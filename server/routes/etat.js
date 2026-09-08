// État complet de l'application (/state) — routes déplacées telles quelles depuis routes.js.
import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.js';
import { asyncHandler, authMiddleware } from '../lib/auth.js';
import { dateLocale } from '../../shared/regles.js';
import { parseCommercial, parseProspect, parseSessionAppel } from '../lib/parse.js';
import { parseSignalement, SELECT_SIGNALEMENTS } from './signalements.js';

const router = Router();

router.get('/state', authMiddleware, asyncHandler(async (req, res) => {
  // Tout le monde reçoit tout : la prospection est commune, et les clients des collègues
  // sont consultables (remplacements, appels de dépannage). Le PÉRIMÈTRE affiché
  // (« Mes clients » / « Toute l'équipe ») est une bascule d'écran, appliquée une seule
  // fois dans le contexte de l'application, donc partout — accueil et retards compris.
  // On ne renvoie pas les données brutes EasyBeer des commandes (raw_data) : inutiles à
  // l'écran et lourdes ; l'admin les consulte via /commandes/orphelines.
  const hier = dateLocale(new Date(Date.now() - 86400000));
  const [prospects, calls, appointments, reminders, commerciaux, tags, emailTemplates, pipelineColumns, documents, clients, interactions, tasksClient, tourneeConfigs, commandes, sessionsAppel, commercialZones, signalements] = await Promise.all([
    db.query('SELECT * FROM prospects'),
    db.query('SELECT * FROM calls'),
    db.query('SELECT * FROM appointments'),
    db.query('SELECT * FROM reminders'),
    db.query('SELECT * FROM commerciaux'),
    db.query('SELECT * FROM tags'),
    db.query('SELECT * FROM email_templates'),
    db.query('SELECT * FROM pipeline_columns ORDER BY sort_order'),
    db.query('SELECT id, nom, categorie, description, nom_fichier, type_mime, taille, uploaded_by, date_creation FROM documents ORDER BY date_creation DESC'),
    db.query('SELECT * FROM clients ORDER BY date_modification DESC'),
    db.query('SELECT * FROM interactions ORDER BY date DESC'),
    db.query('SELECT * FROM tasks_client ORDER BY date_echeance ASC'),
    db.query('SELECT * FROM tournee_config'),
    db.query(`SELECT id, client_id, easybeer_id, numero, date_commande, date_livraison, statut, montant_ht, montant_ttc,
                     lignes, notes, source, client_name, date_creation
              FROM commandes ORDER BY date_commande DESC`),
    db.query('SELECT * FROM sessions_appel WHERE jour >= $1', [hier]),
    db.query('SELECT * FROM commercial_zones ORDER BY created_at ASC'),
    // La boîte de prospection : tout ce qui attend, un mois de traités, et ce qui est rattaché à
    // une fiche (ses photos restent visibles sur la fiche).
    db.query(`${SELECT_SIGNALEMENTS} WHERE s.statut = 'a_qualifier' OR s.created_at >= $1 OR s.prospect_id <> '' OR s.client_id <> '' ORDER BY s.created_at DESC`, [dateLocale(new Date(Date.now() - 30 * 86400000))]),
  ]);

  const etat = {
    prospects: prospects.rows.map(parseProspect),
    calls: calls.rows,
    appointments: appointments.rows,
    reminders: reminders.rows,
    commerciaux: commerciaux.rows.map(parseCommercial),
    tags: tags.rows,
    emailTemplates: emailTemplates.rows,
    pipelineColumns: pipelineColumns.rows,
    documents: documents.rows,
    clients: clients.rows,
    interactions: interactions.rows,
    tasksClient: tasksClient.rows,
    tourneeConfigs: tourneeConfigs.rows,
    commandes: commandes.rows.map(c => ({ ...c, lignes: JSON.parse(c.lignes || '[]') })),
    sessionsAppel: sessionsAppel.rows.map(parseSessionAppel),
    signalements: signalements.rows.map(parseSignalement),
    commercialZones: commercialZones.rows.map(z => { let c = z.coordinates; try { c = JSON.parse(c); } catch { c = []; } return { ...z, coordinates: Array.isArray(c) ? c : [], prioritaire: !!z.prioritaire, consigne: z.consigne || '' }; }),
  };
  // L'écran redemande l'état toutes les 30 s. Quand rien n'a changé, on répond « 304 »
  // sans corps : l'empreinte du JSON sert d'ETag, l'écran garde ce qu'il a.
  const corps = JSON.stringify(etat);
  const empreinte = `"${crypto.createHash('md5').update(corps).digest('hex')}"`;
  res.set('ETag', empreinte);
  res.set('Cache-Control', 'no-cache');
  if (req.headers['if-none-match'] === empreinte) return res.status(304).end();
  res.type('application/json').send(corps);
}));

export default router;
