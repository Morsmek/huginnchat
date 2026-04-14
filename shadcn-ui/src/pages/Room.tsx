import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send,
  Copy,
  LogOut,
  Lock,
  Link,
  UserPlus,
  Check,
  ChevronRight,
  X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import SecurityStatus from '@/components/SecurityStatus';
import ChatMessage from '@/components/ChatMessage';
import ParticipantList from '@/components/ParticipantList';
import { parseRoomUrl, clearRoomUrl, generateRoomUrl, generateParticipantName } from '@/lib/room';
import {
  encryptMessage,
  decryptMessage,
  generateRoomId,
  deriveKeyFromPassword,
} from '@/lib/crypto';
import { WebRTCManager } from '@/lib/webrtc';
import type { Message, Participant, RoomConfig, WebRTCMessage } from '@/lib/types';

function Btn({
  onClick,
  disabled = false,
  children,
  variant = 'primary',
  small = false,
  fullWidth = false,
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  small?: boolean;
  fullWidth?: boolean;
}) {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    borderRadius: 'var(--radius-lg)',
    fontFamily: 'var(--font-body)',
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all var(--transition)',
    border: 'none',
    fontSize: small ? 'var(--text-xs)' : 'var(--text-sm)',
    padding: small ? '0.35rem 0.75rem' : '0.55rem 1.1rem',
    width: fullWidth ? '100%' : undefined,
    opacity: disabled ? 0.45 : 1,
  };

  const variants: Record<string, React.CSSProperties> = {
    primary: {
      background: 'var(--accent)',
      color: 'var(--accent-on)',
    },
    secondary: {
      background: 'var(--surface-offset)',
      color: 'var(--text-muted)',
      border: '1px solid var(--border)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text-muted)',
      border: '1px solid var(--border)',
    },
    danger: {
      background: 'transparent',
      color: 'var(--error)',
      border: '1px solid rgba(204,68,68,0.35)',
    },
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ ...base, ...variants[variant] }}
    >
      {children}
    </button>
  );
}

