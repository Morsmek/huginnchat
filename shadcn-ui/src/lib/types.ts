export interface Message {
  id: string;
  timestamp: number;
  sender: string;
  senderName: string;
  content: string;
  iv: string;
}

export interface Participant {
  id: string;
  name: string;
  connected: boolean;
  joinedAt: number;
  isTyping?: boolean;
}

export interface RoomConfig {
  roomId: string;
  encryptionKey: string;
  participantId: string;
  participantName: string;
}

export interface WebRTCMessage {
  type: 'message' | 'participant-announce' | 'participant-leave' | 'typing';
  data: unknown;
}
