import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Lock, Zap, Eye, MessageSquare, Key, Shuffle, ArrowRight, Github } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createRoom, generateParticipantName } from '@/lib/room';

type Mode = 'quick' | 'custom' | 'private';

export function RavenLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none"
      aria-label="Huginn" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path
        d="M38 9c-3-2.5-7.5-3.5-13-2-8.5 2-14 8-14 16 0 4.5 1.8 8.5 5 11.5L13 42l8-5c1.8.5 3.5.8 5.5.8 9.5 0 16.5-7 16.5-16 0-5.5-2-10-5-12.8z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
        fill="currentColor" fillOpacity="0.06"
      />
      <path d="M19 28 Q24 25 31 27" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.4"/>
      <path d="M18 32 Q24 28 32 31" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.3"/>
      <path d="M16 22.5 Q13 21 11 22 Q13.5 24 16 22.5Z" fill="currentColor" opacity="0.65"/>
      <circle cx="28.5" cy="19.5" r="2.8" fill="#d4870a"/>
      <circle cx="29.3" cy="18.7" r="0.85" fill="white" opacity="0.75"/>
    </svg>
  );
}

const MODES: { id: Mode; icon: typeof Shuffle; label: string; sub: string }[] = [
  { id: 'quick',   icon: Shuffle, label: 'Quick room',   sub: 'Random ID · encryption key in URL' },
  { id: 'custom',  icon: Key,     label: 'Named room',   sub: 'Your name · password required' },
  { id: 'private', icon: Shield,  label: 'Private room', sub: 'Random ID · share URL + password separately' },
];

const FEATURES = [
  { icon: Lock,   label: 'AES-256-GCM' },
  { icon: Eye,    label: 'Zero-knowledge' },
  { icon: Zap,    label: 'Session-only' },
  { icon: Shield, label: 'No servers' },
];

