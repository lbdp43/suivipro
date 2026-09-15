// Le répertoire Google : le bouton qui dépose les clients dans les contacts du téléphone,
// et qui ramène ce qui a été enrichi là-bas.
//
// Le panneau est volontairement bavard avant le premier clic : déposer 1 000 fiches dans le
// répertoire de quelqu'un n'est pas anodin, et il faut savoir ce qui va se passer avant de
// cliquer, pas après.
import { useState, useEffect, useCallback } from 'react';
import {
  BookUser, Link as LinkIcon, Unlink, Loader2, AlertCircle, CheckCircle,
  ChevronDown, ChevronUp, RefreshCw,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import {
  getRepertoireConfigStatus, getRepertoireStatus, getRepertoireAuthUrl,
  disconnectRepertoire, synchroniserRepertoire,
  type EtatRepertoire, type BilanSync,
} from '../api/client';
import { useToast } from './Toast';

function quand(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function RepertoireGooglePanel() {
  const { state } = useApp();
  const toast = useToast();
  const [configure, setConfigure] = useState<boolean | null>(null);
  const [retour, setRetour] = useState('');
  const [etats, setEtats] = useState<Record<string, EtatRepertoire>>({});
  const [ouvert, setOuvert] = useState(false);
  const [connexion, setConnexion] = useState(false);
  const [sync, setSync] = useState(false);
  const [bilan, setBilan] = useState<BilanSync | null>(null);

  const charger = useCallback(async () => {
    try {
      const [config, etat] = await Promise.all([getRepertoireConfigStatus(), getRepertoireStatus()]);
      setConfigure(config.configured);
      setRetour(config.retour || '');
      setEtats(etat);
    } catch {
      setConfigure(false);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_CONTACTS_CONNECTED') {
        setConnexion(false);
        charger();
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [charger]);

  const connecter = async () => {
    setConnexion(true);
    try {
      const { url } = await getRepertoireAuthUrl();
      const l = 500, h = 620;
      window.open(url, 'google-contacts', `width=${l},height=${h},left=${window.screenX + (window.outerWidth - l) / 2},top=${window.screenY + (window.outerHeight - h) / 2}`);
    } catch {
      setConnexion(false);
      toast.error('Impossible d’ouvrir la connexion Google.');
    }
  };

  const deconnecter = async (id: string) => {
    if (!confirm('Déconnecter le répertoire Google ? Les contacts déjà déposés restent dans Google ; vous pouvez les retirer d’un geste depuis le libellé « SuiviPro ».')) return;
    try {
      await disconnectRepertoire(id);
      setBilan(null);
      await charger();
    } catch {
      toast.error('La déconnexion a échoué.');
    }
  };

  const synchroniser = async () => {
    setSync(true);
    setBilan(null);
    try {
      const r = await synchroniserRepertoire();
      setBilan(r);
      if (r.error) toast.error(r.error);
      else toast.success(r.resume || 'Répertoire à jour.');
      await charger();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'La synchronisation a échoué.';
      setBilan(null);
      toast.error(message);
    }
    setSync(false);
  };

  if (configure === null) return null;

  const moiId = state.currentUser?.id;
  const monEtat = moiId ? etats[moiId] : undefined;
  const connecte = !!monEtat?.connected;
  const nombreConnectes = Object.values(etats).filter(e => e.connected).length;
  const nombreClients = state.clients?.length ?? 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
        onClick={() => setOuvert(!ouvert)}
      >
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${configure ? 'bg-emerald-50' : 'bg-gray-100'}`}>
            <BookUser className={`w-4 h-4 ${configure ? 'text-emerald-600' : 'text-gray-400'}`} />
          </div>
          <div className="text-left">
            <p className="text-sm font-medium text-gray-900">Répertoire Google</p>
            <p className="text-[10px] text-gray-500">
              {!configure
                ? 'Non configuré'
                : nombreConnectes > 0
                  ? `${nombreConnectes} répertoire${nombreConnectes > 1 ? 's' : ''} connecté${nombreConnectes > 1 ? 's' : ''}`
                  : 'Voir le nom de vos clients quand ils appellent'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {connecte && (
            <span className="flex items-center gap-1 text-[10px] text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
              <CheckCircle className="w-3 h-3" /> Connecté
            </span>
          )}
          {ouvert ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {ouvert && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
          {!configure ? (
            <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg">
              <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-medium text-amber-800">Configuration requise</p>
                <p className="text-[11px] text-amber-700 mt-0.5">
                  Les mêmes identifiants Google que l'agenda, et une adresse de retour se
                  terminant par <code className="mx-1">/api/google-contacts/callback</code>
                  déclarée dans la console Google.
                </p>
              </div>
            </div>
          ) : !connecte ? (
            <>
              <div className="p-3 bg-gray-50 rounded-lg space-y-1.5">
                <p className="text-xs font-medium text-gray-800">Ce qui va se passer</p>
                <ul className="text-[11px] text-gray-600 space-y-1 list-disc pl-4">
                  <li>Les <strong>{nombreClients} clients</strong> de la brasserie — pas seulement les vôtres — sont déposés dans vos contacts Google, sous le libellé « SuiviPro ».</li>
                  <li>Leur nom s'affiche quand ils appellent, et vous pouvez les appeler depuis le téléphone.</li>
                  <li>Ce que vous corrigez là-bas — numéro, e-mail, note — revient dans la fiche.</li>
                  <li>Le <strong>nom de l'établissement</strong> ne revient jamais de Google : il sert à détecter les doublons.</li>
                  <li>Un contact que vous créez dans Google ne crée rien ici, et en supprimer un ne supprime aucune fiche.</li>
                </ul>
              </div>
              <button
                onClick={connecter}
                disabled={connexion}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {connexion
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Connexion en cours...</>
                  : <><LinkIcon className="w-4 h-4" /> Connecter mon répertoire Google</>}
              </button>
              {retour && (
                <div className="p-2.5 bg-amber-50 rounded-lg">
                  <p className="text-[11px] text-amber-800">
                    Si Google répond <strong>« Accès bloqué — redirect_uri_mismatch »</strong>, c'est que
                    cette adresse n'est pas encore déclarée dans la console Google
                    (Identifiants → votre ID client OAuth → URI de redirection autorisés) :
                  </p>
                  <code className="block mt-1 text-[10px] text-amber-900 bg-amber-100 rounded px-2 py-1 break-all">
                    {retour}
                  </code>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between p-2.5 bg-green-50 rounded-lg">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-green-800 truncate">{monEtat?.contacts_email || 'Répertoire connecté'}</p>
                    <p className="text-[10px] text-green-600">
                      {monEtat?.derniere_sync
                        ? `Dernière synchro : ${quand(monEtat.derniere_sync)} — ${monEtat.dernier_bilan}`
                        : 'Jamais synchronisé'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => deconnecter(moiId!)}
                  className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                  title="Déconnecter"
                >
                  <Unlink className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                onClick={synchroniser}
                disabled={sync}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {sync
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Synchronisation en cours, ne fermez pas la page...</>
                  : <><RefreshCw className="w-4 h-4" /> Synchroniser maintenant</>}
              </button>
              {sync && (
                <p className="text-[10px] text-gray-500 text-center">
                  La première fois, {nombreClients} contacts sont créés : comptez une bonne minute.
                </p>
              )}

              {bilan && !bilan.error && (
                <div className="p-3 bg-gray-50 rounded-lg space-y-1">
                  <p className="text-xs font-medium text-gray-800">Dernière synchronisation</p>
                  <ul className="text-[11px] text-gray-600 space-y-0.5">
                    <li>{bilan.crees} contact{bilan.crees > 1 ? 's' : ''} ajouté{bilan.crees > 1 ? 's' : ''} dans Google</li>
                    <li>{bilan.mis_a_jour} mis à jour, {bilan.retires} retiré{bilan.retires > 1 ? 's' : ''}</li>
                    {bilan.readoptes > 0 && (
                      <li>{bilan.readoptes} contact{bilan.readoptes > 1 ? 's' : ''} déjà présent{bilan.readoptes > 1 ? 's' : ''} dans Google {bilan.readoptes > 1 ? 'ont été repris' : 'a été repris'} au lieu d'être recréé{bilan.readoptes > 1 ? 's' : ''}</li>
                    )}
                    <li>
                      <strong>{bilan.rapatries}</strong> modification{bilan.rapatries > 1 ? 's' : ''} ramenée{bilan.rapatries > 1 ? 's' : ''} de Google
                    </li>
                    {bilan.refuses_vides > 0 && (
                      <li className="text-amber-700">
                        {bilan.refuses_vides} contact{bilan.refuses_vides > 1 ? 's' : ''} revenu{bilan.refuses_vides > 1 ? 's' : ''} vide{bilan.refuses_vides > 1 ? 's' : ''} : fiche{bilan.refuses_vides > 1 ? 's' : ''} laissée{bilan.refuses_vides > 1 ? 's' : ''} intacte{bilan.refuses_vides > 1 ? 's' : ''}
                      </li>
                    )}
                  </ul>
                  {bilan.notes.length > 0 && (
                    <ul className="text-[10px] text-gray-500 space-y-0.5 pt-1 border-t border-gray-200 mt-1.5">
                      {bilan.notes.slice(0, 5).map((n, i) => <li key={i}>{n}</li>)}
                    </ul>
                  )}
                </div>
              )}

              <div>
                <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-2">Équipe</p>
                <div className="space-y-1.5">
                  {state.commerciaux.map(c => {
                    const e = etats[c.id];
                    return (
                      <div key={c.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-gray-50">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${e?.connected ? 'bg-green-500' : 'bg-gray-300'}`} />
                          <span className="text-xs text-gray-700">{c.prenom} {c.nom}</span>
                          {c.id === moiId && <span className="text-[9px] text-gray-400">(vous)</span>}
                        </div>
                        {e?.connected ? (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-400 hidden sm:inline">{e.contacts_email}</span>
                            {(c.id === moiId || state.currentUser?.role === 'admin') && (
                              <button
                                onClick={() => deconnecter(c.id)}
                                className="p-1 text-red-400 hover:text-red-600 transition-colors"
                                title="Déconnecter"
                              >
                                <Unlink className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] text-gray-400">Non connecté</span>
                        )}
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
