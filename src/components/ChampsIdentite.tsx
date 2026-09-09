// L'identité légale d'un établissement : raison sociale, SIREN, SIRET, numéro de TVA.
//
// Un seul jeu de champs, partagé par la fiche prospect, la fiche client et la fenêtre de
// création depuis la boîte de prospection — trois formulaires séparés auraient fini par
// diverger sur la mise en forme comme sur les contrôles.
//
// Deux commodités qui évitent des erreurs de saisie plutôt que de les signaler après coup :
// le SIREN se remplit tout seul depuis le SIRET (ce sont ses neuf premiers chiffres), et le
// numéro de TVA se calcule depuis le SIREN. On ne garde le numéro saisi que s'il diffère du
// calcul — le cas d'une société étrangère, dont le numéro ne se déduit d'aucun SIREN.
import { Landmark } from 'lucide-react';
import { chiffres, sirenValide, siretValide, sirenDeSiret, tvaIntracom } from '../../shared/siret';

export interface Identite {
  raison_sociale?: string;
  siren?: string;
  siret?: string;
  tva_intracom?: string;
}

interface Props {
  valeurs: Identite;
  onChange: (maj: Identite) => void;
  /** Compact : deux colonnes au lieu de quatre lignes, pour une fenêtre étroite. */
  compact?: boolean;
}

const CHAMP = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm';
const LABEL = 'block text-xs font-medium text-gray-600 mb-1';

/** Ce qui cloche dans un numéro, dit sans empêcher d'enregistrer. */
function alerte(valeur: string | undefined, valide: (v: string) => boolean, longueur: number): string {
  const n = chiffres(valeur);
  if (!n) return '';
  if (n.length !== longueur) return `${n.length} chiffre${n.length > 1 ? 's' : ''} sur ${longueur}`;
  return valide(n) ? '' : 'clé de contrôle incorrecte';
}

export default function ChampsIdentite({ valeurs, onChange, compact = false }: Props) {
  const siren = chiffres(valeurs.siren);
  const calcule = tvaIntracom(siren || chiffres(valeurs.siret));
  const alerteSiren = alerte(valeurs.siren, sirenValide, 9);
  const alerteSiret = alerte(valeurs.siret, siretValide, 14);

  // Saisir le SIRET renseigne le SIREN : ce sont ses neuf premiers chiffres, les retaper
  // n'ajoute qu'une occasion de se tromper.
  const majSiret = (v: string) => {
    const deduit = sirenDeSiret(v);
    onChange({ siret: v, ...(deduit ? { siren: deduit } : {}) });
  };

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
        <Landmark className="w-3.5 h-3.5 text-gray-400" /> Identité légale
        <span className="font-normal text-gray-400">— facultatif</span>
      </p>

      <div>
        <label className={LABEL}>Raison sociale</label>
        <input
          className={CHAMP}
          value={valeurs.raison_sociale || ''}
          onChange={e => onChange({ raison_sociale: e.target.value })}
          placeholder="Le nom légal, s'il diffère de l'enseigne"
        />
      </div>

      <div className={compact ? 'space-y-3' : 'grid grid-cols-2 gap-3'}>
        <div>
          <label className={LABEL}>SIRET <span className="font-normal text-gray-400">14 chiffres</span></label>
          <input
            className={CHAMP}
            inputMode="numeric"
            value={valeurs.siret || ''}
            onChange={e => majSiret(e.target.value)}
            placeholder="Établissement"
          />
          {alerteSiret && <p className="text-[11px] text-amber-600 mt-0.5">{alerteSiret}</p>}
        </div>
        <div>
          <label className={LABEL}>SIREN <span className="font-normal text-gray-400">9 chiffres</span></label>
          <input
            className={CHAMP}
            inputMode="numeric"
            value={valeurs.siren || ''}
            onChange={e => onChange({ siren: e.target.value })}
            placeholder="Entreprise"
          />
          {alerteSiren && <p className="text-[11px] text-amber-600 mt-0.5">{alerteSiren}</p>}
        </div>
      </div>

      <div>
        <label className={LABEL}>
          TVA intracommunautaire
          {calcule && <span className="font-normal text-gray-400"> — calculé depuis le SIREN</span>}
        </label>
        <input
          className={CHAMP}
          value={valeurs.tva_intracom || calcule}
          onChange={e => {
            // On ne garde la saisie que si elle diffère du calcul : sinon le champ reste
            // vide en base et suit le SIREN, y compris si le SIREN change plus tard.
            const saisi = e.target.value.trim();
            onChange({ tva_intracom: saisi && saisi !== calcule ? saisi : '' });
          }}
          placeholder={calcule || 'Renseignez le SIREN, ou saisissez un numéro étranger'}
        />
      </div>
    </div>
  );
}
