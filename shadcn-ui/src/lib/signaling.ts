/**
 * Signaling — PeerJS for cross-device, BroadcastChannel for same-browser.
 *
 * Simple approach:
 *   - Every peer registers with ID:  huginn-{roomCode}-{participantId}
 *   - The "host" also registers a second peer with a well-known ID:
 *       huginn-{roomCode}-host
 *   - Joiners connect to huginn-{roomCode}-host to get introductions.
 *   - After intro, all peers connect directly to each other (full mesh).
 *
 * We use the default PeerJS cloud (no custom host params) which is the
 * most reliable option since it's the officially maintained server.
 */

declare const Peer: any;

export type SignalMessage =
  | { type: 'join';      from: string; name: string }
  | { type: 'leave';     from: string }
  | { type: 'chat';      from: string; payload: unknown }
  | { type: 'peer-list'; peers: Array<{ id: string; name: string }> };

export type SignalHandler = (msg: SignalMessage) => void;

// ── BroadcastChannel (same browser) ─────────────────────────────────────────

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

// ── PeerJS ───────────────────────────────────────────────────────────────────

export class PeerJSSignaling {
  // Our main peer (unique per participant)
  private peer: any = null;
  // Host-only: the well-known "host" peer for this room
  private hostPeer: any = null;

  private readonly roomCode: string;
  private readonly participantId: string;
  private readonly participantName: string;

  private connections = new Map<string, any>(); // fullId -> DataConnection
  private peerNames  = new Map<string, string>(); // shortId -> name

  private handlers: SignalHandler[] = [];
  private onJoinCb?:  (shortId: string, name: string) => void;
  private onLeaveCb?: (shortId: string) => void;

  private destroyed = false;
  private amHost    = false;

  constructor(roomCode: string, participantId: string, participantName: string) {
    this.roomCode       = roomCode;
    this.participantId  = participantId;
    this.participantName = participantName;
  }

  get myId()   { return `huginn-${this.roomCode}-${this.participantId}`; }
  get hostId() { return `huginn-${this.roomCode}-host`; }

  private short(fullId: string): string {
    const pre = `huginn-${this.roomCode}-`;
    return fullId.startsWith(pre) ? fullId.slice(pre.length) : fullId;
  }
  private isMe(id: string) {
    return id === this.myId || id === this.participantId;
  }

  onMessage(h: SignalHandler)              { this.handlers.push(h); }
  onPeerJoin(cb: (id: string, name: string) => void)  { this.onJoinCb  = cb; }
  onPeerLeave(cb: (id: string) => void)               { this.onLeaveCb = cb; }

  // ── Start ──────────────────────────────────────────────────────────────────

  start(): Promise<void> {
    return new Promise((resolve) => {
      // Use default PeerJS cloud server (no host/port params = uses peerjs.com)
      this.peer = new Peer(this.myId);

      this.peer.on('open', (id: string) => {
        console.log('[PeerJS] main peer open:', id);
        if (this.destroyed) return;

        // Accept incoming direct connections
        this.peer.on('connection', (conn: any) => this._onIncoming(conn));

        // Race to become host
        this._becomeHost(resolve);
      });

      this.peer.on('error', (err: any) => {
        console.warn('[PeerJS main error]', err.type, err.message);
        if (err.type === 'unavailable-id') {
          // Our participant ID clashed — extremely unlikely
          resolve();
          return;
        }
        if (err.type === 'peer-unavailable') return; // expected
        resolve(); // don't block on errors
      });

      setTimeout(resolve, 12000); // hard fallback
    });
  }

  // ── Host logic ─────────────────────────────────────────────────────────────

  private _becomeHost(resolve: () => void) {
    // Try to register the well-known host peer ID
    const hp = new Peer(this.hostId);

    hp.on('open', (id: string) => {
      console.log('[PeerJS] I am the host:', id);
      this.hostPeer = hp;
      this.amHost = true;
      resolve();

      // When a joiner connects to the host peer, send them the peer list
      hp.on('connection', (conn: any) => {
        conn.on('open', () => {
          const joinerShort: string = conn.metadata?.id ?? this.short(conn.peer);
          const joinerName:  string = conn.metadata?.name ?? 'Peer';

          if (this.isMe(joinerShort)) { conn.close(); return; }

          console.log('[PeerJS host] joiner connected:', joinerShort);

          // Tell the joiner about everyone (including ourselves)
          const list = [
            { id: this.participantId, name: this.participantName },
            ...Array.from(this.peerNames.entries()).map(([id, name]) => ({ id, name })),
          ].filter(p => p.id !== joinerShort);

          conn.send({ type: 'peer-list', peers: list });
          // Don't close immediately — wait for message to be sent
          setTimeout(() => conn.close(), 500);

          // Connect directly to the joiner from our main peer
          this._directConnect(joinerShort, joinerName);
        });
        conn.on('error', () => {});
      });

      hp.on('error', (e: any) => console.warn('[PeerJS host error]', e.type));
    });

    hp.on('error', (err: any) => {
      if (err.type === 'unavailable-id') {
        // Someone else is the host — we are a joiner
        console.log('[PeerJS] host taken, joining as peer');
        hp.destroy();
        // Wait a moment then connect to host
        setTimeout(() => this._joinAsClient(resolve), 500);
        return;
      }
      console.warn('[PeerJS host claim error]', err.type);
      hp.destroy();
      setTimeout(() => this._joinAsClient(resolve), 500);
    });
  }

