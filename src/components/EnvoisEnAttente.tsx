// Les visites notées sans réseau : ce qui attend d'être envoyé, ce qui est à revoir, et
// l'envoi lui-même — au retour du réseau, à la réouverture de l'appli, et toutes les
// 30 secondes tant qu'il reste quelque chose (le réseau revient parfois sans prévenir).
import { Suspense, useEffect, useState } from 'react';
import { CloudOff, AlertTriangle, RefreshCw, Trash2, Send } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { ecouterLaFile, chargerLaFile, retirerDeLaFile, remettreEnAttente, type EnvoiEnAttente } from '../utils/fileHorsLigne';
import { envoyerLaFile } from '../utils/interactions';
import Bouton from './ui/Bouton';
import { confirmer } from './ui/Confirmation';
import { pageParesseuse } from '../utils/pageParesseuse';

// La fenêtre ne se télécharge qu'à l'ouverture : l'en-tête reste léger au démarrage.
const Fenetre = pageParesseuse(() => import('./ui/Fenetre'));

/** La file du téléphone, à jour à chaque changement. */
export function useFileEnvois(): EnvoiEnAttente[] {
  const [envois, setEnvois] = useState<EnvoiEnAttente[]>([]);
  useEffect(() => ecouterLaFile(setEnvois), []);
  return envois;
}

const LIBELLE: Record<string, string> = { VISITE: 'Visite', APPEL: 'Appel', RDV_PLANIFIE: 'RDV' };

function quand(iso: string) {
  const d = new Date(iso);
  const jour = d.toDateString() === new Date().toDateString() ? "aujourd'hui" : d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${jour} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Dans l'en-tête : le compteur, et la fenêtre qui détaille la file. Rien quand la file est vide. */
export default function EnvoisEnAttente() {
  const { state, dispatchLocal } = useApp();
  const userId = state.currentUser?.id;
  const envois = useFileEnvois();
  const [ouvert, setOuvert] = useState(false);
  const [envoi, setEnvoi] = useState(false);

  const attente = envois.filter(e => e.etat === 'attente');
  const aRevoir = envois.filter(e => e.etat === 'a_revoir');

  // L'envoi : au démarrage, au retour du réseau, quand l'appli revient au premier plan, et
  // régulièrement tant que la file n'est pas vide.
  useEffect(() => {
    if (!userId) return;
    const envoyer = () => { if (navigator.onLine !== false) envoyerLaFile(dispatchLocal); };
    chargerLaFile(userId).then(envoyer);
    const visible = () => { if (document.visibilityState === 'visible') envoyer(); };
    window.addEventListener('online', envoyer);
    document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('online', envoyer); document.removeEventListener('visibilitychange', visible); };
  }, [userId, dispatchLocal]);
  useEffect(() => {
    if (!attente.length) return;
    const t = setInterval(() => { if (navigator.onLine !== false) envoyerLaFile(dispatchLocal); }, 30000);
    return () => clearInterval(t);
  }, [attente.length, dispatchLocal]);

  if (!envois.length || !userId) return null;

  const envoyerMaintenant = async () => {
    setEnvoi(true);
    try { await envoyerLaFile(dispatchLocal); } finally { setEnvoi(false); }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-medium ${aRevoir.length ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}
        aria-label={`${attente.length} visite(s) en attente d'envoi${aRevoir.length ? `, ${aRevoir.length} à revoir` : ''}`}
      >
        {aRevoir.length ? <AlertTriangle className="h-4 w-4" /> : <CloudOff className="h-4 w-4" />}
        <span>{aRevoir.length ? `${aRevoir.length} à revoir` : attente.length}</span>
        <span className="sr-only sm:not-sr-only">{aRevoir.length ? '' : ' à envoyer'}</span>
      </button>

      {ouvert && (
      <Suspense fallback={null}>
      <Fenetre
        ouvert={ouvert}
        onFermer={() => setOuvert(false)}
        titre="Notées sans réseau"
        sousTitre={attente.length ? `${attente.length} en attente d'envoi — elles partent toutes seules au retour du réseau.` : 'Rien en attente.'}
        icone={<CloudOff className="h-5 w-5" />}
        pied={attente.length ? (
          <Bouton variante="principal" icone={<Send className="h-4 w-4" />} occupe={envoi} onClick={envoyerMaintenant}>Envoyer maintenant</Bouton>
        ) : undefined}
      >
        <ul className="space-y-2">
          {envois.map(e => (
            <li key={e.id} className={`rounded-lg border p-3 ${e.etat === 'a_revoir' ? 'border-red-200 bg-red-50' : 'border-gray-200'}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    {LIBELLE[e.saisie.type] || e.saisie.type} · {e.client_nom || 'client'}
                  </p>
                  <p className="text-xs text-gray-500">Notée {quand(e.saisie.date)}</p>
                  {e.saisie.comment && <p className="mt-1 line-clamp-2 text-xs text-gray-600">{e.saisie.comment}</p>}
                  {e.etat === 'a_revoir' && <p className="mt-1 text-xs font-medium text-red-700">Refusée par SuiviPro : {e.raison}</p>}
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  {e.etat === 'a_revoir' && (
                    <button type="button" aria-label="Renvoyer" title="Renvoyer" className="rounded-lg p-2 text-gray-500 hover:bg-white"
                      onClick={async () => { await remettreEnAttente(e.id, userId); envoyerLaFile(dispatchLocal); }}>
                      <RefreshCw className="h-4 w-4" />
                    </button>
                  )}
                  <button type="button" aria-label="Retirer" title="Retirer" className="rounded-lg p-2 text-gray-500 hover:bg-white"
                    onClick={async () => {
                      if (!(await confirmer(`Retirer cette ${(LIBELLE[e.saisie.type] || 'visite').toLowerCase()} ?\nElle n'a pas été enregistrée dans SuiviPro : elle sera perdue.`))) return;
                      await retirerDeLaFile(e.id, userId);
                    }}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Fenetre>
      </Suspense>
      )}
    </>
  );
}
