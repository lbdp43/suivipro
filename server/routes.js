// Toutes les routes de l'API, un module par domaine (server/routes/*.js), les helpers
// partagés dans server/lib/. L'ordre de montage est celui de l'ancien fichier unique :
// il compte pour les routes qui partagent un préfixe.
import { Router } from 'express';
import auth from './routes/auth.js';
import etat from './routes/etat.js';
import prospects from './routes/prospects.js';
import prospection from './routes/prospection.js';
import reglages from './routes/reglages.js';
import documents from './routes/documents.js';
import clients from './routes/clients.js';
import commandes from './routes/commandes.js';
import activite from './routes/activite.js';
import tournees from './routes/tournees.js';
import easybeer from './routes/easybeer.js';
import doublons from './routes/doublons.js';
import notifications from './routes/notifications.js';
import admin from './routes/admin.js';
import annuaire from './routes/annuaire.js';
import sirene from './routes/sirene.js';
import crons from './routes/crons.js';

const router = Router();
router.use(auth);
router.use(etat);
router.use(prospects);
router.use(prospection);
router.use(reglages);
router.use(documents);
router.use(clients);
router.use(commandes);
router.use(activite);
router.use(tournees);
router.use(easybeer);
router.use(doublons);
router.use(notifications);
router.use(admin);
router.use(annuaire);
router.use(sirene);
router.use(crons);

export { runZoneSync } from './routes/sirene.js';
export { syncNocturneEasybeer } from './routes/crons.js';
export { purgerJournaux } from './routes/crons.js';
export default router;
