import { formatDistanceToNow } from 'date-fns';
import type { Message } from '@/lib/types';

interface ChatMessageProps {
  message: Message;
  isOwn: boolean;
}

export default function ChatMessage({ message, isOwn }: ChatMessageProps) {
  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-[70%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        {!isOwn && (
          <span className="text-xs text-[#B0B0B0] font-medium px-2">
            {message.senderName}
          </span>
        )}
        <div
          className={`rounded-2xl px-4 py-2 ${
            isOwn
              ? 'bg-gradient-to-r from-[#707070] to-[#A0A0A0] text-white rounded-br-sm'
              : 'bg-[#333333] text-gray-100 rounded-bl-sm'
          }`}
        >
          <p className="text-sm break-words">{message.content}</p>
        </div>
        <span className="text-xs text-[#666666] px-2">
          {formatDistanceToNow(message.timestamp, { addSuffix: true })}
        </span>
      </div>
    </div>
  );
}