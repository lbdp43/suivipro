import { useState, useEffect, useRef, useCallback } from 'react';
import { Home, MessageSquare, Bot, X, Loader2, RefreshCw, AlertTriangle, Hash, ArrowLeft, KeyRound, Check } from 'lucide-react';
import { getHubToken, clearHubTokenCache, saveHubCredentials, getHubChannels } from '../lib/hub';
import { useApp } from '../store/AppContext';
import { handleSuiviProAction, type SuiviProResponse } from '../lib/hubBridge';

const HUB_FRONTEND = (import.meta.env.VITE_HUB_FRONTEND_URL || '').replace(/\/$/, '');
const HUB_ORIGIN = HUB_FRONTEND ? new URL(HUB_FRONTEND).origin : '';

type Tab = 'accueil' | 'messagerie' | 'claude';

interface ProspectContext {
  id: string;
  nom: string;
  nom_etablissement: string;
  type_etablissement: string;
  email: string;
  telephone: string;
  statut: string;
  notes: string;
  ville: string;
  commercial_id: string;
}

interface HubChannel {
  id: string;
  name: string;
  description?: string;
}

export default function HubPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const [tab, setTab] = useState<Tab>('accueil');
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Credentials form
  const [hubEmail, setHubEmail] = useState('');
  const [hubPassword, setHubPassword] = useState('');
  const [savingCreds, setSavingCreds] = useState(false);
  const [credsError, setCredsError] = useState<string | null>(null);
  const [credsSaved, setCredsSaved] = useState(false);

  // Messagerie state
  const [channels, setChannels] = useState<HubChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<HubChannel | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  const claudeIframeRef = useRef<HTMLIFrameElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // ============================================
  // postMessage listener — Hub Bridge
  // Handles SUIVIPRO_REQUEST from Hub iframe
  // Flow: Hub sends request → SuiviPro executes → sends response back
  // For write actions: Hub sends without confirmed → gets needs_confirmation
  //   → Claude asks user in chat → Hub resends with confirmed:true → executes
  // ============================================
  useEffect(() => {
    if (!HUB_ORIGIN) return;

    const handler = (event: MessageEvent) => {
      // Security: only accept messages from Hub origin
      if (event.origin !== HUB_ORIGIN) return;
      if (event.data?.type !== 'SUIVIPRO_REQUEST') return;

      const { requestId, action, payload } = event.data;
      const result = handleSuiviProAction(action, payload || {}, stateRef.current, dispatch);

      const response: SuiviProResponse = {
        type: 'SUIVIPRO_RESPONSE',
        requestId,
        ...result,
      };

      claudeIframeRef.current?.contentWindow?.postMessage(response, HUB_ORIGIN);
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [dispatch]);

  // Fetch token
  const fetchToken = useCallback(() => {
    setLoading(true);
    setError(null);
    setNeedsSetup(false);
    getHubToken()
      .then((t: string) => {
        setToken(t);
        setNeedsSetup(false);
      })
      .catch((err) => {
        if (err.message === 'HUB_NOT_CONFIGURED') {
          setNeedsSetup(true);
        } else {
          setError('Connexion au Hub impossible');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!open || token) return;
    fetchToken();
  }, [open, token, fetchToken]);

  // Fetch channels when token is available
  const fetchChannels = useCallback(async () => {
    setChannelsLoading(true);
    setChannelsError(null);
    try {
      const list = await getHubChannels();
      setChannels(list);
    } catch {
      setChannelsError('Impossible de charger les canaux');
    } finally {
      setChannelsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token && channels.length === 0 && !channelsLoading && !channelsError) {
      fetchChannels();
    }
  }, [token, channels.length, channelsLoading, channelsError, fetchChannels]);

  // Save Hub credentials
  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCreds(true);
    setCredsError(null);
    setCredsSaved(false);
    try {
      await saveHubCredentials(hubEmail, hubPassword);
      setCredsSaved(true);
      setNeedsSetup(false);
      setHubPassword('');
      fetchToken();
    } catch (err: any) {
      setCredsError(err.message || 'Erreur de connexion au Hub');
    } finally {
      setSavingCreds(false);
    }
  };

  const handleRetry = useCallback(() => {
    clearHubTokenCache();
    setToken(null);
    setChannels([]);
    setSelectedChannel(null);
    setRefreshKey(k => k + 1);
  }, []);

  // Send prospect context to the Claude iframe
  const sendProspectContext = useCallback((prospect: ProspectContext) => {
    if (claudeIframeRef.current?.contentWindow && HUB_ORIGIN) {
      claudeIframeRef.current.contentWindow.postMessage({
        type: 'HUB_AI_CONTEXT',
        prospect,
      }, HUB_ORIGIN);
    }
  }, []);

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
              tab === 'accueil' ? 'bg-brewery-600 text-white' : 'text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Home className="w-4 h-4" />
            Accueil
          </button>
          <button
            onClick={() => setTab('messagerie')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === 'messagerie' ? 'bg-brewery-600 text-white' : 'text-gray-600 hover:bg-gray-200'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            Messagerie
          </button>
          <button
            onClick={() => setTab('claude')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === 'claude' ? 'bg-purple-600 text-white' : 'text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Bot className="w-4 h-4" />
            Claude
          </button>
        </div>
        <div className="flex items-center gap-1">
          {token && (
            <button
              onClick={handleRetry}
              className="p-1.5 rounded-lg text-gray-400 hover:text-brewery-600 hover:bg-gray-200 transition-colors"
              title="Rafraichir le Hub"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
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
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-20">
            <Loader2 className="w-6 h-6 text-brewery-600 animate-spin" />
            <span className="mt-2 text-sm text-gray-500">Connexion au Hub...</span>
          </div>
        )}

        {/* Global error */}
        {error && !needsSetup && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-20">
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

        {/* Missing VITE_HUB_FRONTEND_URL */}
        {missingConfig && !loading && !error && !needsSetup && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-20 px-6 text-center">
            <AlertTriangle className="w-8 h-8 text-amber-400 mb-2" />
            <p className="text-sm font-medium text-gray-700 mb-1">Hub non configure</p>
            <p className="text-xs text-gray-500">
              La variable <code className="bg-gray-100 px-1 rounded">VITE_HUB_FRONTEND_URL</code> n'est pas definie.
            </p>
          </div>
        )}

        {/* === SETUP SCREEN: user needs to enter Hub credentials === */}
        {needsSetup && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-20 px-6">
            <div className="w-full max-w-xs">
              <div className="flex items-center justify-center mb-4">
                <div className="w-12 h-12 rounded-full bg-brewery-100 flex items-center justify-center">
                  <KeyRound className="w-6 h-6 text-brewery-600" />
                </div>
              </div>
              <h3 className="text-base font-semibold text-gray-800 text-center mb-1">
                Connexion au Hub
              </h3>
              <p className="text-xs text-gray-500 text-center mb-5">
                Entrez vos identifiants Hub LBDP pour acceder a la messagerie, Claude et le dashboard.
              </p>

              <form onSubmit={handleSaveCredentials} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email Hub</label>
                  <input
                    type="email"
                    value={hubEmail}
                    onChange={e => setHubEmail(e.target.value)}
                    placeholder="votre@email.com"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brewery-500 focus:border-transparent"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Mot de passe Hub</label>
                  <input
                    type="password"
                    value={hubPassword}
                    onChange={e => setHubPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brewery-500 focus:border-transparent"
                    required
                  />
                </div>

                {credsError && (
                  <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{credsError}</p>
                )}

                {credsSaved && (
                  <p className="text-xs text-green-600 bg-green-50 rounded-lg px-3 py-2 flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" />
                    Connecte au Hub
                  </p>
                )}

                <button
                  type="submit"
                  disabled={savingCreds}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-brewery-600 text-white text-sm font-medium rounded-lg hover:bg-brewery-700 disabled:opacity-50 transition-colors"
                >
                  {savingCreds ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Verification...
                    </>
                  ) : (
                    'Se connecter au Hub'
                  )}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* === CONNECTED: show tabs === */}
        {token && (
          <>
            {/* ACCUEIL TAB */}
            <div className={`absolute inset-0 ${tab === 'accueil' ? '' : 'hidden'}`}>
              <iframe
                key={`accueil-${refreshKey}`}
                src={`${HUB_FRONTEND}/embed/home?token=${token}`}
                className="w-full h-full border-0"
                title="Hub Accueil"
                allow="clipboard-write"
              />
            </div>

            {/* MESSAGERIE TAB */}
            <div className={`absolute inset-0 ${tab === 'messagerie' ? '' : 'hidden'}`}>
              {!selectedChannel ? (
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

                  {channelsError && !channelsLoading && (
                    <div className="flex-1 flex flex-col items-center justify-center px-6">
                      <p className="text-sm text-red-500 mb-2">{channelsError}</p>
                      <button onClick={fetchChannels} className="text-sm text-brewery-600 hover:underline">
                        Reessayer
                      </button>
                    </div>
                  )}

                  {!channelsLoading && !channelsError && channels.length === 0 && (
                    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
                      <MessageSquare className="w-8 h-8 text-gray-300 mb-2" />
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
                            <p className="text-sm font-medium text-gray-900 truncate">{channel.name}</p>
                            {channel.description && (
                              <p className="text-xs text-gray-500 truncate">{channel.description}</p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
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
                      allow="clipboard-write; microphone"
                      onLoad={() => setIframeLoaded(true)}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* CLAUDE TAB */}
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
