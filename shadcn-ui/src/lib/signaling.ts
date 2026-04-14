/**
 * Signaling via PeerJS (free public server) + BroadcastChannel fallback.
 *
 * PeerJS handles WebRTC offer/answer automatically for cross-device connections.
 * BroadcastChannel handles instant same-browser tab-to-tab connections.
 *
 * Peer discovery strategy (no lobby peer — lobby caused self-connect bugs):
 *   Each peer registers as: huginn-{roomCode}-{participantId}
 *   When peer A joins, it attempts to connect to the well-known "roster" peer:
 *     huginn-{roomCode}-roster
 *   The roster peer is simply the first peer that arrived.  It keeps a list of
 *   all live peer IDs and hands them to newcomers via a "peer-list" message.
 *   If the roster peer is unreachable the newcomer tries to claim the role.
 *
 *   Key guarantee: a peer NEVER connects to itself. Every connect/data call
 *   checks remotePeerId !== myPeerId before proceeding.
 */

// PeerJS is loaded via CDN in index.html — declare the global type
declare const Peer: any;

export type SignalMessage =
  | { type: 'join';       from: string; name: string }
  | { type: 'leave';      from: string }
  | { type: 'chat';       from: string; payload: unknown }
  | { type: 'peer-list';  peers: Array<{ id: string; name: string }> };

export type SignalHandler = (msg: SignalMessage) => void;

// ── BroadcastChannel (same browser, same origin) ────────────────────────────

export class LocalSignalingChannel {
  private channel: BroadcastChannel;
  private peerId: string;
  private handlers: SignalHandler[] = [];

