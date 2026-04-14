/**
 * Room management utilities — 10-char code based system.
 *
 * The room code IS the shared secret. Everyone who knows the code
 * can derive the same encryption key and join the same PeerJS channel.
 * No URLs, no SDP copy-paste, no server state.
 */

import { deriveKeyFromPassword, generateRoomId } from './crypto';
import type { RoomConfig } from './types';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion

/**
 * Generate a random 10-character human-friendly room code.
 */
export function generateRoomCode(): string {
  const arr = new Uint8Array(10);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

/**
 * Normalise a user-typed code: uppercase, strip spaces/dashes.
 */
export function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s\-_]/g, '');
}

/**
 * Derive a stable AES-256 encryption key from the room code.
 * Everyone with the same code gets the same key — zero knowledge.
 */
export async function keyFromCode(code: string): Promise<string> {
  // Use a fixed salt prefix so the derived key is deterministic per code
  return deriveKeyFromPassword(code, `huginn-room-${code}`);
}

/**
 * Create a new room from a fresh code.
 */
export async function createRoom(participantName: string): Promise<RoomConfig> {
  const code = generateRoomCode();
  const encryptionKey = await keyFromCode(code);
  const participantId = generateRoomId();

  return {
    roomId: code,          // roomId == the 10-char code
    encryptionKey,
    participantId,
    participantName,
  };
}

/**
 * Join a room by code — derives the same key.
 */
export async function joinRoomByCode(
  code: string,
  participantName: string,
): Promise<RoomConfig> {
  const normalised = normaliseCode(code);
  const encryptionKey = await keyFromCode(normalised);
  const participantId = generateRoomId();

  return {
    roomId: normalised,
    encryptionKey,
    participantId,
    participantName,
  };
}

/**
 * Generate a random participant name.
 */
export function generateParticipantName(): string {
  const adjectives = ['Swift', 'Brave', 'Clever', 'Noble', 'Wise', 'Bold', 'Silent', 'Mystic'];
  const nouns = ['Raven', 'Wolf', 'Eagle', 'Fox', 'Hawk', 'Bear', 'Owl', 'Lynx'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj}${noun}${num}`;
}
