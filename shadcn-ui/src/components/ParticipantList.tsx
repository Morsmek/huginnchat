import { ScrollArea } from '@/components/ui/scroll-area';
import type { Participant } from '@/lib/types';

interface Props {
  participants: Participant[];
  currentUserId: string;
}

function Avatar({ name, connected }: { name: string; connected: boolean }) {
  const initials = name.split(/[\s_-]/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
  return (
    <div className="relative flex-shrink-0">
      <div className="w-8 h-8 rounded-full flex items-center justify-center font-medium select-none"
        style={{ background: 'var(--surface-dynamic)', color: 'var(--text-muted)', fontSize: '0.7rem',
          fontFamily: 'var(--font-display)', border: '1px solid var(--border)' }} aria-hidden="true">
        {initials}
      </div>
      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
        style={{ background: connected ? 'var(--success)' : 'var(--text-faint)',
          border: '2px solid var(--surface)' }} aria-hidden="true"/>
    </div>
  );
}

export default function ParticipantList({ participants, currentUserId }: Props) {
  const onlineCount = participants.filter(p => p.connected).length;
  return (
    <div className="flex flex-col flex-shrink-0"
      style={{ width: '200px', borderLeft: '1px solid var(--divider)', background: 'var(--surface)' }}>
      <div className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--divider)' }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>
          Participants
        </span>
        <span className="px-2 py-0.5 rounded-full"
          style={{ fontSize: '0.65rem', color: 'var(--success)', background: 'var(--success-subtle)', fontWeight: 600 }}>
          {onlineCount}
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-0.5">
          {participants.map(p => (
            <div key={p.id}
              className="flex items-center gap-3 px-3 py-2 rounded-lg"
              style={{ background: p.id === currentUserId ? 'var(--surface-offset)' : 'transparent',
                transition: 'background var(--transition)' }}
              onMouseEnter={e => { if (p.id !== currentUserId) (e.currentTarget as HTMLElement).style.background = 'var(--surface-offset)'; }}
              onMouseLeave={e => { if (p.id !== currentUserId) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
              <Avatar name={p.name} connected={p.connected}/>
              <div className="flex-1 min-w-0">
                <p className="truncate" title={p.name}
                  style={{ fontSize: 'var(--text-xs)', color: 'var(--text)' }}>
                  {p.name}
                  {p.id === currentUserId && (
                    <span style={{ color: 'var(--text-faint)', marginLeft: '4px' }}>(you)</span>
                  )}
                </p>
                {!p.connected && (
                  <p style={{ fontSize: '0.65rem', color: 'var(--text-faint)' }}>disconnected</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
