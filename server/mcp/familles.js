// Les familles d'outils du MCP, telles que l'administration les ouvre ou les coupe à chacun
// (Administration → Accès IA). Une famille regroupe des outils qui vont ensemble : couper
// « Lire les clients » retire la recherche, la fiche, les retards et l'historique.
//
// Ce qu'on garde en base, c'est la liste des familles COUPÉES (commerciaux.ia_refus) :
// tout est ouvert par défaut, et une famille ajoutée plus tard le sera aussi.
// « contexte » (les règles de la maison) n'appartient à aucune famille : toujours là.

export const FAMILLES = [
  { cle: 'lire_clients', libelle: 'Lire les clients', description: 'Chercher un client, voir sa fiche, ses retards de visite et son historique.', ecrit: false,
    outils: ['chercher_client', 'fiche_client', 'clients_en_retard', 'visites_et_appels'] },
  { cle: 'lire_prospects', libelle: 'Lire les prospects et le pipeline', description: 'Chercher un prospect, voir sa fiche, le pipeline, ceux qui stagnent, la boîte de prospection, les secteurs.', ecrit: false,
    outils: ['chercher_prospect', 'fiche_prospect', 'pipeline', 'prospects_qui_stagnent', 'boite_prospection', 'secteurs_et_zones'] },
  { cle: 'agenda', libelle: 'Agenda et activité', description: 'Rendez-vous, activité de l\'équipe, comptes rendus à faire, actions à mener.', ecrit: false,
    outils: ['rendez_vous', 'activite', 'comptes_rendus_a_faire', 'mes_actions'] },
  { cle: 'mails', libelle: 'Préparer des mails', description: 'Rédiger un mail pour un prospect ou un client (rien n\'est envoyé).', ecrit: false,
    outils: ['proposer_mail'] },
  { cle: 'noter_visites', libelle: 'Noter des visites et des appels', description: 'Noter une visite ou un appel chez un client, ou toute une tournée.', ecrit: true,
    outils: ['noter_visite_ou_appel', 'noter_visites_en_serie'] },
  { cle: 'comptes_rendus', libelle: 'Comptes rendus et actions', description: 'Écrire le compte rendu d\'un rendez-vous, terminer une action ou une tâche.', ecrit: true,
    outils: ['ecrire_compte_rendu', 'terminer_action', 'terminer_tache'] },
  { cle: 'modifier_clients', libelle: 'Modifier les fiches clients', description: 'Activer ou désactiver un client, régler le rythme des visites.', ecrit: true,
    outils: ['activer_ou_desactiver_client', 'regler_recurrence'] },
  { cle: 'etapes_prospects', libelle: 'Changer l\'étape des prospects', description: 'Déplacer des prospects dans le tunnel, les écarter (perdu, ne pas contacter).', ecrit: true,
    outils: ['changer_etape_prospect'] },
  { cle: 'deposer', libelle: 'Déposer dans la boîte de prospection', description: 'Ranger un établissement trouvé dans la boîte, à qualifier par l\'équipe.', ecrit: true,
    outils: ['deposer_dans_la_boite'] },
];

const CLES = new Set(FAMILLES.map(f => f.cle));

/** La liste des familles coupées, à partir de ce que la base garde (texte JSON ou tableau). */
export function lireRefus(brut) {
  let l = brut;
  if (typeof brut === 'string') { try { l = JSON.parse(brut || '[]'); } catch { l = []; } }
  return Array.isArray(l) ? l.filter(c => CLES.has(c)) : [];
}

export function famillesCoupees(brut) {
  const refus = new Set(lireRefus(brut));
  return FAMILLES.filter(f => refus.has(f.cle));
}

/** Les noms d'outils retirés par les familles coupées. */
export function outilsCoupes(brut) {
  return new Set(famillesCoupees(brut).flatMap(f => f.outils));
}
