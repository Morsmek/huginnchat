import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Copy, LogOut, Lock, Check, ShieldCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import SecurityStatus from '@/components/SecurityStatus';
import ChatMessage from '@/components/ChatMessage';
import ParticipantList from '@/components/ParticipantList';
import { generateParticipantName, keyFingerprint } from '@/lib/room';
import { encryptMessage, decryptMessage, generateRoomId } from '@/lib/crypto';
import { WebRTCManager } from '@/lib/webrtc';
import type { Message, Participant, WebRTCMessage } from '@/lib/types';

// ── Typing debounce ───────────────────────────────────────────────────────────
const TYPING_DEBOUNCE_MS = 2500;

// ── Small button ──────────────────────────────────────────────────────────────

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
    primary:   { background: 'var(--accent)', color: 'var(--accent-on)' },
    secondary: { background: 'var(--surface-offset)', color: 'var(--text-muted)', border: '1px solid var(--border)' },
    ghost:     { background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)' },
    danger:    { background: 'transparent', color: 'var(--error)', border: '1px solid rgba(204,68,68,0.35)' },
  };
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant] }}>{children}</button>;
}

// ── Room code display ─────────────────────────────────────────────────────────

function RoomCodeDisplay({ roomCode, fingerprint }: { roomCode: string; fingerprint: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Room code copied!');
  };

  return (
    <div
      className="flex items-center gap-3 px-4 py-2"
      style={{ background: 'var(--surface)', borderBottom: '1px solid var(--divider)' }}
    >
      <div className="flex-1 min-w-0">
        <div style={{ fontSize: '0.6rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.1rem' }}>
          Room code — share to invite
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '1.1rem', color: 'var(--accent)', letterSpacing: '0.18em' }}>
            {roomCode}
          </span>
          <button
            onClick={handleCopy}
            aria-label="Copy room code"
            style={{
              background: 'var(--accent-subtle)', border: '1px solid rgba(184,188,208,0.25)',
              color: 'var(--accent)', borderRadius: 'var(--radius-md)', padding: '0.2rem 0.5rem',
              cursor: 'pointer', fontSize: '0.65rem', display: 'inline-flex', alignItems: 'center', gap: '3px',
            }}
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      {/* Key fingerprint — both participants must see the same value */}
      {fingerprint && (
        <div
          title="Key fingerprint — verify this matches on all devices to confirm end-to-end encryption"
          style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, cursor: 'help' }}
        >
          <ShieldCheck size={10} style={{ color: 'var(--success)' }} />
          <span style={{ fontFamily: 'monospace', fontSize: '0.6rem', color: 'var(--text-faint)', letterSpacing: '0.08em' }}>
            {fingerprint}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Typing indicator ──────────────────────────────────────────────────────────

