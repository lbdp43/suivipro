// État complet de l'application (/state) — routes déplacées telles quelles depuis routes.js.
import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.js';
import { asyncHandler, authMiddleware } from '../lib/auth.js';
import { dateLocale } from '../../shared/regles.js';
import { parseCommercial, parseProspect, parseSessionAppel } from '../lib/parse.js';
import { parseSignalement, SELECT_SIGNALEMENTS } from './signalements.js';
import { COLONNES_DOCUMENT, documentPourEcran } from './documents.js';
import { etatCommun } from '../lib/etatCache.js';

const router = Router();

router.get('/state', authMiddleware, asyncHandler(async (req, res) => {
  // L'état commun est le même pour tous : calculé une fois, gardé tant que personne n'écrit
  // (lib/etatCache.js). Seul ce que la personne a ouvert lui est propre, et léger.
  const [commun, ouvertures] = await Promise.all([
    etatCommun(calculerEtatCommun),
    db.query('SELECT doc_id, version FROM document_ouvertures WHERE user_id = $1', [req.user.id]),
  ]);
  const ouvertJson = JSON.stringify(ouvertures.rows);
  // L'écran redemande l'état toutes les 30 s. Quand rien n'a changé, on répond « 304 »
  // sans corps : l'empreinte sert d'ETag, l'écran garde ce qu'il a.
  const empreinte = `"${commun.empreinte}-${crypto.createHash('md5').update(ouvertJson).digest('hex').slice(0, 8)}"`;
  res.set('ETag', empreinte);
  res.set('Cache-Control', 'no-cache');
  if (req.headers['if-none-match'] === empreinte) return res.status(304).end();
  res.type('application/json').send(`${commun.corps.slice(0, -1)},"documentOuvertures":${ouvertJson}}`);
}));

async function calculerEtatCommun() {
  // Tout le monde reçoit tout : la prospection est commune, et les clients des collègues
  // sont consultables (remplacements, appels de dépannage). Le PÉRIMÈTRE affiché
  // (« Mes clients » / « Toute l'équipe ») est une bascule d'écran, appliquée une seule
  // fois dans le contexte de l'application, donc partout — accueil et retards compris.
  // On ne renvoie pas les données brutes EasyBeer des commandes (raw_data) : inutiles à
  // l'écran et lourdes ; l'admin les consulte via /commandes/orphelines.
  const hier = dateLocale(new Date(Date.now() - 86400000));
  const [prospects, calls, appointments, reminders, commerciaux, tags, emailTemplates, pipelineColumns, documents, clients, interactions, tasksClient, tourneeConfigs, commandes, sessionsAppel, commercialZones, signalements, documentSignatures] = await Promise.all([
    db.query('SELECT * FROM prospects'),
    db.query('SELECT * FROM calls'),
    db.query('SELECT * FROM appointments'),
    db.query('SELECT * FROM reminders'),
    // Un membre retiré de l'équipe disparaît de toutes les listes d'un coup : sa ligne
    // reste en base pour que son travail garde son nom, mais elle ne sort plus d'ici.
    db.query('SELECT * FROM commerciaux WHERE actif'),
    db.query('SELECT * FROM tags'),
    db.query('SELECT * FROM email_templates'),
    db.query('SELECT * FROM pipeline_columns ORDER BY sort_order'),
    db.query(`SELECT ${COLONNES_DOCUMENT} FROM documents ORDER BY date_creation DESC`),
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
    // Qui a signé quoi (toutes versions : l'historique). Ce que chacun a ouvert est à part,
    // propre à la personne — le bouton « J'ai lu » ne s'allume qu'après l'ouverture.
    db.query('SELECT doc_id, user_id, version, signe_le FROM document_signatures ORDER BY signe_le'),
  ]);

  return {
    prospects: prospects.rows.map(parseProspect),
    calls: calls.rows,
    appointments: appointments.rows,
    reminders: reminders.rows,
    commerciaux: commerciaux.rows.map(parseCommercial),
    tags: tags.rows,
    emailTemplates: emailTemplates.rows,
    pipelineColumns: pipelineColumns.rows,
    documents: documents.rows.map(documentPourEcran),
    documentSignatures: documentSignatures.rows,
    clients: clients.rows,
    interactions: interactions.rows,
    tasksClient: tasksClient.rows,
    tourneeConfigs: tourneeConfigs.rows,
    commandes: commandes.rows.map(c => ({ ...c, lignes: JSON.parse(c.lignes || '[]') })),
    sessionsAppel: sessionsAppel.rows.map(parseSessionAppel),
    signalements: signalements.rows.map(parseSignalement),
    commercialZones: commercialZones.rows.map(z => { let c = z.coordinates; try { c = JSON.parse(c); } catch { c = []; } return { ...z, coordinates: Array.isArray(c) ? c : [], prioritaire: !!z.prioritaire, consigne: z.consigne || '' }; }),
  };
}

export default router;
