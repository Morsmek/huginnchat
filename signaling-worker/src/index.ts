/**
 * Huginn Signaling Worker
 *
 * A Cloudflare Worker using Durable Objects to relay WebRTC signaling
 * messages between peers in the same room.
 *
 * Flow:
 *   1. Peer connects via WebSocket: wss://worker.../room/{roomCode}
 *   2. Peer sends { type: 'hello', id: participantId, name: string }
 *   3. Worker tells all existing peers in the room about the new peer
 *   4. Worker tells the new peer about all existing peers
 *   5. Peers exchange { type: 'signal', to: id, data: any } messages
 *      which the worker forwards to the correct recipient
 *   6. On disconnect, all peers are notified
 */

export interface Env {
  ROOMS: DurableObjectNamespace;
}

// ── Worker entrypoint ────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Upgrade',
        },
      });
    }

    // Route: /room/{roomCode}
    const match = url.pathname.match(/^\/room\/([A-Z0-9]{1,20})$/i);
    if (!match) {
      return new Response('Not found', { status: 404 });
    }

    const roomCode = match[1].toUpperCase();
    const id = env.ROOMS.idFromName(roomCode);
    const room = env.ROOMS.get(id);
    return room.fetch(request);
  },
};

// ── Durable Object: one instance per room ───────────────────────────────────

interface PeerInfo {
  id: string;
  name: string;
  ws: WebSocket;
}

export class Room {
  private peers = new Map<string, PeerInfo>(); // participantId -> PeerInfo
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }

  // ── WebSocket event handlers (called by the runtime) ──────────────────────

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    let data: any;
    try {
      data = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch {
      return;
    }

    if (data.type === 'hello') {
      // New peer introducing itself
      const { id, name } = data as { id: string; name: string };
      if (!id) return;

      // Tell this new peer about everyone already in the room
      const existing = Array.from(this.peers.values()).map(p => ({ id: p.id, name: p.name }));
      this._send(ws, { type: 'peers', peers: existing });

      // Tell everyone else about the new peer
      this._broadcast({ type: 'peer-joined', id, name }, id);

      // Store them
      this.peers.set(id, { id, name, ws });

    } else if (data.type === 'signal') {
      // Relay a signaling message to a specific peer
      const { to, from, payload } = data as { to: string; from: string; payload: any };
      const target = this.peers.get(to);
      if (target) {
        this._send(target.ws, { type: 'signal', from, payload });
      }

    } else if (data.type === 'broadcast') {
      // Relay to all other peers
      const { from, payload } = data as { from: string; payload: any };
      this._broadcast({ type: 'signal', from, payload }, from);
    }
  }

  async webSocketClose(ws: WebSocket) {
    // Find which peer this was and remove them
    for (const [id, peer] of this.peers.entries()) {
      if (peer.ws === ws) {
        this.peers.delete(id);
        this._broadcast({ type: 'peer-left', id }, id);
        break;
      }
    }
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private _send(ws: WebSocket, data: unknown) {
    try {
      ws.send(JSON.stringify(data));
    } catch {}
  }

  private _broadcast(data: unknown, excludeId?: string) {
    for (const peer of this.peers.values()) {
      if (peer.id !== excludeId) {
        this._send(peer.ws, data);
      }
    }
  }
}
