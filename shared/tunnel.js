// Le pipeline comme tunnel de vente : LES règles, au même endroit pour le serveur et l'écran.
//
// Un prospect avance d'étape en étape jusqu'à « Gagné » ou « Perdu ». Chaque prospect dans une
// étape active porte une PROCHAINE ACTION (un rappel typé : appeler, relancer par mail,
// attendre une réponse, ou autre). Quand on la termine, on dit ce qui s'est passé, et la
// réponse déplace l'étape et propose l'action suivante.

export const ETAPES_TERMINALES = ['client_gagne', 'perdu', 'ne_pas_contacter'];
/** Étapes d'entrée : le prospect n'a encore jamais été joint. */
export const ETAPES_ENTREE = ['partage', 'nouveau_datagouv', 'nouveau', 'a_contacter'];

export function estTerminale(etape) {
  return ETAPES_TERMINALES.includes(etape);
}

export const TYPES_ACTION = {
  appeler: 'Appeler',
  relancer_mail: 'Relancer par mail',
  attendre_reponse: 'Attendre une réponse',
  autre: 'À faire',
};

export const RAISONS_PERTE = {
  pas_interesse: 'Pas intéressé',
  deja_fournisseur: 'Déjà fournisseur',
  trop_cher: 'Trop cher',
  ferme: 'Fermé ou cessé',
  injoignable: 'Injoignable',
  autre: 'Autre',
};

/**
 * Les réponses possibles à « que s'est-il passé ? » quand on termine une action.
 * (« Appeler » n'a pas de liste : terminer, c'est passer l'appel, et l'appel enregistré fait le reste.)
 */
export function issuesPourAction(type) {
  switch (type) {
    case 'relancer_mail':
      return [
        { value: 'mail_envoye', label: 'Mail envoyé', effet: 'Négociation, puis on attend la réponse 7 jours.' },
        { value: 'pas_envoye', label: 'Pas encore envoyé', effet: 'On reporte de 2 jours.' },
        { value: 'pas_interesse', label: 'Pas intéressé', effet: 'Le prospect passe en « Perdu ».' },
      ];
    case 'attendre_reponse':
      return [
        { value: 'reponse_positive', label: 'Réponse positive', effet: 'Proposition, puis un appel dans 3 jours pour concrétiser.' },
        { value: 'pas_de_reponse', label: 'Pas de réponse', effet: 'Une relance par mail dans 5 jours.' },
        { value: 'reponse_negative', label: 'Réponse négative', effet: 'Le prospect passe en « Perdu ».' },
      ];
    default:
      return [
        { value: 'fait', label: 'C\'est fait', effet: 'L\'action est close, le prospect ne bouge pas.' },
        { value: 'pas_interesse', label: 'Pas intéressé', effet: 'Le prospect passe en « Perdu ».' },
      ];
  }
}

export function issueEstUnePerte(issue) {
  return issue === 'pas_interesse' || issue === 'reponse_negative';
}

/**
 * Ce que produit une réponse : la nouvelle étape (ou null si le prospect ne bouge pas),
 * la prochaine action à créer (ou null), et si c'est une perte (raison obligatoire).
 */
export function appliquerIssue(type, issue, etapeActuelle) {
  const perdu = issueEstUnePerte(issue);
  if (perdu) return { etape: 'perdu', prochaine: null, perdu: true };
  const terminale = estTerminale(etapeActuelle);
  if (type === 'relancer_mail') {
    if (issue === 'mail_envoye') {
      return { etape: terminale || etapeActuelle === 'negociation' ? null : 'negociation', prochaine: { type: 'attendre_reponse', delaiJours: 7, message: 'Réponse au mail attendue' }, perdu: false };
    }
    return { etape: null, prochaine: { type: 'relancer_mail', delaiJours: 2, message: 'Relancer par mail' }, perdu: false };
  }
  if (type === 'attendre_reponse') {
    if (issue === 'reponse_positive') {
      return { etape: terminale || ['proposition', 'gagne'].includes(etapeActuelle) ? null : 'proposition', prochaine: { type: 'appeler', delaiJours: 3, message: 'Concrétiser : proposer un rendez-vous' }, perdu: false };
    }
    return { etape: null, prochaine: { type: 'relancer_mail', delaiJours: 5, message: 'Relancer par mail (sans réponse)' }, perdu: false };
  }
  return { etape: null, prochaine: null, perdu: false };
}

