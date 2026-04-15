/**
 * Huginn Signaling Worker — Cloudflare Durable Object
 *
 * Uses server.accept() (NOT state.acceptWebSocket) so the Durable Object
 * stays alive in memory between messages and the `peers` Map persists.
 *
 * Flow:
 *   1. Peer connects: wss://huginn-signaling.morten-6e8.workers.dev/room/{code}
 *   2. Peer sends { type: 'hello', id, name }
 *   3. Worker sends back { type: 'peers', peers: [{id,name},...] }
 *   4. Worker broadcasts { type: 'peer-joined', id, name } to others
 *   5. Peers exchange { type: 'signal', to, from, payload } — relayed directly
 *   6. On disconnect → { type: 'peer-left', id } broadcast
 */

export interface Env {
  ROOMS: DurableObjectNamespace;
}

// ── Worker entrypoint ────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Upgrade',
        },
      });
    }

    const match = url.pathname.match(/^\/room\/([A-Za-z0-9]{1,20})$/);
    if (!match) return new Response('Not found', { status: 404 });

    const roomCode = match[1].toUpperCase();
    const id = env.ROOMS.idFromName(roomCode);
    const room = env.ROOMS.get(id);
    return room.fetch(request);
  },
};

// ── Durable Object ───────────────────────────────────────────────────────────

interface PeerInfo {
  id: string;
  name: string;
  ws: WebSocket;
}

export class Room {
  // In-memory map — persists as long as the DO is alive (not hibernating)
  private peers = new Map<string, PeerInfo>();

  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();

    // IMPORTANT: use server.accept() not state.acceptWebSocket()
    // acceptWebSocket() enables hibernation which wipes in-memory state between messages.
    // server.accept() keeps the DO alive and the peers Map intact.
    server.accept();

    server.addEventListener('message', (event: MessageEvent) => {
      this._onMessage(server, typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer));
    });

    server.addEventListener('close', () => {
      this._onClose(server);
    });

    server.addEventListener('error', () => {
      this._onClose(server);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }

  private _onMessage(ws: WebSocket, raw: string) {
    let data: any;
    try { data = JSON.parse(raw); } catch { return; }

    if (data.type === 'hello') {
      const { id, name } = data as { id: string; name: string };
      if (!id) return;

      // Send this peer the list of everyone already here
      const existing = Array.from(this.peers.values()).map(p => ({ id: p.id, name: p.name }));
      this._send(ws, { type: 'peers', peers: existing });

      // Tell everyone else
      this._broadcast({ type: 'peer-joined', id, name }, id);

      // Register
      this.peers.set(id, { id, name, ws });

    } else if (data.type === 'signal') {
      const { to, from, payload } = data as { to: string; from: string; payload: unknown };
      const target = this.peers.get(to);
      if (target) this._send(target.ws, { type: 'signal', from, payload });

    } else if (data.type === 'broadcast') {
      const { from, payload } = data as { from: string; payload: unknown };
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

  private _send(ws: WebSocket, data: unknown) {
    try { ws.send(JSON.stringify(data)); } catch {}
  }

  private _broadcast(data: unknown, excludeId?: string) {
    for (const peer of this.peers.values()) {
      if (peer.id !== excludeId) this._send(peer.ws, data);
    }
  }
}
