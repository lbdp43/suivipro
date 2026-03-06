import { useState, useEffect, useRef, useCallback } from 'react';
import { Home, MessageSquare, Bot, X, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { getHubToken } from '../lib/hub';

const HUB_FRONTEND = (import.meta.env.VITE_HUB_FRONTEND_URL || '').replace(/\/$/, '');
const CHANNEL_ID = import.meta.env.VITE_HUB_CHANNEL_ID || '';

type Tab = 'accueil' | 'messagerie' | 'claude';

interface ProspectContext {
  nom: string;
  email: string;
  telephone: string;
  statut: string;
  notes: string;
}

interface IframeState {
  loaded: boolean;
  error: boolean;
}

export default function HubPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('accueil');
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iframeStates, setIframeStates] = useState<Record<Tab, IframeState>>({
    accueil: { loaded: false, error: false },
    messagerie: { loaded: false, error: false },
    claude: { loaded: false, error: false },
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const claudeIframeRef = useRef<HTMLIFrameElement>(null);

  const fetchToken = useCallback(() => {
    setLoading(true);
    setError(null);
    getHubToken()
      .then((t: string) => setToken(t))
      .catch(() => setError('Connexion au Hub impossible'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!open || token) return;
    fetchToken();
  }, [open, token, fetchToken]);

  // Reset iframe states on refresh
  useEffect(() => {
    setIframeStates({
      accueil: { loaded: false, error: false },
      messagerie: { loaded: false, error: false },
      claude: { loaded: false, error: false },
    });
  }, [refreshKey, token]);

  const handleIframeLoad = useCallback((tabName: Tab) => {
    setIframeStates(prev => ({ ...prev, [tabName]: { loaded: true, error: false } }));
  }, []);

  const handleIframeError = useCallback((tabName: Tab) => {
    setIframeStates(prev => ({ ...prev, [tabName]: { loaded: true, error: true } }));
  }, []);

  const handleRetry = useCallback(() => {
    setToken(null);
    setRefreshKey(k => k + 1);
  }, []);

  // Send prospect context to the Claude iframe
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

  const missingConfig = !HUB_FRONTEND;
  const missingChannel = !CHANNEL_ID;

  // Build iframe URLs
  const urls: Record<Tab, string | null> = {
    accueil: HUB_FRONTEND ? `${HUB_FRONTEND}/embed/home?token=${token}` : null,
    messagerie: HUB_FRONTEND && CHANNEL_ID ? `${HUB_FRONTEND}/embed/${CHANNEL_ID}?token=${token}` : null,
    claude: HUB_FRONTEND ? `${HUB_FRONTEND}/embed/ai?token=${token}` : null,
  };

  const currentIframeState = iframeStates[tab];

  return (
    <div className="fixed top-0 right-0 h-full w-[420px] max-w-full bg-white border-l border-gray-200 shadow-xl z-50 flex flex-col slide-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex gap-1">
          <button
            onClick={() => setTab('accueil')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === 'accueil'
                ? 'bg-brewery-600 text-white'
                : 'text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Home className="w-4 h-4" />
            Accueil
          </button>
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
        <div className="flex items-center gap-1">
          <button
            onClick={handleRetry}
            className="p-1.5 rounded-lg text-gray-400 hover:text-brewery-600 hover:bg-gray-200 transition-colors"
            title="Rafraichir le Hub"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative overflow-hidden bg-white">
        {/* Global loading */}
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-10">
            <Loader2 className="w-6 h-6 text-brewery-600 animate-spin" />
            <span className="mt-2 text-sm text-gray-500">Connexion au Hub...</span>
          </div>
        )}

        {/* Global error */}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-10">
            <AlertTriangle className="w-8 h-8 text-red-400 mb-2" />
            <p className="text-sm text-red-500 mb-3">{error}</p>
            <button
              onClick={handleRetry}
              className="flex items-center gap-2 px-4 py-2 bg-brewery-600 text-white text-sm rounded-lg hover:bg-brewery-700 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Reessayer
            </button>
          </div>
        )}

        {/* Missing config warning */}
        {missingConfig && !loading && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-10 px-6 text-center">
            <AlertTriangle className="w-8 h-8 text-amber-400 mb-2" />
            <p className="text-sm font-medium text-gray-700 mb-1">Hub non configure</p>
            <p className="text-xs text-gray-500">
              La variable <code className="bg-gray-100 px-1 rounded">VITE_HUB_FRONTEND_URL</code> n'est pas definie.
            </p>
          </div>
        )}

        {/* Per-tab loading overlay (shows while iframe loads) */}
        {token && !currentIframeState.loaded && urls[tab] && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-10">
            <Loader2 className="w-6 h-6 text-brewery-600 animate-spin" />
            <span className="mt-2 text-sm text-gray-500">Chargement...</span>
          </div>
        )}

        {/* Missing channel ID warning for messagerie */}
        {tab === 'messagerie' && missingChannel && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-10 px-6 text-center">
            <MessageSquare className="w-8 h-8 text-amber-400 mb-2" />
            <p className="text-sm font-medium text-gray-700 mb-1">Canal non configure</p>
            <p className="text-xs text-gray-500">
              La variable <code className="bg-gray-100 px-1 rounded">VITE_HUB_CHANNEL_ID</code> n'est pas definie.
              Ajoutez l'ID du canal de messagerie dans les variables d'environnement.
            </p>
          </div>
        )}

        {/* Iframes */}
        {token && (
          <>
            {urls.accueil && (
              <iframe
                key={`accueil-${refreshKey}`}
                src={urls.accueil}
                className={`absolute inset-0 w-full h-full border-0 ${tab === 'accueil' ? '' : 'hidden'}`}
                title="Hub Accueil"
                allow="clipboard-write"
                onLoad={() => handleIframeLoad('accueil')}
                onError={() => handleIframeError('accueil')}
              />
            )}
            {urls.messagerie && (
              <iframe
                key={`messagerie-${refreshKey}`}
                src={urls.messagerie}
                className={`absolute inset-0 w-full h-full border-0 ${tab === 'messagerie' ? '' : 'hidden'}`}
                title="Hub Messagerie"
                allow="clipboard-write"
                onLoad={() => handleIframeLoad('messagerie')}
                onError={() => handleIframeError('messagerie')}
              />
            )}
            {urls.claude && (
              <iframe
                key={`claude-${refreshKey}`}
                ref={claudeIframeRef}
                src={urls.claude}
                className={`absolute inset-0 w-full h-full border-0 ${tab === 'claude' ? '' : 'hidden'}`}
                title="Hub Claude AI"
                allow="clipboard-write"
                onLoad={() => handleIframeLoad('claude')}
                onError={() => handleIframeError('claude')}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
