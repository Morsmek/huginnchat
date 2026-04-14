import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Copy, LogOut, Lock, Check, RefreshCw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import SecurityStatus from '@/components/SecurityStatus';
import ChatMessage from '@/components/ChatMessage';
import ParticipantList from '@/components/ParticipantList';
import { generateRoomCode, generateParticipantName } from '@/lib/room';
import { encryptMessage, decryptMessage, generateRoomId } from '@/lib/crypto';
import { WebRTCManager } from '@/lib/webrtc';
import type { Message, Participant, WebRTCMessage } from '@/lib/types';

// ── Small button component ──────────────────────────────────────────────────

function Btn({
  onClick, disabled = false, children, variant = 'primary', small = false, fullWidth = false,
}: {
  onClick?: () => void; disabled?: boolean; children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; small?: boolean; fullWidth?: boolean;
}) {
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    borderRadius: 'var(--radius-lg)', fontFamily: 'var(--font-body)', fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer', transition: 'all var(--transition)',
    border: 'none', fontSize: small ? 'var(--text-xs)' : 'var(--text-sm)',
    padding: small ? '0.35rem 0.75rem' : '0.55rem 1.1rem',
    width: fullWidth ? '100%' : undefined, opacity: disabled ? 0.45 : 1,
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--accent)', color: 'var(--accent-on)' },
    secondary: { background: 'var(--surface-offset)', color: 'var(--text-muted)', border: '1px solid var(--border)' },
    ghost: { background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)' },
    danger: { background: 'transparent', color: 'var(--error)', border: '1px solid rgba(204,68,68,0.35)' },
  };
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant] }}>{children}</button>;
}

// ── Room code display with rotation ────────────────────────────────────────

const CODE_TTL = 60; // seconds before the displayed code rotates

function RoomCodeDisplay({ roomCode, onRotate }: { roomCode: string; onRotate: () => void }) {
  const [copied, setCopied] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(CODE_TTL);

  useEffect(() => {
    setSecondsLeft(CODE_TTL);
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          onRotate();
          return CODE_TTL;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [roomCode, onRotate]);

  const handleCopy = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Room code copied!');
  };

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5"
      style={{ background: 'var(--surface)', borderBottom: '1px solid var(--divider)' }}
    >
      <div className="flex-1 min-w-0">
        <div style={{ fontSize: '0.6rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.1rem' }}>
          Room code — share to invite
        </div>
        <div className="flex items-center gap-2">
          <span
            style={{
              fontFamily: 'monospace', fontWeight: 800, fontSize: '1.1rem',
              color: 'var(--accent)', letterSpacing: '0.18em',
            }}
          >
            {roomCode}
          </span>
          <button
            onClick={handleCopy}
            aria-label="Copy room code"
            style={{
              background: 'var(--accent-subtle)', border: '1px solid rgba(212,135,10,0.3)',
              color: 'var(--accent)', borderRadius: 'var(--radius-md)', padding: '0.2rem 0.5rem',
              cursor: 'pointer', fontSize: '0.65rem', display: 'inline-flex', alignItems: 'center', gap: '3px',
            }}
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      {/* Countdown ring */}
      <div
        title={`Code refreshes in ${secondsLeft}s`}
        style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}
      >
        <RefreshCw
          size={11}
          style={{ color: 'var(--text-faint)', opacity: secondsLeft < 10 ? 1 : 0.4 }}
        />
        <span style={{ fontSize: '0.6rem', color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>
          {secondsLeft}s
        </span>
      </div>
    </div>
  );
}

// ── Main Room component ─────────────────────────────────────────────────────