export default function Room() {
  const navigate = useNavigate();

  const [roomConfig, setRoomConfig] = useState<{
    roomId: string;
    encryptionKey: string;
  } | null>(null);
  const [participantId] = useState(
    () => sessionStorage.getItem('participantId') || generateRoomId(),
  );
  const [participantName, setParticipantName] = useState(
    () => sessionStorage.getItem('participantName') || '',
  );

  // name prompt — shown when joining via a shared link without a stored name
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [shareableUrl, setShareableUrl] = useState('');
  const [isPasswordProtected, setIsPasswordProtected] = useState(false);

  const [showParticipants, setShowParticipants] = useState(false);

  // password prompt
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [roomPassword, setRoomPassword] = useState('');

  // manual pairing dialog
  const [showPairDialog, setShowPairDialog] = useState(false);
  const [pairMode, setPairMode] = useState<'generate' | 'accept'>('generate');
  const [generatedOffer, setGeneratedOffer] = useState('');
  const [pastedOffer, setPastedOffer] = useState('');
  const [generatedAnswer, setGeneratedAnswer] = useState('');
  const [pastedAnswer, setPastedAnswer] = useState('');
  const [pairStep, setPairStep] = useState<'start' | 'waiting-answer' | 'done'>(
    'start',
  );
  const [copied, setCopied] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const rtcRef = useRef<WebRTCManager | null>(null);
  const encKeyRef = useRef<string>('');

  useEffect(() => {
    // If joining via shared URL link and no name is stored, show the name prompt first
    const hasUrlConfig = parseRoomUrl() !== null;
    const hasStoredName = !!sessionStorage.getItem('participantName');
    if (hasUrlConfig && !hasStoredName) {
      setShowNamePrompt(true);
      return;
    }

    initializeRoom();

    return () => {
      rtcRef.current?.disconnect();
      ['roomId', 'encryptionKey', 'roomPassword'].forEach((k) =>
        sessionStorage.removeItem(k),
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initializeRoom = async (resolvedName?: string) => {
    // Use the resolved name (from name prompt) or the current state value
    const effectiveName = resolvedName || participantName || generateParticipantName();

    let config = parseRoomUrl();

    if (!config) {
      const roomId = sessionStorage.getItem('roomId');
      const encryptionKey = sessionStorage.getItem('encryptionKey');
      const storedPw = sessionStorage.getItem('roomPassword');

      if (roomId && encryptionKey) {
        config = { roomId, encryptionKey };
        setIsPasswordProtected(!!storedPw);

        const fullConfig: RoomConfig = {
          roomId,
          encryptionKey,
          participantId,
          participantName: effectiveName,
        };
        const url = storedPw
          ? generateRoomUrl(fullConfig, false)
          : generateRoomUrl(fullConfig, true);

        window.history.replaceState(null, '', url);
        setShareableUrl(url);
      }
    } else {
      const fullConfig: RoomConfig = {
        roomId: config.roomId,
        encryptionKey: config.encryptionKey,
        participantId,
        participantName: effectiveName,
      };
      setShareableUrl(generateRoomUrl(fullConfig, true));
    }

    if (!config) {
      const roomId = new URLSearchParams(
        window.location.hash.slice(1),
      ).get('room');
      if (roomId) {
        setShowPasswordPrompt(true);
        return;
      }
      toast.error('Invalid room URL');
      navigate('/');
      return;
    }

    await setupRoom(config, effectiveName);
  };

  const handleNameSubmit = () => {
    const name = nameInput.trim() || generateParticipantName();
    sessionStorage.setItem('participantName', name);
    sessionStorage.setItem('participantId', participantId);
    setParticipantName(name);
    setShowNamePrompt(false);

    // Check if this is also a password-protected room
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const hasKey = params.has('key');
    if (!hasKey && params.has('room')) {
      // Password-protected room — show password prompt next
      setShowPasswordPrompt(true);
    } else {
      initializeRoom(name);
    }
  };

  const handlePasswordSubmit = async () => {
    const roomId = new URLSearchParams(
      window.location.hash.slice(1),
    ).get('room');
    if (!roomId || !roomPassword.trim()) {
      toast.error('Please enter a password');
      return;
    }

    try {
      const encryptionKey = await deriveKeyFromPassword(
        roomPassword.trim(),
        roomId,
      );
      sessionStorage.setItem('roomPassword', roomPassword.trim());
      setShowPasswordPrompt(false);
      setIsPasswordProtected(true);
      const name = participantName || generateParticipantName();
      await setupRoom({ roomId, encryptionKey }, name);
    } catch {
      toast.error('Failed to join room');
    }
  };

  const setupRoom = async (config: { roomId: string; encryptionKey: string }, effectiveName?: string) => {
    const name = effectiveName || participantName || generateParticipantName();
    setRoomConfig(config);
    encKeyRef.current = config.encryptionKey;
    setIsEncrypted(true);

    const rtc = new WebRTCManager(config.roomId, participantId, name);
    rtcRef.current = rtc;

    rtc.onMessage(async (fromId, msg: WebRTCMessage) => {
      if (msg.type === 'message') {
        const data = msg.data as {
          content: string;
          iv: string;
          senderName: string;
          id: string;
          timestamp: number;
        };

        try {
          const plain = await decryptMessage(
            { content: data.content, iv: data.iv },
            encKeyRef.current,
          );

          const message: Message = {
            id: data.id,
            timestamp: data.timestamp,
            sender: fromId,
            senderName: data.senderName,
            content: plain,
            iv: data.iv,
          };
          setMessages((prev) => [...prev, message]);
        } catch {
          console.error('Decryption failed');
        }
      } else if (msg.type === 'participant-join') {
        const d = msg.data as { id: string; name: string };
        addParticipant(d.id, d.name);
        rtc.broadcast({
          type: 'participant-list',
          data: { id: participantId, name },
        });
      } else if (msg.type === 'participant-list') {
        const d = msg.data as { id: string; name: string };
        addParticipant(d.id, d.name);
      } else if (msg.type === 'participant-leave') {
        const d = msg.data as { id: string };
        setParticipants((prev) => prev.filter((p) => p.id !== d.id));
      }
    });

    rtc.onConnectionChange((fromId, connected, peerName) => {
      if (connected) {
        addParticipant(fromId, peerName || 'Peer');
        rtc.broadcast({
          type: 'participant-join',
          data: { id: participantId, name },
        });
      } else {
        setParticipants((prev) =>
          prev.map((p) =>
            p.id === fromId ? { ...p, connected: false } : p,
          ),
        );
      }
    });

    rtc.start();

    setParticipants([
      {
        id: participantId,
        name,
        connected: true,
        joinedAt: Date.now(),
      },
    ]);

    setMessages([
      {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        sender: 'system',
        senderName: 'System',
        content: `Welcome, ${name}. All messages are AES-256-GCM encrypted in your browser — nothing is stored or transmitted in plaintext.`,
        iv: '',
      },
    ]);
  };

  const addParticipant = (id: string, name: string) => {
    setParticipants((prev) => {
      if (prev.find((p) => p.id === id)) return prev;
      return [
        ...prev,
        { id, name, connected: true, joinedAt: Date.now() },
      ];
    });
  };

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSendMessage = useCallback(async () => {
    if (!inputMessage.trim() || !roomConfig) return;

    const rtc = rtcRef.current;
    const text = inputMessage.trim();
    setInputMessage('');

    try {
      const encrypted = await encryptMessage(text, roomConfig.encryptionKey);
      const id = crypto.randomUUID();
      const timestamp = Date.now();

      setMessages((prev) => [
        ...prev,
        {
          id,
          timestamp,
          sender: participantId,
          senderName: participantName,
          content: text,
          iv: encrypted.iv,
        },
      ]);

      rtc?.broadcast({
        type: 'message',
        data: {
          id,
          timestamp,
          content: encrypted.content,
          iv: encrypted.iv,
          senderName: participantName,
        },
      });
    } catch {
      toast.error('Failed to encrypt message');
    }
  }, [inputMessage, roomConfig, participantId, participantName]);

  const handleCopyRoomUrl = () => {
    const password = sessionStorage.getItem('roomPassword');
    const text = password
      ? `${shareableUrl}\n\nPassword: ${password}`
      : shareableUrl || window.location.href;

    navigator.clipboard.writeText(text);
    toast.success(
      password ? 'URL + password copied' : 'Room URL copied',
    );
  };

  const handleLeaveRoom = () => {
    if (
      !window.confirm('Leave this room? All messages will be destroyed.')
    )
      return;

    rtcRef.current?.broadcast({
      type: 'participant-leave',
      data: { id: participantId },
    });
    rtcRef.current?.disconnect();
    clearRoomUrl();
    ['participantId', 'roomId', 'encryptionKey', 'roomPassword'].forEach(
      (k) => sessionStorage.removeItem(k),
    );
    navigate('/');
  };

  const handleOpenPairDialog = () => {
    setShowPairDialog(true);
    setPairMode('generate');
    setPairStep('start');
    setGeneratedOffer('');
    setPastedOffer('');
    setGeneratedAnswer('');
    setPastedAnswer('');
  };

  const handleGenerateOffer = async () => {
    const rtc = rtcRef.current;
    if (!rtc) return;

    try {
      const offer = await rtc.generateManualOffer();
      setGeneratedOffer(offer);
      setPairStep('waiting-answer');
    } catch {
      toast.error('Failed to generate offer');
    }
  };

  const handleAcceptOffer = async () => {
    const rtc = rtcRef.current;
    if (!rtc || !pastedOffer.trim()) return;

    try {
      const answer = await rtc.acceptManualOffer(pastedOffer.trim());
      setGeneratedAnswer(answer);
      setPairStep('done');
      toast.success('Share the answer code');
    } catch {
      toast.error('Invalid offer code');
    }
  };

  const handleAcceptAnswer = async () => {
    const rtc = rtcRef.current;
    if (!rtc || !pastedAnswer.trim()) return;

    try {
      await rtc.acceptManualAnswer(pastedAnswer.trim());
      setShowPairDialog(false);
      toast.success('Peer connected!');
    } catch {
      toast.error('Invalid answer code');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const monoArea: React.CSSProperties = {
    width: '100%',
    height: '6rem',
    padding: '0.75rem',
    fontFamily: 'monospace',
    resize: 'none',
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    color: 'var(--text-muted)',
    fontSize: '0.65rem',
    borderRadius: 'var(--radius-xl)',
    outline: 'none',
  };

  if (showNamePrompt) {
    return (
      <div
        className="h-screen flex items-center justify-center p-4"
        style={{
          background: 'var(--bg)',
          fontFamily: 'var(--font-body)',
        }}
      >
        <div className="w-full max-w-sm fade-up">
          <div
            className="rounded-2xl p-8"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  background: 'var(--accent-subtle)',
                  border: '1px solid rgba(212,135,10,0.3)',
                }}
              >
                <UserPlus
                  size={18}
                  style={{ color: 'var(--accent)' }}
                />
              </div>
              <div>
                <h2
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'var(--text-lg)',
                    fontWeight: 800,
                    color: 'var(--text)',
                  }}
                >
                  You're invited!
                </h2>
                <p
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--text-muted)',
                  }}
                >
                  Enter a name to join the room
                </p>
              </div>
            </div>
            <Input
              type="text"
              placeholder="Your name (or leave blank for a Norse alias)"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) =>
                e.key === 'Enter' && handleNameSubmit()
              }
              autoFocus
              className="mb-4 w-full"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                borderRadius: 'var(--radius-md)',
                padding: '0.6rem 0.85rem',
                fontSize: 'var(--text-sm)',
              }}
            />
            <div className="flex gap-2">
              <Btn onClick={handleNameSubmit} fullWidth>
                Join room <ChevronRight size={14} />
              </Btn>
              <Btn onClick={() => navigate('/')} variant="ghost">
                Cancel
              </Btn>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (showPasswordPrompt) {
    return (
      <div
        className="h-screen flex items-center justify-center p-4"
        style={{
          background: 'var(--bg)',
          fontFamily: 'var(--font-body)',
        }}
      >
        <div className="w-full max-w-sm fade-up">
          <div
            className="rounded-2xl p-8"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  background: 'var(--accent-subtle)',
                  border: '1px solid rgba(212,135,10,0.3)',
                }}
              >
                <Lock
                  size={18}
                  style={{ color: 'var(--accent)' }}
                />
              </div>
              <div>
                <h2
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'var(--text-lg)',
                    fontWeight: 800,
                    color: 'var(--text)',
                  }}
                >
                  Password required
                </h2>
                <p
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--text-muted)',
                  }}
                >
                  This room is password-protected
                </p>
              </div>
            </div>
            <Input
              type="password"
              placeholder="Enter room password"
              value={roomPassword}
              onChange={(e) => setRoomPassword(e.target.value)}
              onKeyDown={(e) =>
                e.key === 'Enter' && handlePasswordSubmit()
              }
              className="mb-4 w-full"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                borderRadius: 'var(--radius-md)',
                padding: '0.6rem 0.85rem',
                fontSize: 'var(--text-sm)',
              }}
            />
            <div className="flex gap-2">
              <Btn
                onClick={handlePasswordSubmit}
                disabled={!roomPassword.trim()}
                fullWidth
              >
                Join room <ChevronRight size={14} />
              </Btn>
              <Btn
                onClick={() => navigate('/')}
                variant="ghost"
              >
                Cancel
              </Btn>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!roomConfig) return null;

  return (
    <div
      className="h-screen flex flex-col"
      style={{
        background: 'var(--bg)',
        fontFamily: 'var(--font-body)',
      }}
    >
      <SecurityStatus
        encrypted={isEncrypted}
        participantCount={participants.filter((p) => p.connected).length}
        roomId={roomConfig.roomId}
        isPasswordProtected={isPasswordProtected}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Chat column */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* room info bar */}
          <div
            className="flex items-center gap-3 px-4 py-2.5 flex-shrink-0"
            style={{
              background: 'var(--surface)',
              borderBottom: '1px solid var(--divider)',
            }}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="font-mono truncate"
                  title={roomConfig.roomId}
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--text-faint)',
                  }}
                >
                  {roomConfig.roomId}
                </span>
                {isPasswordProtected && (
                  <Lock
                    size={10}
                    style={{
                      color: 'var(--accent)',
                      flexShrink: 0,
                    }}
                    aria-label="Password protected"
                  />
                )}
              </div>
              <p
                style={{
                  fontSize: '0.65rem',
                  color: 'var(--text-faint)',
                }}
              >
                {isPasswordProtected
                  ? 'Share URL + password separately'
                  : 'Key is in the URL fragment — never stored'}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Btn
                onClick={handleCopyRoomUrl}
                variant="ghost"
                small
              >
                <Link size={11} />
                <span className="hidden sm:inline">
                  Copy URL
                </span>
              </Btn>
              <Btn
                onClick={handleOpenPairDialog}
                variant="ghost"
                small
              >
                <UserPlus size={11} />
                <span className="hidden sm:inline">
                  Add peer
                </span>
              </Btn>
              <Btn
                onClick={handleLeaveRoom}
                variant="danger"
                small
              >
                <LogOut size={11} />
              </Btn>
            </div>
          </div>

          {/* messages */}
          <ScrollArea className="flex-1">
            <div className="py-4 space-y-0.5">
              {/* Cross-device connection guidance banner */}
              {participants.filter((p) => p.connected).length === 1 && messages.length <= 1 && (
                <div
                  className="mx-4 mb-3 rounded-xl p-4"
                  style={{
                    background: 'var(--accent-subtle)',
                    border: '1px solid rgba(212,135,10,0.3)',
                  }}
                >
                  <p
                    style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--text-muted)',
                      lineHeight: 1.6,
                    }}
                  >
                    <span style={{ color: 'var(--accent)', fontWeight: 700 }}>Waiting for peers.</span>
                    {' '}If you're on the same device/browser, share the URL and open it in another tab — it auto-connects.
                    For <strong>cross-device</strong> connections, click <strong>Add peer</strong> above and exchange the connection codes manually.
                  </p>
                </div>
              )}
              {messages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  isOwn={msg.sender === participantId}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* input bar */}
          <div
            className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
            style={{
              background: 'var(--surface)',
              borderTop: '1px solid var(--divider)',
            }}
          >
            <Input
              type="text"
              placeholder="Write an encrypted message…"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) =>
                e.key === 'Enter' &&
                !e.shiftKey &&
                handleSendMessage()
              }
              className="flex-1"
              aria-label="Message input"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                borderRadius: 'var(--radius-lg)',
                padding: '0.6rem 1rem',
                fontSize: 'var(--text-sm)',
              }}
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputMessage.trim()}
              aria-label="Send message"
              className="w-10 h-10 flex items-center justify-center rounded-xl flex-shrink-0"
              style={{
                background: inputMessage.trim()
                  ? 'var(--accent)'
                  : 'var(--surface-dynamic)',
                color: inputMessage.trim()
                  ? 'var(--accent-on)'
                  : 'var(--text-faint)',
                cursor: inputMessage.trim()
                  ? 'pointer'
                  : 'not-allowed',
                transition: 'all var(--transition)',
                border: 'none',
              }}
            >
              <Send size={15} aria-hidden="true" />
            </button>
            <button
              onClick={() =>
                setShowParticipants((v) => !v)
              }
              aria-label="Toggle participants"
              className="sm:hidden w-10 h-10 flex items-center justify-center rounded-xl flex-shrink-0"
              style={{
                background: 'var(--surface-offset)',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
              }}
            >
              <span
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                }}
              >
                {
                  participants.filter((p) => p.connected)
                    .length
                }
              </span>
            </button>
          </div>
        </div>

        {/* participants */}
        <div
          className={`flex-shrink-0 ${
            showParticipants ? 'block' : 'hidden sm:block'
          }`}
        >
          <ParticipantList
            participants={participants}
            currentUserId={participantId}
          />
        </div>
      </div>

      {/* pair dialog */}
      <Dialog
        open={showPairDialog}
        onOpenChange={setShowPairDialog}
      >
        <DialogContent
          className="max-w-lg"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-xl)',
            borderRadius: 'var(--radius-2xl)',
            fontFamily: 'var(--font-body)',
          }}
        >
          <DialogHeader>
            <DialogTitle
              className="flex items-center gap-2"
              style={{
                color: 'var(--text)',
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
              }}
            >
              <UserPlus
                size={16}
                style={{ color: 'var(--accent)' }}
              />
              Add Peer
            </DialogTitle>
            <DialogDescription
              style={{
                color: 'var(--text-muted)',
                fontSize: 'var(--text-xs)',
              }}
            >
              Zero-knowledge manual handshake — no server
              involved.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2 my-2">
            {(['generate', 'accept'] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setPairMode(m);
                  setPairStep('start');
                }}
                className="flex-1 py-2 rounded-lg font-medium"
                style={{
                  background:
                    pairMode === m
                      ? 'var(--accent-subtle)'
                      : 'var(--surface-offset)',
                  border: `1px solid ${
                    pairMode === m
                      ? 'rgba(212,135,10,0.4)'
                      : 'transparent'
                  }`,
                  color:
                    pairMode === m
                      ? 'var(--text)'
                      : 'var(--text-muted)',
                  cursor: 'pointer',
                  transition: 'all var(--transition)',
                  fontSize: 'var(--text-xs)',
                }}
              >
                {m === 'generate'
                  ? 'I want to invite'
                  : 'I received a link'}
              </button>
            ))}
          </div>

          {pairMode === 'generate' && (
            <div className="space-y-4">
              {/* Step 1 — share the room link */}
              {pairStep === 'start' && (
                <>
                  <div
                    style={{
                      background: 'var(--surface-offset)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-xl)',
                      padding: '0.85rem 1rem',
                    }}
                  >
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--accent)', fontWeight: 700, marginBottom: '0.25rem' }}>
                      Step 1 of 2 — Send the invite link
                    </p>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                      Share this link with the person you want to invite. Once they've opened it and entered the room, come back here and click Next.
                    </p>
                    <div className="flex items-center gap-2">
                      <code
                        style={{
                          flex: 1,
                          fontSize: '0.62rem',
                          color: 'var(--text-faint)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'block',
                        }}
                        title={shareableUrl}
                      >
                        {shareableUrl}
                      </code>
                      <button
                        onClick={() => copyToClipboard(shareableUrl)}
                        aria-label="Copy invite link"
                        className="flex items-center gap-1 px-2 py-1 rounded-lg flex-shrink-0"
                        style={{
                          background: 'var(--accent)',
                          color: 'var(--accent-on)',
                          fontSize: '0.65rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          border: 'none',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {copied ? <Check size={10} /> : <Copy size={10} />}
                        {copied ? 'Copied!' : 'Copy link'}
                      </button>
                    </div>
                  </div>
                  <Btn onClick={handleGenerateOffer} fullWidth>
                    They're in — generate connection code →
                  </Btn>
                </>
              )}

              {/* Step 2 — exchange SDP */}
              {pairStep === 'waiting-answer' && (
                <>
                  <div
                    style={{
                      background: 'var(--surface-offset)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-xl)',
                      padding: '0.6rem 0.85rem',
                      marginBottom: '0.25rem',
                    }}
                  >
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--accent)', fontWeight: 700 }}>
                      Step 2 of 2 — Exchange codes
                    </p>
                  </div>
                  <div>
                    <p
                      style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--text-muted)',
                        marginBottom: '0.5rem',
                      }}
                    >
                      1. Send them this connection code (via chat, email, etc.):
                    </p>
                    <div className="relative">
                      <textarea
                        readOnly
                        value={generatedOffer}
                        style={monoArea}
                      />
                      <button
                        onClick={() =>
                          copyToClipboard(generatedOffer)
                        }
                        aria-label="Copy offer"
                        className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-lg"
                        style={{
                          background:
                            'var(--surface-dynamic)',
                          border:
                            '1px solid var(--border)',
                          color: 'var(--text-muted)',
                          fontSize: '0.65rem',
                          cursor: 'pointer',
                        }}
                      >
                        {copied ? (
                          <Check size={10} />
                        ) : (
                          <Copy size={10} />
                        )}
                      </button>
                    </div>
                  </div>
                  <div>
                    <p
                      style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--text-muted)',
                        marginBottom: '0.5rem',
                      }}
                    >
                      2. Paste the answer code they send back:
                    </p>
                    <textarea
                      value={pastedAnswer}
                      onChange={(e) =>
                        setPastedAnswer(e.target.value)
                      }
                      placeholder="Paste answer code here…"
                      style={{
                        ...monoArea,
                        color: 'var(--text)',
                      }}
                    />
                  </div>
                  <Btn
                    onClick={handleAcceptAnswer}
                    disabled={!pastedAnswer.trim()}
                    fullWidth
                  >
                    Complete connection
                  </Btn>
                </>
              )}
            </div>
          )}

          {pairMode === 'accept' && (
            <div className="space-y-4">
              {pairStep === 'start' && (
                <>
                  <p
                    style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--text-muted)',
                      marginBottom: '0.5rem',
                    }}
                  >
                    Paste the connection code you received from the host:
                  </p>
                  <textarea
                    value={pastedOffer}
                    onChange={(e) =>
                      setPastedOffer(e.target.value)
                    }
                    placeholder="Paste connection code here…"
                    style={{
                      ...monoArea,
                      color: 'var(--text)',
                    }}
                  />
                  <Btn
                    onClick={handleAcceptOffer}
                    disabled={!pastedOffer.trim()}
                    fullWidth
                  >
                    Generate answer code
                  </Btn>
                </>
              )}

              {pairStep === 'done' && (
                <>
                  <p
                    style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--text-muted)',
                      marginBottom: '0.5rem',
                    }}
                  >
                    Send this answer code back to the host:
                  </p>
                  <div className="relative">
                    <textarea
                      readOnly
                      value={generatedAnswer}
                      style={monoArea}
                    />
                    <button
                      onClick={() =>
                        copyToClipboard(generatedAnswer)
                      }
                      aria-label="Copy answer"
                      className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-lg"
                      style={{
                        background: 'var(--surface-dynamic)',
                        border:
                          '1px solid var(--border)',
                        color: 'var(--text-muted)',
                        fontSize: '0.65rem',
                        cursor: 'pointer',
                      }}
                    >
                      {copied ? (
                        <Check size={10} />
                      ) : (
                        <Copy size={10} />
                      )}
                    </button>
                  </div>
                  <p
                    style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--text-faint)',
                    }}
                  >
                    Connection completes automatically once
                    they paste it.
                  </p>
                  <Btn
                    onClick={() => setShowPairDialog(false)}
                    variant="ghost"
                    fullWidth
                  >
                    Done <X size={12} />
                  </Btn>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}