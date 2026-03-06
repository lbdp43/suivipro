import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, Bot, X, Loader2 } from 'lucide-react';
import { getHubToken } from '../lib/hub';

const HUB_FRONTEND = import.meta.env.VITE_HUB_FRONTEND_URL;
const CHANNEL_ID = import.meta.env.VITE_HUB_CHANNEL_ID;

type Tab = 'messagerie' | 'claude';

interface ProspectContext {
  nom: string;
  email: string;
  telephone: string;
  statut: string;
  notes: string;
}

export default function HubPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('messagerie');
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const claudeIframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!open || token) return;
    setLoading(true);
    setError(null);
    getHubToken()
      .then((t: string) => setToken(t))
      .catch(() => setError('Connexion au Hub impossible'))
      .finally(() => setLoading(false));
  }, [open, token]);

  // Expose a method to send prospect context to the Claude iframe
  const sendProspectContext = useCallback((prospect: ProspectContext) => {
    if (claudeIframeRef.current?.contentWindow) {
      claudeIframeRef.current.contentWindow.postMessage({
        type: 'HUB_AI_CONTEXT',
        prospect,
      }, '*');
    }
  }, []);

  // Listen for prospect-context events dispatched from ProspectsPage
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ProspectContext>).detail;
      if (detail) {
        setTab('claude');
        sendProspectContext(detail);
      }
    };
    window.addEventListener('hub:prospect-context', handler);
    return () => window.removeEventListener('hub:prospect-context', handler);
  }, [sendProspectContext]);

  if (!open) return null;

  return (
    <div className="fixed top-0 right-0 h-full w-[420px] max-w-full bg-white border-l border-gray-200 shadow-xl z-50 flex flex-col slide-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex gap-1">
          <button
            onClick={() => setTab('messagerie')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === 'messagerie'
                ? 'bg-brewery-600 text-white'
                : 'text-gray-600 hover:bg-gray-200'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            Messagerie
          </button>
          <button
            onClick={() => setTab('claude')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === 'claude'
                ? 'bg-purple-600 text-white'
                : 'text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Bot className="w-4 h-4" />
            Claude
          </button>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white">
            <Loader2 className="w-6 h-6 text-brewery-600 animate-spin" />
            <span className="ml-2 text-sm text-gray-500">Connexion au Hub...</span>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-white">
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {token && (
          <>
            <iframe
              src={`${HUB_FRONTEND}/embed/${CHANNEL_ID}?token=${token}`}
              className={`absolute inset-0 w-full h-full border-0 ${tab === 'messagerie' ? '' : 'hidden'}`}
              title="Hub Messagerie"
            />
            <iframe
              ref={claudeIframeRef}
              src={`${HUB_FRONTEND}/embed/ai?token=${token}`}
              className={`absolute inset-0 w-full h-full border-0 ${tab === 'claude' ? '' : 'hidden'}`}
              title="Hub Claude AI"
            />
          </>
        )}
      </div>
    </div>
  );
}