  // ── Joiner logic ───────────────────────────────────────────────────────────

  private _joinAsClient(resolve: () => void, attempt = 0) {
    if (this.destroyed || this.amHost) return;

    console.log(`[PeerJS] connecting to host (attempt ${attempt + 1})`);

    const conn = this.peer.connect(this.hostId, {
      metadata: { id: this.participantId, name: this.participantName },
      reliable: true,
    });

    let opened = false;

    conn.on('open', () => {
      opened = true;
      console.log('[PeerJS] connected to host');
      resolve();
    });

    conn.on('data', (data: any) => {
      if (data?.type === 'peer-list') {
        const peers: Array<{ id: string; name: string }> = data.peers ?? [];
        console.log('[PeerJS] got peer-list from host:', peers);
        for (const p of peers) {
          if (!this.isMe(p.id)) this._directConnect(p.id, p.name);
        }
      }
    });

    conn.on('error', (e: any) => {
      console.warn('[PeerJS joiner error]', e.type);
      if (!opened && attempt < 4 && !this.destroyed && !this.amHost) {
        setTimeout(() => this._joinAsClient(resolve, attempt + 1), 2500);
      }
    });

    conn.on('close', () => {
      if (!opened && attempt < 4 && !this.destroyed && !this.amHost) {
        setTimeout(() => this._joinAsClient(resolve, attempt + 1), 2500);
      }
    });
  }

  // ── Direct peer connections ────────────────────────────────────────────────

  private _directConnect(shortId: string, name: string) {
    if (this.isMe(shortId)) return;
    const fullId = `huginn-${this.roomCode}-${shortId}`;
    if (this.connections.has(fullId)) return;

    console.log('[PeerJS] direct connect to:', shortId);

    const conn = this.peer.connect(fullId, {
      metadata: { id: this.participantId, name: this.participantName },
      reliable: true,
    });

    this._setupConn(conn, shortId, name);
  }

  private _onIncoming(conn: any) {
    const fullId  = conn.peer as string;
    const shortId = this.short(fullId);
    if (this.isMe(fullId) || shortId === 'host') { conn.close(); return; }
    console.log('[PeerJS] incoming connection from:', shortId);
    this._setupConn(conn, shortId, conn.metadata?.name);
  }

  private _setupConn(conn: any, shortId: string, name?: string) {
    if (this.isMe(shortId)) { conn.close(); return; }
    const fullId = `huginn-${this.roomCode}-${shortId}`;

    conn.on('open', () => {
      if (this.destroyed) { conn.close(); return; }
      if (this.connections.has(fullId)) { conn.close(); return; } // duplicate
      this.connections.set(fullId, conn);
      const resolvedName = name ?? conn.metadata?.name ?? 'Peer';
      this.peerNames.set(shortId, resolvedName);
      console.log('[PeerJS] direct connection open with:', shortId);
      this.onJoinCb?.(shortId, resolvedName);
      conn.send({ type: 'join', from: this.participantId, name: this.participantName });
    });

    conn.on('data', (data: any) => {
      if (!data || this.isMe(data.from ?? shortId)) return;
      if (data.type === 'join') {
        if (data.name) this.peerNames.set(shortId, data.name);
        return;
      }
      if (data.type === 'peer-list') return;
      this.handlers.forEach(h => h({ ...data, from: shortId }));
    });

    conn.on('close', () => {
      this.connections.delete(fullId);
      if (!this.isMe(shortId)) this.onLeaveCb?.(shortId);
    });

    conn.on('error', (e: any) => {
      if (e?.type !== 'peer-unavailable') console.warn('[PeerJS conn]', e);
    });
  }

  // ── Broadcast ──────────────────────────────────────────────────────────────

  broadcast(msg: SignalMessage) {
    this.connections.forEach((conn) => {
      if (conn.open) conn.send(msg);
    });
  }

  destroy() {
    this.destroyed = true;
    this.connections.forEach(c => c.close());
    this.connections.clear();
    this.peer?.destroy();
    this.hostPeer?.destroy();
    this.hostPeer = null;
  }
}
