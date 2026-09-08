// Tournées, zones dessinées, secteurs — routes déplacées telles quelles depuis routes.js.
import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.js';
import { sansAccents } from '../../shared/normalisation.js';
import { adminOnly, asyncHandler, authMiddleware, isAdmin } from '../lib/auth.js';
import { lireConfigTournee, nomZone } from '../lib/geo.js';
import { pointDansPolygone, rattacherTout, etatGeocodage, geocoderManquants } from '../lib/zones.js';
import { logActivity } from '../lib/journal.js';
import { validationError } from '../lib/validation.js';

const router = Router();

router.get('/tournee-config', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM tournee_config');
  res.json(result.rows);
}));

router.get('/tournee-config/:commercialId', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM tournee_config WHERE commercial_id = $1', [req.params.commercialId]);
  if (result.rows.length === 0) {
    return res.json({ commercial_id: req.params.commercialId, config: '{}', notes: '', updated_at: new Date().toISOString() });
  }
  res.json(result.rows[0]);
}));

router.post('/tournee-config/:commercialId', authMiddleware, asyncHandler(async (req, res) => {
  // Chacun règle sa propre tournée ; celle d'un collègue, c'est l'admin.
  if (!isAdmin(req) && req.params.commercialId !== req.user.id) {
    return res.status(403).json({ error: 'Vous ne pouvez modifier que votre propre tournée' });
  }
  const { config, notes, tournee_info, week_pattern } = req.body;
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO tournee_config (commercial_id, config, notes, tournee_info, week_pattern, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (commercial_id) DO UPDATE SET config = $2, notes = $3, tournee_info = $4, week_pattern = $5, updated_at = $6`,
    [req.params.commercialId, JSON.stringify(config || {}), notes || '', tournee_info || '', week_pattern || 'every', now]
  );
  res.json({ ok: true });
}));



async function analyserSecteurs() {
  const [configs, zones, clients, prospects, commerciaux] = await Promise.all([
    db.query('SELECT commercial_id, config FROM tournee_config'),
    db.query('SELECT id, commercial_id, nom, coordinates FROM commercial_zones'),
    db.query('SELECT id, nom, tournee, ville, latitude, longitude, statut FROM clients'),
    db.query('SELECT id, nom_etablissement AS nom, secteur, ville, latitude, longitude FROM prospects'),
    db.query('SELECT id, prenom, nom FROM commerciaux'),
  ]);
  const nomCommercial = new Map(commerciaux.rows.map(c => [c.id, `${c.prenom} ${c.nom}`.trim()]));
  const clientsParNom = new Map(), prospectsParNom = new Map(), parVille = new Map();
  for (const c of clients.rows) { const k = sansAccents(c.tournee); if (k) clientsParNom.set(k, (clientsParNom.get(k) || 0) + 1); }
  for (const p of prospects.rows) { const k = sansAccents(p.secteur); if (k) prospectsParNom.set(k, (prospectsParNom.get(k) || 0) + 1); }
  // Prudence : un secteur qui porte le nom d'une ville où se trouvent des fiches (champ
  // ville) n'est pas considéré vide, même si personne n'y est « attitré » par le champ.
  for (const c of clients.rows) { const k = sansAccents(c.ville); if (k) parVille.set(k, (parVille.get(k) || 0) + 1); }
  for (const p of prospects.rows) { const k = sansAccents(p.ville); if (k) parVille.set(k, (parVille.get(k) || 0) + 1); }

  const secteurs = new Map(); // clé normalisée -> fiche
  const fiche = (nom) => {
    const k = sansAccents(nom);
    if (!secteurs.has(k)) secteurs.set(k, { cle: k, nom: String(nom).trim(), clients: clientsParNom.get(k) || 0, prospects: prospectsParNom.get(k) || 0, meme_ville: parVille.get(k) || 0, dans_polygone: 0, configs: [], zones: [] });
    return secteurs.get(k);
  };
  const JOURS = { '1': 'lundi', '2': 'mardi', '3': 'mercredi', '4': 'jeudi', '5': 'vendredi', '6': 'samedi', '0': 'dimanche' };
  for (const row of configs.rows) {
    const cfg = lireConfigTournee(row.config);
    for (const [jour, liste] of Object.entries(cfg)) {
      if (!Array.isArray(liste)) continue;
      for (const z of liste) {
        const nom = nomZone(z);
        if (!nom) continue;
        const f = fiche(nom);
        f.configs.push({ commercial_id: row.commercial_id, commercial: nomCommercial.get(row.commercial_id) || row.commercial_id, jour: jour === 'prospection' ? 'prospection' : (JOURS[jour] || jour) });
      }
    }
  }
  for (const z of zones.rows) {
    let coords = [];
    try { coords = JSON.parse(z.coordinates || '[]'); } catch { coords = []; }
    const f = fiche(z.nom || `zone sans nom (${nomCommercial.get(z.commercial_id) || z.commercial_id})`);
    let dedans = 0;
    if (Array.isArray(coords) && coords.length >= 3) {
      for (const c of clients.rows) if (c.latitude && c.longitude && pointDansPolygone(Number(c.latitude), Number(c.longitude), coords)) dedans++;
      for (const p of prospects.rows) if (p.latitude && p.longitude && pointDansPolygone(Number(p.latitude), Number(p.longitude), coords)) dedans++;
    }
    f.dans_polygone += dedans;
    f.zones.push({ id: z.id, commercial_id: z.commercial_id, commercial: nomCommercial.get(z.commercial_id) || z.commercial_id, points: dedans });
  }
  const liste = [...secteurs.values()].map(f => ({ ...f, vide: f.clients === 0 && f.prospects === 0 && f.meme_ville === 0 && f.dans_polygone === 0 }))
    .sort((a, b) => Number(b.vide) - Number(a.vide) || a.nom.localeCompare(b.nom));
  return { secteurs: liste, vides: liste.filter(f => f.vide).length, total: liste.length };
}

router.get('/tournees/vides', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  res.json(await analyserSecteurs());
}));

router.post('/tournees/vides/supprimer', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const demandes = new Set((Array.isArray(req.body?.cles) ? req.body.cles : []).map(sansAccents).filter(Boolean));
  if (demandes.size === 0) return res.status(400).json({ error: 'Aucun secteur demandé' });
  // Recompte au moment de supprimer : on ne supprime que ce qui est ENCORE vide.
  const analyse = await analyserSecteurs();
  const aSupprimer = analyse.secteurs.filter(f => demandes.has(f.cle) && f.vide);
  const refuses = analyse.secteurs.filter(f => demandes.has(f.cle) && !f.vide).map(f => f.nom);
  const cles = new Set(aSupprimer.map(f => f.cle));
  let configsModifiees = 0, zonesSupprimees = 0;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const configs = (await client.query('SELECT commercial_id, config FROM tournee_config')).rows;
    for (const row of configs) {
      const cfg = lireConfigTournee(row.config);
      let change = false;
      for (const [jour, liste] of Object.entries(cfg)) {
        if (!Array.isArray(liste)) continue;
        const filtre = liste.filter(z => !cles.has(sansAccents(nomZone(z))));
        if (filtre.length !== liste.length) { cfg[jour] = filtre; change = true; }
        if (jour !== 'prospection' && filtre.length === 0) delete cfg[jour];
      }
      if (change) {
        await client.query('UPDATE tournee_config SET config = $1, updated_at = $2 WHERE commercial_id = $3', [JSON.stringify(cfg), new Date().toISOString(), row.commercial_id]);
        configsModifiees++;
      }
    }
    const ids = aSupprimer.flatMap(f => f.zones.map(z => z.id));
    if (ids.length) {
      const r = await client.query('DELETE FROM commercial_zones WHERE id = ANY($1::text[])', [ids]);
      zonesSupprimees = r.rowCount || 0;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await logActivity(req.user.id, 'suppression_secteurs', `${aSupprimer.length} secteur(s) vide(s) : ${aSupprimer.map(f => f.nom).join(', ')}`, 'tournee', '');
  res.json({ ok: true, supprimes: aSupprimer.map(f => f.nom), refuses, configs_modifiees: configsModifiees, zones_supprimees: zonesSupprimees });
}));

// Fusionner des secteurs : tout ce qui portait un des noms « sources » porte désormais le
// nom « cible » — champ tournée des clients, champ secteur des prospects, jours et zones de
// prospection des configs de tournée, nom des zones dessinées. Rien n'est supprimé : les
// zones dessinées gardent leur tracé, seul leur nom change.
router.post('/tournees/fusionner', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const cible = String(req.body?.cible || '').trim();
  const sources = new Set((Array.isArray(req.body?.sources) ? req.body.sources : []).map(sansAccents).filter(Boolean));
  if (!cible) return res.status(400).json({ error: 'Nom du secteur cible requis' });
  sources.delete(sansAccents(cible));
  if (sources.size === 0) return res.status(400).json({ error: 'Aucun secteur source (différent de la cible)' });
  const estSource = (v) => sources.has(sansAccents(v));

  const client = await db.connect();
  const bilan = { clients: 0, prospects: 0, configs: 0, zones: 0 };
  try {
    await client.query('BEGIN');
    const now = new Date().toISOString();
    const cl = (await client.query('SELECT id, tournee FROM clients')).rows.filter(c => estSource(c.tournee)).map(c => c.id);
    if (cl.length) bilan.clients = (await client.query('UPDATE clients SET tournee = $1, date_modification = $2 WHERE id = ANY($3::text[])', [cible, now, cl])).rowCount || 0;
    const pr = (await client.query('SELECT id, secteur FROM prospects')).rows.filter(p => estSource(p.secteur)).map(p => p.id);
    if (pr.length) bilan.prospects = (await client.query('UPDATE prospects SET secteur = $1, date_modification = $2 WHERE id = ANY($3::text[])', [cible, now, pr])).rowCount || 0;
    for (const row of (await client.query('SELECT commercial_id, config FROM tournee_config')).rows) {
      const cfg = lireConfigTournee(row.config);
      let change = false;
      for (const [jour, liste] of Object.entries(cfg)) {
        if (!Array.isArray(liste)) continue;
        const vus = new Set();
        const neuf = [];
        for (const z of liste) {
          const nom = nomZone(z);
          const remplace = estSource(nom) ? cible : nom;
          const k = sansAccents(remplace);
          if (vus.has(k)) { change = true; continue; } // doublon dans la même journée après fusion
          vus.add(k);
          if (remplace !== nom) { change = true; neuf.push(typeof z === 'string' ? cible : { ...z, zone: cible }); }
          else neuf.push(z);
        }
        cfg[jour] = neuf;
      }
      if (change) {
        await client.query('UPDATE tournee_config SET config = $1, updated_at = $2 WHERE commercial_id = $3', [JSON.stringify(cfg), now, row.commercial_id]);
        bilan.configs++;
      }
    }
    const zo = (await client.query('SELECT id, nom FROM commercial_zones')).rows.filter(z => estSource(z.nom)).map(z => z.id);
    if (zo.length) bilan.zones = (await client.query('UPDATE commercial_zones SET nom = $1, updated_at = $2 WHERE id = ANY($3::text[])', [cible, now, zo])).rowCount || 0;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await logActivity(req.user.id, 'fusion_secteurs', `${[...sources].join(', ')} → ${cible} (${bilan.clients} clients, ${bilan.prospects} prospects)`, 'tournee', '');
  res.json({ ok: true, cible, ...bilan });
}));

router.get('/commercial-zones', authMiddleware, asyncHandler(async (req, res) => {
  const result = await db.query('SELECT * FROM commercial_zones ORDER BY created_at ASC');
  res.json(result.rows.map(z => ({ ...z, coordinates: JSON.parse(z.coordinates) })));
}));

router.post('/commercial-zones', authMiddleware, asyncHandler(async (req, res) => {
  const z = req.body;
  if (!z.commercial_id) return validationError(res, ['commercial_id est requis']);
  if (!Array.isArray(z.coordinates) || z.coordinates.length < 3) return validationError(res, ['coordinates doit contenir au moins 3 points']);
  if (!isAdmin(req) && z.commercial_id !== req.user.id) {
    return res.status(403).json({ error: 'Vous ne pouvez dessiner que votre propre zone' });
  }
  const now = new Date().toISOString();
  const id = z.id || `zone-${crypto.randomUUID()}`;
  const prioritaire = !!z.prioritaire;
  const consigne = typeof z.consigne === 'string' ? z.consigne : '';
  await db.query(
    `INSERT INTO commercial_zones (id, commercial_id, nom, couleur, coordinates, created_at, updated_at, prioritaire, consigne)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, z.commercial_id, z.nom || '', z.couleur || '#6366f1', JSON.stringify(z.coordinates), now, now, prioritaire, consigne]
  );
  await rattacherTout();
  res.json({ id, commercial_id: z.commercial_id, nom: z.nom || '', couleur: z.couleur || '#6366f1', coordinates: z.coordinates, created_at: now, updated_at: now, prioritaire, consigne });
}));

