/**
 * Signaling — PeerJS for cross-device, BroadcastChannel for same-browser.
 *
 * Connection flow:
 *
 *  The room has a well-known "anchor" PeerJS ID: huginn-{roomCode}
 *  Each participant has their own ID:            huginn-{roomCode}-{participantId}
 *
 *  Step 1 — every peer tries to CLAIM the anchor ID.
 *  Step 2a — if claim succeeds → you are the "host". Accept incoming
 *             connections. When a new peer connects via the anchor, send
 *             them the list of all connected participant IDs, then connect
 *             directly to the new peer from your main peer ID.
 *  Step 2b — if claim fails → someone else is host. Connect to the anchor
 *             to receive the peer list, then form direct connections.
 *
 *  PeerJS server: api.peerjs.com (current live server, not the deprecated 0.peerjs.com)
 */

declare const Peer: any;

export type SignalMessage =
  | { type: 'join';      from: string; name: string }
  | { type: 'leave';     from: string }
  | { type: 'chat';      from: string; payload: unknown }
  | { type: 'peer-list'; peers: Array<{ id: string; name: string }> };

export type SignalHandler = (msg: SignalMessage) => void;

const PEER_CFG = {
  // Use api.peerjs.com — the current maintained PeerJS cloud server
  host: 'api.peerjs.com',
  port: 443,
  path: '/',
  secure: true,
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  },
};

// ── BroadcastChannel (same browser, same origin) ─────────────────────────

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
  onMessage(h: SignalHandler): () => void {
    this.handlers.push(h);
    return () => { this.handlers = this.handlers.filter((x) => x !== h); };
  }
  close() { this.channel.close(); }
}

// ── PeerJS mesh ──────────────────────────────────────────────────────────

export class PeerJSSignaling {
  private mainPeer: any = null;
  private anchorPeer: any = null; // only held if we are the host

  private readonly roomCode: string;
  private readonly participantId: string;
  private readonly participantName: string;

  // fullId -> DataConnection  (direct participant-to-participant)
  private connections = new Map<string, any>();
  // shortId -> name
  private peerNames = new Map<string, string>();

  private handlers: SignalHandler[] = [];
  private onJoinCb?: (shortId: string, name: string) => void;
  private onLeaveCb?: (shortId: string) => void;

  private destroyed = false;
  private isHost = false; // did we successfully claim the anchor?

  constructor(roomCode: string, participantId: string, participantName: string) {
    this.roomCode = roomCode;
    this.participantId = participantId;
    this.participantName = participantName;
  }

  // ── ID helpers ───────────────────────────────────────────────────────────

  get myFullId() { return `huginn-${this.roomCode}-${this.participantId}`; }
  get anchorId() { return `huginn-${this.roomCode}`; }

  private toShort(fullId: string): string {
    // huginn-{code}-{shortId} → shortId
    const prefix = `huginn-${this.roomCode}-`;
    if (fullId.startsWith(prefix)) return fullId.slice(prefix.length);
    return fullId;
  }

  private isMe(id: string): boolean {
    return id === this.myFullId || id === this.participantId;
  }

  // ── Events ───────────────────────────────────────────────────────────────

  onMessage(h: SignalHandler): () => void {
    this.handlers.push(h);
    return () => { this.handlers = this.handlers.filter((x) => x !== h); };
  }
  onPeerJoin(cb: (shortId: string, name: string) => void) { this.onJoinCb = cb; }
  onPeerLeave(cb: (shortId: string) => void) { this.onLeaveCb = cb; }

  // ── Start ────────────────────────────────────────────────────────────────

  start(): Promise<void> {
    return new Promise((resolve) => {
      const main = new Peer(this.myFullId, PEER_CFG);
      this.mainPeer = main;

      main.on('open', () => {
        if (this.destroyed) return;

        // Accept incoming direct connections (from host forwarding us to others)
        main.on('connection', (conn: any) => this._setupDirectConn(conn));

        // Race: try to claim anchor AND connect to it simultaneously.
        // Exactly one will win. We set a short delay on the join path so the
        // creator's claim has a chance to open first.
        this._tryClaimAnchor(resolve);
        setTimeout(() => {
          if (!this.isHost && !this.destroyed) {
            this._joinViaAnchor(resolve);
          }
        }, 1500);

        // Safety resolve after 10s
        setTimeout(() => resolve(), 10000);
      });

      main.on('error', (err: any) => {
        if (err.type === 'unavailable-id') {
          // Our participant ID is somehow taken — generate a suffix and retry
          console.warn('[PeerJS] main ID taken, this should not happen');
          resolve();
          return;
        }
        if (err.type === 'peer-unavailable') return;
        console.warn('[PeerJS main]', err.type, err.message);
        resolve(); // non-fatal — fall back to local-only
      });
    });
  }

  // ── Host path (claim anchor) ──────────────────────────────────────────────

