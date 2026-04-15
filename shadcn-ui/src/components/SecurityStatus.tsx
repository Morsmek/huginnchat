import { Lock, Users, Shield } from 'lucide-react';

interface Props {
  encrypted: boolean;
  participantCount: number;
  roomId: string;
  isPasswordProtected: boolean;
}

function RavenMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M38 9c-3-2.5-7.5-3.5-13-2-8.5 2-14 8-14 16 0 4.5 1.8 8.5 5 11.5L13 42l8-5c1.8.5 3.5.8 5.5.8 9.5 0 16.5-7 16.5-16 0-5.5-2-10-5-12.8z"
        fill="url(#ravenGrad)" stroke="url(#ravenStroke)" strokeWidth="1" strokeLinejoin="round"/>
      <defs>
        <linearGradient id="ravenGrad" x1="11" y1="7" x2="38" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4a4a5a" stopOpacity="0.6"/>
          <stop offset="50%" stopColor="#9a9db0" stopOpacity="0.4"/>
          <stop offset="100%" stopColor="#2a2a38" stopOpacity="0.5"/>
        </linearGradient>
        <linearGradient id="ravenStroke" x1="11" y1="7" x2="38" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6a6e84"/>
          <stop offset="50%" stopColor="#c8cce0"/>
          <stop offset="100%" stopColor="#5a5e72"/>
        </linearGradient>
      </defs>
    </svg>
  );
}

export default function SecurityStatus({ encrypted, participantCount, roomId, isPasswordProtected }: Props) {
  return (
    <div className="flex items-center gap-2.5 px-4 flex-shrink-0"
      style={{ height: '48px', background: 'var(--surface)', borderBottom: '1px solid var(--divider)' }}>
      <RavenMark/>
      <span className="hidden sm:block" style={{
        fontFamily: 'var(--font-display)', fontWeight: 800,
        fontSize: '0.95rem', letterSpacing: '-0.02em',
        background: 'linear-gradient(105deg, #7a7e94 0%, #c8cce0 40%, #eef0f8 55%, #c8cce0 70%, #7a7e94 100%)',
        backgroundSize: '200% auto',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      }}>
        Huginn
      </span>
      <div className="w-px h-4 hidden sm:block" style={{ background: 'var(--divider)' }}/>
      <span className="font-mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }} title={roomId}>
        {roomId}
      </span>
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
        style={{
          background: encrypted ? 'var(--success-subtle)' : 'var(--accent-subtle)',
          color: encrypted ? 'var(--success)' : 'var(--accent)',
          border: `1px solid ${encrypted ? 'rgba(74,158,106,0.25)' : 'rgba(184,188,208,0.2)'}`,
          fontSize: 'var(--text-xs)',
        }}>
        {encrypted ? <Lock size={10} aria-hidden="true"/> : <Shield size={10} aria-hidden="true"/>}
        <span>{encrypted ? 'AES-256' : 'Connecting…'}</span>
      </div>
      {isPasswordProtected && (
        <div className="items-center gap-1 px-2 py-1 rounded-full hidden sm:flex"
          style={{ background: 'var(--accent-subtle)', color: 'var(--accent)',
            border: '1px solid rgba(184,188,208,0.2)', fontSize: 'var(--text-xs)' }}>
          <Lock size={9} aria-hidden="true"/><span>pw</span>
        </div>
      )}
      <div className="flex-1"/>
      <div className="flex items-center gap-1.5" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}
        aria-label={`${participantCount} participant${participantCount !== 1 ? 's' : ''} online`}>
        <Users size={13} aria-hidden="true"/>
        <span>{participantCount}</span>
      </div>
    </div>
  );
}
