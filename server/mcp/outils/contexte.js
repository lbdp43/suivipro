// L'outil qui rend les onze autres compréhensibles : les règles de la maison, écrites une
// seule fois dans shared/ et lues ici. Il ne touche à aucune donnée.
import { z } from 'zod';
import { REGLES } from '../../../shared/regles.js';
import {
  LIBELLES_TYPE_CLIENT, FREQUENCES_VISITE, LIBELLES_ETAPE, LIBELLES_RESULTAT_APPEL,
  LIBELLES_STATUT_VISITE, LIBELLES_ROLE,
} from '../../../shared/libelles.js';
import { RAISONS_PERTE, TYPES_ACTION, SEUIL_STAGNATION_JOURS, issuesPourAction } from '../../../shared/tunnel.js';
import { SCORE_DE_BASE } from '../../../shared/score.js';
import { bloc } from '../format.js';

const COULEURS = [
  ['Rouge', LIBELLES_STATUT_VISITE.RETARD, 'la visite prévue est strictement antérieure à aujourd\'hui'],
  ['Orange', LIBELLES_STATUT_VISITE.AUJOURDHUI, 'la visite prévue tombe le jour même — ce n\'est pas un retard'],
  ['Vert', LIBELLES_STATUT_VISITE.A_VENIR, 'la visite prévue est dans le futur'],
  ['Gris', `${LIBELLES_STATUT_VISITE.SANS_RECURRENCE} ou ${LIBELLES_STATUT_VISITE.INACTIF.toLowerCase()}`, 'aucune fréquence, ou client inactif : jamais en retard'],
];

function frequences() {
  const vues = new Map();
  for (const [code, jours] of Object.entries(FREQUENCES_VISITE)) {
    const cle = `${jours}`;
    const nom = LIBELLES_TYPE_CLIENT[code] || code;
    if (!vues.has(cle)) vues.set(cle, { jours, types: [] });
    vues.get(cle).types.push(nom);
  }
  return [...vues.values()]
    .sort((a, b) => (a.jours ?? 9999) - (b.jours ?? 9999))
    .map(f => `- ${f.jours ? `tous les ${f.jours} jours` : 'aucune récurrence'} : ${f.types.join(', ')}`)
    .join('\n');
}

function tunnel() {
  return Object.entries(LIBELLES_ETAPE).map(([code, nom]) => `- ${nom} (${code})`).join('\n');
}

function appels() {
  const suites = ['relancer_mail', 'attendre_reponse'].flatMap(type =>
    issuesPourAction(type).map(i => `- ${TYPES_ACTION[type]} → « ${i.label} » : ${i.effet}`)
  );
  return bloc(
    `Résultats d'un appel de prospection : ${Object.values(LIBELLES_RESULTAT_APPEL).join(', ')}.`,
    `Issues d'un appel client : Commande passée ou à venir, Intéressé à relancer (relance à 7 jours), Appel de courtoisie, Problème ou mécontentement (suivi à 2 jours), Pas de réponse (rappel à 2 jours), À rappeler plus tard (rappel à 7 jours).`,
    '',
    'Ce qu\'une action terminée déclenche :',
    suites.join('\n'),
  );
}

function regles() {
  return REGLES.map(r => `**${r.titre}** — ${r.regle}\n${r.detail}`).join('\n\n');
}

const SUJETS = {
  frequences: () => bloc('# Fréquences de visite par type de client', frequences()),
  couleurs: () => bloc('# Les quatre couleurs d\'un client', COULEURS.map(([c, e, r]) => `- ${c} — ${e} : ${r}`).join('\n')),
  tunnel: () => bloc(
    '# Les étapes du tunnel de vente', tunnel(), '',
    `Un prospect stagne au-delà de ${SEUIL_STAGNATION_JOURS} jours sans activité.`,
    `Raisons de perte : ${Object.values(RAISONS_PERTE).join(', ')}.`,
    `Types d'action : ${Object.values(TYPES_ACTION).join(', ')}.`,
    `Score : il part de ${SCORE_DE_BASE} et bouge selon les points des étiquettes, borné entre 0 et 100.`,
  ),
  appels: () => bloc('# Appels et relances', appels()),
  tournees: () => bloc('# Semaines et tournées', regles()),
  roles: () => bloc(
    '# Les rôles',
    `- ${LIBELLES_ROLE.admin} : voit toute l'équipe, clients comme prospects.`,
    `- ${LIBELLES_ROLE.commercial} : ses clients et ses prospects ; un collègue seulement s'il le nomme, et c'est journalisé.`,
    `- ${LIBELLES_ROLE.prospection} : prospects, pipeline, boîte de prospection et rendez-vous qu'elle a pris. Pas d'accès aux clients.`,
  ),
  vocabulaire: () => bloc(
    '# Vocabulaire',
    '- Prospect : établissement pas encore client, suivi dans le tunnel de vente.',
    '- Client : établissement qui commande, suivi par des visites régulières.',
    '- Secteur : le nom de la zone dessinée sur la carte qui contient la fiche.',
    '- Zone prioritaire : une zone marquée à travailler en premier, avec une consigne.',
    '- Tournée : le regroupement des clients par jour de passage.',
    '- « Pris par » : la personne qui a décroché le rendez-vous, quand ce n\'est pas celle qui l\'a.',
    '- Signalement : ce que quelqu\'un partage depuis son téléphone dans la boîte de prospection.',
  ),
};

export default [{
  nom: 'contexte',
  titre: 'Les règles de SuiviPro',
  description: 'Les règles métier de La Brasserie des Plantes : fréquences de visite, couleurs d\'un client, étapes du tunnel de vente, appels et relances, semaines de tournée, rôles, vocabulaire. À lire avant d\'interpréter les autres outils. Ne lit aucune donnée.',
  schema: {
    sujet: z.enum(['tout', 'frequences', 'couleurs', 'tunnel', 'appels', 'tournees', 'roles', 'vocabulaire'])
      .optional().describe('Le sujet voulu ; « tout » par défaut.'),
  },
  executer: async ({ sujet }) => {
    const choisi = sujet && sujet !== 'tout' ? [SUJETS[sujet]] : Object.values(SUJETS);
    return choisi.map(f => f()).join('\n\n');
  },
}];
