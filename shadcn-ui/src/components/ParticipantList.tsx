import { User, Circle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Participant } from '@/lib/types';

interface ParticipantListProps {
  participants: Participant[];
  currentUserId: string;
}

export default function ParticipantList({ participants, currentUserId }: ParticipantListProps) {
  return (
    <div className="w-64 bg-[#1a1f2e] border-l border-[#2a3142] flex flex-col">
      <div className="px-4 py-3 border-b border-[#2a3142]">
        <h3 className="text-sm font-semibold text-gray-300">Participants</h3>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {participants.map((participant) => (
            <div
              key={participant.id}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#2a3142] transition-colors"
            >
              <div className="relative">
                <div className="w-8 h-8 rounded-full bg-[#5DBEBD]/20 flex items-center justify-center">
                  <User className="w-4 h-4 text-[#5DBEBD]" />
                </div>
                <Circle
                  className={`w-3 h-3 absolute -bottom-0.5 -right-0.5 ${
                    participant.connected ? 'fill-green-500 text-green-500' : 'fill-gray-500 text-gray-500'
                  }`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200 truncate">
                  {participant.name}
                  {participant.id === currentUserId && (
                    <span className="text-xs text-gray-500 ml-1">(you)</span>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}