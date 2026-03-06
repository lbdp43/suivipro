import { useState, useEffect, useRef, useCallback } from 'react';
import { Home, MessageSquare, Bot, X, Loader2, RefreshCw, AlertTriangle, Hash, ArrowLeft } from 'lucide-react';
import { getHubToken } from '../lib/hub';

const HUB_FRONTEND = (import.meta.env.VITE_HUB_FRONTEND_URL || '').replace(/\/$/, '');

type Tab = 'accueil' | 'messagerie' | 'claude';

interface ProspectContext {
  nom: string;
  email: string;
  telephone: string;
  statut: string;
  notes: string;
}

interface HubChannel {
  id: string;
  name: string;
  description?: string;
}

export default function HubPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('accueil');
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Messagerie state
  const [channels, setChannels] = useState<HubChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<HubChannel | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);

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

  // Fetch channels when token is available
  const fetchChannels = useCallback(async () => {
    const authToken = localStorage.getItem('suivipro_token');
    if (!authToken) return;

    setChannelsLoading(true);
    setChannelsError(null);
    try {
      const res = await fetch('/api/hub/channels', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error('Erreur chargement canaux');
      const data = await res.json();
      // Handle both array response and { channels: [] } response
      setChannels(Array.isArray(data) ? data : data.channels || []);
    } catch {
      setChannelsError('Impossible de charger les canaux');
    } finally {
      setChannelsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token && channels.length === 0 && !channelsLoading) {
      fetchChannels();
    }
  }, [token, channels.length, channelsLoading, fetchChannels]);

  const handleRetry = useCallback(() => {
    setToken(null);
    setChannels([]);
    setSelectedChannel(null);
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
            onClick={() => { setTab('messagerie'); }}
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

        {token && (
          <>
            {/* === ACCUEIL TAB === */}
            <div className={`absolute inset-0 ${tab === 'accueil' ? '' : 'hidden'}`}>
              <iframe
                key={`accueil-${refreshKey}`}
                src={`${HUB_FRONTEND}/embed/home?token=${token}`}
                className="w-full h-full border-0"
                title="Hub Accueil"
                allow="clipboard-write"
              />
            </div>

            {/* === MESSAGERIE TAB === */}
            <div className={`absolute inset-0 ${tab === 'messagerie' ? '' : 'hidden'}`}>
              {/* Channel selector (no channel selected) */}
              {!selectedChannel && (
                <div className="h-full flex flex-col">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-700">Canaux</h3>
                  </div>

                  {channelsLoading && (
                    <div className="flex-1 flex items-center justify-center">
                      <Loader2 className="w-5 h-5 text-brewery-600 animate-spin" />
                      <span className="ml-2 text-sm text-gray-500">Chargement...</span>
                    </div>
                  )}

                  {channelsError && (
                    <div className="flex-1 flex flex-col items-center justify-center px-6">
                      <p className="text-sm text-red-500 mb-2">{channelsError}</p>
                      <button
                        onClick={fetchChannels}
                        className="text-sm text-brewery-600 hover:underline"
                      >
                        Reessayer
                      </button>
                    </div>
                  )}

                  {!channelsLoading && !channelsError && channels.length === 0 && (
                    <div className="flex-1 flex items-center justify-center px-6 text-center">
                      <p className="text-sm text-gray-500">Aucun canal disponible</p>
                    </div>
                  )}

                  {!channelsLoading && channels.length > 0 && (
                    <div className="flex-1 overflow-y-auto">
                      {channels.map(channel => (
                        <button
                          key={channel.id}
                          onClick={() => { setSelectedChannel(channel); setIframeLoaded(false); }}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left border-b border-gray-50"
                        >
                          <div className="w-8 h-8 rounded-lg bg-brewery-100 flex items-center justify-center flex-shrink-0">
                            <Hash className="w-4 h-4 text-brewery-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {channel.name}
                            </p>
                            {channel.description && (
                              <p className="text-xs text-gray-500 truncate">{channel.description}</p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Channel iframe (channel selected) */}
              {selectedChannel && (
                <div className="h-full flex flex-col">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50">
                    <button
                      onClick={() => setSelectedChannel(null)}
                      className="p-1 rounded hover:bg-gray-200 transition-colors"
                      title="Retour aux canaux"
                    >
                      <ArrowLeft className="w-4 h-4 text-gray-600" />
                    </button>
                    <Hash className="w-4 h-4 text-brewery-600" />
                    <span className="text-sm font-medium text-gray-700 truncate">{selectedChannel.name}</span>
                  </div>
                  <div className="flex-1 relative">
                    {!iframeLoaded && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
                        <Loader2 className="w-5 h-5 text-brewery-600 animate-spin" />
                      </div>
                    )}
                    <iframe
                      key={`msg-${selectedChannel.id}-${refreshKey}`}
                      src={`${HUB_FRONTEND}/embed/${selectedChannel.id}?token=${token}`}
                      className="w-full h-full border-0"
                      title={`Canal ${selectedChannel.name}`}
                      allow="clipboard-write"
                      onLoad={() => setIframeLoaded(true)}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* === CLAUDE TAB === */}
            <div className={`absolute inset-0 ${tab === 'claude' ? '' : 'hidden'}`}>
              <iframe
                key={`claude-${refreshKey}`}
                ref={claudeIframeRef}
                src={`${HUB_FRONTEND}/embed/ai?token=${token}`}
                className="w-full h-full border-0"
                title="Hub Claude AI"
                allow="clipboard-write"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
