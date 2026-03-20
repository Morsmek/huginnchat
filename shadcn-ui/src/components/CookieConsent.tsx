import { useState, useEffect } from 'react';
import { Cookie, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem('cookie-consent');
    if (!consent) {
      // Small delay so it doesn't flash on load
      const timer = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem('cookie-consent', 'accepted');
    setVisible(false);
  };

  const handleDecline = () => {
    localStorage.setItem('cookie-consent', 'declined');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 animate-in slide-in-from-bottom-5 duration-500">
      <div className="max-w-2xl mx-auto bg-[#1a1f2e] border border-[#2a3142] rounded-xl shadow-2xl shadow-black/40 p-5">
        <div className="flex items-start gap-4">
          <div className="p-2.5 bg-[#5DBEBD]/10 rounded-lg shrink-0 mt-0.5">
            <Cookie className="w-5 h-5 text-[#5DBEBD]" />
          </div>
          <div className="flex-1 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold text-base">Cookie Notice</h3>
              <button
                onClick={handleDecline}
                className="text-gray-500 hover:text-gray-300 transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed">
              We use minimal cookies to enhance your experience. We do <strong className="text-gray-300">not</strong> share 
              any of your information with third parties. Your privacy is our priority — Huginn is built on 
              zero-knowledge principles, and that extends to how we handle cookies too.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <Button
                onClick={handleAccept}
                className="bg-[#5DBEBD] hover:bg-[#4A9B9A] text-white text-sm px-5"
              >
                Accept
              </Button>
              <Button
                onClick={handleDecline}
                variant="outline"
                className="!bg-transparent border-[#2a3142] text-gray-400 hover:text-white hover:border-gray-500 text-sm px-5"
              >
                Decline
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}