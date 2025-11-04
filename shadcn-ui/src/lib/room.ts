/**
 * Room management and URL parsing utilities
 */

import { generateEncryptionKey, generateRoomId, deriveKeyFromPassword } from './crypto';
import type { RoomConfig } from './types';

/**
 * Create a new room with generated credentials
 */
export async function createRoom(
  participantName: string,
  customRoomName?: string,
  password?: string
): Promise<RoomConfig> {
  const roomId = customRoomName || generateRoomId();
  const participantId = generateRoomId();
  
  // If password is provided, derive encryption key from it
  // Otherwise generate a random key
  const encryptionKey = password 
    ? await deriveKeyFromPassword(password, roomId)
    : await generateEncryptionKey();

  return {
    roomId,
    encryptionKey,
    participantId,
    participantName,
  };
}

/**
 * Generate a shareable room URL
 */
export function generateRoomUrl(config: RoomConfig, includeKey: boolean = true): string {
  const params = new URLSearchParams({
    room: config.roomId,
  });
  
  // Only include key in URL if it's a random room without password
  if (includeKey) {
    params.set('key', config.encryptionKey);
  }
  
  return `${window.location.origin}/#${params.toString()}`;
}

/**
 * Parse room credentials from URL fragment
 */
export function parseRoomUrl(): { roomId: string; encryptionKey: string } | null {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;

  const params = new URLSearchParams(hash);
  const roomId = params.get('room');
  const encryptionKey = params.get('key');

  if (!roomId || !encryptionKey) return null;

  return { roomId, encryptionKey };
}

/**
 * Clear room credentials from URL
 */
export function clearRoomUrl() {
  window.location.hash = '';
}

/**
 * Generate a random participant name
 */
export function generateParticipantName(): string {
  const adjectives = ['Swift', 'Brave', 'Clever', 'Noble', 'Wise', 'Bold', 'Silent', 'Mystic'];
  const nouns = ['Raven', 'Wolf', 'Eagle', 'Fox', 'Hawk', 'Bear', 'Owl', 'Lynx'];
  
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 100);
  
  return `${adj}${noun}${num}`;
}