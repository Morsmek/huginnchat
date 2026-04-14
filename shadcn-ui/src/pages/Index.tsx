import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Lock, Zap, Eye, MessageSquare, ArrowRight, Github, Hash } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createRoom, joinRoomByCode, generateParticipantName, normaliseCode } from '@/lib/room';

export function RavenLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-label="Huginn" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M38 9c-3-2.5-7.5-3.5-13-2-8.5 2-14 8-14 16 0 4.5 1.8 8.5 5 11.5L13 42l8-5c1.8.5 3.5.8 5.5.8 9.5 0 16.5-7 16.5-16 0-5.5-2-10-5-12.8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="currentColor" fillOpacity="0.06" />
      <path d="M19 28 Q24 25 31 27" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
      <path d="M18 32 Q24 28 32 31" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.3" />
      <path d="M16 22.5 Q13 21 11 22 Q13.5 24 16 22.5Z" fill="currentColor" opacity="0.65" />
      <circle cx="28.5" cy="19.5" r="2.8" fill="#d4870a" />
      <circle cx="29.3" cy="18.7" r="0.85" fill="white" opacity="0.75" />
    </svg>
  );
}

const FEATURES = [
  { icon: Lock, label: 'AES-256-GCM' },
  { icon: Eye, label: 'Zero-knowledge' },
  { icon: Zap, label: 'Session-only' },
  { icon: Shield, label: 'No logs' },
];

type Tab = 'create' | 'join';

