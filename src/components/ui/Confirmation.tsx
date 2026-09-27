// La confirmation de SuiviPro, à la place du confirm() du navigateur : même usage
// (`if (!(await confirmer('Supprimer ce RDV ?'))) return;`), mais une vraie fenêtre de
// l'appli — lisible sur téléphone, au pouce, avec un bouton rouge quand l'action efface.
//
// Le texte peut garder ses retours à la ligne ; la première phrase devient le titre, le
// reste l'explication. Le bouton reprend le verbe de la question (« Supprimer », « Vider »…).
import { useEffect, useState } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import Fenetre from './Fenetre';
import Bouton from './Bouton';

export interface OptionsConfirmation {
  titre?: string;
  /** Libellé du bouton de confirmation ; sinon déduit de la question. */
  bouton?: string;
  /** Action sans retour (suppression…) : bouton rouge. Déduit du verbe si absent. */
  danger?: boolean;
}

interface Demande extends OptionsConfirmation {
  message: string;
  repondre: (oui: boolean) => void;
}

let afficher: ((d: Demande) => void) | null = null;

const VERBES_DANGER = ['supprimer', 'retirer', 'vider', 'révoquer', 'revoquer', 'délier', 'delier', 'déconnecter', 'deconnecter', 'défaire', 'defaire', 'effacer', 'remplacer'];
const VERBES = [...VERBES_DANGER, 'fusionner', 'passer', 'importer', 'importer', 'valider', 'envoyer', 'archiver', 'restaurer'];

function premierMot(message: string): string {
  return (message.trim().split(/[\s«"']/)[0] || '').toLowerCase();
}

/** Pose la question ; résout `true` si la personne confirme, `false` sinon. */
export function confirmer(message: string, options: OptionsConfirmation = {}): Promise<boolean> {
  return new Promise(resolve => {
    if (!afficher) { resolve(window.confirm(message)); return; } // avant le montage : secours
    afficher({ ...options, message, repondre: resolve });
  });
}

function decouper(message: string, titre?: string): { titre: string; detail: string } {
  if (titre) return { titre, detail: message };
  const texte = message.trim();
  const coupe = texte.search(/\n|(?<=[?.!])\s/);
  if (coupe === -1 || coupe > 160) return { titre: texte, detail: '' };
  return { titre: texte.slice(0, coupe).trim(), detail: texte.slice(coupe).trim() };
}

export function HoteConfirmation() {
  const [demande, setDemande] = useState<Demande | null>(null);
  useEffect(() => {
    afficher = setDemande;
    return () => { afficher = null; };
  }, []);

  if (!demande) return null;
  const mot = premierMot(demande.message);
  const danger = demande.danger ?? VERBES_DANGER.includes(mot);
  const libelle = demande.bouton ?? (VERBES.includes(mot) ? mot[0].toUpperCase() + mot.slice(1) : 'Confirmer');
  const { titre, detail } = decouper(demande.message, demande.titre);
  const repondre = (oui: boolean) => { demande.repondre(oui); setDemande(null); };

  return (
    <Fenetre
      ouvert
      auPremierPlan
      onFermer={() => repondre(false)}
      titre={titre}
      icone={danger ? <AlertTriangle className="h-5 w-5 text-danger" /> : <HelpCircle className="h-5 w-5" />}
      pied={(
        <>
          <Bouton variante="secondaire" onClick={() => repondre(false)}>Annuler</Bouton>
          <Bouton variante={danger ? 'danger' : 'principal'} onClick={() => repondre(true)} autoFocus>{libelle}</Bouton>
        </>
      )}
    >
      {detail ? <p className="whitespace-pre-line text-sm text-encre-douce">{detail}</p> : null}
    </Fenetre>
  );
}
