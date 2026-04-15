/**
 * WebRTCManager — thin wrapper around PeerJSSignaling + LocalSignalingChannel.
 *
 * PeerJSSignaling now uses our own Cloudflare Worker for signaling
 * and native RTCPeerConnection for data channels.
 * LocalSignalingChannel handles same-browser tab connections.
 */

import type { WebRTCMessage } from './types';
import { LocalSignalingChannel, PeerJSSignaling } from './signaling';

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export class WebRTCManager {
  private localSignal: LocalSignalingChannel;
  private peerSignal: PeerJSSignaling;

  private localPCs    = new Map<string, RTCPeerConnection>();
  private localChans  = new Map<string, RTCDataChannel>();

  readonly roomCode: string;
  readonly peerId: string;
  readonly peerName: string;

  private onMessageCb?: (peerId: string, msg: WebRTCMessage) => void;
  private onConnChangeCb?: (peerId: string, connected: boolean, name?: string) => void;

  constructor(roomCode: string, peerId: string, peerName: string) {
    this.roomCode = roomCode;
    this.peerId   = peerId;
    this.peerName = peerName;

    this.localSignal = new LocalSignalingChannel(roomCode, peerId);
    this.peerSignal  = new PeerJSSignaling(roomCode, peerId, peerName);
  }

  onMessage(cb: (peerId: string, msg: WebRTCMessage) => void) { this.onMessageCb = cb; }
  onConnectionChange(cb: (peerId: string, connected: boolean, name?: string) => void) { this.onConnChangeCb = cb; }

  async start() {
    // ── Same-browser (BroadcastChannel → raw WebRTC) ───────────────────────
    this.localSignal.onMessage((msg) => {
      if (msg.type === 'join')  this._localJoin(msg.from, msg.name);
      if (msg.type === 'leave') this._localLeave(msg.from);
      if (msg.type === 'chat')  this.onMessageCb?.(msg.from, msg.payload as WebRTCMessage);
    });
    this.localSignal.send({ type: 'join', from: this.peerId, name: this.peerName });

    // ── Cross-device (Cloudflare Worker → WebRTC data channel) ────────────
    this.peerSignal.onPeerJoin((id, name) => {
      if (id === this.peerId) return;
      this.onConnChangeCb?.(id, true, name);
    });
    this.peerSignal.onPeerLeave((id) => {
      if (id === this.peerId) return;
      this.onConnChangeCb?.(id, false);
    });
    this.peerSignal.onMessage((msg) => {
      if (msg.type === 'chat' && msg.from !== this.peerId) {
        this.onMessageCb?.(msg.from, msg.payload as WebRTCMessage);
      }
    });

    try {
      await this.peerSignal.start();
    } catch (e) {
      console.warn('[WebRTCManager] signaling failed:', e);
    }
  }

  // ── Local same-browser path ────────────────────────────────────────────────

  private async _localJoin(fromId: string, fromName: string) {
    if (fromId === this.peerId || this.localPCs.has(fromId)) return;

    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    this.localPCs.set(fromId, pc);

    const dc = pc.createDataChannel('chat', { ordered: true });
    this._bindLocalChan(fromId, dc, fromName);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await new Promise<void>((res) => {
      if (pc.iceGatheringState === 'complete') { res(); return; }
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') res(); });
      setTimeout(res, 3000);
    });

    this.localSignal.send({
      type: 'chat', from: this.peerId,
      payload: { __signal: 'offer', to: fromId, sdp: pc.localDescription!.sdp },
    } as any);
  }

  private _localLeave(fromId: string) {
    this.localPCs.get(fromId)?.close();
    this.localPCs.delete(fromId);
    this.localChans.delete(fromId);
    this.onConnChangeCb?.(fromId, false);
  }

  private _bindLocalChan(peerId: string, dc: RTCDataChannel, name?: string) {
    this.localChans.set(peerId, dc);
    dc.onopen  = () => this.onConnChangeCb?.(peerId, true, name);
    dc.onclose = () => this.onConnChangeCb?.(peerId, false);
    dc.onmessage = ({ data }) => {
      try { this.onMessageCb?.(peerId, JSON.parse(data)); } catch {}
    };
  }

  // ── Broadcast to all peers ─────────────────────────────────────────────────

  broadcast(message: WebRTCMessage) {
    // Same-browser channels
    this.localChans.forEach((dc) => {
      if (dc.readyState === 'open') dc.send(JSON.stringify(message));
    });
    // Cross-device via signaling (routes through data channels internally)
    this.peerSignal.broadcast({ type: 'chat', from: this.peerId, payload: message });
  }

  disconnect() {
    this.localSignal.send({ type: 'leave', from: this.peerId });
    this.localChans.forEach(dc => dc.close());
    this.localPCs.forEach(pc => pc.close());
    this.localChans.clear();
    this.localPCs.clear();
    this.localSignal.close();
    this.peerSignal.destroy();
  }
}
