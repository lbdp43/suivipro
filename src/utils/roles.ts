import { Commercial } from '../types';

// Un rôle, plus une case : une personne peut être commerciale ET faire de la prospection
// (Louis). Le rôle « prospection » seul reste possible pour quelqu'un qui n'a pas de clients.
export function faitDeLaProspection(c: Pick<Commercial, 'role' | 'prospection'> | null | undefined): boolean {
  return !!c && (c.role === 'prospection' || !!c.prospection);
}

/** Tient des clients et des rendez-vous : commercial ou admin. */
export function estCommercial(c: Pick<Commercial, 'role'> | null | undefined): boolean {
  return !!c && c.role !== 'prospection';
}

export function libelleRole(c: Pick<Commercial, 'role' | 'prospection'> | null | undefined): string {
  if (!c) return '';
  if (c.role === 'admin') return c.prospection ? 'Administrateur · prospection' : 'Administrateur';
  if (c.role === 'prospection') return 'Prospection';
  return c.prospection ? 'Commercial · prospection' : 'Commercial';
}
