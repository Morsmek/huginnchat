/**
 * Signaling via Cloudflare Worker WebSocket + BroadcastChannel (same browser).
 *
 * The Cloudflare Worker at SIGNALING_URL acts as a simple relay:
 *   - Each peer connects to wss://huginn-signaling.{account}.workers.dev/room/{roomCode}
 *   - Sends { type: 'hello', id, name } to introduce itself
 *   - Receives { type: 'peers', peers: [{id, name}] } — existing peers in the room
 *   - Receives { type: 'peer-joined', id, name } — when someone new joins
 *   - Receives { type: 'peer-left', id } — when someone disconnects
 *   - Sends/receives { type: 'signal', to/from, payload } for WebRTC signaling
 *
 * WebRTC data channels carry the actual encrypted chat messages.
 * BroadcastChannel handles zero-latency same-browser tab connections.
 */

const SIGNALING_URL = 'wss://huginn-signaling.morten-6e8.workers.dev';

export type SignalMessage =
  | { type: 'join';  from: string; name: string }
  | { type: 'leave'; from: string }
  | { type: 'chat';  from: string; payload: unknown };

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

// ── WebRTC + Worker signaling ─────────────────────────────────────────────────

interface PeerState {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  name: string;
  makingOffer: boolean;
  ignoreOffer: boolean;
}