  private _tryClaimAnchor(resolve: () => void) {
    const ap = new Peer(this.anchorId, PEER_CFG);

    ap.on('open', () => {
      if (this.destroyed) { ap.destroy(); return; }
      this.anchorPeer = ap;
      this.isHost = true;
      console.log('[PeerJS] I am the host (anchor claimed)');
      resolve(); // host is ready

      // Accept connections on the anchor — these are join requests from newcomers
      ap.on('connection', (anchorConn: any) => {
        anchorConn.on('open', () => {
          const joinerShortId: string = anchorConn.metadata?.id ?? this.toShort(anchorConn.peer);
          const joinerName: string = anchorConn.metadata?.name ?? 'Peer';

          if (this.isMe(joinerShortId)) { anchorConn.close(); return; }

          // Send the joiner the list of all currently connected peers
          // (including ourselves — the host)
          const peerList = [
            { id: this.participantId, name: this.participantName },
            ...Array.from(this.peerNames.entries()).map(([id, name]) => ({ id, name })),
          ].filter((p) => p.id !== joinerShortId);

          anchorConn.send({ type: 'peer-list', peers: peerList });
          anchorConn.close(); // intro only

          // Initiate a direct connection to the joiner
          if (!this.connections.has(`huginn-${this.roomCode}-${joinerShortId}`)) {
            this._openDirectConn(joinerShortId, joinerName);
          }
        });

        anchorConn.on('error', () => {});
      });

      ap.on('error', (e: any) => console.warn('[PeerJS anchor]', e.type));
    });

    ap.on('error', (err: any) => {
      if (err.type === 'unavailable-id') {
        // Anchor is already taken — we are a joiner, not the host
        ap.destroy();
        return;
      }
      console.warn('[PeerJS anchor claim]', err.type);
      ap.destroy();
    });
  }

  // ── Joiner path (connect to anchor) ──────────────────────────────────────

  private _joinViaAnchor(resolve: () => void, attempt = 0) {
    if (this.destroyed || this.isHost) return;

    const conn = this.mainPeer.connect(this.anchorId, {
      metadata: { id: this.participantId, name: this.participantName },
      reliable: true,
    });

    let opened = false;

    conn.on('open', () => {
      opened = true;
      console.log('[PeerJS] connected to anchor, waiting for peer-list');
      resolve(); // we're connected
    });

    conn.on('data', (data: any) => {
      if (data?.type === 'peer-list') {
        const peers: Array<{ id: string; name: string }> = data.peers ?? [];
        console.log('[PeerJS] received peer-list:', peers);
        for (const p of peers) {
          if (!this.isMe(p.id)) {
            this._openDirectConn(p.id, p.name);
          }
        }
      }
    });

    conn.on('error', (e: any) => {
      if (!opened && attempt < 5 && !this.destroyed && !this.isHost) {
        console.log(`[PeerJS] anchor connect failed (attempt ${attempt + 1}), retrying...`);
        setTimeout(() => this._joinViaAnchor(resolve, attempt + 1), 2000);
      }
    });
  }

  // ── Direct peer-to-peer connections ──────────────────────────────────────

  private _openDirectConn(shortId: string, name: string) {
    if (this.isMe(shortId)) return;
    const fullId = `huginn-${this.roomCode}-${shortId}`;
    if (this.connections.has(fullId)) return;

    console.log('[PeerJS] opening direct connection to', shortId);
    const conn = this.mainPeer.connect(fullId, {
      metadata: { id: this.participantId, name: this.participantName },
      reliable: true,
    });

    this._setupDirectConn(conn, shortId, name);
  }

  private _setupDirectConn(conn: any, knownShortId?: string, knownName?: string) {
    const fullId: string = conn.peer;
    const shortId = knownShortId ?? this.toShort(fullId);

    // Reject self-connections
    if (this.isMe(fullId) || this.isMe(shortId)) { conn.close(); return; }

    conn.on('open', () => {
      if (this.destroyed) { conn.close(); return; }
      this.connections.set(fullId, conn);
      const name = knownName ?? (conn.metadata?.name as string) ?? 'Peer';
      this.peerNames.set(shortId, name);
      this.onJoinCb?.(shortId, name);
      // Introduce ourselves
      conn.send({ type: 'join', from: this.participantId, name: this.participantName });
    });

    conn.on('data', (data: any) => {
      if (!data) return;
      const from: string = data.from ?? shortId;
      if (this.isMe(from)) return;

      if (data.type === 'join') {
        // Update name — join is already fired on open
        if (data.name) this.peerNames.set(shortId, data.name);
        return;
      }
      this.handlers.forEach((h) => h({ ...data, from: shortId }));
    });

    conn.on('close', () => {
      this.connections.delete(fullId);
      if (!this.isMe(shortId)) this.onLeaveCb?.(shortId);
    });

    conn.on('error', (e: any) => {
      if (e?.type !== 'peer-unavailable') console.warn('[PeerJS direct conn]', e);
    });
  }

  // ── Broadcast ─────────────────────────────────────────────────────────────

  broadcast(msg: SignalMessage) {
    this.connections.forEach((conn) => {
      if (conn.open) conn.send(msg);
    });
  }

  // ── Destroy ───────────────────────────────────────────────────────────────

  destroy() {
    this.destroyed = true;
    this.connections.forEach((c) => c.close());
    this.connections.clear();
    this.mainPeer?.destroy();
    this.anchorPeer?.destroy();
    this.anchorPeer = null;
  }
}
