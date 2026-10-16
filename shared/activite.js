// ============================================================================
// Ce qu'on compte — UNE seule définition pour les écrans, le serveur et l'IA.
//
// Avant, « RDV pris » se calculait de quatre façons (15, 0, 0 ou 2 pour la même personne
// le même mois), un mail comptait comme un appel ici et pas là, « visite » voulait dire
// trois choses. Les règles sont écrites ici en JavaScript pour les écrans, et en SQL
// (mêmes noms, mêmes conditions) pour les requêtes du serveur et de l'IA.
// ============================================================================
import { jourDe, rdvAnnule } from './regles.js';

// ----------------------------------------------------------------------------
// APPELS. Un appel, c'est un appel : les mails envoyés depuis l'écran d'appel
// (resultat « email_envoye ») se comptent à part. Côté clients, seules les
// interactions de type APPEL sont des appels (une visite est une visite, un
// rendez-vous planifié n'est ni l'un ni l'autre).
// Un appel « abouti » : quelqu'un a décroché (« repondu » côté prospects ;
// côté clients, l'appel a compté comme une visite).
// ----------------------------------------------------------------------------
export const RESULTAT_MAIL = 'email_envoye';

export function estMail(appel) {
  return !!appel && appel.resultat === RESULTAT_MAIL;
}

export function estAppel(appel) {
  return !!appel && !estMail(appel);
}

export function appelAbouti(appel) {
  return !!appel && appel.resultat === 'repondu';
}

export function interactionEstAppel(i) {
  return !!i && i.type === 'APPEL';
}

export function interactionAppelAbouti(i) {
  return interactionEstAppel(i) && i.compte_visite === true;
}

/** SQL : la condition « c'est un appel » sur la table calls. */
export const SQL_APPEL = `resultat <> '${RESULTAT_MAIL}'`;
export const SQL_MAIL = `resultat = '${RESULTAT_MAIL}'`;
export const SQL_APPEL_ABOUTI = `resultat = 'repondu'`;

// ----------------------------------------------------------------------------
// VISITES. Une visite, c'est une interaction qui a compté comme telle
// (compte_visite) : une visite sur place, ou un appel abouti chez un client.
// Une interaction ancienne sans le drapeau compte si c'est une VISITE.
// ----------------------------------------------------------------------------
export function compteCommeVisite(i) {
  if (!i) return false;
  if (i.compte_visite === true) return true;
  if (i.compte_visite === false) return false;
  return i.type === 'VISITE';
}

export const SQL_VISITE = `(compte_visite = TRUE OR (compte_visite IS NULL AND type = 'VISITE'))`;

// ----------------------------------------------------------------------------
// RDV PRIS. Un rendez-vous pris en prospection : chez un prospect, avec une
// date de prise (created_at), non annulé. Il est porté par le prospecteur qui
// l'a pris, sinon par le commercial du rendez-vous. Il se date du jour de sa
// prise, pas du jour du rendez-vous.
// ----------------------------------------------------------------------------
export function estRdvPris(rdv) {
  return !!rdv && !!rdv.prospect_id && !!rdv.created_at && !rdvAnnule(rdv);
}

export function quiAPrisLeRdv(rdv) {
  return (rdv && (rdv.prospecteur_id || rdv.commercial_id)) || '';
}

export function jourDePriseDuRdv(rdv) {
  return rdv ? jourDe(rdv.created_at) : '';
}

export const SQL_RDV_PRIS = `(prospect_id IS NOT NULL AND prospect_id <> '' AND NULLIF(created_at, '') IS NOT NULL AND statut <> 'annule')`;
export const SQL_QUI_A_PRIS = `COALESCE(NULLIF(prospecteur_id, ''), commercial_id)`;

// ----------------------------------------------------------------------------
// RDV RÉALISÉS. Un rendez-vous a eu lieu quand il n'est pas annulé et qu'il est
// marqué terminé ou qu'il a un compte rendu. Un rendez-vous terminé sans compte
// rendu est réalisé ET attend encore son compte rendu (voir rdvSansCompteRendu).
// Il se compte au jour du rendez-vous, pour la personne qui l'a tenu (commercial_id).
// ----------------------------------------------------------------------------
export function rdvRealise(rdv) {
  return !!rdv && !rdvAnnule(rdv) && (rdv.statut === 'termine' || !!rdv.compte_rendu);
}

export const SQL_RDV_REALISE = `(statut <> 'annule' AND (statut = 'termine' OR COALESCE(compte_rendu, '') <> ''))`;

// ----------------------------------------------------------------------------
// CHIFFRE D'AFFAIRES. Toujours hors taxes, et sans les commandes annulées.
// ----------------------------------------------------------------------------
export function commandeComptee(c) {
  return !!c && c.statut !== 'annulee' && !!c.date_commande;
}

export function montantCA(c) {
  return commandeComptee(c) ? Number(c.montant_ht) || 0 : 0;
}
