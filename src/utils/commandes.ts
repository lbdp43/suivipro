import { Commande } from '../types';
import { jourDe } from '../../shared/regles';

// « Ce client décroche » : il commandait, et n'a plus commandé depuis un moment.
// Seuil unique pour toute l'application.
export const JOURS_DECROCHE = 90;

export function derniereCommande(commandes: Commande[]): string | null {
  let d: string | null = null;
  for (const c of commandes) {
    if (c.statut === 'annulee') continue;
    const j = jourDe(c.date_commande);
    if (j && (!d || j > d)) d = j;
  }
  return d;
}

export function joursDepuis(jour: string | null, aujourdhui = new Date()): number | null {
  if (!jour) return null;
  const d = new Date(jour + 'T12:00:00');
  if (isNaN(d.getTime())) return null;
  const ref = new Date(aujourdhui); ref.setHours(12, 0, 0, 0);
  return Math.max(0, Math.round((ref.getTime() - d.getTime()) / 86400000));
}

export interface Decroche { derniere: string; jours: number; libelle: string }

/** null si le client ne décroche pas (jamais commandé, ou commande récente). */
export function decrocheDuClient(commandes: Commande[], aujourdhui = new Date()): Decroche | null {
  const derniere = derniereCommande(commandes);
  const jours = joursDepuis(derniere, aujourdhui);
  if (!derniere || jours === null || jours < JOURS_DECROCHE) return null;
  const mois = Math.floor(jours / 30);
  const libelle = mois >= 24 ? `sans commande depuis ${Math.floor(mois / 12)} ans` : mois >= 2 ? `sans commande depuis ${mois} mois` : `sans commande depuis ${jours} jours`;
  return { derniere, jours, libelle };
}