export default function Index() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('create');
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    borderRadius: 'var(--radius-md)',
    padding: '0.6rem 0.85rem',
    fontSize: 'var(--text-sm)',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: '0.375rem',
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
  };

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const pName = name.trim() || generateParticipantName();
      const config = await createRoom(pName);
      sessionStorage.setItem('participantId', config.participantId);
      sessionStorage.setItem('participantName', pName);
      sessionStorage.setItem('roomId', config.roomId);
      sessionStorage.setItem('encryptionKey', config.encryptionKey);
      navigate('/room');
    } catch {
      setCreating(false);
    }
  };

  const handleJoin = async () => {
    const code = normaliseCode(joinCode);
    if (code.length !== 10) {
      setJoinError('Please enter the full 10-character room code.');
      return;
    }
    if (joining) return;
    setJoining(true);
    setJoinError('');
    try {
      const pName = name.trim() || generateParticipantName();
      const config = await joinRoomByCode(code, pName);
      sessionStorage.setItem('participantId', config.participantId);
      sessionStorage.setItem('participantName', pName);
      sessionStorage.setItem('roomId', config.roomId);
      sessionStorage.setItem('encryptionKey', config.encryptionKey);
      navigate('/room');
    } catch {
      setJoinError('Failed to join room. Please check the code and try again.');
      setJoining(false);
    }
  };

  const handleCodeInput = (val: string) => {
    // Auto-format: uppercase, max 10 chars, strip invalid
    const clean = val.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    setJoinCode(clean);
    setJoinError('');
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)', fontFamily: 'var(--font-body)' }}>
      {/* Nav */}
      <nav className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--divider)' }}>
        <div className="flex items-center gap-2.5">
          <span style={{ color: 'var(--accent)' }}><RavenLogo size={26} /></span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.05rem', color: 'var(--text)', letterSpacing: '-0.02em' }}>
            Huginn
          </span>
        </div>
        <a
          href="https://github.com/Morsmek/huginnchat"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
          style={{ color: 'var(--text-muted)', background: 'var(--surface)', border: '1px solid var(--border)', textDecoration: 'none', fontSize: 'var(--text-xs)', transition: 'color var(--transition)' }}
        >
          <Github size={13} /> Source
        </a>
      </nav>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md fade-up">
          {/* Badge */}
          <div className="flex justify-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full pulse-accent" style={{ background: 'var(--accent-subtle)', border: '1px solid rgba(212,135,10,0.3)', color: 'var(--accent)', fontSize: 'var(--text-xs)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)', display: 'inline-block' }} />
              End-to-end encrypted · No logs · No servers
            </div>
          </div>

          {/* Headline */}
          <h1 className="text-center mb-3" style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.025em', lineHeight: 1.1 }}>
            Chat that <span style={{ color: 'var(--accent)' }}>vanishes</span><br />when you leave
          </h1>
          <p className="text-center" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', maxWidth: '34ch', margin: '0 auto var(--space-8)' }}>
            Share a 10-character code. Connect instantly. Nothing is stored.
          </p>

          {/* Card */}
          <div className="rounded-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>

            {/* Tab switcher */}
            <div className="flex" style={{ borderBottom: '1px solid var(--divider)' }}>
              {(['create', 'join'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className="flex-1 py-3.5 font-semibold"
                  style={{
                    fontSize: 'var(--text-sm)',
                    color: tab === t ? 'var(--text)' : 'var(--text-muted)',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
                    cursor: 'pointer',
                    transition: 'all var(--transition)',
                    marginBottom: '-1px',
                  }}
                >
                  {t === 'create' ? 'Create room' : 'Join with code'}
                </button>
              ))}
            </div>

            <div className="p-6">
              {/* Shared: name field */}
              <div className="mb-5">
                <Label htmlFor="participant-name" style={labelStyle}>Your name</Label>
                <Input
                  id="participant-name"
                  placeholder="Leave blank for a random Norse alias"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (tab === 'create' ? handleCreate() : handleJoin())}
                  style={inputStyle}
                />
              </div>

              {tab === 'create' && (
                <>
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: '1.25rem', lineHeight: 1.6 }}>
                    A unique 10-character room code will be generated. Share it with whoever you want to chat with — they enter it on this page to join instantly.
                  </p>
                  <button
                    onClick={handleCreate}
                    disabled={creating}
                    className="w-full flex items-center justify-center gap-2 rounded-xl py-3 font-semibold"
                    style={{
                      background: creating ? 'var(--surface-dynamic)' : 'var(--accent)',
                      color: creating ? 'var(--text-faint)' : 'var(--accent-on)',
                      fontSize: 'var(--text-sm)',
                      cursor: creating ? 'not-allowed' : 'pointer',
                      transition: 'all var(--transition)',
                      border: 'none',
                    }}
                    aria-busy={creating}
                  >
                    <MessageSquare size={14} />
                    {creating ? 'Creating…' : 'Create room'}
                  </button>
                </>
              )}

              {tab === 'join' && (
                <>
                  <div className="mb-5">
                    <Label htmlFor="room-code" style={labelStyle}>
                      Room code
                    </Label>
                    {/* Big code input */}
                    <div style={{ position: 'relative' }}>
                      <Hash size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }} />
                      <input
                        id="room-code"
                        type="text"
                        inputMode="text"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        placeholder="XXXXXXXXXX"
                        value={joinCode}
                        onChange={(e) => handleCodeInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                        maxLength={10}
                        style={{
                          width: '100%',
                          background: 'var(--surface-2)',
                          border: `1px solid ${joinError ? 'var(--error)' : 'var(--border)'}`,
                          color: 'var(--text)',
                          borderRadius: 'var(--radius-md)',
                          padding: '0.75rem 0.85rem 0.75rem 2.25rem',
                          fontSize: '1.35rem',
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          letterSpacing: '0.2em',
                          textTransform: 'uppercase',
                          outline: 'none',
                        }}
                      />
                    </div>
                    {joinError && (
                      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--error)', marginTop: '0.35rem' }}>{joinError}</p>
                    )}
                  </div>
                  <button
                    onClick={handleJoin}
                    disabled={joinCode.length !== 10 || joining}
                    className="w-full flex items-center justify-center gap-2 rounded-xl py-3 font-semibold"
                    style={{
                      background: joinCode.length === 10 && !joining ? 'var(--accent)' : 'var(--surface-dynamic)',
                      color: joinCode.length === 10 && !joining ? 'var(--accent-on)' : 'var(--text-faint)',
                      fontSize: 'var(--text-sm)',
                      cursor: joinCode.length === 10 && !joining ? 'pointer' : 'not-allowed',
                      transition: 'all var(--transition)',
                      border: 'none',
                    }}
                    aria-busy={joining}
                  >
                    {joining ? 'Joining…' : <> Join room <ArrowRight size={14} /></>}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap justify-center gap-2.5 mt-7">
            {FEATURES.map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                <Icon size={11} style={{ color: 'var(--accent)' }} />
                {label}
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="flex items-center justify-center gap-2 py-5" style={{ borderTop: '1px solid var(--divider)', fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>
        <span style={{ color: 'var(--accent)' }}><RavenLogo size={13} /></span>
        Huginn · ephemeral zero-knowledge chat
      </footer>
    </div>
  );
}
