import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Lock, Zap, Eye, MessageSquare, Key, Shuffle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { createRoom, generateParticipantName } from '@/lib/room';

export default function Index() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [customRoomName, setCustomRoomName] = useState('');
  const [password, setPassword] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [selectedMode, setSelectedMode] = useState<'quick' | 'custom' | 'private'>('quick');

  const handleQuickJoin = async () => {
    setIsCreating(true);
    try {
      const participantName = name.trim() || generateParticipantName();
      const config = await createRoom(participantName);
      
      sessionStorage.setItem('participantId', config.participantId);
      sessionStorage.setItem('participantName', participantName);
      sessionStorage.setItem('roomId', config.roomId);
      sessionStorage.setItem('encryptionKey', config.encryptionKey);
      
      navigate('/room');
    } catch (error) {
      console.error('Failed to create room:', error);
      setIsCreating(false);
    }
  };

  const handleCustomRoom = async () => {
    if (!customRoomName.trim() || !password.trim()) {
      return;
    }
    
    setIsCreating(true);
    try {
      const participantName = name.trim() || generateParticipantName();
      const config = await createRoom(participantName, customRoomName.trim(), password.trim());
      
      sessionStorage.setItem('participantId', config.participantId);
      sessionStorage.setItem('participantName', participantName);
      sessionStorage.setItem('roomId', config.roomId);
      sessionStorage.setItem('encryptionKey', config.encryptionKey);
      sessionStorage.setItem('roomPassword', password.trim());
      
      navigate('/room');
    } catch (error) {
      console.error('Failed to create room:', error);
      setIsCreating(false);
    }
  };

  const handlePrivateRandom = async () => {
    if (!password.trim()) {
      return;
    }
    
    setIsCreating(true);
    try {
      const participantName = name.trim() || generateParticipantName();
      const config = await createRoom(participantName, undefined, password.trim());
      
      sessionStorage.setItem('participantId', config.participantId);
      sessionStorage.setItem('participantName', participantName);
      sessionStorage.setItem('roomId', config.roomId);
      sessionStorage.setItem('encryptionKey', config.encryptionKey);
      sessionStorage.setItem('roomPassword', password.trim());
      
      navigate('/room');
    } catch (error) {
      console.error('Failed to create room:', error);
      setIsCreating(false);
    }
  };

  const handleJoinRoom = () => {
    const participantName = name.trim() || generateParticipantName();
    sessionStorage.setItem('participantName', participantName);
    navigate('/room');
  };

  const handleCreateRoom = () => {
    if (selectedMode === 'quick') {
      handleQuickJoin();
    } else if (selectedMode === 'custom') {
      handleCustomRoom();
    } else {
      handlePrivateRandom();
    }
  };

  const isFormValid = () => {
    if (selectedMode === 'quick') return true;
    if (selectedMode === 'custom') return customRoomName.trim() && password.trim();
    if (selectedMode === 'private') return password.trim();
    return false;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0d0d0d] via-[#1a1a1a] to-[#0d0d0d] flex flex-col">
      {/* Header */}
      <header className="border-b border-[#3a3a3a] bg-[#2a2a2a]">
        <div className="container mx-auto px-4 py-5 flex flex-col items-center gap-1 relative">
          {/* Centered logo - the logo already contains "Huginn" text */}
          <img src="/huginn-logo.png" alt="Huginn" className="h-16 w-auto" />
          {/* Zero-Knowledge badge */}
          <div className="flex items-center gap-2 md:absolute md:right-4 md:top-1/2 md:-translate-y-1/2">
            <Lock className="w-4 h-4 text-[#B0B0B0]" />
            <span className="text-sm text-[#999999]">Zero-Knowledge Chat</span>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 container mx-auto px-4 py-12 flex flex-col items-center justify-center">
        <div className="max-w-4xl w-full space-y-12">
          {/* Hero */}
          <div className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#B0B0B0]/10 border border-[#B0B0B0]/30 mb-4">
              <Shield className="w-4 h-4 text-[#B0B0B0]" />
              <span className="text-sm text-[#C0C0C0] font-medium">End-to-End Encrypted</span>
            </div>
            <h2 className="text-5xl font-bold text-white leading-tight">
              Secure Ephemeral
              <br />
              <span className="bg-gradient-to-r from-[#888888] to-[#D0D0D0] bg-clip-text text-transparent">Group Chat</span>
            </h2>
            <p className="text-xl text-[#999999] max-w-2xl mx-auto">
              Zero-knowledge, serverless communication. Your messages are encrypted in your browser
              and destroyed after your session ends.
            </p>
          </div>

          {/* Action Card */}
          <Card className="bg-[#1a1a1a] border-[#333333] max-w-2xl mx-auto">
            <CardHeader>
              <CardTitle className="text-white">Get Started</CardTitle>
              <CardDescription className="text-[#999999]">
                Choose how you want to create or join a room
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Name Input */}
              <div>
                <Label className="text-sm text-[#999999] mb-2 block">
                  Your Name (optional)
                </Label>
                <Input
                  type="text"
                  placeholder="Leave blank for random name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-[#0d0d0d] border-[#333333] text-white placeholder:text-[#555555]"
                />
              </div>

              {/* Room Type Selection */}
              <div className="space-y-4">
                <TooltipProvider>
                  {/* Quick Join Option */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setSelectedMode('quick')}
                        className={`w-full text-left transition-all ${
                          selectedMode === 'quick'
                            ? 'bg-[#B0B0B0]/10 border-2 border-[#B0B0B0]'
                            : 'bg-[#0d0d0d] border-2 border-[#333333] hover:border-[#B0B0B0]/50'
                        } rounded-lg p-5 cursor-pointer`}
                      >
                        <div className="flex items-center gap-4">
                          <div className={`p-3 rounded-lg ${
                            selectedMode === 'quick' ? 'bg-gradient-to-br from-[#888888] to-[#B0B0B0]' : 'bg-[#333333]'
                          }`}>
                            <Shuffle className={`w-6 h-6 ${
                              selectedMode === 'quick' ? 'text-white' : 'text-[#B0B0B0]'
                            }`} />
                          </div>
                          <div className="flex-1">
                            <h3 className="text-white font-semibold text-lg mb-1">Quick Join</h3>
                            <p className="text-sm text-[#999999]">
                              Random room name, shareable URL
                            </p>
                          </div>
                          <Info className="w-5 h-5 text-[#666666]" />
                        </div>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs bg-[#1a1a1a] border-[#B0B0B0]">
                      <p className="text-sm">
                        <strong className="text-[#C0C0C0]">Quick Join:</strong> Generate a random room ID and share the URL. 
                        No password needed - the encryption key is included in the link. Perfect for quick, casual chats.
                      </p>
                    </TooltipContent>
                  </Tooltip>

                  {/* Custom Room Option */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setSelectedMode('custom')}
                        className={`w-full text-left transition-all ${
                          selectedMode === 'custom'
                            ? 'bg-[#B0B0B0]/10 border-2 border-[#B0B0B0]'
                            : 'bg-[#0d0d0d] border-2 border-[#333333] hover:border-[#B0B0B0]/50'
                        } rounded-lg p-5 cursor-pointer`}
                      >
                        <div className="flex items-center gap-4">
                          <div className={`p-3 rounded-lg ${
                            selectedMode === 'custom' ? 'bg-gradient-to-br from-[#888888] to-[#B0B0B0]' : 'bg-[#333333]'
                          }`}>
                            <Key className={`w-6 h-6 ${
                              selectedMode === 'custom' ? 'text-white' : 'text-[#B0B0B0]'
                            }`} />
                          </div>
                          <div className="flex-1">
                            <h3 className="text-white font-semibold text-lg mb-1">Custom Room</h3>
                            <p className="text-sm text-[#999999]">
                              Choose name + password protection
                            </p>
                          </div>
                          <Info className="w-5 h-5 text-[#666666]" />
                        </div>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs bg-[#1a1a1a] border-[#B0B0B0]">
                      <p className="text-sm">
                        <strong className="text-[#C0C0C0]">Custom Room:</strong> Choose your own room name 
                        (e.g., "team-meeting"). Password required to join. Great for organized, recurring meetings 
                        with an extra layer of security.
                      </p>
                    </TooltipContent>
                  </Tooltip>

                  {/* Private Random Option */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setSelectedMode('private')}
                        className={`w-full text-left transition-all ${
                          selectedMode === 'private'
                            ? 'bg-[#B0B0B0]/10 border-2 border-[#B0B0B0]'
                            : 'bg-[#0d0d0d] border-2 border-[#333333] hover:border-[#B0B0B0]/50'
                        } rounded-lg p-5 cursor-pointer`}
                      >
                        <div className="flex items-center gap-4">
                          <div className={`p-3 rounded-lg ${
                            selectedMode === 'private' ? 'bg-gradient-to-br from-[#888888] to-[#B0B0B0]' : 'bg-[#333333]'
                          }`}>
                            <Shield className={`w-6 h-6 ${
                              selectedMode === 'private' ? 'text-white' : 'text-[#B0B0B0]'
                            }`} />
                          </div>
                          <div className="flex-1">
                            <h3 className="text-white font-semibold text-lg mb-1">Private Random</h3>
                            <p className="text-sm text-[#999999]">
                              Random name + password required
                            </p>
                          </div>
                          <Info className="w-5 h-5 text-[#666666]" />
                        </div>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs bg-[#1a1a1a] border-[#B0B0B0]">
                      <p className="text-sm">
                        <strong className="text-[#C0C0C0]">Private Random:</strong> Random room name with 
                        password protection. Share URL and password separately. Combines anonymity with security - 
                        ideal for sensitive discussions.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              {/* Dynamic Form Fields Based on Selection */}
              {selectedMode === 'custom' && (
                <div className="space-y-3 pt-2">
                  <div>
                    <Label className="text-sm text-[#999999] mb-2 block">Room Name</Label>
                    <Input
                      type="text"
                      placeholder="e.g., team-meeting"
                      value={customRoomName}
                      onChange={(e) => setCustomRoomName(e.target.value)}
                      className="bg-[#0d0d0d] border-[#333333] text-white placeholder:text-[#555555]"
                    />
                  </div>
                  <div>
                    <Label className="text-sm text-[#999999] mb-2 block">Password</Label>
                    <Input
                      type="password"
                      placeholder="Enter room password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="bg-[#0d0d0d] border-[#333333] text-white placeholder:text-[#555555]"
                    />
                  </div>
                </div>
              )}

              {selectedMode === 'private' && (
                <div className="pt-2">
                  <Label className="text-sm text-[#999999] mb-2 block">Password</Label>
                  <Input
                    type="password"
                    placeholder="Enter room password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-[#0d0d0d] border-[#333333] text-white placeholder:text-[#555555]"
                  />
                </div>
              )}

              {/* Create Room Button */}
              <Button
                onClick={handleCreateRoom}
                disabled={isCreating || !isFormValid()}
                className="w-full bg-gradient-to-r from-[#707070] to-[#A0A0A0] hover:from-[#808080] hover:to-[#B0B0B0] text-white font-semibold"
              >
                <MessageSquare className="w-4 h-4 mr-2" />
                {isCreating ? 'Creating...' : 'Create Room'}
              </Button>

              {/* Join Existing Room */}
              <div className="pt-4 border-t border-[#333333]">
                <Button
                  onClick={handleJoinRoom}
                  variant="outline"
                  className="w-full !bg-transparent border-[#B0B0B0] text-[#B0B0B0] hover:bg-[#B0B0B0]/10"
                >
                  Join Existing Room
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Features */}
          <div className="grid md:grid-cols-3 gap-6 mt-12">
            <Card className="bg-[#1a1a1a]/50 border-[#333333]">
              <CardHeader>
                <Lock className="w-8 h-8 text-[#B0B0B0] mb-2" />
                <CardTitle className="text-white text-lg">AES-256 Encryption</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-[#999999] text-sm">
                  Military-grade encryption. All messages are encrypted in your browser before
                  transmission.
                </p>
              </CardContent>
            </Card>

            <Card className="bg-[#1a1a1a]/50 border-[#333333]">
              <CardHeader>
                <Eye className="w-8 h-8 text-[#B0B0B0] mb-2" />
                <CardTitle className="text-white text-lg">Zero Knowledge</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-[#999999] text-sm">
                  No servers, no databases, no accounts. Your conversations are truly private.
                </p>
              </CardContent>
            </Card>

            <Card className="bg-[#1a1a1a]/50 border-[#333333]">
              <CardHeader>
                <Zap className="w-8 h-8 text-[#B0B0B0] mb-2" />
                <CardTitle className="text-white text-lg">Ephemeral</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-[#999999] text-sm">
                  Messages auto-destruct when you close your browser. No traces left behind.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Security Notice */}
          <div className="bg-[#B0B0B0]/5 border border-[#B0B0B0]/20 rounded-lg p-6 text-center">
            <Shield className="w-8 h-8 text-[#B0B0B0] mx-auto mb-3" />
            <p className="text-[#CCCCCC] text-sm">
              <strong className="text-[#D0D0D0]">Security Notice:</strong> This application uses
              WebRTC for peer-to-peer communication. All encryption happens in your browser. No
              messages are ever stored on any server.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#3a3a3a] bg-[#2a2a2a] py-6">
        <div className="container mx-auto px-4 flex items-center justify-center gap-2">
          <span className="text-[#B0B0B0] text-sm font-medium">A part of</span>
          <img src="/huginn-logo.png" alt="Huginn" className="h-6" />
        </div>
      </footer>
    </div>
  );
}