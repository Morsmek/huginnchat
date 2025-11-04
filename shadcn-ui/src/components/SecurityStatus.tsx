import { Shield, Lock, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface SecurityStatusProps {
  encrypted: boolean;
  participantCount: number;
}

export default function SecurityStatus({ encrypted, participantCount }: SecurityStatusProps) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 bg-[#1a1f2e] border-b border-[#2a3142]">
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-[#5DBEBD]" />
        <span className="text-sm text-gray-300">Huginn</span>
      </div>
      
      <div className="flex items-center gap-2">
        {encrypted ? (
          <>
            <Lock className="w-4 h-4 text-[#5DBEBD]" />
            <Badge variant="outline" className="bg-[#5DBEBD]/10 text-[#5DBEBD] border-[#5DBEBD]/30">
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
        <Users className="w-4 h-4 text-gray-400" />
        <span className="text-sm text-gray-400">{participantCount} online</span>
      </div>
    </div>
  );
}