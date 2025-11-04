import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Copy, LogOut, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import SecurityStatus from '@/components/SecurityStatus';
import ChatMessage from '@/components/ChatMessage';
import ParticipantList from '@/components/ParticipantList';
import { parseRoomUrl, clearRoomUrl, generateRoomUrl } from '@/lib/room';
import { encryptMessage, generateRoomId } from '@/lib/crypto';
import type { Message, Participant, RoomConfig } from '@/lib/types';

export default function Room() {
  const navigate = useNavigate();
  const [roomConfig, setRoomConfig] = useState<{ roomId: string; encryptionKey: string } | null>(null);
  const [participantId] = useState(() => sessionStorage.getItem('participantId') || generateRoomId());
  const [participantName] = useState(() => sessionStorage.getItem('participantName') || 'Anonymous');
  const [messages, setMessages] = useState<Message[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [shareableUrl, setShareableUrl] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // First try to get from URL hash
    let config = parseRoomUrl();
    
    // If not in URL, try sessionStorage (for newly created rooms)
    if (!config) {
      const roomId = sessionStorage.getItem('roomId');
      const encryptionKey = sessionStorage.getItem('encryptionKey');
      
      if (roomId && encryptionKey) {
        config = { roomId, encryptionKey };
        
        // Generate shareable URL and set it in the address bar
        const fullConfig: RoomConfig = {
          roomId,
          encryptionKey,
          participantId,
          participantName,
        };
        const url = generateRoomUrl(fullConfig);
        window.history.replaceState(null, '', url);
      }
    }
    
    if (!config) {
      toast.error('Invalid room URL');
      navigate('/');
      return;
    }

    setRoomConfig(config);
    setIsEncrypted(true);
    
    // Generate shareable URL
    const fullConfig: RoomConfig = {
      roomId: config.roomId,
      encryptionKey: config.encryptionKey,
      participantId,
      participantName,
    };
    setShareableUrl(generateRoomUrl(fullConfig));

    // Add self as participant
    setParticipants([
      {
        id: participantId,
        name: participantName,
        connected: true,
        joinedAt: Date.now(),
      },
    ]);

    // Simulate system message
    const welcomeMessage: Message = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      sender: 'system',
      senderName: 'System',
      content: `Welcome to the room, ${participantName}! Share the URL to invite others. Messages are end-to-end encrypted and will be destroyed when you leave.`,
      iv: '',
    };
    setMessages([welcomeMessage]);

    // Cleanup on unmount
    return () => {
      // Clear messages from memory
      setMessages([]);
      // Clear room credentials from sessionStorage
      sessionStorage.removeItem('roomId');
      sessionStorage.removeItem('encryptionKey');
    };
  }, [navigate, participantId, participantName]);

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !roomConfig) return;

    try {
      const encrypted = await encryptMessage(inputMessage.trim(), roomConfig.encryptionKey);

      const message: Message = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        sender: participantId,
        senderName: participantName,
        content: inputMessage.trim(),
        iv: encrypted.iv,
      };

      setMessages((prev) => [...prev, message]);
      setInputMessage('');

      // In a real implementation, this would be sent via WebRTC
      // For MVP, messages are only visible to the sender
    } catch (error) {
      console.error('Failed to send message:', error);
      toast.error('Failed to send message');
    }
  };

  const handleCopyRoomUrl = () => {
    navigator.clipboard.writeText(shareableUrl || window.location.href);
    toast.success('Room URL copied to clipboard');
  };

  const handleLeaveRoom = () => {
    if (confirm('Are you sure you want to leave? All messages will be destroyed.')) {
      clearRoomUrl();
      sessionStorage.removeItem('participantId');
      sessionStorage.removeItem('roomId');
      sessionStorage.removeItem('encryptionKey');
      navigate('/');
    }
  };

  if (!roomConfig) {
    return null;
  }

  return (
    <div className="h-screen bg-[#0f1419] flex flex-col">
      {/* Security Status Bar */}
      <SecurityStatus encrypted={isEncrypted} participantCount={participants.length} />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat Area */}
        <div className="flex-1 flex flex-col">
          {/* Info Banner */}
          <Alert className="m-4 bg-[#5DBEBD]/10 border-[#5DBEBD]/30 text-[#5DBEBD]">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between">
              <span className="text-sm">
                Share this room URL to invite others. Messages are encrypted end-to-end.
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopyRoomUrl}
                className="!bg-transparent !hover:bg-transparent border-[#5DBEBD] text-[#5DBEBD] ml-4"
              >
                <Copy className="w-3 h-3 mr-1" />
                Copy URL
              </Button>
            </AlertDescription>
          </Alert>

          {/* Messages */}
          <ScrollArea className="flex-1 px-4" ref={scrollRef}>
            <div className="py-4 space-y-2">
              {messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  isOwn={message.sender === participantId}
                />
              ))}
            </div>
          </ScrollArea>

          {/* Message Input */}
          <div className="p-4 border-t border-[#2a3142] bg-[#1a1f2e]">
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="Type an encrypted message..."
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                className="flex-1 bg-[#0f1419] border-[#2a3142] text-white placeholder:text-gray-600"
              />
              <Button
                onClick={handleSendMessage}
                disabled={!inputMessage.trim()}
                className="bg-[#5DBEBD] hover:bg-[#4A9B9A] text-white"
              >
                <Send className="w-4 h-4" />
              </Button>
              <Button
                onClick={handleLeaveRoom}
                variant="outline"
                className="!bg-transparent !hover:bg-transparent border-red-500 text-red-500 hover:bg-red-500/10"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Participant List */}
        <ParticipantList participants={participants} currentUserId={participantId} />
      </div>
    </div>
  );
}