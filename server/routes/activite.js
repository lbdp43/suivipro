// Activité de prospection par membre — routes déplacées telles quelles depuis routes.js.
import { Router } from 'express';
import db from '../db.js';
import { asyncHandler, authMiddleware, isAdmin } from '../lib/auth.js';
import { dateLocale } from '../../shared/regles.js';
import { SQL_APPEL, SQL_APPEL_ABOUTI, SQL_VISITE, SQL_RDV_PRIS, SQL_QUI_A_PRIS, SQL_RDV_REALISE } from '../../shared/activite.js';
import { validationError } from '../lib/validation.js';

const router = Router();

// Compteurs d'activite de prospection de TOUTE l'equipe, pour la page Statistiques.
// Les chiffres des collegues ne regardent que l'administrateur : la page lui est
// reservee, et la porte est fermee ici aussi, pas seulement dans le menu.
router.get('/prospection/activite', authMiddleware, asyncHandler(async (req, res) => {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: "Les statistiques de l'equipe sont reservees a l'administrateur" });
  }
  const debut = String(req.query.debut || '').slice(0, 10);
  const fin = String(req.query.fin || '').slice(0, 10);
  if (!debut || !fin) return validationError(res, ['debut et fin sont requis (AAAA-MM-JJ)']);
  const aujourdhui = dateLocale(new Date());

  // Les colonnes de date sont du texte ISO : on compare sur les 10 premiers caracteres
  // pour accepter aussi bien « 2026-09-06 » que « 2026-09-06T14:12:00.000Z ».
  const [appels, rdvTenus, rdvPris, visites, prospects] = await Promise.all([
    db.query(
      `SELECT commercial_id,
              COUNT(*) FILTER (WHERE jour_paris(date) BETWEEN $1 AND $2) AS periode,
              COUNT(*) FILTER (WHERE jour_paris(date) BETWEEN $1 AND $2 AND ${SQL_APPEL_ABOUTI}) AS repondus,
              COUNT(*) FILTER (WHERE jour_paris(date) = $3) AS aujourdhui,
              COALESCE(AVG(duree) FILTER (WHERE jour_paris(date) BETWEEN $1 AND $2 AND duree > 0), 0) AS duree_moyenne
       FROM calls WHERE ${SQL_APPEL} GROUP BY commercial_id`,
      [debut, fin, aujourdhui]
    ),
    db.query(
      `SELECT commercial_id, COUNT(*) AS n FROM appointments
       WHERE ${SQL_RDV_REALISE} AND LEFT(date,10) BETWEEN $1 AND $2 GROUP BY commercial_id`,
      [debut, fin]
    ),
    // RDV pris : on compte a la date de prise, et au nom de celui qui l'a pris.
    db.query(
      `SELECT ${SQL_QUI_A_PRIS} AS commercial_id, COUNT(*) AS n FROM appointments
       WHERE ${SQL_RDV_PRIS} AND jour_paris(created_at) BETWEEN $1 AND $2
       GROUP BY 1`,
      [debut, fin]
    ),
    db.query(
      `SELECT commercial_id, COUNT(*) AS n FROM interactions
       WHERE ${SQL_VISITE} AND jour_paris(date) BETWEEN $1 AND $2 GROUP BY commercial_id`,
      [debut, fin]
    ),
    db.query(
      `SELECT commercial_id,
              COUNT(*) FILTER (WHERE jour_paris(date_creation) BETWEEN $1 AND $2) AS crees,
              COUNT(*) FILTER (WHERE etape_pipeline = 'client_gagne') AS gagnes
       FROM prospects GROUP BY commercial_id`,
      [debut, fin]
    ),
  ]);

  const parCommercial = {};
  const ligne = (id) => {
    if (!id) return null;
    if (!parCommercial[id]) {
      parCommercial[id] = {
        commercial_id: id, appels: 0, appels_aujourdhui: 0, appels_repondus: 0,
        duree_moyenne: 0, rdv_tenus: 0, rdv_pris: 0, visites: 0, prospects_crees: 0, prospects_gagnes: 0,
      };
    }
    return parCommercial[id];
  };

  for (const r of appels.rows) {
    const l = ligne(r.commercial_id); if (!l) continue;
    l.appels = Number(r.periode) || 0;
    l.appels_repondus = Number(r.repondus) || 0;
    l.appels_aujourdhui = Number(r.aujourdhui) || 0;
    l.duree_moyenne = Math.round(Number(r.duree_moyenne) || 0);
  }
  for (const r of rdvTenus.rows) { const l = ligne(r.commercial_id); if (l) l.rdv_tenus = Number(r.n) || 0; }
  for (const r of rdvPris.rows) { const l = ligne(r.commercial_id); if (l) l.rdv_pris = Number(r.n) || 0; }
  for (const r of visites.rows) { const l = ligne(r.commercial_id); if (l) l.visites = Number(r.n) || 0; }
  for (const r of prospects.rows) {
    const l = ligne(r.commercial_id); if (!l) continue;
    l.prospects_crees = Number(r.crees) || 0;
    l.prospects_gagnes = Number(r.gagnes) || 0;
  }

  res.json({ debut, fin, activites: Object.values(parCommercial) });
}));

export default router;