export default function Room() {
  const navigate = useNavigate();

  const [roomId, setRoomId] = useState<string | null>(null);
  const [encryptionKey, setEncryptionKey] = useState<string>('');
  const [displayCode, setDisplayCode] = useState<string>(''); // the rotating invite code

  const [participantId] = useState(() => sessionStorage.getItem('participantId') || generateRoomId());
  const [participantName, setParticipantName] = useState(() => sessionStorage.getItem('participantName') || '');

  // Name prompt for direct navigations without a stored name
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const [messages, setMessages] = useState<Message[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const rtcRef = useRef<WebRTCManager | null>(null);
  const encKeyRef = useRef<string>('');

  // ── Initialise ────────────────────────────────────────────────────────────

  useEffect(() => {
    const storedRoom = sessionStorage.getItem('roomId');
    const storedKey = sessionStorage.getItem('encryptionKey');
    const storedName = sessionStorage.getItem('participantName');

    if (!storedRoom || !storedKey) {
      toast.error('Invalid room — no credentials found.');
      navigate('/');
      return;
    }

    if (!storedName) {
      setShowNamePrompt(true);
      return;
    }

    setParticipantName(storedName);
    setupRoom(storedRoom, storedKey, storedName);

    return () => {
      rtcRef.current?.disconnect();
      ['roomId', 'encryptionKey'].forEach((k) => sessionStorage.removeItem(k));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNameSubmit = () => {
    const name = nameInput.trim() || generateParticipantName();
    sessionStorage.setItem('participantName', name);
    sessionStorage.setItem('participantId', participantId);
    setParticipantName(name);
    setShowNamePrompt(false);

    const storedRoom = sessionStorage.getItem('roomId')!;
    const storedKey = sessionStorage.getItem('encryptionKey')!;
    setupRoom(storedRoom, storedKey, name);
  };

  const setupRoom = (rId: string, key: string, name: string) => {
    setRoomId(rId);
    setEncryptionKey(key);
    setDisplayCode(rId); // initial display code = room code
    encKeyRef.current = key;
    setIsEncrypted(true);

    const rtc = new WebRTCManager(rId, participantId, name);
    rtcRef.current = rtc;

    rtc.onMessage(async (fromId, msg: WebRTCMessage) => {
      if (msg.type === 'message') {
        const data = msg.data as { content: string; iv: string; senderName: string; id: string; timestamp: number };
        try {
          const plain = await decryptMessage({ content: data.content, iv: data.iv }, encKeyRef.current);
          setMessages((prev) => {
            // Deduplicate by message ID
            if (prev.some((m) => m.id === data.id)) return prev;
            return [...prev, {
              id: data.id, timestamp: data.timestamp, sender: fromId,
              senderName: data.senderName, content: plain, iv: data.iv,
            }];
          });
        } catch { console.error('Decryption failed'); }
      } else if (msg.type === 'participant-announce') {
        // Remote peer is telling us their identity after connection
        const d = msg.data as { id: string; name: string };
        if (d.id !== participantId) addParticipant(d.id, d.name);
      } else if (msg.type === 'participant-leave') {
        const d = msg.data as { id: string };
        setParticipants((prev) => prev.filter((p) => p.id !== d.id));
      }
    });

    rtc.onConnectionChange((fromId, connected, peerName) => {
      if (fromId === participantId) return; // never add yourself
      if (connected) {
        addParticipant(fromId, peerName || 'Peer');
        // Tell the newly connected peer who we are
        rtc.broadcast({ type: 'participant-announce', data: { id: participantId, name } });
      } else {
        setParticipants((prev) => prev.map((p) => p.id === fromId ? { ...p, connected: false } : p));
      }
    });

    rtc.start();

    setParticipants([{ id: participantId, name, connected: true, joinedAt: Date.now() }]);

    setMessages([{
      id: crypto.randomUUID(), timestamp: Date.now(), sender: 'system', senderName: 'System',
      content: `Welcome, ${name}. All messages are AES-256-GCM encrypted — nothing is stored or transmitted in plaintext.`,
      iv: '',
    }]);
  };

  const addParticipant = (id: string, name: string) => {
    setParticipants((prev) => {
      if (prev.find((p) => p.id === id)) return prev;
      return [...prev, { id, name, connected: true, joinedAt: Date.now() }];
    });
  };

  // ── Code rotation (cosmetic — underlying room stays the same) ─────────────
  const handleCodeRotate = useCallback(() => {
    setDisplayCode(generateRoomCode());
  }, []);

  // ── Scroll ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Send message ───────────────────────────────────────────────────────────
  const handleSendMessage = useCallback(async () => {
    if (!inputMessage.trim() || !encKeyRef.current) return;
    const rtc = rtcRef.current;
    const text = inputMessage.trim();
    setInputMessage('');
    try {
      const encrypted = await encryptMessage(text, encKeyRef.current);
      const id = crypto.randomUUID();
      const timestamp = Date.now();
      setMessages((prev) => [...prev, { id, timestamp, sender: participantId, senderName: participantName, content: text, iv: encrypted.iv }]);
      rtc?.broadcast({ type: 'message', data: { id, timestamp, content: encrypted.content, iv: encrypted.iv, senderName: participantName } });
    } catch { toast.error('Failed to encrypt message'); }
  }, [inputMessage, participantId, participantName]);

  // ── Leave ──────────────────────────────────────────────────────────────────
  const handleLeaveRoom = () => {
    if (!window.confirm('Leave this room? All messages will be destroyed.')) return;
    rtcRef.current?.broadcast({ type: 'participant-leave', data: { id: participantId } });
    rtcRef.current?.disconnect();
    ['participantId', 'roomId', 'encryptionKey'].forEach((k) => sessionStorage.removeItem(k));
    navigate('/');
  };

  // ── Name prompt screen ─────────────────────────────────────────────────────
  if (showNamePrompt) {
    return (
      <div className="h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg)', fontFamily: 'var(--font-body)' }}>
        <div className="w-full max-w-sm fade-up">
          <div className="rounded-2xl p-8" style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--text)', marginBottom: '0.5rem' }}>
              You're invited!
            </h2>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              Enter a name to join the room
            </p>
            <Input
              type="text"
              placeholder="Your name (or leave blank for a Norse alias)"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNameSubmit()}
              autoFocus
              className="mb-4 w-full"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--radius-md)', padding: '0.6rem 0.85rem', fontSize: 'var(--text-sm)' }}
            />
            <div className="flex gap-2">
              <Btn onClick={handleNameSubmit} fullWidth>Join room →</Btn>
              <Btn onClick={() => navigate('/')} variant="ghost">Cancel</Btn>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!roomId) return null;

  return (
    <div className="h-screen flex flex-col" style={{ background: 'var(--bg)', fontFamily: 'var(--font-body)' }}>
      <SecurityStatus
        encrypted={isEncrypted}
        participantCount={participants.filter((p) => p.connected).length}
        roomId={roomId}
        isPasswordProtected={false}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Chat column */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Room code bar */}
          <RoomCodeDisplay roomCode={displayCode} onRotate={handleCodeRotate} />

          {/* Top action bar */}
          <div
            className="flex items-center justify-between px-4 py-2 flex-shrink-0"
            style={{ background: 'var(--surface)', borderBottom: '1px solid var(--divider)' }}
          >
            <p style={{ fontSize: '0.65rem', color: 'var(--text-faint)' }}>
              <Lock size={9} style={{ display: 'inline', marginRight: '3px' }} />
              AES-256-GCM · session only
            </p>
            <Btn onClick={handleLeaveRoom} variant="danger" small>
              <LogOut size={11} /> Leave
            </Btn>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1">
            <div className="py-4 space-y-0.5">
              {/* Waiting banner */}
              {participants.filter((p) => p.connected).length === 1 && messages.length <= 1 && (
                <div className="mx-4 mb-3 rounded-xl p-4" style={{ background: 'var(--accent-subtle)', border: '1px solid rgba(212,135,10,0.3)' }}>
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    <span style={{ color: 'var(--accent)', fontWeight: 700 }}>Waiting for peers.</span>
                    {' '}Share the room code above with whoever you want to chat with. They enter it on the Huginn home page.
                  </p>
                </div>
              )}
              {messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} isOwn={msg.sender === participantId} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Input bar */}
          <div
            className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
            style={{ background: 'var(--surface)', borderTop: '1px solid var(--divider)' }}
          >
            <Input
              type="text"
              placeholder="Write an encrypted message…"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
              className="flex-1"
              aria-label="Message input"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--radius-lg)', padding: '0.6rem 1rem', fontSize: 'var(--text-sm)' }}
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputMessage.trim()}
              aria-label="Send message"
              className="w-10 h-10 flex items-center justify-center rounded-xl flex-shrink-0"
              style={{
                background: inputMessage.trim() ? 'var(--accent)' : 'var(--surface-dynamic)',
                color: inputMessage.trim() ? 'var(--accent-on)' : 'var(--text-faint)',
                cursor: inputMessage.trim() ? 'pointer' : 'not-allowed',
                transition: 'all var(--transition)', border: 'none',
              }}
            >
              <Send size={15} aria-hidden="true" />
            </button>
            <button
              onClick={() => setShowParticipants((v) => !v)}
              aria-label="Toggle participants"
              className="sm:hidden w-10 h-10 flex items-center justify-center rounded-xl flex-shrink-0"
              style={{ background: 'var(--surface-offset)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            >
              <span style={{ fontSize: '0.7rem', fontWeight: 700 }}>
                {participants.filter((p) => p.connected).length}
              </span>
            </button>
          </div>
        </div>

        {/* Participants sidebar */}
        <div className={`flex-shrink-0 ${showParticipants ? 'block' : 'hidden sm:block'}`}>
          <ParticipantList participants={participants} currentUserId={participantId} />
        </div>
      </div>
    </div>
  );
}