type PeerEventCallback = (peerId: string, name: string) => void;
type DisconnectCallback = (peerId: string) => void;
type MessageCallback = (peerId: string, data: unknown) => void;

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export class PeerJSSignaling {
  private ws: WebSocket | null = null;
  private peers = new Map<string, PeerState>();

  private readonly roomCode: string;
  private readonly participantId: string;
  private readonly participantName: string;

  private onJoinCb?: PeerEventCallback;
  private onLeaveCb?: DisconnectCallback;
  private msgHandlers: SignalHandler[] = [];

  private destroyed = false;
  private wsReady = false;
  private pendingSignals: Array<{ to: string; payload: unknown }> = [];

  constructor(roomCode: string, participantId: string, participantName: string) {
    this.roomCode = roomCode;
    this.participantId = participantId;
    this.participantName = participantName;
  }

  onMessage(h: SignalHandler): () => void {
    this.msgHandlers.push(h);
    return () => { this.msgHandlers = this.msgHandlers.filter((x) => x !== h); };
  }
  onPeerJoin(cb: PeerEventCallback)   { this.onJoinCb  = cb; }
  onPeerLeave(cb: DisconnectCallback) { this.onLeaveCb = cb; }

  // ── Start ──────────────────────────────────────────────────────────────────

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${SIGNALING_URL}/room/${this.roomCode}`;
      console.log('[Signaling] connecting to', url);

      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };

      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        console.log('[Signaling] connected');
        this.wsReady = true;
        ws.send(JSON.stringify({ type: 'hello', id: this.participantId, name: this.participantName }));
        // Flush any signals that were queued before WS opened
        for (const s of this.pendingSignals) this._wsSend({ type: 'signal', to: s.to, from: this.participantId, payload: s.payload });
        this.pendingSignals = [];
        done();
      };

      ws.onmessage = (event) => {
        let msg: any;
        try { msg = JSON.parse(event.data); } catch { return; }
        this._handleServerMsg(msg);
      };

      ws.onerror = (e) => {
        console.error('[Signaling] WebSocket error', e);
        if (!resolved) { resolved = true; reject(new Error('WebSocket failed')); }
      };

      ws.onclose = () => {
        console.log('[Signaling] WebSocket closed');
        this.wsReady = false;
        if (!this.destroyed) {
          // Auto-reconnect after 2s
          setTimeout(() => this._reconnect(), 2000);
        }
      };

      setTimeout(done, 10000);
    });
  }

  private _reconnect() {
    if (this.destroyed) return;
    console.log('[Signaling] reconnecting...');
    this.wsReady = false;
    const url = `${SIGNALING_URL}/room/${this.roomCode}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.wsReady = true;
      ws.send(JSON.stringify({ type: 'hello', id: this.participantId, name: this.participantName }));
    };
    ws.onmessage = (event) => {
      let msg: any;
      try { msg = JSON.parse(event.data); } catch { return; }
      this._handleServerMsg(msg);
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      this.wsReady = false;
      if (!this.destroyed) setTimeout(() => this._reconnect(), 3000);
    };
  }

  // ── Handle messages from the signaling server ──────────────────────────────

  private _handleServerMsg(msg: any) {
    switch (msg.type) {
      case 'peers': {
        // List of peers already in the room — initiate WebRTC to each
        const peers: Array<{ id: string; name: string }> = msg.peers ?? [];
        console.log('[Signaling] existing peers:', peers);
        for (const p of peers) {
          if (p.id !== this.participantId) {
            this._getOrCreatePeer(p.id, p.name, true /* polite */);
          }
        }
        break;
      }

      case 'peer-joined': {
        const { id, name } = msg as { id: string; name: string };
        if (id !== this.participantId) {
          console.log('[Signaling] peer joined:', id, name);
          this._getOrCreatePeer(id, name, false /* impolite — we were here first */);
        }
        break;
      }

      case 'peer-left': {
        const { id } = msg as { id: string };
        console.log('[Signaling] peer left:', id);
        this._closePeer(id);
        break;
      }

      case 'signal': {
        const { from, payload } = msg as { from: string; payload: any };
        if (from !== this.participantId) {
          this._handleSignal(from, payload);
        }
        break;
      }
    }
  }

  // ── WebRTC peer management ─────────────────────────────────────────────────

  private _getOrCreatePeer(peerId: string, name: string, polite: boolean): PeerState {
    if (this.peers.has(peerId)) return this.peers.get(peerId)!;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const state: PeerState = { pc, dc: null, name, makingOffer: false, ignoreOffer: false };
    this.peers.set(peerId, state);

    // ICE candidates → forward via signaling server
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this._sendSignal(peerId, { ice: candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] ${peerId} state:`, pc.connectionState);
      if (pc.connectionState === 'connected') {
        // Connection established — data channel should be open
      }
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this._closePeer(peerId);
      }
    };

    pc.onnegotiationneeded = async () => {
      try {
        state.makingOffer = true;
        await pc.setLocalDescription();
        this._sendSignal(peerId, { sdp: pc.localDescription });
      } catch (e) {
        console.error('[WebRTC] negotiation failed', e);
      } finally {
        state.makingOffer = false;
      }
    };

    // Data channel for receiving (the offerer creates it; answerer receives via ondatachannel)
    pc.ondatachannel = (event) => {
      this._setupDataChannel(peerId, event.channel);
    };

    // If we are the offerer (not polite = we arrived second / peer-joined event)
    if (!polite) {
      const dc = pc.createDataChannel('chat', { ordered: true });
      this._setupDataChannel(peerId, dc);
      state.dc = dc;
    }

    return state;
  }

  private _setupDataChannel(peerId: string, dc: RTCDataChannel) {
    const state = this.peers.get(peerId);
    if (state) state.dc = dc;

    dc.onopen = () => {
      console.log('[WebRTC] data channel open with', peerId);
      const name = this.peers.get(peerId)?.name ?? 'Peer';
      this.onJoinCb?.(peerId, name);
    };

    dc.onclose = () => {
      console.log('[WebRTC] data channel closed with', peerId);
    };

    dc.onmessage = ({ data }) => {
      try {
        const msg = JSON.parse(data);
        this.msgHandlers.forEach(h => h({ type: 'chat', from: peerId, payload: msg }));
      } catch {}
    };
  }

  private async _handleSignal(fromId: string, payload: any) {
    const state = this._getOrCreatePeer(fromId, 'Peer', true);
    const pc = state.pc;

    try {
      if (payload.sdp) {
        const offerCollision =
          payload.sdp.type === 'offer' &&
          (state.makingOffer || pc.signalingState !== 'stable');

        state.ignoreOffer = offerCollision;
        if (state.ignoreOffer) return;

        await pc.setRemoteDescription(payload.sdp);

        if (payload.sdp.type === 'offer') {
          await pc.setLocalDescription();
          this._sendSignal(fromId, { sdp: pc.localDescription });
        }
      } else if (payload.ice) {
        try {
          await pc.addIceCandidate(payload.ice);
        } catch (e) {
          if (!state.ignoreOffer) throw e;
        }
      }
    } catch (e) {
      console.error('[WebRTC] signal handling error', e);
    }
  }

  private _closePeer(peerId: string) {
    const state = this.peers.get(peerId);
    if (!state) return;
    state.dc?.close();
    state.pc.close();
    this.peers.delete(peerId);
    this.onLeaveCb?.(peerId);
  }

  // ── Sending ────────────────────────────────────────────────────────────────

  private _sendSignal(to: string, payload: unknown) {
    const msg = { type: 'signal', to, from: this.participantId, payload };
    if (this.wsReady && this.ws) {
      this._wsSend(msg);
    } else {
      this.pendingSignals.push({ to, payload });
    }
  }

  private _wsSend(data: unknown) {
    try {
      this.ws?.send(JSON.stringify(data));
    } catch {}
  }

  broadcast(msg: SignalMessage) {
    // Send chat data over WebRTC data channels
    this.peers.forEach((state, peerId) => {
      if (state.dc?.readyState === 'open') {
        try { state.dc.send(JSON.stringify((msg as any).payload ?? msg)); } catch {}
      }
    });
  }

  destroy() {
    this.destroyed = true;
    this.peers.forEach((_, id) => this._closePeer(id));
    this.ws?.close();
    this.ws = null;
  }
}
