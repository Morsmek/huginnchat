import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Copy, LogOut, AlertCircle, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import SecurityStatus from '@/components/SecurityStatus';
import ChatMessage from '@/components/ChatMessage';
import ParticipantList from '@/components/ParticipantList';
import { parseRoomUrl, clearRoomUrl, generateRoomUrl } from '@/lib/room';
import { encryptMessage, generateRoomId, deriveKeyFromPassword } from '@/lib/crypto';
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
  const [roomPassword, setRoomPassword] = useState('');
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [isPasswordProtected, setIsPasswordProtected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    initializeRoom();
  }, [navigate, participantId, participantName]);

  const initializeRoom = async () => {
    let config = parseRoomUrl();
    
    if (!config) {
      const roomId = sessionStorage.getItem('roomId');
      const encryptionKey = sessionStorage.getItem('encryptionKey');
      const storedPassword = sessionStorage.getItem('roomPassword');
      
      if (roomId && encryptionKey) {
        config = { roomId, encryptionKey };
        setIsPasswordProtected(!!storedPassword);
        
        const fullConfig: RoomConfig = {
          roomId,
          encryptionKey,
          participantId,
          participantName,
        };
        
        const url = storedPassword 
          ? generateRoomUrl(fullConfig, false)
          : generateRoomUrl(fullConfig, true);
        
        window.history.replaceState(null, '', url);
        setShareableUrl(url);
      }
    } else {
      const storedPassword = sessionStorage.getItem('roomPassword');
      setIsPasswordProtected(false);
      
      const fullConfig: RoomConfig = {
        roomId: config.roomId,
        encryptionKey: config.encryptionKey,
        participantId,
        participantName,
      };
      setShareableUrl(generateRoomUrl(fullConfig, true));
    }
    
    if (!config) {
      const roomId = new URLSearchParams(window.location.hash.slice(1)).get('room');
      if (roomId) {
        setShowPasswordPrompt(true);
        return;
      }
      
      toast.error('Invalid room URL');
      navigate('/');
      return;
    }

    await setupRoom(config);
  };

  const handlePasswordSubmit = async () => {
    const roomId = new URLSearchParams(window.location.hash.slice(1)).get('room');
    if (!roomId || !roomPassword.trim()) {
      toast.error('Please enter a password');
      return;
    }

    try {
      const encryptionKey = await deriveKeyFromPassword(roomPassword.trim(), roomId);
      const config = { roomId, encryptionKey };
      
      sessionStorage.setItem('roomPassword', roomPassword.trim());
      setShowPasswordPrompt(false);
      setIsPasswordProtected(true);
      
      await setupRoom(config);
    } catch (error) {
      console.error('Failed to join room:', error);
      toast.error('Failed to join room with this password');
    }
  };

  const setupRoom = async (config: { roomId: string; encryptionKey: string }) => {
    setRoomConfig(config);
    setIsEncrypted(true);

    setParticipants([
      {
        id: participantId,
        name: participantName,
        connected: true,
        joinedAt: Date.now(),
      },
    ]);

    const welcomeMessage: Message = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      sender: 'system',
      senderName: 'System',
      content: `Welcome to the room, ${participantName}! ${isPasswordProtected ? 'This room is password-protected.' : 'Share the URL to invite others.'} Messages are end-to-end encrypted and will be destroyed when you leave.`,
      iv: '',
    };
    setMessages([welcomeMessage]);
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    return () => {
      setMessages([]);
      sessionStorage.removeItem('roomId');
      sessionStorage.removeItem('encryptionKey');
      sessionStorage.removeItem('roomPassword');
    };
  }, []);

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
    } catch (error) {
      console.error('Failed to send message:', error);
      toast.error('Failed to send message');
    }
  };

  const handleCopyRoomUrl = () => {
    const password = sessionStorage.getItem('roomPassword');
    if (password) {
      navigator.clipboard.writeText(`${shareableUrl}\n\nPassword: ${password}`);
      toast.success('Room URL and password copied to clipboard');
    } else {
      navigator.clipboard.writeText(shareableUrl || window.location.href);
      toast.success('Room URL copied to clipboard');
    }
  };

  const handleLeaveRoom = () => {
    if (confirm('Are you sure you want to leave? All messages will be destroyed.')) {
      clearRoomUrl();
      sessionStorage.removeItem('participantId');
      sessionStorage.removeItem('roomId');
      sessionStorage.removeItem('encryptionKey');
      sessionStorage.removeItem('roomPassword');
      navigate('/');
    }
  };

  // Password prompt screen
  if (showPasswordPrompt) {
    return (
      <div className="h-screen bg-[#0d0d0d] flex items-center justify-center p-4">
        <div className="max-w-md w-full space-y-6">
          <div className="text-center space-y-2">
            <Lock className="w-12 h-12 text-[#B0B0B0] mx-auto" />
            <h2 className="text-2xl font-bold text-white">Password Required</h2>
            <p className="text-[#999999]">This room is password-protected. Enter the password to join.</p>
          </div>
          
          <div className="space-y-4">
            <Input
              type="password"
              placeholder="Enter room password"
              value={roomPassword}
              onChange={(e) => setRoomPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
              className="bg-[#1a1a1a] border-[#333333] text-white placeholder:text-[#555555]"
            />
            <div className="flex gap-2">
              <Button
                onClick={handlePasswordSubmit}
                disabled={!roomPassword.trim()}
                className="flex-1 bg-gradient-to-r from-[#707070] to-[#A0A0A0] hover:from-[#808080] hover:to-[#B0B0B0] text-white"
              >
                Join Room
              </Button>
              <Button
                onClick={() => navigate('/')}
                variant="outline"
                className="!bg-transparent border-[#333333] text-[#999999]"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!roomConfig) {
    return null;
  }

  return (
    <div className="h-screen bg-[#0d0d0d] flex flex-col">
      {/* Security Status Bar */}
      <SecurityStatus encrypted={isEncrypted} participantCount={participants.length} />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat Area */}
        <div className="flex-1 flex flex-col">
          {/* Info Banner */}
          <Alert className="m-4 bg-[#B0B0B0]/10 border-[#B0B0B0]/30 text-[#C0C0C0]">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">
                  Room: {roomConfig.roomId}
                  {isPasswordProtected && <Lock className="w-3 h-3 inline ml-1" />}
                </span>
                <span className="text-xs text-[#B0B0B0]/80">
                  {isPasswordProtected 
                    ? 'Share URL and password to invite others'
                    : 'Share this URL to invite others'}
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopyRoomUrl}
                className="!bg-transparent border-[#B0B0B0] text-[#B0B0B0] ml-4"
              >
                <Copy className="w-3 h-3 mr-1" />
                Copy {isPasswordProtected ? 'URL + Password' : 'URL'}
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
          <div className="p-4 border-t border-[#333333] bg-[#1a1a1a]">
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="Type an encrypted message..."
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                className="flex-1 bg-[#0d0d0d] border-[#333333] text-white placeholder:text-[#555555]"
              />
              <Button
                onClick={handleSendMessage}
                disabled={!inputMessage.trim()}
                className="bg-gradient-to-r from-[#707070] to-[#A0A0A0] hover:from-[#808080] hover:to-[#B0B0B0] text-white"
              >
                <Send className="w-4 h-4" />
              </Button>
              <Button
                onClick={handleLeaveRoom}
                variant="outline"
                className="!bg-transparent border-red-500 text-red-500 hover:bg-red-500/10"
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