router.put('/commercial-zones/:id', authMiddleware, asyncHandler(async (req, res) => {
  const z = req.body;
  if (z.coordinates !== undefined && (!Array.isArray(z.coordinates) || z.coordinates.length < 3)) return validationError(res, ['coordinates doit contenir au moins 3 points']);
  const existing = await db.query('SELECT * FROM commercial_zones WHERE id = $1', [req.params.id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: 'Zone introuvable' });
  const actuelle = existing.rows[0];
  if (!isAdmin(req) && actuelle.commercial_id !== req.user.id) {
    return res.status(403).json({ error: 'Vous ne pouvez modifier que votre propre zone' });
  }
  // Champ absent du corps → inchangé (le renommage depuis la carte n'envoie pas le tracé).
  const now = new Date().toISOString();
  const nom = z.nom !== undefined ? (z.nom || '') : actuelle.nom;
  const couleur = z.couleur !== undefined ? (z.couleur || '#6366f1') : actuelle.couleur;
  const coordinates = z.coordinates !== undefined ? JSON.stringify(z.coordinates) : actuelle.coordinates;
  const commercialId = isAdmin(req) && z.commercial_id ? z.commercial_id : actuelle.commercial_id;
  const prioritaire = z.prioritaire !== undefined ? !!z.prioritaire : !!actuelle.prioritaire;
  const consigne = z.consigne !== undefined ? String(z.consigne || '') : (actuelle.consigne || '');
  await db.query(
    `UPDATE commercial_zones SET nom=$1, couleur=$2, coordinates=$3, updated_at=$4, commercial_id=$5, prioritaire=$6, consigne=$7 WHERE id=$8`,
    [nom, couleur, coordinates, now, commercialId, prioritaire, consigne, req.params.id]
  );
  // Les prospects qui portaient le nom de la zone comme secteur suivent le renommage.
  if (nom !== actuelle.nom && actuelle.nom) {
    await db.query('UPDATE prospects SET secteur = $1 WHERE zone_id = $2 AND secteur = $3', [nom, req.params.id, actuelle.nom]);
  }
  if (z.coordinates !== undefined || nom !== actuelle.nom) await rattacherTout();
  if (prioritaire !== !!actuelle.prioritaire) {
    await logActivity(req.user.id, 'zone_prioritaire', `${nom || 'Zone'} : ${prioritaire ? 'marquée prioritaire' : 'priorité retirée'}${consigne ? ` — ${consigne}` : ''}`, 'zone', req.params.id);
  }
  res.json({ ok: true, prioritaire, consigne, nom, commercial_id: commercialId });
}));