function TypingIndicator({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  const label = names.length === 1
    ? `${names[0]} is typing`
    : names.length === 2
    ? `${names[0]} and ${names[1]} are typing`
    : `${names.length} people are typing`;

  return (
    <div className="flex items-center gap-2 px-4 pb-1" style={{ minHeight: '22px' }}>
      <span style={{ fontSize: '0.65rem', color: 'var(--text-faint)', fontStyle: 'italic' }}>
        {label}
        <span className="ml-1" aria-hidden="true">
          <span style={{ animation: 'fadeIn 0.4s 0s both, fadeIn 0.4s 0.6s reverse both' }}>·</span>
          <span style={{ animation: 'fadeIn 0.4s 0.2s both, fadeIn 0.4s 0.8s reverse both' }}>·</span>
          <span style={{ animation: 'fadeIn 0.4s 0.4s both, fadeIn 0.4s 1s reverse both' }}>·</span>
        </span>
      </span>
    </div>
  );
}

// ── Main Room component ───────────────────────────────────────────────────────

export default function Room() {
  const navigate = useNavigate();

  const [roomId,         setRoomId]         = useState<string | null>(null);
  const [displayCode,    setDisplayCode]    = useState('');
  const [keyFp,          setKeyFp]          = useState(''); // key fingerprint

  const [participantId]    = useState(() => sessionStorage.getItem('participantId') || generateRoomId());
  const [participantName,  setParticipantName]  = useState(() => sessionStorage.getItem('participantName') || '');

  const [showNamePrompt,  setShowNamePrompt]  = useState(false);
  const [nameInput,       setNameInput]       = useState('');

  const [messages,        setMessages]        = useState<Message[]>([]);
  const [participants,    setParticipants]    = useState<Participant[]>([]);
  const [inputMessage,    setInputMessage]    = useState('');
  const [isEncrypted,     setIsEncrypted]     = useState(false);
  const [showParticipants,setShowParticipants]= useState(false);
  const [connectionStatus,setConnectionStatus]= useState<'connecting' | 'ready'>('connecting');

  // Typing indicators
  const [typingPeers,     setTypingPeers]     = useState<Map<string, string>>(new Map()); // id -> name
  const typingTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const isTypingRef    = useRef(false);
  const typingTimeout  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const rtcRef         = useRef<WebRTCManager | null>(null);
  const encKeyRef      = useRef<string>('');

  // ── Init ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    const storedRoom = sessionStorage.getItem('roomId');
    const storedKey  = sessionStorage.getItem('encryptionKey');
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
      ['roomId', 'encryptionKey'].forEach(k => sessionStorage.removeItem(k));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNameSubmit = () => {
    const name = nameInput.trim() || generateParticipantName();
    sessionStorage.setItem('participantName', name);
    sessionStorage.setItem('participantId', participantId);
    setParticipantName(name);
    setShowNamePrompt(false);
    setupRoom(
      sessionStorage.getItem('roomId')!,
      sessionStorage.getItem('encryptionKey')!,
      name,
    );
  };

  const setupRoom = async (rId: string, key: string, name: string) => {
    setRoomId(rId);
    setDisplayCode(rId);
    encKeyRef.current = key;
    setIsEncrypted(true);

    // Compute and display key fingerprint
    try {
      const fp = await keyFingerprint(key);
      setKeyFp(fp);
    } catch {}

    const rtc = new WebRTCManager(rId, participantId, name);
    rtcRef.current = rtc;

    rtc.onMessage(async (fromId, msg: WebRTCMessage) => {
      if (msg.type === 'message') {
        const data = msg.data as { content: string; iv: string; senderName: string; id: string; timestamp: number };
        try {
          const plain = await decryptMessage({ content: data.content, iv: data.iv }, encKeyRef.current);
          setMessages(prev => {
            if (prev.some(m => m.id === data.id)) return prev;
            return [...prev, { id: data.id, timestamp: data.timestamp, sender: fromId, senderName: data.senderName, content: plain, iv: data.iv }];
          });
          // Clear typing indicator when they send a message
          _clearTyping(fromId);
        } catch {
          toast.error(`⚠ Failed to decrypt a message from ${fromId.slice(0, 6)}… — possible key mismatch`);
        }
      } else if (msg.type === 'typing') {
        const d = msg.data as { id: string; name: string; isTyping: boolean };
        if (d.isTyping) {
          _setTyping(d.id, d.name);
        } else {
          _clearTyping(d.id);
        }
      } else if (msg.type === 'participant-announce') {
        const d = msg.data as { id: string; name: string };
        if (d.id !== participantId) addParticipant(d.id, d.name);
      } else if (msg.type === 'participant-leave') {
        const d = msg.data as { id: string };
        setParticipants(prev => prev.filter(p => p.id !== d.id));
        _clearTyping(d.id);
      }
    });

    rtc.onConnectionChange((fromId, connected, peerName) => {
      if (fromId === participantId) return;
      if (connected) {
        addParticipant(fromId, peerName || 'Peer');
        rtc.broadcast({ type: 'participant-announce', data: { id: participantId, name } });
        setConnectionStatus('ready');
      } else {
        setParticipants(prev => prev.map(p => p.id === fromId ? { ...p, connected: false } : p));
        _clearTyping(fromId);
      }
    });

    await rtc.start();

    setParticipants([{ id: participantId, name, connected: true, joinedAt: Date.now() }]);
    setMessages([{
      id: crypto.randomUUID(), timestamp: Date.now(), sender: 'system', senderName: 'System',
      content: `Welcome, ${name}. All messages are AES-256-GCM encrypted — nothing is stored or transmitted in plaintext.`,
      iv: '',
    }]);
  };

  const addParticipant = (id: string, name: string) => {
    setParticipants(prev => {
      if (prev.find(p => p.id === id)) return prev;
      return [...prev, { id, name, connected: true, joinedAt: Date.now() }];
    });
  };

  // ── Typing indicators ──────────────────────────────────────────────────────

  const _setTyping = (id: string, name: string) => {
    setTypingPeers(prev => new Map(prev).set(id, name));
    setParticipants(prev => prev.map(p => p.id === id ? { ...p, isTyping: true } : p));
    // Auto-clear after 4s in case we miss the stop event
    const existing = typingTimeouts.current.get(id);
    if (existing) clearTimeout(existing);
    typingTimeouts.current.set(id, setTimeout(() => _clearTyping(id), 4000));
  };

  const _clearTyping = (id: string) => {
    setTypingPeers(prev => { const m = new Map(prev); m.delete(id); return m; });
    setParticipants(prev => prev.map(p => p.id === id ? { ...p, isTyping: false } : p));
    const t = typingTimeouts.current.get(id);
    if (t) { clearTimeout(t); typingTimeouts.current.delete(id); }
  };

  const handleInputChange = (val: string) => {
    setInputMessage(val);
    const rtc = rtcRef.current;
    if (!rtc) return;

    if (val.length > 0 && !isTypingRef.current) {
      isTypingRef.current = true;
      rtc.broadcast({ type: 'typing', data: { id: participantId, name: participantName, isTyping: true } });
    }

    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      if (isTypingRef.current) {
        isTypingRef.current = false;
        rtc.broadcast({ type: 'typing', data: { id: participantId, name: participantName, isTyping: false } });
      }
    }, TYPING_DEBOUNCE_MS);
  };

  // ── Scroll ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingPeers]);

  // ── Send ───────────────────────────────────────────────────────────────────
  const handleSendMessage = useCallback(async () => {
    if (!inputMessage.trim() || !encKeyRef.current) return;
    const rtc = rtcRef.current;
    const text = inputMessage.trim();
    setInputMessage('');

    // Stop typing indicator
    if (isTypingRef.current) {
      isTypingRef.current = false;
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      rtc?.broadcast({ type: 'typing', data: { id: participantId, name: participantName, isTyping: false } });
    }

    try {
      const encrypted = await encryptMessage(text, encKeyRef.current);
      const id = crypto.randomUUID();
      const timestamp = Date.now();
      setMessages(prev => [...prev, { id, timestamp, sender: participantId, senderName: participantName, content: text, iv: encrypted.iv }]);
      rtc?.broadcast({ type: 'message', data: { id, timestamp, content: encrypted.content, iv: encrypted.iv, senderName: participantName } });
    } catch {
      toast.error('Failed to encrypt message — please try again');
    }
  }, [inputMessage, participantId, participantName]);

  // ── Leave ──────────────────────────────────────────────────────────────────
  const handleLeaveRoom = () => {
    if (!window.confirm('Leave this room? All messages will be destroyed.')) return;
    rtcRef.current?.broadcast({ type: 'participant-leave', data: { id: participantId } });
    rtcRef.current?.disconnect();
    ['participantId', 'roomId', 'encryptionKey'].forEach(k => sessionStorage.removeItem(k));
    navigate('/');
  };

  // ── Name prompt ────────────────────────────────────────────────────────────
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
              type="text" placeholder="Your name (or leave blank for a Norse alias)"
              value={nameInput} onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleNameSubmit()} autoFocus className="mb-4 w-full"
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

  const typingNames = Array.from(typingPeers.values());
  const onlineCount = participants.filter(p => p.connected).length;

  return (
    <div className="h-screen flex flex-col" style={{ background: 'var(--bg)', fontFamily: 'var(--font-body)' }}>
      <SecurityStatus
        encrypted={isEncrypted}
        participantCount={onlineCount}
        roomId={roomId}
        isPasswordProtected={false}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Chat column */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Room code + fingerprint bar */}
          <RoomCodeDisplay roomCode={displayCode} fingerprint={keyFp} />

          {/* Action bar */}
          <div className="flex items-center justify-between px-4 py-2 flex-shrink-0"
            style={{ background: 'var(--surface)', borderBottom: '1px solid var(--divider)' }}>
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
              {onlineCount === 1 && messages.length <= 1 && (
                <div className="mx-4 mb-3 rounded-xl p-4" style={{ background: 'var(--accent-subtle)', border: '1px solid rgba(184,188,208,0.15)' }}>
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    <span style={{ color: 'var(--accent)', fontWeight: 700 }}>Waiting for peers.</span>
                    {' '}Share the room code above. Others enter it on the Huginn home page to join.
                  </p>
                </div>
              )}
              {messages.map(msg => (
                <ChatMessage key={msg.id} message={msg} isOwn={msg.sender === participantId} />
              ))}
              <TypingIndicator names={typingNames} />
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Input bar */}
          <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
            style={{ background: 'var(--surface)', borderTop: '1px solid var(--divider)' }}>
            <Input
              type="text" placeholder="Write an encrypted message…"
              value={inputMessage}
              onChange={e => handleInputChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
              className="flex-1" aria-label="Message input"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--radius-lg)', padding: '0.6rem 1rem', fontSize: 'var(--text-sm)' }}
            />
            <button
              onClick={handleSendMessage} disabled={!inputMessage.trim()}
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
              onClick={() => setShowParticipants(v => !v)} aria-label="Toggle participants"
              className="sm:hidden w-10 h-10 flex items-center justify-center rounded-xl flex-shrink-0"
              style={{ background: 'var(--surface-offset)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            >
              <span style={{ fontSize: '0.7rem', fontWeight: 700 }}>{onlineCount}</span>
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
