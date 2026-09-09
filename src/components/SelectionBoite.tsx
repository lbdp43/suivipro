// La barre d'actions d'une sélection dans la boîte de prospection.
//
// Vider la boîte, c'est parcourir une série de dépôts et trancher : ceux-là tiennent, on
// les crée ; ceux-là non, on les écarte. À trois clics par fiche, personne ne le fait — et
// une boîte qu'on ne vide pas ne sert plus à rien. Ici on coche, puis on tranche en un coup.
//
// Chaque action dit sur combien de fiches elle porte, et la suppression nomme celles qu'elle
// va détruire : c'est le seul geste de cette page qui ne se rattrape pas.
import { useState } from 'react';
import { X, UserPlus, Trash2, Loader2, CheckSquare, RotateCcw } from 'lucide-react';
import { apiPost } from '../api/client';
import { useToast } from './Toast';

interface Props {
  /** Les signalements cochés, un identifiant par ligne (les groupes sont déjà déployés). */
  ids: string[];
  /** Les noms correspondants, dans le même ordre, pour les confirmations. */
  noms: string[];
  /** Vrai dans l'onglet « Traités » : on y rouvre au lieu de créer et d'ignorer. */
  traites: boolean;
  admin: boolean;
  onTout: () => void;
  onVider: () => void;
  onFini: (resultat: ResultatMasse) => void;
  onFermer: () => void;
}

export interface ResultatMasse {
  action: 'creer' | 'ignorer' | 'rouvrir' | 'supprimer';
  signalements: unknown[];
  prospects: unknown[];
  supprimes: string[];
  echecs: { id: string; nom?: string; raison: string }[];
}

/** Au-delà, la confirmation deviendrait illisible : on nomme les premières et on compte le reste. */
const NOMS_AFFICHES = 12;

/** Ce que le serveur accepte d'un coup. Au-delà, on envoie en plusieurs fois plutôt que
 *  de refuser un « tout ce qui est affiché » sur une boîte bien remplie. */
const PAR_ENVOI = 200;

function compte(n: number, singulier: string, pluriel: string): string {
  return `${n} ${n > 1 ? pluriel : singulier}`;
}

export default function SelectionBoite({ ids, noms, traites, admin, onTout, onVider, onFini, onFermer }: Props) {
  const toast = useToast();
  const [enCours, setEnCours] = useState<string | null>(null);
  const rien = ids.length === 0;
  const combien = compte(ids.length, 'signalement', 'signalements');

  const lancer = async (action: ResultatMasse['action']) => {
    setEnCours(action);
    try {
      const r: ResultatMasse = { action, signalements: [], prospects: [], supprimes: [], echecs: [] };
      for (let i = 0; i < ids.length; i += PAR_ENVOI) {
        const bout = await apiPost('/signalements/masse', { ids: ids.slice(i, i + PAR_ENVOI), action }) as ResultatMasse;
        r.signalements.push(...bout.signalements);
        r.prospects.push(...bout.prospects);
        r.supprimes.push(...bout.supprimes);
        r.echecs.push(...bout.echecs);
      }
      onFini(r);
      // Ce qui a réussi se dit ici ; ce qui a été refusé se dit dans la page, qui en connaît
      // les noms. Deux messages pour le même lot, ce serait un de trop.
      const faits = action === 'supprimer' ? r.supprimes.length : r.signalements.length;
      const dit = { creer: 'prospect(s) créé(s)', ignorer: 'ignoré(s)', rouvrir: 'rouvert(s)', supprimer: 'supprimé(s)' }[action];
      if (faits > 0) toast.success(`${faits} ${dit}`);
      else if (r.echecs.length === 0) toast.error("Rien n'a été fait");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setEnCours(null);
    }
  };

  const supprimer = () => {
    const liste = noms.slice(0, NOMS_AFFICHES).map(n => `• ${n}`).join('\n');
    const reste = noms.length > NOMS_AFFICHES ? `\n… et ${noms.length - NOMS_AFFICHES} autre(s)` : '';
    const message = `Supprimer ${combien} ?\n\n${liste}${reste}\n\n`
      + 'La suppression est définitive : ces signalements ne se rouvrent pas. SuiviPro garde seulement leur nom, '
      + 'pour vous prévenir si le même établissement revient un jour dans la boîte.';
    if (window.confirm(message)) lancer('supprimer');
  };

  return (
    <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 px-3 py-2 bg-white border-t border-gray-200 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
      <div className="flex items-center gap-2 flex-wrap max-w-4xl mx-auto">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 flex-shrink-0">
          <CheckSquare className="w-4 h-4 text-brewery-600" />
          {rien ? 'Cochez les fiches à traiter' : combien}
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

        {traites ? (
          <button
            onClick={() => lancer('rouvrir')}
            disabled={rien || enCours !== null}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            {enCours === 'rouvrir' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
            Rouvrir
          </button>
        ) : (
          <>
            {/* Créer en lot prend la fiche telle qu'elle a été déposée : c'est le geste
                « tout est bon, va-y ». Pour retoucher un nom ou une adresse, la création
                une par une ouvre toujours sa fenêtre. */}
            <button
              onClick={() => lancer('creer')}
              disabled={rien || enCours !== null}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-brewery-600 text-white hover:bg-brewery-700 disabled:opacity-40"
            >
              {enCours === 'creer' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
              Créer les prospects
            </button>
            <button
              onClick={() => lancer('ignorer')}
              disabled={rien || enCours !== null}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              {enCours === 'ignorer' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
              Ignorer
            </button>
          </>
        )}

        {/* Supprimer détruit pour de bon : l'administrateur seul, et jamais sans avoir lu les noms. */}
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
