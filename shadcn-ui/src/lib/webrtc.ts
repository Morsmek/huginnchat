/**
 * WebRTC P2P connection management
 * Uses public STUN servers for NAT traversal
 */

import type { WebRTCMessage } from './types';

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export class WebRTCManager {
  private connections: Map<string, RTCPeerConnection> = new Map();
  private dataChannels: Map<string, RTCDataChannel> = new Map();
  private onMessageCallback?: (peerId: string, message: WebRTCMessage) => void;
  private onConnectionChangeCallback?: (peerId: string, connected: boolean) => void;

  constructor() {}

  onMessage(callback: (peerId: string, message: WebRTCMessage) => void) {
    this.onMessageCallback = callback;
  }

  onConnectionChange(callback: (peerId: string, connected: boolean) => void) {
    this.onConnectionChangeCallback = callback;
  }

  async createOffer(peerId: string): Promise<RTCSessionDescriptionInit> {
    const connection = this.createConnection(peerId);
    const dataChannel = connection.createDataChannel('chat');
    this.setupDataChannel(peerId, dataChannel);

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    return offer;
  }

  async handleOffer(
    peerId: string,
    offer: RTCSessionDescriptionInit
  ): Promise<RTCSessionDescriptionInit> {
    const connection = this.createConnection(peerId);
    await connection.setRemoteDescription(offer);

    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    return answer;
  }

  async handleAnswer(peerId: string, answer: RTCSessionDescriptionInit) {
    const connection = this.connections.get(peerId);
    if (connection) {
      await connection.setRemoteDescription(answer);
    }
  }

  async handleIceCandidate(peerId: string, candidate: RTCIceCandidateInit) {
    const connection = this.connections.get(peerId);
    if (connection) {
      await connection.addIceCandidate(candidate);
    }
  }

  sendMessage(message: WebRTCMessage) {
    const messageStr = JSON.stringify(message);
    this.dataChannels.forEach((channel) => {
      if (channel.readyState === 'open') {
        channel.send(messageStr);
      }
    });
  }

  disconnect() {
    this.dataChannels.forEach((channel) => channel.close());
    this.connections.forEach((connection) => connection.close());
    this.dataChannels.clear();
    this.connections.clear();
  }

  private createConnection(peerId: string): RTCPeerConnection {
    const connection = new RTCPeerConnection({
      iceServers: STUN_SERVERS,
    });

    connection.ondatachannel = (event) => {
      this.setupDataChannel(peerId, event.channel);
    };

    connection.oniceconnectionstatechange = () => {
      const connected = connection.iceConnectionState === 'connected';
      this.onConnectionChangeCallback?.(peerId, connected);
    };

    this.connections.set(peerId, connection);
    return connection;
  }

  private setupDataChannel(peerId: string, channel: RTCDataChannel) {
    channel.onopen = () => {
      console.log(`Data channel opened with ${peerId}`);
      this.onConnectionChangeCallback?.(peerId, true);
    };

    channel.onclose = () => {
      console.log(`Data channel closed with ${peerId}`);
      this.onConnectionChangeCallback?.(peerId, false);
    };

    channel.onmessage = (event) => {
      try {
        const message: WebRTCMessage = JSON.parse(event.data);
        this.onMessageCallback?.(peerId, message);
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    };

    this.dataChannels.set(peerId, channel);
  }
}