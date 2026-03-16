import { useState, useEffect, useCallback } from 'react';
import { Calendar, Link, Unlink, Loader2, AlertCircle, CheckCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useApp } from '../store/AppContext';
import {
  getGoogleCalendarConfigStatus,
  getGoogleCalendarStatus,
  getGoogleCalendarAuthUrl,
  disconnectGoogleCalendar,
} from '../api/client';

interface ConnectionStatus {
  connected: boolean;
  calendar_email: string;
  connected_at: string;
}

export default function GoogleCalendarPanel() {
  const { state } = useApp();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, ConnectionStatus>>({});
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const [config, status] = await Promise.all([
        getGoogleCalendarConfigStatus(),
        getGoogleCalendarStatus(),
      ]);
      setConfigured(config.configured);
      setStatusMap(status);
    } catch {
      setConfigured(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Listen for OAuth callback message
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_CALENDAR_CONNECTED') {
        setConnecting(false);
        loadStatus();
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [loadStatus]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { url } = await getGoogleCalendarAuthUrl();
      // Open in a popup
      const w = 500;
      const h = 600;
      const left = window.screenX + (window.outerWidth - w) / 2;
      const top = window.screenY + (window.outerHeight - h) / 2;
      window.open(url, 'google-auth', `width=${w},height=${h},left=${left},top=${top}`);
    } catch {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (commercialId: string) => {
    if (!confirm('Deconnecter Google Agenda pour cet utilisateur ?')) return;
    setLoading(true);
    try {
      await disconnectGoogleCalendar(commercialId);
      await loadStatus();
    } catch {
      // ignore
    }
    setLoading(false);
  };

  // Not configured - show nothing or a subtle hint
  if (configured === null) return null;

  const currentUserId = state.currentUser?.id;
  const isCurrentUserConnected = currentUserId ? !!statusMap[currentUserId]?.connected : false;
  const connectedCount = Object.values(statusMap).filter(s => s.connected).length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header - always visible */}
      <button
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${configured ? 'bg-blue-50' : 'bg-gray-100'}`}>
            <Calendar className={`w-4 h-4 ${configured ? 'text-blue-600' : 'text-gray-400'}`} />
          </div>
          <div className="text-left">
            <p className="text-sm font-medium text-gray-900">Google Agenda</p>
            <p className="text-[10px] text-gray-500">
              {!configured
                ? 'Non configure'
                : connectedCount > 0
                  ? `${connectedCount} agenda${connectedCount > 1 ? 's' : ''} connecte${connectedCount > 1 ? 's' : ''}`
                  : 'Aucun agenda connecte'
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isCurrentUserConnected && (
            <span className="flex items-center gap-1 text-[10px] text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
              <CheckCircle className="w-3 h-3" /> Connecte
            </span>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
          {!configured ? (
            <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg">
              <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-medium text-amber-800">Configuration requise</p>
                <p className="text-[11px] text-amber-700 mt-0.5">
                  Pour activer Google Agenda, configurez les variables d'environnement :
                </p>
                <code className="text-[10px] text-amber-600 mt-1 block">
                  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
                </code>
              </div>
            </div>
          ) : (
            <>
              {/* Current user connection */}
              {!isCurrentUserConnected ? (
                <button
                  onClick={handleConnect}
                  disabled={connecting}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50"
                >
                  {connecting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Connexion en cours...
                    </>
                  ) : (
                    <>
                      <Link className="w-4 h-4" />
                      Connecter mon Google Agenda
                    </>
                  )}
                </button>
              ) : (
                <div className="flex items-center justify-between p-2.5 bg-green-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <div>
                      <p className="text-xs font-medium text-green-800">Votre agenda est connecte</p>
                      {statusMap[currentUserId!]?.calendar_email && (
                        <p className="text-[10px] text-green-600">{statusMap[currentUserId!].calendar_email}</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDisconnect(currentUserId!)}
                    disabled={loading}
                    className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Deconnecter"
                  >
                    <Unlink className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Status of all team members */}
              <div>
                <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-2">Equipe</p>
                <div className="space-y-1.5">
                  {state.commerciaux.map(c => {
                    const status = statusMap[c.id];
                    const isConnected = status?.connected;
                    return (
                      <div key={c.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-gray-50">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-300'}`} />
                          <span className="text-xs text-gray-700">{c.prenom} {c.nom}</span>
                          {c.id === currentUserId && <span className="text-[9px] text-gray-400">(vous)</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          {isConnected ? (
                            <>
                              <span className="text-[10px] text-gray-400">{status.calendar_email}</span>
                              {(c.id === currentUserId || state.currentUser?.role === 'admin') && (
                                <button
                                  onClick={() => handleDisconnect(c.id)}
                                  disabled={loading}
                                  className="p-1 text-red-400 hover:text-red-600 transition-colors"
                                  title="Deconnecter"
                                >
                                  <Unlink className="w-3 h-3" />
                                </button>
                              )}
                            </>
                          ) : (
                            <span className="text-[10px] text-gray-400">Non connecte</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
