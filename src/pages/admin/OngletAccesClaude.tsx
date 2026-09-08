// Les accès Claude (MCP) : créer un jeton pour quelqu'un, voir qui s'en sert, révoquer.
//
// Un jeton appartient à une personne et porte son rôle : c'est ce qui permet de répondre
// à « mes clients » et de savoir, dans le journal, qui a lu quoi. Sa valeur ne s'affiche
// qu'une seule fois, à la création — ensuite, seuls les quatre derniers caractères restent.
import { useEffect, useState } from 'react';
import { Bot, Copy, Check, Plus, Trash2, ShieldCheck, AlertTriangle, Clock } from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '../../api/client';
import { useApp } from '../../store/AppContext';
import { useToast } from '../../components/Toast';
import { libelleRole } from '../../utils/roles';

interface Jeton {
  id: string;
  commercial_id: string;
  nom: string;
  indice: string;
  cree_le: string;
  expire_le: string;
  revoque_le: string | null;
  derniere_utilisation: string | null;
  appels: number;
  prenom: string;
  nom_commercial: string;
  role: string;
  actif: boolean;
}

const dateCourte = (v?: string | null) => (v ? new Date(v).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const dateEtHeure = (v?: string | null) => (v ? new Date(v).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'jamais');

function joursAvant(v: string) {
  return Math.ceil((new Date(v).getTime() - Date.now()) / 86400000);
}

export default function OngletAccesClaude() {
  const { state } = useApp();
  const toast = useToast();
  const [jetons, setJetons] = useState<Jeton[]>([]);
  const [chargement, setChargement] = useState(true);
  const [pour, setPour] = useState('');
  const [nouveau, setNouveau] = useState<{ valeur: string; pour: string } | null>(null);
  const [copie, setCopie] = useState(false);

  const charger = async () => {
    try {
      const r = await apiGet<{ jetons: Jeton[] }>('/mcp/jetons');
      setJetons(r.jetons || []);
    } catch (err) {
      toast.error(`Accès Claude illisibles : ${(err as Error).message}`);
    } finally {
      setChargement(false);
    }
  };

  useEffect(() => { charger(); }, []);

  const creer = async () => {
    if (!pour) return;
    const personne = state.commerciaux.find(c => c.id === pour);
    try {
      const r = await apiPost('/mcp/jetons', { commercial_id: pour, nom: 'Accès Claude' }) as { valeur: string };
      setNouveau({ valeur: r.valeur, pour: personne ? `${personne.prenom} ${personne.nom}` : '' });
      setCopie(false);
      setPour('');
      charger();
    } catch (err) {
      toast.error(`Création impossible : ${(err as Error).message}`);
    }
  };

  const revoquer = async (j: Jeton) => {
    if (!window.confirm(`Révoquer l'accès Claude de ${j.prenom} ? Il cessera de fonctionner immédiatement.`)) return;
    try {
      await apiDelete(`/mcp/jetons/${j.id}`);
      toast.success('Accès révoqué');
      charger();
    } catch (err) {
      toast.error(`Révocation impossible : ${(err as Error).message}`);
    }
  };

  const copier = async () => {
    if (!nouveau) return;
    try {
      await navigator.clipboard.writeText(nouveau.valeur);
      setCopie(true);
    } catch {
      toast.error('Copie impossible : sélectionnez le jeton à la main');
    }
  };

  const actifs = jetons.filter(j => j.actif);
  const anciens = jetons.filter(j => !j.actif);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Bot className="w-4 h-4 text-brewery-600" /> Accès Claude
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          Un accès permet de poser des questions à SuiviPro depuis Claude — <strong>en lecture seule</strong>.
          Chaque personne a le sien : il porte son rôle, et ne montre que ce qu'elle voit déjà à l'écran.
          Rien ne peut être créé, modifié ni supprimé par ce chemin.
        </p>
        <p className="text-xs text-gray-500 mt-2">
          À brancher dans Claude : Réglages → Connecteurs → connecteur personnalisé, nom <code className="bg-gray-100 px-1 rounded">suivipro</code>,
          adresse <code className="bg-gray-100 px-1 rounded">{window.location.origin}/mcp</code>, et le jeton dans le champ d'authentification.
        </p>
      </div>

      {nouveau && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4">
          <p className="text-sm font-semibold text-amber-900 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Le jeton de {nouveau.pour} — copiez-le maintenant
          </p>
          <p className="text-xs text-amber-800 mt-1">Il ne sera plus jamais affiché. S'il est perdu, il faudra en créer un autre.</p>
          <div className="flex items-center gap-2 mt-3">
            <code className="flex-1 min-w-0 bg-white border border-amber-200 rounded-lg px-3 py-2 text-xs font-mono break-all">{nouveau.valeur}</code>
            <button type="button" onClick={copier} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 flex-shrink-0">
              {copie ? <><Check className="w-3.5 h-3.5" /> Copié</> : <><Copy className="w-3.5 h-3.5" /> Copier</>}
            </button>
          </div>
          <button type="button" onClick={() => setNouveau(null)} className="mt-3 text-xs text-amber-800 underline">J'ai copié le jeton, masquer</button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Créer un accès</h3>
        <div className="flex flex-wrap items-center gap-2">
          <select value={pour} onChange={e => setPour(e.target.value)} className="flex-1 min-w-[12rem] px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Pour qui ?</option>
            {state.commerciaux.map(c => (
              <option key={c.id} value={c.id}>{c.prenom} {c.nom} — {libelleRole(c)}</option>
            ))}
          </select>
          <button type="button" onClick={creer} disabled={!pour} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brewery-600 text-white text-sm font-medium hover:bg-brewery-700 disabled:opacity-40">
            <Plus className="w-4 h-4" /> Créer
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">Valable un an. Une personne peut avoir plusieurs accès : créez le nouveau, puis révoquez l'ancien.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide px-4 pt-4">Accès en service ({actifs.length})</h3>
        {chargement && <p className="text-sm text-gray-400 p-4">Chargement…</p>}
        {!chargement && actifs.length === 0 && <p className="text-sm text-gray-400 p-4">Aucun accès pour le moment.</p>}
        <div className="divide-y divide-gray-100 mt-2">
          {actifs.map(j => {
            const restants = joursAvant(j.expire_le);
            return (
              <div key={j.id} className="flex items-center gap-3 px-4 py-3">
                <ShieldCheck className="w-4 h-4 text-brewery-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {j.prenom} {j.nom_commercial}
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">{j.role}</span>
                    <span className="ml-2 text-xs font-mono text-gray-400">…{j.indice}</span>
                  </p>
                  <p className="text-[11px] text-gray-500 flex flex-wrap items-center gap-x-3">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> dernière utilisation : {dateEtHeure(j.derniere_utilisation)}</span>
                    <span>{j.appels} requête(s)</span>
                    <span className={restants <= 30 ? 'text-amber-600 font-medium' : ''}>expire le {dateCourte(j.expire_le)}{restants <= 30 ? ` — dans ${restants} j` : ''}</span>
                  </p>
                </div>
                <button type="button" onClick={() => revoquer(j)} className="p-2 rounded-lg text-red-500 hover:bg-red-50 flex-shrink-0" title="Révoquer">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {anciens.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Accès révoqués ou expirés ({anciens.length})</h3>
          <div className="space-y-1">
            {anciens.map(j => (
              <p key={j.id} className="text-xs text-gray-400">
                {j.prenom} {j.nom_commercial} · …{j.indice} · {j.revoque_le ? `révoqué le ${dateCourte(j.revoque_le)}` : `expiré le ${dateCourte(j.expire_le)}`} · {j.appels} requête(s)
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
