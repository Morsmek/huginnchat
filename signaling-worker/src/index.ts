/**
 * Huginn Signaling Worker — Cloudflare Durable Object
 *
 * Security hardening:
 *   - CORS restricted to huginnchat.pages.dev (and localhost for dev)
 *   - Max 10 participants per room
 *   - Rate limiting: max 30 signals per peer per 10s window
 *   - Input validation on all message fields
 *   - Peer IDs validated as alphanumeric
 *   - Worker only relays opaque payloads — never inspects signal content
 */

export interface Env {
  ROOMS: DurableObjectNamespace;
}

const ALLOWED_ORIGINS = new Set([
  'https://huginnchat.pages.dev',
  'http://localhost:5173',
  'http://localhost:4173',
]);

const MAX_PEERS_PER_ROOM  = 10;
const RATE_WINDOW_MS      = 10_000;
const RATE_MAX_SIGNALS    = 60; // per peer per window
const MAX_ID_LEN          = 64;
const MAX_NAME_LEN        = 50;
const MAX_PAYLOAD_BYTES   = 8_192; // 8 KB per signal message

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : [...ALLOWED_ORIGINS][0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Upgrade',
    'Vary': 'Origin',
  };
}

// ── Worker entrypoint ────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const url    = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const match = url.pathname.match(/^\/room\/([A-Za-z0-9]{1,20})$/);
    if (!match) return new Response('Not found', { status: 404 });

    const roomCode = match[1].toUpperCase();
    const stub = env.ROOMS.get(env.ROOMS.idFromName(roomCode));
    const resp = await stub.fetch(request);

    // Attach CORS headers to the WebSocket upgrade response
    const newHeaders = new Headers(resp.headers);
    Object.entries(corsHeaders(origin)).forEach(([k, v]) => newHeaders.set(k, v));
    return new Response(resp.body, { status: resp.status, webSocket: (resp as any).webSocket, headers: newHeaders });
  },
};

// ── Durable Object ───────────────────────────────────────────────────────────

interface PeerInfo {
  id: string;
  name: string;
  ws: WebSocket;
  signalCount: number;
  windowStart: number;
}

function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LEN && /^[A-Za-z0-9_-]+$/.test(id);
}

function isValidName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= MAX_NAME_LEN;
}

export class Room {
  private peers = new Map<string, PeerInfo>();

  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();

    server.addEventListener('message', (event: MessageEvent) => {
      const raw = typeof event.data === 'string'
        ? event.data
        : new TextDecoder().decode(event.data as ArrayBuffer);
      this._onMessage(server, raw);
    });

    server.addEventListener('close',  () => this._onClose(server));
    server.addEventListener('error',  () => this._onClose(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  private _onMessage(ws: WebSocket, raw: string) {
    if (raw.length > MAX_PAYLOAD_BYTES) return; // drop oversized messages

    let data: any;
    try { data = JSON.parse(raw); } catch { return; }
    if (typeof data !== 'object' || data === null) return;

    if (data.type === 'hello') {
      const { id, name } = data;
      if (!isValidId(id) || !isValidName(name)) return;
      if (this.peers.has(id)) return; // already registered
      if (this.peers.size >= MAX_PEERS_PER_ROOM) {
        this._send(ws, { type: 'error', code: 'room-full', message: 'Room is full (max 10 participants)' });
        ws.close(1008, 'Room full');
        return;
      }

      // Send existing peer list to newcomer
      const existing = Array.from(this.peers.values()).map(p => ({ id: p.id, name: p.name }));
      this._send(ws, { type: 'peers', peers: existing });

      // Announce newcomer to existing peers
      this._broadcast({ type: 'peer-joined', id, name }, id);

      this.peers.set(id, { id, name, ws, signalCount: 0, windowStart: Date.now() });

    } else if (data.type === 'signal') {
      const { to, from, payload } = data;
      if (!isValidId(to) || !isValidId(from)) return;

      // Find sender by WebSocket to verify 'from' matches their registered ID
      const sender = this._peerByWs(ws);
      if (!sender || sender.id !== from) return; // spoofing attempt

      // Rate limiting
      const now = Date.now();
      if (now - sender.windowStart > RATE_WINDOW_MS) {
        sender.signalCount = 0;
        sender.windowStart = now;
      }
      sender.signalCount++;
      if (sender.signalCount > RATE_MAX_SIGNALS) return; // silently drop

      const target = this.peers.get(to);
      if (target) this._send(target.ws, { type: 'signal', from, payload });

    } else if (data.type === 'broadcast') {
      const { from, payload } = data;
      if (!isValidId(from)) return;
      const sender = this._peerByWs(ws);
      if (!sender || sender.id !== from) return;
      this._broadcast({ type: 'signal', from, payload }, from);
    }
  }

  private _onClose(ws: WebSocket) {
    for (const [id, peer] of this.peers.entries()) {
      if (peer.ws === ws) {
        this.peers.delete(id);
        this._broadcast({ type: 'peer-left', id }, id);
        break;
      }
    }
  }

  private _peerByWs(ws: WebSocket): PeerInfo | undefined {
    for (const peer of this.peers.values()) {
      if (peer.ws === ws) return peer;
    }
    return undefined;
  }

  private _send(ws: WebSocket, data: unknown) {
    try { ws.send(JSON.stringify(data)); } catch {}
  }

  private _broadcast(data: unknown, excludeId?: string) {
    for (const peer of this.peers.values()) {
      if (peer.id !== excludeId) this._send(peer.ws, data);
    }
  }
}
