import { AppState, Commercial, Objectifs } from '../types';
import { jourDe, rdvAnnule, rdvSansCompteRendu } from '../../shared/regles';

// ============================================================================
// Objectifs mensuels par rôle, et leur mesure à partir de l'état de l'application.
// Un prospecteur appelle et prend des rendez-vous ; un commercial tient les rendez-vous,
// voit ses clients et fait rentrer des commandes. Chacun a donc ses propres jauges.
// ============================================================================

export interface DefinitionObjectif {
  cle: keyof Objectifs;
  label: string;
  aide: string;
  defaut: number;
}

export const OBJECTIFS_PROSPECTION: DefinitionObjectif[] = [
  { cle: 'appels_mois', label: 'Appels', aide: 'Appels passés ce mois', defaut: 200 },
  { cle: 'rdv_pris_mois', label: 'RDV pris', aide: 'Rendez-vous pris ce mois pour les commerciaux', defaut: 20 },
];

export const OBJECTIFS_COMMERCIAL: DefinitionObjectif[] = [
  { cle: 'rdv_realises_mois', label: 'RDV réalisés', aide: 'Rendez-vous tenus ce mois (compte rendu saisi ou RDV terminé)', defaut: 15 },
  { cle: 'clients_vus_mois', label: 'Clients vus', aide: 'Clients différents visités ce mois', defaut: 40 },
  { cle: 'commandes_mois', label: 'Commandes', aide: 'Commandes de mes clients ce mois (hors annulées)', defaut: 30 },
];

export function objectifsDuRole(role: string | undefined): DefinitionObjectif[] {
  return role === 'prospection' ? OBJECTIFS_PROSPECTION : OBJECTIFS_COMMERCIAL;
}

export interface MesureObjectif extends DefinitionObjectif {
  valeur: number;
  objectif: number;
  /** Part de l'objectif atteinte, en % (0–100+). */
  pct: number;
  /** Ce qu'on devrait avoir atteint à cette date du mois, pour rester dans le rythme. */
  attendu: number;
  etat: 'atteint' | 'dans_le_rythme' | 'en_retard' | 'sans_objectif';
}

function debutDuMois(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function dansLeMois(valeur: string | null | undefined, debut: string, finExclue: string): boolean {
  const j = jourDe(valeur);
  return j !== '' && j >= debut && j < finExclue;
}

/** Valeurs brutes du mois pour une personne, quelle que soit sa fiche d'objectifs. */
export function mesurerLeMois(state: AppState, personne: Commercial, maintenant = new Date()) {
  const debut = debutDuMois(maintenant);
  const finExclue = debutDuMois(new Date(maintenant.getFullYear(), maintenant.getMonth() + 1, 1));
  const id = personne.id;

  const appels = state.calls.filter(c => c.commercial_id === id && dansLeMois(c.date, debut, finExclue)).length;
  const rdvPris = state.appointments.filter(a => a.prospecteur_id === id && dansLeMois(a.created_at, debut, finExclue)).length;
  const rdvRealises = state.appointments.filter(a =>
    a.commercial_id === id && !rdvAnnule(a) && dansLeMois(a.date, debut, finExclue) && (a.statut === 'termine' || !!a.compte_rendu)
  ).length;
  const clientsVus = new Set(
    state.interactions.filter(i => i.commercial_id === id && i.type === 'VISITE' && dansLeMois(i.date, debut, finExclue)).map(i => i.client_id)
  ).size;
  const mesClients = new Set(state.clients.filter(c => c.commercial_id === id).map(c => c.id));
  const commandes = state.commandes.filter(c =>
    c.client_id && mesClients.has(c.client_id) && c.statut !== 'annulee' && dansLeMois(c.date_commande, debut, finExclue)
  ).length;
  const rdvSansCr = state.appointments.filter(a => a.commercial_id === id && rdvSansCompteRendu(a, maintenant)).length;

  return { appels_mois: appels, rdv_pris_mois: rdvPris, rdv_realises_mois: rdvRealises, clients_vus_mois: clientsVus, commandes_mois: commandes, rdvSansCr };
}

/** Les jauges d'une personne : valeur, objectif, avancement, et si elle est dans le rythme. */
export function mesurerObjectifs(state: AppState, personne: Commercial, maintenant = new Date()): MesureObjectif[] {
  const mois = mesurerLeMois(state, personne, maintenant);
  const joursDuMois = new Date(maintenant.getFullYear(), maintenant.getMonth() + 1, 0).getDate();
  const avancementDuMois = maintenant.getDate() / joursDuMois;
  return objectifsDuRole(personne.role).map(def => {
    const valeur = mois[def.cle as keyof typeof mois] ?? 0;
    const objectif = Number(personne.objectifs?.[def.cle] ?? 0);
    const attendu = Math.round(objectif * avancementDuMois);
    const pct = objectif > 0 ? Math.round((valeur / objectif) * 100) : 0;
    let etat: MesureObjectif['etat'] = 'sans_objectif';
    if (objectif > 0) {
      if (valeur >= objectif) etat = 'atteint';
      else if (valeur >= attendu * 0.8) etat = 'dans_le_rythme';
      else etat = 'en_retard';
    }
    return { ...def, valeur, objectif, pct, attendu, etat };
  });
}

export const COULEUR_ETAT: Record<MesureObjectif['etat'], { barre: string; texte: string; label: string }> = {
  atteint: { barre: 'bg-green-500', texte: 'text-green-700', label: 'Atteint' },
  dans_le_rythme: { barre: 'bg-brewery-500', texte: 'text-brewery-700', label: 'Dans le rythme' },
  en_retard: { barre: 'bg-amber-500', texte: 'text-amber-700', label: 'À rattraper' },
  sans_objectif: { barre: 'bg-gray-300', texte: 'text-gray-500', label: 'Pas d\'objectif fixé' },
};

/** Objectif d'appels d'une personne, en mensuel (sa fiche) ou ramené à la semaine. */
export function objectifAppels(personne: Commercial, periode: 'semaine' | 'mois'): number {
  const mois = Number(personne.objectifs?.appels_mois ?? (personne.objectifs?.appels_semaine ?? 0) * 4);
  return periode === 'mois' ? mois : Math.round(mois / 4);
}

/** Objectifs proposés à la création d'une fiche, selon le rôle. */
export function objectifsParDefaut(role: string | undefined): Objectifs {
  const o: Objectifs = {};
  for (const def of objectifsDuRole(role)) o[def.cle] = def.defaut;
  return o;
}
