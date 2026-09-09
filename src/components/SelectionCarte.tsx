// La barre d'actions d'une sélection sur la carte.
//
// On sélectionne des prospects et des clients en cliquant dessus, puis on agit sur le lot :
// attribuer à quelqu'un, désactiver ou réactiver des clients, mettre à la corbeille.
// Chaque action dit exactement sur quoi elle porte — « 12 prospects et 3 clients » — parce
// qu'une action en masse qui se trompe de lot coûte cher à défaire.
import { useState } from 'react';
import { X, UserCheck, Power, Trash2, Loader2, CheckSquare } from 'lucide-react';
import { apiPost } from '../api/client';
import { useToast } from './Toast';
import { Commercial } from '../types';

export interface Selection {
  prospects: string[];
  clients: string[];
}

interface Props {
  selection: Selection;
  /** Nom lisible d'une fiche, pour la confirmation de suppression. */
  nomDe: (type: 'prospect' | 'client', id: string) => string;
  commerciaux: Commercial[];
  admin: boolean;
  onTout: () => void;
  onVider: () => void;
  onFini: () => void;
  onFermer: () => void;
}

/** « 12 prospects et 3 clients » — de quoi relire ce qu'on s'apprête à faire. */
export function libelleSelection({ prospects, clients }: Selection): string {
  const bouts: string[] = [];
  if (prospects.length) bouts.push(`${prospects.length} prospect${prospects.length > 1 ? 's' : ''}`);
  if (clients.length) bouts.push(`${clients.length} client${clients.length > 1 ? 's' : ''}`);
  return bouts.join(' et ') || 'aucune fiche';
}

/** Au-delà, la confirmation deviendrait illisible : on nomme les premières et on compte le reste. */
const NOMS_AFFICHES = 12;

export default function SelectionCarte({ selection, nomDe, commerciaux, admin, onTout, onVider, onFini, onFermer }: Props) {
  const toast = useToast();
  const [versQui, setVersQui] = useState('');
  const [enCours, setEnCours] = useState<string | null>(null);

  const total = selection.prospects.length + selection.clients.length;
  const rien = total === 0;

  const lancer = async (cle: string, appel: () => Promise<void>) => {
    setEnCours(cle);
    try {
      await appel();
      onFini();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setEnCours(null);
    }
  };

  const attribuer = () => {
    if (!versQui) return;
    const qui = commerciaux.find(c => c.id === versQui);
    lancer('attribuer', async () => {
      const r = await apiPost('/masse/attribuer', { ...selection, commercial_id: versQui }) as { touches: number };
      toast.success(`${r.touches} fiche${r.touches > 1 ? 's' : ''} attribuée${r.touches > 1 ? 's' : ''} à ${qui?.prenom || 'ce commercial'}`);
    });
  };

  // La carte ne montre que les clients actifs : on ne peut donc que désactiver ici. La
  // réactivation se fait depuis la page Clients, où les inactifs sont visibles.
  const desactiver = () => lancer('desactiver', async () => {
    const r = await apiPost('/masse/statut-client', { clients: selection.clients, actif: false }) as { touches: number };
    toast.success(`${r.touches} client${r.touches > 1 ? 's' : ''} désactivé${r.touches > 1 ? 's' : ''}`);
  });

  const supprimer = () => {
    const noms = [
      ...selection.prospects.map(id => nomDe('prospect', id)),
      ...selection.clients.map(id => nomDe('client', id)),
    ];
    const liste = noms.slice(0, NOMS_AFFICHES).map(n => `• ${n}`).join('\n');
    const reste = noms.length > NOMS_AFFICHES ? `\n… et ${noms.length - NOMS_AFFICHES} autre(s)` : '';
    const message = `Mettre à la corbeille ${libelleSelection(selection)} ?\n\n${liste}${reste}\n\n`
      + 'Rien n\'est détruit : les fiches partent dans la corbeille avec leur historique, et vous pourrez les remettre en place depuis Administration → Corbeille.';
    if (!window.confirm(message)) return;
    lancer('supprimer', async () => {
      const r = await apiPost('/masse/supprimer', selection) as { rangees: number };
      toast.success(`${r.rangees} fiche${r.rangees > 1 ? 's' : ''} dans la corbeille`);
    });
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-[1000] bg-white border-t border-gray-200 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
      <div className="px-3 py-2 flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 flex-shrink-0">
          <CheckSquare className="w-4 h-4 text-brewery-600" />
          {rien ? 'Cliquez sur les points à sélectionner' : libelleSelection(selection)}
        </span>

        <button onClick={onTout} className="text-xs font-medium text-brewery-700 hover:underline flex-shrink-0">
          Tout ce qui est affiché
        </button>
        {!rien && (
          <button onClick={onVider} className="text-xs font-medium text-gray-500 hover:underline flex-shrink-0">
            Vider
          </button>
        )}

        <div className="flex-1" />

        {/* Attribuer : le geste courant, ouvert aux commerciaux comme à l'administrateur. */}
        <div className="flex items-center gap-1.5">
          <select
            value={versQui}
            onChange={e => setVersQui(e.target.value)}
            disabled={rien}
            className="px-2 py-1.5 rounded-lg border border-gray-200 text-xs bg-white disabled:opacity-50"
          >
            <option value="">Attribuer à…</option>
            {commerciaux.map(c => (
              <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
            ))}
          </select>
          <button
            onClick={attribuer}
            disabled={rien || !versQui || enCours !== null}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-brewery-600 text-white hover:bg-brewery-700 disabled:opacity-40"
          >
            {enCours === 'attribuer' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
            Attribuer
          </button>
        </div>

        {/* Actif / inactif n'existe que pour les clients : le bouton le dit plutôt que d'ignorer les prospects en silence. */}
        <button
          onClick={desactiver}
          disabled={selection.clients.length === 0 || enCours !== null}
          title={selection.clients.length === 0 ? 'Sélectionnez des clients : les prospects n\'ont pas d\'état actif/inactif' : undefined}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-40"
        >
          {enCours === 'desactiver' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
          Désactiver{selection.clients.length > 0 ? ` (${selection.clients.length})` : ''}
        </button>

        {/* Mettre à la corbeille : l'administrateur seul, et jamais sans avoir lu les noms. */}
        {admin && (
          <button
            onClick={supprimer}
            disabled={rien || enCours !== null}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-40"
          >
            {enCours === 'supprimer' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            Supprimer
          </button>
        )}

        <button onClick={onFermer} className="p-1.5 rounded-lg hover:bg-gray-100 flex-shrink-0" title="Quitter la sélection">
          <X className="w-4 h-4 text-gray-400" />
        </button>
      </div>
    </div>
  );
}
