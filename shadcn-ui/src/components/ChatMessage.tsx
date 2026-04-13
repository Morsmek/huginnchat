import { formatDistanceToNow } from 'date-fns';
import type { Message } from '@/lib/types';

interface Props {
  message: Message;
  isOwn: boolean;
}

export default function ChatMessage({ message, isOwn }: Props) {
  const isSystem = message.sender === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center my-3 px-4">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
          style={{ background: 'var(--surface-offset)', border: '1px solid var(--divider)', maxWidth: '72ch' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)',
            textAlign: 'center', fontStyle: 'italic' }}>
            {message.content}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} px-4 mb-1 bubble-in`}>
      <div className={`flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`} style={{ maxWidth: '72%' }}>
        {!isOwn && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
            paddingLeft: '2px', fontWeight: 500 }}>
            {message.senderName}
          </span>
        )}
        <div className={`rounded-2xl px-4 py-2.5 ${isOwn ? 'rounded-br-sm' : 'rounded-bl-sm'}`}
          style={isOwn
            ? { background: 'var(--accent)', color: 'var(--accent-on)' }
            : { background: 'var(--surface-offset)', color: 'var(--text)', border: '1px solid var(--divider)' }}>
          <p style={{ fontSize: 'var(--text-sm)', wordBreak: 'break-words', lineHeight: 1.5 }}>
            {message.content}
          </p>
        </div>
        <span style={{ fontSize: '0.68rem', color: 'var(--text-faint)',
          paddingLeft: isOwn ? 0 : '2px', paddingRight: isOwn ? '2px' : 0 }}>
          {formatDistanceToNow(message.timestamp, { addSuffix: true })}
        </span>
      </div>
    </div>
  );
}
