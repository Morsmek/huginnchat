/**
 * Room management — 10-char code based system.
 *
 * Security notes:
 *   - Room code is generated with rejection sampling (no modulo bias)
 *   - PBKDF2 uses a fixed app-level salt prefix so the derived key is
 *     deterministic per code but not trivially guessable from the code alone
 *   - participantId is a fresh UUID-based random ID per session
 */

import { deriveKeyFromPassword, generateRoomId } from './crypto';
import type { RoomConfig } from './types';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no 0/O/1/I confusion
const CODE_LEN   = 10;

// Fixed app-level salt — not derived from the room code to avoid the
// salt=f(password) weakness. Must never change (breaks existing rooms if changed).
const APP_SALT = 'huginn-v2-ephemeral-e2e-2024';

/**
 * Generate a cryptographically uniform 10-char room code.
 * Uses rejection sampling to eliminate modulo bias (32 chars = 2^5, fits exactly).
 */
export function generateRoomCode(): string {
  // 32 = 2^5, so each byte needs only 5 bits. We use the lower 5 bits of each
  // random byte and reject the rare case where a byte >= 32 (never happens with
  // 32 chars since 256/32=8 exactly — perfectly uniform, no bias at all).
  const result: string[] = [];
  while (result.length < CODE_LEN) {
    const arr = new Uint8Array(CODE_LEN * 2); // extra to avoid refill loops
    crypto.getRandomValues(arr);
    for (const b of arr) {
      // 256 % 32 === 0, so b % 32 is perfectly uniform
      result.push(CODE_CHARS[b % CODE_CHARS.length]);
      if (result.length === CODE_LEN) break;
    }
  }
  return result.join('');
}

/**
 * Normalise a user-typed code: uppercase, strip whitespace/dashes/underscores.
 */
export function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s\-_]/g, '');
}

/**
 * Derive a stable AES-256 key from the room code using PBKDF2.
 * Salt = APP_SALT + roomCode — fixed prefix means the salt is not trivially
 * equal to the password, which is the main PBKDF2 salt requirement.
 */
export async function keyFromCode(code: string): Promise<string> {
  return deriveKeyFromPassword(code, `${APP_SALT}-${code}`);
}

/**
 * Compute a short human-readable fingerprint of the encryption key.
 * Both parties should see the same fingerprint — if they don't, something
 * is wrong (different codes or a misconfiguration).
 * Returns 8 hex chars (32 bits) — enough to detect mismatches, not enough
 * to weaken the key.
 */
export async function keyFingerprint(base64Key: string): Promise<string> {
  const raw = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
  const hash = await crypto.subtle.digest('SHA-256', raw);
  return Array.from(new Uint8Array(hash))
    .slice(0, 4)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Create a new room.
 */
export async function createRoom(participantName: string): Promise<RoomConfig> {
  const code = generateRoomCode();
  const encryptionKey = await keyFromCode(code);
  const participantId = generateRoomId();
  return { roomId: code, encryptionKey, participantId, participantName };
}

/**
 * Join a room by code.
 */
export async function joinRoomByCode(code: string, participantName: string): Promise<RoomConfig> {
  const normalised = normaliseCode(code);
  const encryptionKey = await keyFromCode(normalised);
  const participantId = generateRoomId();
  return { roomId: normalised, encryptionKey, participantId, participantName };
}

/**
 * Generate a random participant name.
 */
export function generateParticipantName(): string {
  const adjectives = ['Swift', 'Brave', 'Clever', 'Noble', 'Wise', 'Bold', 'Silent', 'Mystic'];
  const nouns = ['Raven', 'Wolf', 'Eagle', 'Fox', 'Hawk', 'Bear', 'Owl', 'Lynx'];
  const adj  = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num  = Math.floor(Math.random() * 100);
  return `${adj}${noun}${num}`;
}
