import { useState, useEffect } from 'react';
import { Cookie, X } from 'lucide-react';

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = sessionStorage.getItem('cookie-consent');
    if (!consent) {
      const timer = setTimeout(() => setVisible(true), 900);
      return () => clearTimeout(timer);
    }
  }, []);

  const handle = (value: 'accepted' | 'declined') => {
    sessionStorage.setItem('cookie-consent', value);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 slide-up" role="dialog" aria-label="Cookie notice">
      <div className="max-w-lg mx-auto rounded-2xl p-5"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-xl)' }}>
        <div className="flex items-start gap-4">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0 mt-0.5"
            style={{ background: 'var(--surface-offset)' }}>
            <Cookie size={16} style={{ color: 'var(--text-muted)' }} aria-hidden="true"/>
          </div>
          <div className="flex-1 space-y-2.5">
            <div className="flex items-center justify-between">
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)',
                fontFamily: 'var(--font-display)' }}>Cookie notice</span>
              <button onClick={() => handle('declined')} aria-label="Dismiss"
                style={{ color: 'var(--text-faint)', padding: '4px', borderRadius: 'var(--radius-sm)',
                  background: 'none', border: 'none', cursor: 'pointer', transition: 'color var(--transition)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}>
                <X size={14} aria-hidden="true"/>
              </button>
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', lineHeight: 1.55 }}>
              We use minimal session cookies to keep you in your room.
              We do <strong style={{ color: 'var(--text)' }}>not</strong> store messages,
              share data, or maintain any server logs. Huginn is zero-knowledge end to end.
            </p>
            <div className="flex items-center gap-2.5 pt-0.5">
              <button onClick={() => handle('accepted')}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-semibold"
                style={{ background: 'var(--accent)', color: 'var(--accent-on)', fontSize: 'var(--text-xs)',
                  border: 'none', cursor: 'pointer', transition: 'background var(--transition)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--accent)')}>
                Accept
              </button>
              <button onClick={() => handle('declined')}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg"
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
                  fontSize: 'var(--text-xs)', cursor: 'pointer', transition: 'all var(--transition)' }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--text-faint)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}>
                Decline
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
