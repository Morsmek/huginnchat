import { Shield, Lock, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface SecurityStatusProps {
  encrypted: boolean;
  participantCount: number;
}

export default function SecurityStatus({ encrypted, participantCount }: SecurityStatusProps) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 bg-[#1a1a1a] border-b border-[#333333]">
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-[#B0B0B0]" />
        <span className="text-sm text-[#CCCCCC]">Huginn</span>
      </div>
      
      <div className="flex items-center gap-2">
        {encrypted ? (
          <>
            <Lock className="w-4 h-4 text-[#B0B0B0]" />
            <Badge variant="outline" className="bg-[#B0B0B0]/10 text-[#C0C0C0] border-[#B0B0B0]/30">
              AES-256 Encrypted
            </Badge>
          </>
        ) : (
          <>
            <Lock className="w-4 h-4 text-yellow-500" />
            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/30">
              Connecting...
            </Badge>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <Users className="w-4 h-4 text-[#999999]" />
        <span className="text-sm text-[#999999]">{participantCount} online</span>
      </div>
    </div>
  );
}