export default function Index() {
  const navigate = useNavigate();
  const [name, setName]         = useState('');
  const [roomName, setRoomName] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode]         = useState<Mode>('quick');
  const [creating, setCreating] = useState(false);

  const isValid =
    mode === 'quick' ||
    (mode === 'custom'  && roomName.trim() && password.trim()) ||
    (mode === 'private' && password.trim());

  const handleCreate = async () => {
    if (!isValid || creating) return;
    setCreating(true);
    try {
      const pName = name.trim() || generateParticipantName();
      const config = await createRoom(
        pName,
        mode === 'custom' ? roomName.trim() : undefined,
        mode !== 'quick'  ? password.trim() : undefined,
      );
      sessionStorage.setItem('participantId',   config.participantId);
      sessionStorage.setItem('participantName', pName);
      sessionStorage.setItem('roomId',          config.roomId);
      sessionStorage.setItem('encryptionKey',   config.encryptionKey);
      if (mode !== 'quick') sessionStorage.setItem('roomPassword', password.trim());
      navigate('/room');
    } catch (e) {
      console.error(e);
      setCreating(false);
    }
  };

  const handleJoin = () => {
    const pName = name.trim() || generateParticipantName();
    sessionStorage.setItem('participantName', pName);
    navigate('/room');
  };

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

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)', fontFamily: 'var(--font-body)' }}>

      {/* Nav */}
      <nav className="flex items-center justify-between px-5 py-4"
        style={{ borderBottom: '1px solid var(--divider)' }}>
        <div className="flex items-center gap-2.5">
          <span style={{ color: 'var(--accent)' }}><RavenLogo size={26} /></span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.05rem',
            color: 'var(--text)', letterSpacing: '-0.02em' }}>
            Huginn
          </span>
        </div>
        <a href="https://github.com/Morsmek/huginnchat" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
          style={{ color: 'var(--text-muted)', background: 'var(--surface)', border: '1px solid var(--border)',
            textDecoration: 'none', fontSize: 'var(--text-xs)', transition: 'color var(--transition)' }}>
          <Github size={13}/> Source
        </a>
      </nav>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md fade-up">

          {/* Security badge */}
          <div className="flex justify-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full pulse-accent"
              style={{ background: 'var(--accent-subtle)', border: '1px solid rgba(212,135,10,0.3)',
                color: 'var(--accent)', fontSize: 'var(--text-xs)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)', display:'inline-block' }}/>
              End-to-end encrypted · No logs · No servers
            </div>
          </div>

          {/* Headline */}
          <h1 className="text-center mb-3"
            style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', fontWeight: 800,
              color: 'var(--text)', letterSpacing: '-0.025em', lineHeight: 1.1 }}>
            Chat that <span style={{ color: 'var(--accent)' }}>vanishes</span><br/>when you leave
          </h1>
          <p className="text-center" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)',
            maxWidth: '34ch', margin: '0 auto var(--space-8)' }}>
            Messages are encrypted in your browser with AES-256-GCM and destroyed when the session ends.
          </p>

          {/* Card */}
          <div className="rounded-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
            <div className="p-6">

              {/* Name */}
              <div className="mb-5">
                <Label htmlFor="participant-name" style={labelStyle}>Your name</Label>
                <Input id="participant-name" placeholder="Leave blank for a random Norse alias"
                  value={name} onChange={e => setName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()} style={inputStyle} />
              </div>

              {/* Mode */}
              <div className="mb-5">
                <div style={{ ...labelStyle, marginBottom: '0.5rem' }}>Room type</div>
                <div className="space-y-2">
                  {MODES.map(({ id, icon: Icon, label, sub }) => {
                    const active = mode === id;
                    return (
                      <button key={id} onClick={() => setMode(id)} aria-pressed={active}
                        className="w-full flex items-center gap-3.5 rounded-xl px-4 py-3 text-left"
                        style={{ background: active ? 'var(--accent-subtle)' : 'var(--surface-offset)',
                          border: `1.5px solid ${active ? 'rgba(212,135,10,0.5)' : 'transparent'}`,
                          cursor: 'pointer', transition: 'all var(--transition)' }}>
                        <div className="w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center"
                          style={{ border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                            background: active ? 'var(--accent)' : 'transparent',
                            transition: 'all var(--transition)' }}>
                          {active && <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent-on)' }}/>}
                        </div>
                        <Icon size={14} style={{ color: active ? 'var(--accent)' : 'var(--text-faint)', flexShrink: 0 }}/>
                        <div>
                          <div className="font-medium" style={{ fontSize: 'var(--text-sm)',
                            color: active ? 'var(--text)' : 'var(--text-muted)' }}>{label}</div>
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>{sub}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom fields */}
              {mode === 'custom' && (
                <div className="space-y-3 mb-5 fade-up">
                  <div>
                    <Label htmlFor="room-name" style={labelStyle}>Room name</Label>
                    <Input id="room-name" placeholder="e.g. team-standup" value={roomName}
                      onChange={e => setRoomName(e.target.value)} style={inputStyle}/>
                  </div>
                  <div>
                    <Label htmlFor="password-custom" style={labelStyle}>Password</Label>
                    <Input id="password-custom" type="password" placeholder="Shared with invitees"
                      value={password} onChange={e => setPassword(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleCreate()} style={inputStyle}/>
                  </div>
                </div>
              )}
              {mode === 'private' && (
                <div className="mb-5 fade-up">
                  <Label htmlFor="password-private" style={labelStyle}>Password</Label>
                  <Input id="password-private" type="password" placeholder="Share separately from the URL"
                    value={password} onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreate()} style={inputStyle}/>
                </div>
              )}

              {/* Create button */}
              <button onClick={handleCreate} disabled={!isValid || creating}
                className="w-full flex items-center justify-center gap-2 rounded-xl py-3 font-semibold"
                style={{ background: isValid && !creating ? 'var(--accent)' : 'var(--surface-dynamic)',
                  color: isValid && !creating ? 'var(--accent-on)' : 'var(--text-faint)',
                  fontSize: 'var(--text-sm)', cursor: isValid && !creating ? 'pointer' : 'not-allowed',
                  transition: 'all var(--transition)', border: 'none' }}
                aria-busy={creating}>
                <MessageSquare size={14}/>{creating ? 'Creating…' : 'Create room'}
              </button>
            </div>

            {/* Join */}
            <div style={{ borderTop: '1px solid var(--divider)' }}>
              <button onClick={handleJoin}
                className="w-full flex items-center justify-center gap-2 py-4"
                style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', background: 'transparent',
                  transition: 'color var(--transition)', border: 'none' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                Join an existing room <ArrowRight size={13}/>
              </button>
            </div>
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap justify-center gap-2.5 mt-7">
            {FEATURES.map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)',
                  fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                <Icon size={11} style={{ color: 'var(--accent)' }}/>{label}
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="flex items-center justify-center gap-2 py-5"
        style={{ borderTop: '1px solid var(--divider)', fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>
        <span style={{ color: 'var(--accent)' }}><RavenLogo size={13}/></span>
        Huginn · ephemeral zero-knowledge chat
      </footer>
    </div>
  );
}
