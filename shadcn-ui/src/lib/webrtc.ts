/**
 * P2P mesh manager — PeerJS (cross-device) + BroadcastChannel (same browser).
 *
 * All application messages are routed through this manager.
 * Encryption/decryption happens in Room.tsx; this layer handles raw transport.
 */

import type { WebRTCMessage } from './types';
import { LocalSignalingChannel, PeerJSSignaling } from './signaling';

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export class WebRTCManager {
  private localSignal: LocalSignalingChannel;
  private peerSignal: PeerJSSignaling;

  // Raw WebRTC connections for same-browser path
  private localPCs = new Map<string, RTCPeerConnection>();
  private localChannels = new Map<string, RTCDataChannel>();

  readonly roomCode: string;
  readonly peerId: string;
  readonly peerName: string;

  private onMessageCallback?: (peerId: string, msg: WebRTCMessage) => void;
  private onConnectionChangeCallback?: (peerId: string, connected: boolean, name?: string) => void;

  constructor(roomCode: string, peerId: string, peerName: string) {
    this.roomCode = roomCode;
    this.peerId = peerId;
    this.peerName = peerName;

    this.localSignal = new LocalSignalingChannel(roomCode, peerId);
    this.peerSignal = new PeerJSSignaling(roomCode, peerId, peerName);
  }

  onMessage(cb: (peerId: string, msg: WebRTCMessage) => void) {
    this.onMessageCallback = cb;
  }

  onConnectionChange(cb: (peerId: string, connected: boolean, name?: string) => void) {
    this.onConnectionChangeCallback = cb;
  }

  async start() {
    // ── BroadcastChannel (same browser, instant) ───────────────────────────
    this.localSignal.onMessage((msg) => {
      if (msg.type === 'join') {
        this._handleLocalJoin(msg.from, msg.name);
      } else if (msg.type === 'leave') {
        this._handleLocalLeave(msg.from);
      } else if (msg.type === 'chat') {
        this.onMessageCallback?.(msg.from, msg.payload as WebRTCMessage);
      }
    });
    // Announce ourselves to any other tabs in the same browser
    this.localSignal.send({ type: 'join', from: this.peerId, name: this.peerName });

    // ── PeerJS (cross-device) ──────────────────────────────────────────────
    this.peerSignal.onPeerJoin((shortId, name) => {
      if (shortId === this.peerId) return; // never add yourself
      this.onConnectionChangeCallback?.(shortId, true, name);
    });

    this.peerSignal.onPeerLeave((shortId) => {
      if (shortId === this.peerId) return;
      this.onConnectionChangeCallback?.(shortId, false);
    });

    this.peerSignal.onMessage((msg) => {
      if (msg.type === 'chat') {
        if (msg.from === this.peerId) return; // ignore own echoes
        this.onMessageCallback?.(msg.from, msg.payload as WebRTCMessage);
      }
      // join/leave are handled via onPeerJoin/onPeerLeave callbacks, not here
    });

    try {
      await this.peerSignal.start();
    } catch (e) {
      console.warn('[WebRTCManager] PeerJS failed to start — cross-device unavailable:', e);
    }
  }

  // ── BroadcastChannel → raw WebRTC data channel (same browser) ─────────────

  private async _handleLocalJoin(fromId: string, fromName: string) {
    if (fromId === this.peerId) return;
    if (this.localPCs.has(fromId)) return;

    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    this.localPCs.set(fromId, pc);

    const ch = pc.createDataChannel('chat', { ordered: true });
    this._bindLocalChannel(fromId, ch, fromName);

    // Wait for ICE gathering then send offer over BroadcastChannel
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await new Promise<void>((resolve) => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      const check = () => { if (pc.iceGatheringState === 'complete') resolve(); };
      pc.addEventListener('icegatheringstatechange', check);
      setTimeout(resolve, 3000);
    });

    this.localSignal.send({
      type: 'chat',
      from: this.peerId,
      payload: { __signal: 'offer', to: fromId, sdp: pc.localDescription!.sdp },
    } as any);
  }

  private _handleLocalLeave(fromId: string) {
    this.localPCs.get(fromId)?.close();
    this.localPCs.delete(fromId);
    this.localChannels.delete(fromId);
    this.onConnectionChangeCallback?.(fromId, false);
  }

  private _bindLocalChannel(peerId: string, ch: RTCDataChannel, name?: string) {
    this.localChannels.set(peerId, ch);
    ch.onopen  = () => this.onConnectionChangeCallback?.(peerId, true, name);
    ch.onclose = () => this.onConnectionChangeCallback?.(peerId, false);
    ch.onmessage = ({ data }) => {
      try { this.onMessageCallback?.(peerId, JSON.parse(data)); } catch {}
    };
  }

  // ── Broadcast to all peers ─────────────────────────────────────────────────

  broadcast(message: WebRTCMessage) {
    // Same-browser data channels
    this.localChannels.forEach((ch) => {
      if (ch.readyState === 'open') ch.send(JSON.stringify(message));
    });

    // Cross-device via PeerJS
    this.peerSignal.broadcast({
      type: 'chat',
      from: this.peerId,
      payload: message,
    });
  }

  disconnect() {
    this.localSignal.send({ type: 'leave', from: this.peerId });
    this.peerSignal.broadcast({ type: 'leave', from: this.peerId });

    this.localChannels.forEach((ch) => ch.close());
    this.localPCs.forEach((pc) => pc.close());
    this.localChannels.clear();
    this.localPCs.clear();

    this.localSignal.close();
    this.peerSignal.destroy();
  }
}
