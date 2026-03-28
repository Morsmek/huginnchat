/**
 * WebRTC P2P mesh — zero knowledge.
 *
 * Two modes:
 *  1. LOCAL (BroadcastChannel): automatic, instant, same browser.
 *  2. MANUAL (copy-paste SDP): user copies offer, recipient pastes answer.
 *
 * No signaling server. No relay. AES-256-GCM encryption on every message.
 */

import type { WebRTCMessage } from './types';
import {
  LocalSignalingChannel,
  gatherCompleteDescription,
  encodeSignal,
  decodeSignal,
  type ManualOffer,
  type ManualAnswer,
  type SignalHandler,
} from './signaling';

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export class WebRTCManager {
  private connections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private localSignal: LocalSignalingChannel;
  private unsubLocal: (() => void) | null = null;

  readonly peerId: string;
  readonly peerName: string;

  private onMessageCallback?: (peerId: string, msg: WebRTCMessage) => void;
  private onConnectionChangeCallback?: (peerId: string, connected: boolean, name?: string) => void;
  private onManualOfferReadyCallback?: (encodedOffer: string) => void;

  constructor(roomId: string, peerId: string, peerName: string) {
    this.peerId = peerId;
    this.peerName = peerName;
    this.localSignal = new LocalSignalingChannel(roomId, peerId);
  }

  onMessage(cb: (peerId: string, msg: WebRTCMessage) => void) { this.onMessageCallback = cb; }
  onConnectionChange(cb: (peerId: string, connected: boolean, name?: string) => void) { this.onConnectionChangeCallback = cb; }
  onManualOfferReady(cb: (encoded: string) => void) { this.onManualOfferReadyCallback = cb; }

  /** Announce presence on the local channel so same-browser tabs auto-connect. */
  start() {
    const handler: SignalHandler = (msg) => {
      if (msg.type === 'join') this.handleLocalJoin(msg.from, msg.name);
      else if (msg.type === 'offer') this.handleLocalOffer(msg as any);
      else if (msg.type === 'answer') this.handleLocalAnswer(msg as any);
      else if (msg.type === 'leave') this.handleLeave(msg.from);
    };
    this.unsubLocal = this.localSignal.onMessage(handler);
    this.localSignal.send({ type: 'join', from: this.peerId, name: this.peerName });
  }

  // ── Local (BroadcastChannel) path ─────────────────────────────────────────

  private async handleLocalJoin(fromId: string, fromName: string) {
    // Existing peer initiates offer to newcomer
    const pc = this.createPC(fromId);
    const ch = pc.createDataChannel('chat', { ordered: true });
    this.setupChannel(fromId, ch, fromName);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const { sdp, candidates } = await gatherCompleteDescription(pc);

    this.localSignal.send({
      type: 'offer',
      from: this.peerId,
      to: fromId,
      sdp,
      candidates,
    });
  }

  private async handleLocalOffer(msg: { from: string; to: string; sdp: string; candidates: RTCIceCandidateInit[] }) {
    if (msg.to !== this.peerId) return;
    const pc = this.createPC(msg.from);
    await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
    for (const c of msg.candidates) await pc.addIceCandidate(c).catch(() => {});

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const { sdp, candidates } = await gatherCompleteDescription(pc);

    this.localSignal.send({
      type: 'answer',
      from: this.peerId,
      to: msg.from,
      sdp,
      candidates,
    });
  }

  private async handleLocalAnswer(msg: { from: string; to: string; sdp: string; candidates: RTCIceCandidateInit[] }) {
    if (msg.to !== this.peerId) return;
    const pc = this.connections.get(msg.from);
    if (!pc) return;
    await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
    for (const c of msg.candidates) await pc.addIceCandidate(c).catch(() => {});
  }

  private handleLeave(fromId: string) {
    this.connections.get(fromId)?.close();
    this.connections.delete(fromId);
    this.dataChannels.delete(fromId);
    this.onConnectionChangeCallback?.(fromId, false);
  }

  // ── Manual (copy-paste) path ───────────────────────────────────────────────

  /** Generate a manual offer blob for cross-device pairing. */
  async generateManualOffer(): Promise<string> {
    const tempId = `manual-${Date.now()}`;
    const pc = this.createPC(tempId);
    const ch = pc.createDataChannel('chat', { ordered: true });
    this.setupChannel(tempId, ch);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const { sdp, candidates } = await gatherCompleteDescription(pc);

    const blob: ManualOffer = {
      type: 'offer',
      from: this.peerId,
      fromName: this.peerName,
      sdp,
      candidates,
    };
    const encoded = encodeSignal(blob);
    this.onManualOfferReadyCallback?.(encoded);
    return encoded;
  }

  /** Accept a manual offer and return the answer blob to share back. */
  async acceptManualOffer(encodedOffer: string): Promise<string> {
    const blob = decodeSignal(encodedOffer) as ManualOffer;
    if (!blob || blob.type !== 'offer') throw new Error('Invalid offer');

    const pc = this.createPC(blob.from);
    await pc.setRemoteDescription({ type: 'offer', sdp: blob.sdp });
    for (const c of blob.candidates) await pc.addIceCandidate(c).catch(() => {});

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const { sdp, candidates } = await gatherCompleteDescription(pc);

    // Notify UI that a peer with this name is connecting
    this.onConnectionChangeCallback?.(blob.from, false, blob.fromName);

    const answerBlob: ManualAnswer = {
      type: 'answer',
      from: this.peerId,
      fromName: this.peerName,
      to: blob.from,
      sdp,
      candidates,
    };
    return encodeSignal(answerBlob);
  }

  /** Complete the initiator side after the remote pastes back the answer. */
  async acceptManualAnswer(encodedAnswer: string): Promise<void> {
    const blob = decodeSignal(encodedAnswer) as ManualAnswer;
    if (!blob || blob.type !== 'answer') throw new Error('Invalid answer');
    if (blob.to !== this.peerId) throw new Error('Answer not for this peer');

    const pc = this.connections.get(blob.from) || this.connections.values().next().value;
    if (!pc) throw new Error('No pending connection');

    await pc.setRemoteDescription({ type: 'answer', sdp: blob.sdp });
    for (const c of blob.candidates) await pc.addIceCandidate(c).catch(() => {});
    this.onConnectionChangeCallback?.(blob.from, false, blob.fromName);
  }

  // ── Shared helpers ─────────────────────────────────────────────────────────

  private createPC(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    pc.ondatachannel = ({ channel }) => this.setupChannel(peerId, channel);
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        this.onConnectionChangeCallback?.(peerId, false);
      }
    };
    this.connections.set(peerId, pc);
    return pc;
  }

  private setupChannel(peerId: string, channel: RTCDataChannel, name?: string) {
    this.dataChannels.set(peerId, channel);
    channel.onopen = () => this.onConnectionChangeCallback?.(peerId, true, name);
    channel.onclose = () => this.onConnectionChangeCallback?.(peerId, false, name);
    channel.onmessage = ({ data }) => {
      try { this.onMessageCallback?.(peerId, JSON.parse(data)); } catch {}
    };
  }

  broadcast(message: WebRTCMessage) {
    const str = JSON.stringify(message);
    this.dataChannels.forEach(ch => {
      if (ch.readyState === 'open') ch.send(str);
    });
  }

  disconnect() {
    this.localSignal.send({ type: 'leave', from: this.peerId });
    this.unsubLocal?.();
    this.dataChannels.forEach(ch => ch.close());
    this.connections.forEach(pc => pc.close());
    this.localSignal.close();
    this.dataChannels.clear();
    this.connections.clear();
  }

  get connectedCount(): number {
    let n = 0;
    this.dataChannels.forEach(ch => { if (ch.readyState === 'open') n++; });
    return n;
  }
}
