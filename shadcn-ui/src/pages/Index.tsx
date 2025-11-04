import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Lock, Zap, Eye, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createRoom, generateParticipantName } from '@/lib/room';

export default function Index() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateRoom = async () => {
    setIsCreating(true);
    try {
      const participantName = name.trim() || generateParticipantName();
      const config = await createRoom(participantName);
      
      // Store all config in sessionStorage
      sessionStorage.setItem('participantId', config.participantId);
      sessionStorage.setItem('participantName', participantName);
      sessionStorage.setItem('roomId', config.roomId);
      sessionStorage.setItem('encryptionKey', config.encryptionKey);
      
      // Navigate to room
      navigate('/room');
    } catch (error) {
      console.error('Failed to create room:', error);
      setIsCreating(false);
    }
  };

  const handleJoinRoom = () => {
    const participantName = name.trim() || generateParticipantName();
    sessionStorage.setItem('participantName', participantName);
    // User will paste the room URL which contains the credentials
    navigate('/room');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0f1419] via-[#1a1f2e] to-[#0f1419] flex flex-col">
      {/* Header */}
      <header className="border-b border-[#2a3142] bg-[#1a1f2e]/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4 flex items-center gap-3">
          <img src="/huginn-logo.png" alt="Huginn" className="w-10 h-10" />
          <h1 className="text-2xl font-bold text-white">Huginn</h1>
          <div className="ml-auto flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#5DBEBD]" />
            <span className="text-sm text-gray-400">Zero-Knowledge Chat</span>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 container mx-auto px-4 py-12 flex flex-col items-center justify-center">
        <div className="max-w-4xl w-full space-y-12">
          {/* Hero */}
          <div className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#5DBEBD]/10 border border-[#5DBEBD]/30 mb-4">
              <Shield className="w-4 h-4 text-[#5DBEBD]" />
              <span className="text-sm text-[#5DBEBD] font-medium">End-to-End Encrypted</span>
            </div>
            <h2 className="text-5xl font-bold text-white leading-tight">
              Secure Ephemeral
              <br />
              <span className="text-[#5DBEBD]">Group Chat</span>
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Zero-knowledge, serverless communication. Your messages are encrypted in your browser
              and destroyed after your session ends.
            </p>
          </div>

          {/* Action Card */}
          <Card className="bg-[#1a1f2e] border-[#2a3142] max-w-md mx-auto">
            <CardHeader>
              <CardTitle className="text-white">Get Started</CardTitle>
              <CardDescription className="text-gray-400">
                Create a new room or join an existing one
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm text-gray-400 mb-2 block">
                  Your Name (optional)
                </label>
                <Input
                  type="text"
                  placeholder="Leave blank for random name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-[#0f1419] border-[#2a3142] text-white placeholder:text-gray-600"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  onClick={handleCreateRoom}
                  disabled={isCreating}
                  className="w-full bg-[#5DBEBD] hover:bg-[#4A9B9A] text-white"
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  {isCreating ? 'Creating...' : 'Create New Room'}
                </Button>
                <Button
                  onClick={handleJoinRoom}
                  variant="outline"
                  className="w-full !bg-transparent !hover:bg-transparent border-[#5DBEBD] text-[#5DBEBD] hover:bg-[#5DBEBD]/10"
                >
                  Join Existing Room
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Features */}
          <div className="grid md:grid-cols-3 gap-6 mt-12">
            <Card className="bg-[#1a1f2e]/50 border-[#2a3142]">
              <CardHeader>
                <Lock className="w-8 h-8 text-[#5DBEBD] mb-2" />
                <CardTitle className="text-white text-lg">AES-256 Encryption</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-400 text-sm">
                  Military-grade encryption. All messages are encrypted in your browser before
                  transmission.
                </p>
              </CardContent>
            </Card>

            <Card className="bg-[#1a1f2e]/50 border-[#2a3142]">
              <CardHeader>
                <Eye className="w-8 h-8 text-[#5DBEBD] mb-2" />
                <CardTitle className="text-white text-lg">Zero Knowledge</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-400 text-sm">
                  No servers, no databases, no accounts. Your conversations are truly private.
                </p>
              </CardContent>
            </Card>

            <Card className="bg-[#1a1f2e]/50 border-[#2a3142]">
              <CardHeader>
                <Zap className="w-8 h-8 text-[#5DBEBD] mb-2" />
                <CardTitle className="text-white text-lg">Ephemeral</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-400 text-sm">
                  Messages auto-destruct when you close your browser. No traces left behind.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Security Notice */}
          <div className="bg-[#5DBEBD]/5 border border-[#5DBEBD]/20 rounded-lg p-6 text-center">
            <Shield className="w-8 h-8 text-[#5DBEBD] mx-auto mb-3" />
            <p className="text-gray-300 text-sm">
              <strong className="text-[#5DBEBD]">Security Notice:</strong> This application uses
              WebRTC for peer-to-peer communication. All encryption happens in your browser. No
              messages are ever stored on any server.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#2a3142] bg-[#1a1f2e]/50 py-6">
        <div className="container mx-auto px-4 text-center text-gray-500 text-sm">
          <p>Built with privacy in mind. Open source and serverless.</p>
        </div>
      </footer>
    </div>
  );
}