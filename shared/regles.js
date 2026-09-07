// ============================================================================
// Règles métier de SuiviPro — UNE seule définition, utilisée par le serveur ET
// par les écrans. Si une règle change, elle change ici et nulle part ailleurs.
// Les mêmes règles sont écrites en clair dans le Guide (page Guide → « Les règles »).
// ============================================================================

/** Date locale au format AAAA-MM-JJ (jamais d'UTC : une visite à 23 h reste le bon jour). */
export function dateLocale(d = new Date()) {
  const a = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const j = String(d.getDate()).padStart(2, '0');
  return `${a}-${m}-${j}`;
}

/** Ramène une date (chaîne ISO, AAAA-MM-JJ ou Date) à son jour AAAA-MM-JJ. */
export function jourDe(valeur) {
  if (!valeur) return '';
  if (valeur instanceof Date) return dateLocale(valeur);
  return String(valeur).slice(0, 10);
}

/** Heure locale HH:MM. */
export function heureLocale(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ----------------------------------------------------------------------------
// RÈGLE 1 — Client en retard
// Un client est en retard quand sa visite prévue (next_visit) est dépassée d'au
// moins un jour : la date prévue est strictement antérieure à aujourd'hui.
// Un client inactif ou sans visite prévue n'est jamais « en retard ».
// ----------------------------------------------------------------------------

export function estEnRetard(client, aujourdhui = dateLocale()) {
  if (!client || client.statut === 'INACTIF') return false;
  const prevue = jourDe(client.next_visit);
  return prevue !== '' && prevue < aujourdhui;
}

/** Nombre de jours de retard (0 si pas en retard). */
export function joursDeRetard(client, aujourdhui = dateLocale()) {
  if (!estEnRetard(client, aujourdhui)) return 0;
  const prevue = new Date(jourDe(client.next_visit) + 'T12:00:00');
  const ref = new Date(aujourdhui + 'T12:00:00');
  return Math.max(0, Math.round((ref - prevue) / 86400000));
}

/** Statut de visite d'un client, dérivé de la règle 1. */
export function statutVisite(client, aujourdhui = dateLocale()) {
  if (!client || client.statut === 'INACTIF') return 'INACTIF';
  const prevue = jourDe(client.next_visit);
  if (!prevue) return 'SANS_RECURRENCE';
  if (prevue < aujourdhui) return 'RETARD';
  if (prevue === aujourdhui) return 'AUJOURDHUI';
  return 'A_VENIR';
}

// ----------------------------------------------------------------------------
// RÈGLE 2 — Semaine
// La semaine commence le lundi. Le numéro de semaine est le numéro ISO 8601
// (celui des calendriers et d'EasyBeer). « Paire / impaire » se lit sur ce numéro.
// ----------------------------------------------------------------------------

/** Lundi 00:00 de la semaine contenant `date`, décalé de `decalage` semaines. */
export function lundiDeLaSemaine(date = new Date(), decalage = 0) {
  const d = new Date(date);
  const jour = d.getDay() || 7; // dimanche = 7
  d.setDate(d.getDate() - jour + 1 + decalage * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Dimanche 23:59:59 de la semaine contenant `date`. */
export function dimancheDeLaSemaine(date = new Date(), decalage = 0) {
  const d = lundiDeLaSemaine(date, decalage);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Numéro de semaine ISO 8601 : { annee, semaine }. */
export function semaineIso(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const jour = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - jour); // jeudi de la semaine ISO
  const debutAnnee = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const semaine = Math.ceil(((d - debutAnnee) / 86400000 + 1) / 7);
  return { annee: d.getUTCFullYear(), semaine };
}

export function semainePaire(date = new Date()) {
  return semaineIso(date).semaine % 2 === 0;
}

/** Une tournée « every / even / odd » est-elle active la semaine de `date` ? */
export function tourneeActive(motif, date = new Date()) {
  if (motif === 'even') return semainePaire(date);
  if (motif === 'odd') return !semainePaire(date);
  return true;
}

// ----------------------------------------------------------------------------
// RÈGLE 3 — Rendez-vous sans compte rendu
// Un RDV est « passé » dès que son heure de début est atteinte. Un RDV passé,
// non annulé et sans compte rendu est un « RDV sans compte rendu ».
// Avant son heure, c'est un « RDV à venir » : il ne manque rien.
// ----------------------------------------------------------------------------

export function rdvAnnule(rdv) {
  return !rdv || rdv.statut === 'annule';
}

export function rdvPasse(rdv, maintenant = new Date()) {
  if (!rdv) return false;
  const jour = jourDe(rdv.date);
  if (!jour) return false;
  const aujourdhui = dateLocale(maintenant);
  if (jour < aujourdhui) return true;
  if (jour > aujourdhui) return false;
  const debut = (rdv.heure_debut || '').slice(0, 5);
  return debut === '' || debut <= heureLocale(maintenant);
}

export function rdvSansCompteRendu(rdv, maintenant = new Date()) {
  return !rdvAnnule(rdv) && !rdv.compte_rendu && rdvPasse(rdv, maintenant);
}

export function rdvAVenir(rdv, maintenant = new Date()) {
  return !rdvAnnule(rdv) && !rdvPasse(rdv, maintenant);
}

/** Texte des règles, tel qu'affiché dans le Guide. Une seule source, ici. */
export const REGLES = [
  {
    id: 'retard',
    titre: 'Client en retard',
    regle: 'Un client est en retard quand sa visite prévue est dépassée d\'au moins un jour.',
    detail: 'La date de prochaine visite est calculée à partir de la dernière visite et de la fréquence du client. Le jour même de la visite prévue, le client est « à visiter aujourd\'hui », pas en retard. Un client inactif ou sans fréquence n\'est jamais en retard. Le nombre affiché est le même sur l\'accueil, la liste des clients, la semaine et l\'administration.',
  },
  {
    id: 'semaine',
    titre: 'Semaine, paire et impaire',
    regle: 'La semaine commence le lundi et porte son numéro ISO, celui des calendriers.',
    detail: 'Une tournée « semaines paires » se fait quand ce numéro est pair, « semaines impaires » quand il est impair. Toutes les pages utilisent le même calcul : ce qu\'affiche Tournées est ce qu\'affiche la Semaine.',
  },
  {
    id: 'sans-cr',
    titre: 'Rendez-vous sans compte rendu',
    regle: 'Un rendez-vous est sans compte rendu dès que son heure est passée et qu\'aucun compte rendu n\'a été saisi.',
    detail: 'Avant l\'heure du rendez-vous, il est « à venir » : rien ne manque. Un rendez-vous annulé n\'attend pas de compte rendu.',
  },
];