/** Étape après un appel enregistré, ou null s'il ne bouge pas. */
export function etapeApresAppel({ issueNegative, rdvPris, memo }, etapeActuelle) {
  if (issueNegative === 'pas_interesse') return 'perdu';
  if (issueNegative === 'ne_pas_contacter') return 'ne_pas_contacter';
  if (rdvPris && !['gagne', ...ETAPES_TERMINALES].includes(etapeActuelle)) return 'gagne';
  if (memo && ETAPES_ENTREE.includes(etapeActuelle)) return 'contacte';
  return null;
}

/** Étape après un compte rendu de rendez-vous, ou null s'il ne bouge pas. */
export function etapeApresCompteRendu(resultat, etapeActuelle) {
  if (resultat === 'client') return 'client_gagne';
  if (resultat === 'pas_interesse') return 'perdu';
  if (estTerminale(etapeActuelle)) return null;
  if (resultat === 'mail_envoye') return 'negociation';
  if (resultat === 'commande_plus_tard' || resultat === 'a_relancer') return 'proposition';
  return null;
}

/** Type de la prochaine action après un compte rendu, pour le rappel qu'il crée. */
export function typeActionApresCompteRendu(resultat) {
  return resultat === 'mail_envoye' ? 'attendre_reponse' : 'appeler';
}

/** Étape après un mail envoyé depuis un modèle, ou null. */
export function etapeApresMail(etapeActuelle) {
  return estTerminale(etapeActuelle) || ['gagne', 'negociation'].includes(etapeActuelle) ? null : 'negociation';
}

/** Étape après un rendez-vous pris, ou null. */
export function etapeApresRdvCree(etapeActuelle) {
  return estTerminale(etapeActuelle) || etapeActuelle === 'gagne' ? null : 'gagne';
}

/** Nombre de jours entre deux dates ISO (jour local ou horodatage), arrondi vers le bas. */
function joursEntre(a, b) {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

/**
 * La prochaine action d'un prospect : le rappel actif le plus proche, ou le prochain
 * rendez-vous à venir. `aujourdhui` au format AAAA-MM-JJ.
 */
export function prochaineActionDe(prospect, rappels, rendezVous, aujourdhui) {
  const actifs = rappels.filter(r => r.prospect_id === prospect.id && r.statut === 'actif').sort((a, b) => a.date.localeCompare(b.date) || (a.heure || '').localeCompare(b.heure || ''));
  const rdv = rendezVous.filter(a => a.prospect_id === prospect.id && a.statut !== 'annule' && a.statut !== 'termine' && a.date >= aujourdhui).sort((a, b) => a.date.localeCompare(b.date))[0];
  const rappel = actifs[0];
  if (rdv && (!rappel || rdv.date < rappel.date)) {
    return { genre: 'rdv', type: 'rdv', date: rdv.date, heure: rdv.heure_debut || '', libelle: 'Rendez-vous', enRetard: false, rappel: null, rdv };
  }
  if (rappel) {
    const type = rappel.type || 'appeler';
    return { genre: 'rappel', type, date: rappel.date, heure: rappel.heure || '', libelle: TYPES_ACTION[type] || 'À faire', enRetard: rappel.date < aujourdhui, rappel, rdv: null };
  }
  return null;
}

/** La dernière chose qui s'est passée avec ce prospect (appel, mail, rendez-vous passé). */
export function derniereActiviteDe(prospect, appels, rendezVous, aujourdhui) {
  const evenements = [];
  for (const c of appels) {
    if (c.prospect_id !== prospect.id) continue;
    evenements.push({ genre: c.resultat === 'email_envoye' ? 'mail' : 'appel', date: c.date, resultat: c.resultat, commercial_id: c.commercial_id });
  }
  for (const a of rendezVous) {
    if (a.prospect_id !== prospect.id || a.statut === 'annule' || a.date > aujourdhui) continue;
    evenements.push({ genre: 'rdv', date: `${a.date}T${a.heure_debut || '00:00'}`, resultat: a.compte_rendu || '', commercial_id: a.commercial_id });
  }
  evenements.sort((a, b) => b.date.localeCompare(a.date));
  return evenements[0] || null;
}

/** Jours passés dans l'étape courante (depuis date_etape, sinon depuis la modification). */
export function joursDansEtape(prospect, maintenant = new Date()) {
  const depuis = prospect.date_etape || prospect.date_modification || prospect.date_creation;
  if (!depuis) return 0;
  return Math.max(0, joursEntre(depuis, maintenant.toISOString()));
}

/** Jours sans activité (appel, mail, rendez-vous passé) ; null si jamais rien. */
export function joursSansActivite(derniere, maintenant = new Date()) {
  if (!derniere) return null;
  return Math.max(0, joursEntre(derniere.date, maintenant.toISOString()));
}

export const SEUIL_STAGNATION_JOURS = 14;