router.delete('/commercial-zones/:id', authMiddleware, asyncHandler(async (req, res) => {
  const existing = await db.query('SELECT commercial_id FROM commercial_zones WHERE id = $1', [req.params.id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: 'Zone introuvable' });
  if (!isAdmin(req) && existing.rows[0].commercial_id !== req.user.id) {
    return res.status(403).json({ error: 'Vous ne pouvez supprimer que votre propre zone' });
  }
  await db.query('DELETE FROM commercial_zones WHERE id = $1', [req.params.id]);
  await rattacherTout();
  res.json({ ok: true });
}));

// État du placement des fiches : sans coordonnées, hors zone. Et les deux actions qui vont avec.
router.get('/geo/etat', authMiddleware, adminOnly, asyncHandler(async (_req, res) => {
  res.json(await etatGeocodage());
}));

router.post('/geo/geocoder-manquants', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const bilan = await geocoderManquants({ limite: Math.min(500, Math.max(1, Number(req.body?.limite) || 150)) });
  await logActivity(req.user.id, 'geocodage', `${bilan.geocodes} fiche(s) placée(s), ${bilan.echecs} échec(s), ${bilan.restants} restante(s)`, 'geo', '');
  res.json({ ...bilan, etat: await etatGeocodage() });
}));

router.post('/geo/rattacher', authMiddleware, adminOnly, asyncHandler(async (_req, res) => {
  const bilan = await rattacherTout();
  res.json({ ...bilan, etat: await etatGeocodage() });
}));

export default router;
