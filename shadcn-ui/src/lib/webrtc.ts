/**
 * P2P mesh manager — PeerJS + BroadcastChannel.
 *
 * PeerJS handles WebRTC offer/answer automatically for cross-device.
 * BroadcastChannel handles instant same-browser tab-to-tab connections.
 *
 * Messages sent through the data channels are pre-encrypted with
 * AES-256-GCM before transmission. PeerJS never sees plaintext.
 */

import type { WebRTCMessage } from './types';
import { LocalSignalingChannel, PeerJSSignaling } from './signaling';

// PeerJS is loaded via CDN
declare const Peer: any;

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export class WebRTCManager {
  private localSignal: LocalSignalingChannel;
  private peerSignal: PeerJSSignaling;

  // Raw WebRTC connections for local (BroadcastChannel) path
  private localConnections = new Map<string, RTCPeerConnection>();
  private localChannels = new Map<string, RTCDataChannel>();

  // PeerJS data channels (already managed by PeerJSSignaling)
  // We route messages through PeerJSSignaling directly

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
    // ── Local (BroadcastChannel) path ──────────────────────────────────────
    this.localSignal.onMessage((msg) => {
      if (msg.type === 'join') this._handleLocalJoin(msg.from, msg.name);
      else if (msg.type === 'leave') this._handleLocalLeave(msg.from);
      else if (msg.type === 'chat') {
        this.onMessageCallback?.(msg.from, msg.payload as WebRTCMessage);
      }
    });
    this.localSignal.send({ type: 'join', from: this.peerId, name: this.peerName });

    // ── PeerJS (cross-device) path ──────────────────────────────────────────
    this.peerSignal.onConnect((peerId, name) => {
      this.onConnectionChangeCallback?.(peerId, true, name);
    });

    this.peerSignal.onDisconnect((peerId) => {
      this.onConnectionChangeCallback?.(peerId, false);
    });

    this.peerSignal.onMessage((msg) => {
      if (msg.type === 'chat') {
        this.onMessageCallback?.(msg.from, msg.payload as WebRTCMessage);
      } else if (msg.type === 'join') {
        this.onConnectionChangeCallback?.(msg.from, true, msg.name);
      } else if (msg.type === 'leave') {
        this.onConnectionChangeCallback?.(msg.from, false);
      }
    });

    try {
      await this.peerSignal.start();
    } catch (e) {
      console.warn('[WebRTCManager] PeerJS failed to start, cross-device unavailable', e);
    }
  }

  // ── Local path (BroadcastChannel → raw WebRTC data channel) ───────────────

  private async _handleLocalJoin(fromId: string, fromName: string) {
    if (this.localConnections.has(fromId)) return;

    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    this.localConnections.set(fromId, pc);

    const ch = pc.createDataChannel('chat', { ordered: true });
    this._setupLocalChannel(fromId, ch, fromName);

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      // For BroadcastChannel path we rely on trickle — handled inline
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Wait for ICE gathering
    await new Promise<void>((resolve) => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      const check = () => { if (pc.iceGatheringState === 'complete') { resolve(); } };
      pc.addEventListener('icegatheringstatechange', check);
      setTimeout(resolve, 3000);
    });

    this.localSignal.send({
      type: 'chat',
      from: this.peerId,
      payload: {
        __signal: 'offer',
        to: fromId,
        sdp: pc.localDescription!.sdp,
      },
    } as any);
  }

  private _handleLocalLeave(fromId: string) {
    this.localConnections.get(fromId)?.close();
    this.localConnections.delete(fromId);
    this.localChannels.delete(fromId);
    this.onConnectionChangeCallback?.(fromId, false);
  }

  private _setupLocalChannel(peerId: string, channel: RTCDataChannel, name?: string) {
    this.localChannels.set(peerId, channel);
    channel.onopen = () => this.onConnectionChangeCallback?.(peerId, true, name);
    channel.onclose = () => this.onConnectionChangeCallback?.(peerId, false);
    channel.onmessage = ({ data }) => {
      try { this.onMessageCallback?.(peerId, JSON.parse(data)); } catch {}
    };
  }

  // ── Broadcast to all connected peers ──────────────────────────────────────

  broadcast(message: WebRTCMessage) {
    // Local (same browser) data channels
    this.localChannels.forEach((ch) => {
      if (ch.readyState === 'open') ch.send(JSON.stringify(message));
    });

    // PeerJS connections
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
    this.localConnections.forEach((pc) => pc.close());
    this.localChannels.clear();
    this.localConnections.clear();

    this.localSignal.close();
    this.peerSignal.destroy();
  }
}
