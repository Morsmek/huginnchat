/**
 * Signaling via PeerJS (free public server) + BroadcastChannel fallback.
 *
 * PeerJS handles WebRTC offer/answer automatically for cross-device connections.
 * BroadcastChannel handles instant same-browser tab-to-tab connections.
 *
 * The encryption key is NEVER sent through PeerJS — it is derived locally
 * from the room code. PeerJS only sees encrypted WebRTC data channel traffic.
 *
 * How peer discovery works:
 *  - Each peer registers on PeerJS as "huginn-{roomCode}-{participantId}"
 *  - There is also a "lobby" peer ID: "huginn-{roomCode}-000" which the
 *    first peer to arrive claims. New peers call the lobby to announce
 *    themselves. The lobby peer calls back all known peers in the room.
 *  - BroadcastChannel covers same-browser scenarios with zero latency.
 */

// PeerJS is loaded via CDN in index.html — declare the global type
declare const Peer: any;

export type SignalMessage =
  | { type: 'join';   from: string; name: string }
  | { type: 'leave';  from: string }
  | { type: 'chat';   from: string; payload: unknown };

export type SignalHandler = (msg: SignalMessage) => void;

// ── BroadcastChannel (same browser) ────────────────────────────────────────

export class LocalSignalingChannel {
  private channel: BroadcastChannel;
  private peerId: string;
  private handlers: SignalHandler[] = [];

  constructor(roomId: string, peerId: string) {
    this.peerId = peerId;
    this.channel = new BroadcastChannel(`huginn::${roomId}`);
    this.channel.onmessage = (e) => {
      if (e.data?.from !== this.peerId) {
        this.handlers.forEach((h) => h(e.data));
      }
    };
  }

  send(msg: SignalMessage) { this.channel.postMessage(msg); }

  onMessage(handler: SignalHandler): () => void {
    this.handlers.push(handler);
    return () => { this.handlers = this.handlers.filter((h) => h !== handler); };
  }

  close() { this.channel.close(); }
}

// ── PeerJS (cross-device) ───────────────────────────────────────────────────

export type PeerDataMessage = SignalMessage;

export interface PeerConnection {
  peerId: string;
  conn: any; // PeerJS DataConnection
}

/**
 * Manages PeerJS connections for a room.
 * Peer IDs are formatted as: huginn-{roomCode}-{participantId}
 * Lobby ID:                   huginn-{roomCode}-lobby
 */
export class PeerJSSignaling {
  private peer: any = null;
  private roomCode: string;
  private participantId: string;
  private participantName: string;
  private connections = new Map<string, any>(); // peerId -> DataConnection
  private handlers: SignalHandler[] = [];
  private onConnectCallback?: (peerId: string, name: string) => void;
  private onDisconnectCallback?: (peerId: string) => void;
  private destroyed = false;

  constructor(roomCode: string, participantId: string, participantName: string) {
    this.roomCode = roomCode;
    this.participantId = participantId;
    this.participantName = participantName;
  }

  get myPeerId(): string {
    return `huginn-${this.roomCode}-${this.participantId}`;
  }

  get lobbyPeerId(): string {
    return `huginn-${this.roomCode}-lobby`;
  }

  onMessage(handler: SignalHandler): () => void {
    this.handlers.push(handler);
    return () => { this.handlers = this.handlers.filter((h) => h !== handler); };
  }

  onConnect(cb: (peerId: string, name: string) => void) { this.onConnectCallback = cb; }
  onDisconnect(cb: (peerId: string) => void) { this.onDisconnectCallback = cb; }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Use the free PeerJS public server
        this.peer = new Peer(this.myPeerId, {
          host: '0.peerjs.com',
          port: 443,
          path: '/',
          secure: true,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun.cloudflare.com:3478' },
            ],
          },
        });

        this.peer.on('open', () => {
          if (this.destroyed) return;
          // Try to connect to the lobby to announce ourselves
          this._connectToLobby();
          // Also try to claim the lobby role ourselves
          this._tryClaimLobby();
          resolve();
        });

        this.peer.on('connection', (conn: any) => {
          this._setupConnection(conn);
        });

        this.peer.on('error', (err: any) => {
          // ID taken errors are fine (someone else has lobby)
          if (err.type === 'unavailable-id') {
            resolve();
            return;
          }
          console.warn('[PeerJS]', err.type, err.message);
          if (err.type === 'peer-unavailable') return; // normal — peer not online yet
          reject(err);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  private _connectToLobby() {
    const conn = this.peer.connect(this.lobbyPeerId, {
      metadata: { name: this.participantName, id: this.participantId },
      reliable: true,
    });
    if (conn) this._setupConnection(conn, true);
  }

  private _tryClaimLobby() {
    // Try to also register a lobby peer — will fail gracefully if taken
    const lobbyPeer = new Peer(this.lobbyPeerId, {
      host: '0.peerjs.com',
      port: 443,
      path: '/',
      secure: true,
    });
    lobbyPeer.on('open', () => {
      // We are the lobby — accept connections and forward join announcements
      lobbyPeer.on('connection', (conn: any) => {
        conn.on('open', () => {
          // Tell this new peer about all currently connected peers
          const knownPeers = Array.from(this.connections.keys());
          conn.send({ type: 'peer-list', peers: knownPeers });
          // Tell all existing peers about this new arrival
          this.broadcast({ type: 'join', from: conn.metadata?.id || conn.peer, name: conn.metadata?.name || 'Peer' });
        });
      });
    });
    lobbyPeer.on('error', () => {
      // Someone else has the lobby — that's fine
      lobbyPeer.destroy();
    });
  }

  private _setupConnection(conn: any, isOutgoing = false) {
    const remotePeerId = conn.peer;

    conn.on('open', () => {
      if (this.destroyed) { conn.close(); return; }
      this.connections.set(remotePeerId, conn);
      // Extract short ID from "huginn-{code}-{id}" format
      const shortId = remotePeerId.replace(`huginn-${this.roomCode}-`, '');
      const name = conn.metadata?.name || 'Peer';
      this.onConnectCallback?.(shortId, name);
      // Announce ourselves
      conn.send({ type: 'join', from: this.participantId, name: this.participantName });
    });

    conn.on('data', (data: any) => {
      if (data?.type === 'peer-list') {
        // Connect to all known peers
        for (const peerId of (data.peers as string[])) {
          if (!this.connections.has(peerId) && peerId !== this.myPeerId) {
            const c = this.peer.connect(peerId, {
              metadata: { name: this.participantName, id: this.participantId },
              reliable: true,
            });
            if (c) this._setupConnection(c);
          }
        }
        return;
      }
      this.handlers.forEach((h) => h(data as SignalMessage));
    });

    conn.on('close', () => {
      this.connections.delete(remotePeerId);
      const shortId = remotePeerId.replace(`huginn-${this.roomCode}-`, '');
      this.onDisconnectCallback?.(shortId);
    });

    conn.on('error', (e: any) => console.warn('[PeerJS conn]', e));
  }

  broadcast(msg: SignalMessage) {
    const str = JSON.stringify(msg);
    this.connections.forEach((conn) => {
      if (conn.open) conn.send(msg);
    });
  }

  sendTo(peerId: string, msg: SignalMessage) {
    // Look up by short ID or full peer ID
    const fullId = peerId.startsWith('huginn-') ? peerId : `huginn-${this.roomCode}-${peerId}`;
    const conn = this.connections.get(fullId);
    if (conn?.open) conn.send(msg);
  }

  destroy() {
    this.destroyed = true;
    this.connections.forEach((conn) => conn.close());
    this.connections.clear();
    this.peer?.destroy();
  }
}
