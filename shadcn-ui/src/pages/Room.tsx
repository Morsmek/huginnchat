import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Copy, LogOut, AlertCircle, Lock, Link, UserPlus, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import SecurityStatus from '@/components/SecurityStatus';
import ChatMessage from '@/components/ChatMessage';
import ParticipantList from '@/components/ParticipantList';
import { parseRoomUrl, clearRoomUrl, generateRoomUrl } from '@/lib/room';
import { encryptMessage, decryptMessage, generateRoomId, deriveKeyFromPassword } from '@/lib/crypto';
import { WebRTCManager } from '@/lib/webrtc';
import type { Message, Participant, RoomConfig, WebRTCMessage } from '@/lib/types';

export default function Room() {
  const navigate = useNavigate();

  // Core state
  const [roomConfig, setRoomConfig] = useState<{ roomId: string; encryptionKey: string } | null>(null);
  const [participantId] = useState(() => sessionStorage.getItem('participantId') || generateRoomId());
  const [participantName] = useState(() => sessionStorage.getItem('participantName') || 'Anonymous');
  const [messages, setMessages] = useState<Message[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [shareableUrl, setShareableUrl] = useState('');
  const [isPasswordProtected, setIsPasswordProtected] = useState(false);

  // Password prompt
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [roomPassword, setRoomPassword] = useState('');

  // Manual pairing dialog
  const [showPairDialog, setShowPairDialog] = useState(false);
  const [pairMode, setPairMode] = useState<'generate' | 'accept'>('generate');
  const [generatedOffer, setGeneratedOffer] = useState('');
  const [pastedOffer, setPastedOffer] = useState('');
  const [generatedAnswer, setGeneratedAnswer] = useState('');
  const [pastedAnswer, setPastedAnswer] = useState('');
  const [pairStep, setPairStep] = useState<'start' | 'waiting-answer' | 'done'>('start');
  const [copied, setCopied] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rtcRef = useRef<WebRTCManager | null>(null);
  const encKeyRef = useRef<string>('');

  // ── Initialise room ──────────────────────────────────────────────────────

  useEffect(() => {
    initializeRoom();
    return () => {
      rtcRef.current?.disconnect();
      sessionStorage.removeItem('roomId');
      sessionStorage.removeItem('encryptionKey');
      sessionStorage.removeItem('roomPassword');
    };
  }, []);

  const initializeRoom = async () => {
    let config = parseRoomUrl();

    if (!config) {
      const roomId = sessionStorage.getItem('roomId');
      const encryptionKey = sessionStorage.getItem('encryptionKey');
      const storedPw = sessionStorage.getItem('roomPassword');
      if (roomId && encryptionKey) {
        config = { roomId, encryptionKey };
        setIsPasswordProtected(!!storedPw);
        const fullConfig: RoomConfig = { roomId, encryptionKey, participantId, participantName };
        const url = storedPw ? generateRoomUrl(fullConfig, false) : generateRoomUrl(fullConfig, true);
        window.history.replaceState(null, '', url);
        setShareableUrl(url);
      }
    } else {
      const fullConfig: RoomConfig = { roomId: config.roomId, encryptionKey: config.encryptionKey, participantId, participantName };
      setShareableUrl(generateRoomUrl(fullConfig, true));
    }

    if (!config) {
      const roomId = new URLSearchParams(window.location.hash.slice(1)).get('room');
      if (roomId) { setShowPasswordPrompt(true); return; }
      toast.error('Invalid room URL');
      navigate('/');
      return;
    }

    await setupRoom(config);
  };

  const handlePasswordSubmit = async () => {
    const roomId = new URLSearchParams(window.location.hash.slice(1)).get('room');
    if (!roomId || !roomPassword.trim()) { toast.error('Please enter a password'); return; }
    try {
      const encryptionKey = await deriveKeyFromPassword(roomPassword.trim(), roomId);
      sessionStorage.setItem('roomPassword', roomPassword.trim());
      setShowPasswordPrompt(false);
      setIsPasswordProtected(true);
      await setupRoom({ roomId, encryptionKey });
    } catch {
      toast.error('Failed to join room');
    }
  };

  const setupRoom = async (config: { roomId: string; encryptionKey: string }) => {
    setRoomConfig(config);
    encKeyRef.current = config.encryptionKey;
    setIsEncrypted(true);

    // Init WebRTC manager (zero-knowledge: local BroadcastChannel only by default)
    const rtc = new WebRTCManager(config.roomId, participantId, participantName);
    rtcRef.current = rtc;

    rtc.onMessage(async (fromId, msg: WebRTCMessage) => {
      if (msg.type === 'message') {
        const data = msg.data as { content: string; iv: string; senderName: string; id: string; timestamp: number };
        try {
          const plain = await decryptMessage({ content: data.content, iv: data.iv }, encKeyRef.current);
          const message: Message = {
            id: data.id,
            timestamp: data.timestamp,
            sender: fromId,
            senderName: data.senderName,
            content: plain,
            iv: data.iv,
          };
          setMessages(prev => [...prev, message]);
        } catch {
          console.error('Decryption failed');
        }
      } else if (msg.type === 'participant-join') {
        const d = msg.data as { id: string; name: string };
        addParticipant(d.id, d.name);
        // Respond with our own info
        rtc.broadcast({ type: 'participant-list', data: { id: participantId, name: participantName } });
      } else if (msg.type === 'participant-list') {
        const d = msg.data as { id: string; name: string };
        addParticipant(d.id, d.name);
      } else if (msg.type === 'participant-leave') {
        const d = msg.data as { id: string };
        setParticipants(prev => prev.filter(p => p.id !== d.id));
      }
    });

    rtc.onConnectionChange((fromId, connected, name) => {
      if (connected) {
        addParticipant(fromId, name || 'Peer');
        // Announce ourselves
        rtc.broadcast({ type: 'participant-join', data: { id: participantId, name: participantName } });
      } else {
        setParticipants(prev => prev.map(p => p.id === fromId ? { ...p, connected: false } : p));
      }
    });

    rtc.start();

    setParticipants([{ id: participantId, name: participantName, connected: true, joinedAt: Date.now() }]);
    setMessages([{
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      sender: 'system',
      senderName: 'System',
      content: `Welcome, ${participantName}! 🔒 Messages are AES-256 encrypted in your browser and never leave it unencrypted. Open this URL in another tab to test locally, or use "Add Peer" to connect a second device.`,
      iv: '',
    }]);
  };

  const addParticipant = (id: string, name: string) => {
    setParticipants(prev => {
      if (prev.find(p => p.id === id)) return prev;
      return [...prev, { id, name, connected: true, joinedAt: Date.now() }];
    });
  };

  // ── Auto-scroll ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // ── Send message ─────────────────────────────────────────────────────────

  const handleSendMessage = useCallback(async () => {
    if (!inputMessage.trim() || !roomConfig) return;
    const rtc = rtcRef.current;
    const text = inputMessage.trim();
    setInputMessage('');

    try {
      const encrypted = await encryptMessage(text, roomConfig.encryptionKey);
      const id = crypto.randomUUID();
      const timestamp = Date.now();

      // Add own message locally
      setMessages(prev => [...prev, {
        id, timestamp,
        sender: participantId,
        senderName: participantName,
        content: text,
        iv: encrypted.iv,
      }]);

      // Broadcast encrypted payload to peers
      rtc?.broadcast({
        type: 'message',
        data: { id, timestamp, content: encrypted.content, iv: encrypted.iv, senderName: participantName },
      });
    } catch {
      toast.error('Failed to encrypt message');
    }
  }, [inputMessage, roomConfig, participantId, participantName]);

  // ── Copy room URL ────────────────────────────────────────────────────────

  const handleCopyRoomUrl = () => {
    const password = sessionStorage.getItem('roomPassword');
    const text = password ? `${shareableUrl}\n\nPassword: ${password}` : (shareableUrl || window.location.href);
    navigator.clipboard.writeText(text);
    toast.success(password ? 'URL + password copied' : 'Room URL copied');
  };

  // ── Leave room ───────────────────────────────────────────────────────────

  const handleLeaveRoom = () => {
    if (!confirm('Leave room? All messages will be destroyed.')) return;
    rtcRef.current?.broadcast({ type: 'participant-leave', data: { id: participantId } });
    rtcRef.current?.disconnect();
    clearRoomUrl();
    ['participantId','roomId','encryptionKey','roomPassword'].forEach(k => sessionStorage.removeItem(k));
    navigate('/');
  };

  // ── Manual pairing ────────────────────────────────────────────────────────

  const handleOpenPairDialog = () => {
    setShowPairDialog(true);
    setPairMode('generate');
    setPairStep('start');
    setGeneratedOffer('');
    setPastedOffer('');
    setGeneratedAnswer('');
    setPastedAnswer('');
  };

  const handleGenerateOffer = async () => {
    const rtc = rtcRef.current;
    if (!rtc) return;
    try {
      const offer = await rtc.generateManualOffer();
      setGeneratedOffer(offer);
      setPairStep('waiting-answer');
    } catch (e) {
      toast.error('Failed to generate offer');
    }
  };

  const handleAcceptOffer = async () => {
    const rtc = rtcRef.current;
    if (!rtc || !pastedOffer.trim()) return;
    try {
      const answer = await rtc.acceptManualOffer(pastedOffer.trim());
      setGeneratedAnswer(answer);
      setPairStep('done');
      toast.success('Connection initiated — share the answer with the other person');
    } catch (e) {
      toast.error('Invalid offer code');
    }
  };

  const handleAcceptAnswer = async () => {
    const rtc = rtcRef.current;
    if (!rtc || !pastedAnswer.trim()) return;
    try {
      await rtc.acceptManualAnswer(pastedAnswer.trim());
      setShowPairDialog(false);
      toast.success('Peer connection established!');
    } catch (e) {
      toast.error('Invalid answer code');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Password screen ───────────────────────────────────────────────────────

  if (showPasswordPrompt) {
    return (
      <div className="h-screen bg-[#0d0d0d] flex items-center justify-center p-4">
        <div className="max-w-md w-full space-y-6">
          <div className="text-center space-y-2">
            <Lock className="w-12 h-12 text-[#B0B0B0] mx-auto" />
            <h2 className="text-2xl font-bold text-white">Password Required</h2>
            <p className="text-[#999999]">This room is password-protected.</p>
          </div>
          <div className="space-y-4">
            <Input
              type="password"
              placeholder="Enter room password"
              value={roomPassword}
              onChange={e => setRoomPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handlePasswordSubmit()}
              className="bg-[#1a1a1a] border-[#333333] text-white placeholder:text-[#555555]"
            />
            <div className="flex gap-2">
              <Button onClick={handlePasswordSubmit} disabled={!roomPassword.trim()}
                className="flex-1 bg-gradient-to-r from-[#707070] to-[#A0A0A0] hover:from-[#808080] hover:to-[#B0B0B0] text-white">
                Join Room
              </Button>
              <Button onClick={() => navigate('/')} variant="outline"
                className="!bg-transparent border-[#333333] text-[#999999]">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!roomConfig) return null;

  return (
    <div className="h-screen bg-[#0d0d0d] flex flex-col">
      <SecurityStatus encrypted={isEncrypted} participantCount={participants.filter(p => p.connected).length} />

      <div className="flex-1 flex overflow-hidden">
        {/* Chat */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Info banner */}
          <Alert className="m-4 mb-0 bg-[#B0B0B0]/10 border-[#B0B0B0]/30 text-[#C0C0C0]">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  Room: <span className="font-mono text-xs">{roomConfig.roomId}</span>
                  {isPasswordProtected && <Lock className="w-3 h-3 inline ml-1" />}
                </span>
                <span className="text-xs text-[#888888]">
                  {isPasswordProtected ? 'Share URL + password separately' : 'Share URL to invite (key is in the fragment)'}
                </span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleCopyRoomUrl}
                  className="!bg-transparent border-[#B0B0B0]/40 text-[#B0B0B0] text-xs">
                  <Link className="w-3 h-3 mr-1" />
                  Copy URL
                </Button>
                <Button size="sm" variant="outline" onClick={handleOpenPairDialog}
                  className="!bg-transparent border-[#B0B0B0]/40 text-[#B0B0B0] text-xs">
                  <UserPlus className="w-3 h-3 mr-1" />
                  Add Peer
                </Button>
              </div>
            </AlertDescription>
          </Alert>

          {/* Messages */}
          <ScrollArea className="flex-1 px-4 mt-4" ref={scrollRef}>
            <div className="py-2 space-y-1">
              {messages.map(msg => (
                <ChatMessage key={msg.id} message={msg} isOwn={msg.sender === participantId} />
              ))}
            </div>
          </ScrollArea>

          {/* Input */}
          <div className="p-4 border-t border-[#333333] bg-[#1a1a1a]">
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="Type an encrypted message…"
                value={inputMessage}
                onChange={e => setInputMessage(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                className="flex-1 bg-[#0d0d0d] border-[#333333] text-white placeholder:text-[#555555]"
              />
              <Button onClick={handleSendMessage} disabled={!inputMessage.trim()}
                className="bg-gradient-to-r from-[#707070] to-[#A0A0A0] hover:from-[#808080] hover:to-[#B0B0B0] text-white">
                <Send className="w-4 h-4" />
              </Button>
              <Button onClick={handleLeaveRoom} variant="outline"
                className="!bg-transparent border-red-500/50 text-red-500 hover:bg-red-500/10">
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Participant list */}
        <ParticipantList participants={participants} currentUserId={participantId} />
      </div>

      {/* Manual peer pairing dialog */}
      <Dialog open={showPairDialog} onOpenChange={setShowPairDialog}>
        <DialogContent className="bg-[#1a1a1a] border-[#333333] text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-[#B0B0B0]" />
              Add Peer (Cross-Device)
            </DialogTitle>
            <DialogDescription className="text-[#888888]">
              Zero-knowledge manual handshake — no server involved. Copy/paste codes between devices.
            </DialogDescription>
          </DialogHeader>

          {/* Mode tabs */}
          <div className="flex gap-2 mb-4">
            <button onClick={() => { setPairMode('generate'); setPairStep('start'); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${pairMode === 'generate' ? 'bg-[#B0B0B0]/20 text-white border border-[#B0B0B0]/40' : 'text-[#888888] hover:text-white'}`}>
              I want to invite
            </button>
            <button onClick={() => { setPairMode('accept'); setPairStep('start'); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${pairMode === 'accept' ? 'bg-[#B0B0B0]/20 text-white border border-[#B0B0B0]/40' : 'text-[#888888] hover:text-white'}`}>
              I received a code
            </button>
          </div>

          {/* GENERATE OFFER flow */}
          {pairMode === 'generate' && (
            <div className="space-y-4">
              {pairStep === 'start' && (
                <>
                  <p className="text-sm text-[#999999]">
                    Generate a connection code, share it with the other person. They'll send back an answer code.
                  </p>
                  <Button onClick={handleGenerateOffer}
                    className="w-full bg-gradient-to-r from-[#707070] to-[#A0A0A0] text-white">
                    Generate Connection Code
                  </Button>
                </>
              )}
              {pairStep === 'waiting-answer' && (
                <>
                  <div>
                    <p className="text-sm text-[#999999] mb-2">1. Share this code with the other person:</p>
                    <div className="relative">
                      <textarea readOnly value={generatedOffer}
                        className="w-full h-24 bg-[#0d0d0d] border border-[#333333] rounded-lg p-3 font-mono text-xs text-[#CCC] resize-none" />
                      <Button size="sm" variant="outline" onClick={() => copyToClipboard(generatedOffer)}
                        className="absolute top-2 right-2 !bg-[#1a1a1a] border-[#555] text-[#999] text-xs">
                        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-[#999999] mb-2">2. Paste the answer code they send back:</p>
                    <textarea
                      value={pastedAnswer}
                      onChange={e => setPastedAnswer(e.target.value)}
                      placeholder="Paste answer code here…"
                      className="w-full h-24 bg-[#0d0d0d] border border-[#333333] rounded-lg p-3 font-mono text-xs text-white placeholder:text-[#555] resize-none"
                    />
                  </div>
                  <Button onClick={handleAcceptAnswer} disabled={!pastedAnswer.trim()}
                    className="w-full bg-gradient-to-r from-[#707070] to-[#A0A0A0] text-white">
                    Complete Connection
                  </Button>
                </>
              )}
            </div>
          )}

          {/* ACCEPT OFFER flow */}
          {pairMode === 'accept' && (
            <div className="space-y-4">
              {pairStep === 'start' && (
                <>
                  <p className="text-sm text-[#999999] mb-2">Paste the connection code you received:</p>
                  <textarea
                    value={pastedOffer}
                    onChange={e => setPastedOffer(e.target.value)}
                    placeholder="Paste connection code here…"
                    className="w-full h-24 bg-[#0d0d0d] border border-[#333333] rounded-lg p-3 font-mono text-xs text-white placeholder:text-[#555] resize-none"
                  />
                  <Button onClick={handleAcceptOffer} disabled={!pastedOffer.trim()}
                    className="w-full bg-gradient-to-r from-[#707070] to-[#A0A0A0] text-white">
                    Generate Answer Code
                  </Button>
                </>
              )}
              {pairStep === 'done' && (
                <>
                  <p className="text-sm text-[#999999] mb-2">Share this answer code back with the other person:</p>
                  <div className="relative">
                    <textarea readOnly value={generatedAnswer}
                      className="w-full h-24 bg-[#0d0d0d] border border-[#333333] rounded-lg p-3 font-mono text-xs text-[#CCC] resize-none" />
                    <Button size="sm" variant="outline" onClick={() => copyToClipboard(generatedAnswer)}
                      className="absolute top-2 right-2 !bg-[#1a1a1a] border-[#555] text-[#999] text-xs">
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </Button>
                  </div>
                  <p className="text-sm text-[#888888]">Once they paste it, you'll be connected. You can close this dialog.</p>
                  <Button onClick={() => setShowPairDialog(false)} variant="outline"
                    className="w-full !bg-transparent border-[#333] text-[#999]">
                    Done
                  </Button>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
