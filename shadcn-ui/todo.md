# Huginn - Zero-Knowledge Ephemeral Group Chat MVP

## Implementation Plan (Phase 1 - Core Functionality)

### Files to Create:
1. **src/lib/crypto.ts** - AES-256-GCM encryption/decryption utilities
2. **src/lib/webrtc.ts** - WebRTC P2P connection management
3. **src/lib/room.ts** - Room state management and URL parsing
4. **src/pages/Index.tsx** - Landing page with Create/Join room
5. **src/pages/Room.tsx** - Chat room interface
6. **src/components/ChatMessage.tsx** - Message display component
7. **src/components/ParticipantList.tsx** - Participant sidebar
8. **src/components/SecurityStatus.tsx** - Encryption status indicator

### Color Scheme (from logo):
- Primary Teal: #5DBEBD
- Dark Teal: #4A9B9A
- Background: #1a1f2e (dark)
- Text: #e5e7eb (light gray)

### Core Features (MVP):
✓ Room creation with cryptographically secure ID + AES key
✓ URL fragment-based credential sharing
✓ WebRTC P2P messaging
✓ AES-256-GCM encryption/decryption
✓ Simple chat interface
✓ Message auto-destruct (session-only for MVP)
✓ Clean landing page with security emphasis
✓ Mobile responsive design

### Simplified for MVP:
- Session-only messages (no persistent storage)
- Basic participant list (no verification codes yet)
- Simple connection status
- No admin controls yet
- No typing indicators yet