  constructor(roomId: string, peerId: string) {
    this.peerId = peerId;
    this.channel = new BroadcastChannel(`huginn::${roomId}`);
    this.channel.onmessage = (e) => {
      // Ignore our own messages
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

const PEERJS_CONFIG = {
  host: '0.peerjs.com',
  port: 443,
  path: '/',
  secure: true,
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
  },
};

const ROSTER_SUFFIX = 'roster';

/**
 * PeerJSSignaling manages a PeerJS peer and a mesh of data-channel connections.
 *
 * Emits:
 *   onPeerJoin(shortId, name)      — a remote peer has connected and introduced itself
 *   onPeerLeave(shortId)           — a remote peer's connection closed
 *   onMessage(msg: SignalMessage)  — a chat message arrived from a remote peer
 */
export class PeerJSSignaling {
  private peer: any = null;
  private rosterPeer: any = null; // second Peer instance, only when we hold the roster role

  private roomCode: string;
  private participantId: string;
  private participantName: string;

  // peerId -> DataConnection  (only actual remote participant peers, not roster)
  private connections = new Map<string, any>();
  // shortId -> name  (for peers known from the peer-list before they connect)
  private knownPeers = new Map<string, string>();

  private handlers: SignalHandler[] = [];
  private onJoinCallback?: (shortId: string, name: string) => void;
  private onLeaveCallback?: (shortId: string) => void;

  private destroyed = false;

  constructor(roomCode: string, participantId: string, participantName: string) {
    this.roomCode = roomCode;
    this.participantId = participantId;
    this.participantName = participantName;
  }

  // ── Public ID helpers ──────────────────────────────────────────────────────

  get myPeerId(): string {
    return `huginn-${this.roomCode}-${this.participantId}`;
  }

  private get rosterPeerId(): string {
    return `huginn-${this.roomCode}-${ROSTER_SUFFIX}`;
  }

  private shortId(fullPeerId: string): string {
    return fullPeerId.replace(`huginn-${this.roomCode}-`, '');
  }

  private isMyself(fullOrShortId: string): boolean {
    return (
      fullOrShortId === this.myPeerId ||
      fullOrShortId === this.participantId
    );
  }

  // ── Event registration ─────────────────────────────────────────────────────

  onMessage(handler: SignalHandler): () => void {
    this.handlers.push(handler);
    return () => { this.handlers = this.handlers.filter((h) => h !== handler); };
  }

  onPeerJoin(cb: (shortId: string, name: string) => void) { this.onJoinCallback = cb; }
  onPeerLeave(cb: (shortId: string) => void) { this.onLeaveCallback = cb; }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.peer = new Peer(this.myPeerId, PEERJS_CONFIG);

        this.peer.on('open', (id: string) => {
          if (this.destroyed) return;
          // Accept incoming connections from other peers
          this.peer.on('connection', (conn: any) => {
            this._setupIncoming(conn);
          });
          // Announce ourselves to the room
          this._joinRoom();
          resolve();
        });

        this.peer.on('error', (err: any) => {
          if (err.type === 'unavailable-id') {
            // Our chosen peer ID is taken — extremely unlikely with UUID-based IDs
            console.warn('[PeerJS] peer ID taken, retrying with new ID');
            resolve(); // non-fatal
            return;
          }
          if (err.type === 'peer-unavailable') return; // normal — remote peer not yet online
          console.warn('[PeerJS] error:', err.type, err.message);
          reject(err);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // ── Room join flow ─────────────────────────────────────────────────────────

  private _joinRoom() {
    // Step 1: try to connect to the existing roster peer to get the peer list
    const rosterConn = this.peer.connect(this.rosterPeerId, {
      metadata: { id: this.participantId, name: this.participantName },
      reliable: true,
    });

    let rosterResponded = false;

    rosterConn.on('open', () => {
      rosterResponded = true;
      // Roster peer will send us the peer list, then we connect to each one
    });

    rosterConn.on('data', (data: any) => {
      if (data?.type === 'peer-list') {
        const peers: Array<{ id: string; name: string }> = data.peers || [];
        for (const p of peers) {
          if (!this.isMyself(p.id)) {
            this.knownPeers.set(p.id, p.name);
            this._connectToPeer(p.id, p.name);
          }
        }
        rosterConn.close(); // done with roster — direct connections take over
      }
    });

    rosterConn.on('error', () => {
      // Roster peer unavailable — we become the roster
      if (!rosterResponded) {
        this._claimRoster();
      }
    });

    // If roster doesn't respond within 3 seconds, claim the role
    setTimeout(() => {
      if (!rosterResponded && !this.destroyed) {
        this._claimRoster();
      }
    }, 3000);
  }

  private _claimRoster() {
    if (this.destroyed || this.rosterPeer) return;

    this.rosterPeer = new Peer(this.rosterPeerId, {
      ...PEERJS_CONFIG,
      // Roster peer uses same ICE config
    });

    this.rosterPeer.on('open', () => {
      this.rosterPeer.on('connection', (conn: any) => {
        conn.on('open', () => {
          // Send the new peer a list of everyone currently connected
          const currentPeers = Array.from(this.connections.entries())
            .filter(([fullId]) => !this.isMyself(fullId))
            .map(([fullId, _]) => ({
              id: this.shortId(fullId),
              name: this.knownPeers.get(this.shortId(fullId)) || 'Peer',
            }));

          conn.send({ type: 'peer-list', peers: currentPeers });
        });

        conn.on('error', () => {});
      });
    });

    this.rosterPeer.on('error', (err: any) => {
      if (err.type === 'unavailable-id') {
        // Someone else claimed roster first — that's fine
        this.rosterPeer?.destroy();
        this.rosterPeer = null;
        // Try to join through the new roster
        setTimeout(() => this._joinRoom(), 500);
      }
    });
  }

  private _connectToPeer(shortId: string, name: string) {
    if (this.isMyself(shortId)) return;
    const fullId = `huginn-${this.roomCode}-${shortId}`;
    if (this.connections.has(fullId)) return; // already connected

    const conn = this.peer.connect(fullId, {
      metadata: { id: this.participantId, name: this.participantName },
      reliable: true,
    });

    this._setupOutgoing(conn, shortId, name);
  }

  // ── Connection setup ───────────────────────────────────────────────────────

  /** Incoming connection initiated by a remote peer */
  private _setupIncoming(conn: any) {
    const fullId: string = conn.peer;
    const shortId = this.shortId(fullId);

    if (this.isMyself(fullId) || shortId === ROSTER_SUFFIX) {
      conn.close();
      return;
    }

    conn.on('open', () => {
      if (this.destroyed) { conn.close(); return; }
      this.connections.set(fullId, conn);
      const name: string = conn.metadata?.name || 'Peer';
      this.knownPeers.set(shortId, name);
      // Fire join event
      this.onJoinCallback?.(shortId, name);
      // Send our own intro
      conn.send({ type: 'join', from: this.participantId, name: this.participantName });
    });

    conn.on('data', (data: any) => this._handleData(data, shortId));
    conn.on('close', () => this._handleClose(fullId, shortId));
    conn.on('error', (e: any) => console.warn('[PeerJS incoming conn]', e));
  }

  /** Outgoing connection we initiated */
  private _setupOutgoing(conn: any, expectedShortId: string, expectedName: string) {
    const fullId = `huginn-${this.roomCode}-${expectedShortId}`;

    if (this.isMyself(fullId)) return;

    conn.on('open', () => {
      if (this.destroyed) { conn.close(); return; }
      this.connections.set(fullId, conn);
      this.knownPeers.set(expectedShortId, expectedName);
      // Fire join event
      this.onJoinCallback?.(expectedShortId, expectedName);
      // Send our own intro
      conn.send({ type: 'join', from: this.participantId, name: this.participantName });
    });

    conn.on('data', (data: any) => this._handleData(data, expectedShortId));
    conn.on('close', () => this._handleClose(fullId, expectedShortId));
    conn.on('error', (e: any) => {
      // Peer unavailable is expected when joining an empty room
      if (e?.type !== 'peer-unavailable') console.warn('[PeerJS outgoing conn]', e);
    });
  }

  private _handleData(data: any, fromShortId: string) {
    if (!data || this.isMyself(fromShortId)) return;

    if (data.type === 'join') {
      // Remote peer introduced themselves — update name if we have them
      const name = data.name || 'Peer';
      this.knownPeers.set(fromShortId, name);
      // Don't fire onJoinCallback again — already fired in _setupIncoming/Outgoing
      return;
    }

    if (data.type === 'peer-list') return; // handled at join time only

    this.handlers.forEach((h) => h({ ...data, from: fromShortId }));
  }

  private _handleClose(fullId: string, shortId: string) {
    this.connections.delete(fullId);
    if (!this.isMyself(shortId)) {
      this.onLeaveCallback?.(shortId);
    }
  }

  // ── Broadcast ──────────────────────────────────────────────────────────────

  broadcast(msg: Omit<SignalMessage, 'from'> & { from: string }) {
    this.connections.forEach((conn) => {
      if (conn.open) conn.send(msg);
    });
  }

  // ── Teardown ───────────────────────────────────────────────────────────────

  destroy() {
    this.destroyed = true;
    this.connections.forEach((conn) => conn.close());
    this.connections.clear();
    this.peer?.destroy();
    this.rosterPeer?.destroy();
    this.rosterPeer = null;
  }
}
