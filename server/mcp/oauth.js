// La connexion OAuth du MCP, pour ChatGPT (et tout client qui ne sait pas passer un jeton
// d'en-tête).
//
// ChatGPT ne propose que deux façons de brancher un serveur MCP : sans authentification,
// ou OAuth. Il ne sait pas ajouter un en-tête « x-token » comme Claude. On fait donc de
// SuiviPro son propre service de connexion, le plus petit possible :
//
//   1. ChatGPT lit les deux fiches « .well-known » et apprend où s'inscrire et se connecter ;
//   2. il s'inscrit tout seul (/oauth/register) et reçoit un identifiant de client ;
//   3. il ouvre /oauth/authorize dans le navigateur : la personne y tape son e-mail et son
//      mot de passe SuiviPro, comme dans l'appli ;
//   4. ChatGPT échange le code reçu (/oauth/token) contre un jeton « sp_ » ordinaire.
//
// Ce jeton est un accès comme ceux créés par l'administration : même table, même durée
// (un an), même périmètre (celui de la personne), visible et révocable dans
// Administration → Accès IA. Le MCP n'a rien à savoir de plus.
//
// Tout compte actif peut se brancher ainsi. PKCE (S256) est obligatoire : un code
// intercepté ne sert à rien sans le secret que seul ChatGPT a gardé.
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import db from '../db.js';
import { creerJeton, DUREE_JOURS } from './jetons.js';
import { logActivity } from '../lib/journal.js';

const routeur = express.Router();

const DUREE_CODE_MS = 10 * 60 * 1000;

const empreinte = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const base64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** L'adresse publique du serveur, telle que le client la voit (Railway passe par un proxy). */
export function adressePublique(req) {
  return `${req.protocol}://${req.get('host')}`;
}

/** Où un client trouve comment se connecter : ce que dit l'en-tête WWW-Authenticate d'un refus. */
export function adresseFicheRessource(req) {
  return `${adressePublique(req)}/.well-known/oauth-protected-resource/mcp`;
}

// Ces adresses sont lues par ChatGPT depuis ses serveurs, parfois depuis un navigateur.
const ouvert = cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'mcp-protocol-version'] });

// ─── Les fiches de découverte ───────────────────────────────────────────────────────────

function ficheRessource(req, res) {
  const base = adressePublique(req);
  res.json({
    resource: `${base}/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    resource_name: 'SuiviPro',
  });
}
routeur.get('/.well-known/oauth-protected-resource', ouvert, ficheRessource);
routeur.get('/.well-known/oauth-protected-resource/mcp', ouvert, ficheRessource);

function ficheServeur(req, res) {
  const base = adressePublique(req);
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: ['suivipro'],
  });
}
routeur.get('/.well-known/oauth-authorization-server', ouvert, ficheServeur);
routeur.get('/.well-known/oauth-authorization-server/mcp', ouvert, ficheServeur);
routeur.get('/.well-known/openid-configuration', ouvert, ficheServeur);

// Toute autre adresse OAuth sondée : un refus net, pas la page de l'appli.
routeur.use((req, res, next) => {
  if (!req.path.startsWith('/.well-known/oauth-')) return next();
  return res.status(404).json({ error: 'Adresse inconnue' });
});

// ─── L'inscription d'un client (ChatGPT s'inscrit tout seul) ──────────────────────────

const limiteInscription = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

/** Une adresse de retour acceptable : https, ou la machine locale pour les essais. */
function retourAcceptable(uri) {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

routeur.post('/oauth/register', ouvert, limiteInscription, express.json({ limit: '32kb' }), async (req, res) => {
  const corps = req.body || {};
  const retours = Array.isArray(corps.redirect_uris) ? corps.redirect_uris.map(String) : [];
  if (!retours.length || retours.length > 10 || !retours.every(retourAcceptable)) {
    return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'Adresses de retour https obligatoires.' });
  }
  const nom = String(corps.client_name || 'Assistant').slice(0, 80);
  const id = `spc_${crypto.randomBytes(16).toString('hex')}`;
  const maintenant = new Date();
  await db.query(
    'INSERT INTO oauth_clients (id, nom, redirect_uris, cree_le) VALUES ($1,$2,$3,$4)',
    [id, nom, JSON.stringify(retours), maintenant.toISOString()]
  );
  return res.status(201).json({
    client_id: id,
    client_id_issued_at: Math.floor(maintenant.getTime() / 1000),
    client_name: nom,
    redirect_uris: retours,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  });
});

async function clientInscrit(id) {
  if (!id) return null;
  const r = await db.query('SELECT id, nom, redirect_uris FROM oauth_clients WHERE id = $1', [String(id)]);
  const c = r.rows[0];
  if (!c) return null;
  return { ...c, redirect_uris: JSON.parse(c.redirect_uris || '[]') };
}

// ─── La page de connexion ─────────────────────────────────────────────────────────────

const echapper = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function page(res, { client, params, email = '', erreur = '' }, statut = 200) {
  const caches = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource']
    .map(k => `<input type="hidden" name="${k}" value="${echapper(params[k])}">`).join('');
  // Après l'envoi du formulaire, le navigateur suit la redirection vers ChatGPT : la règle
  // « form-action » doit l'autoriser, sinon Chrome bloque le retour en silence.
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https:; frame-ancestors 'none'; base-uri 'none'");
  res.set('Cache-Control', 'no-store');
  res.status(statut).type('html').send(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connexion à SuiviPro</title>
<style>
  :root { --fond:#f3f5f2; --carte:#fff; --encre:#1b2a20; --doux:#5b6b60; --trait:#d6ddd7; --vert:#16a34a; --vert-fort:#15803d; --rouge:#b91c1c; --rouge-fond:#fef2f2; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root { --fond:#0f1216; --carte:#171a21; --encre:#f1f3f5; --doux:#b4bac5; --trait:#2c313a; --vert:#22c55e; --vert-fort:#16a34a; --rouge:#fca5a5; --rouge-fond:#331a1e; color-scheme: dark; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:16px; background:var(--fond); color:var(--encre); font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  main { width:100%; max-width:380px; background:var(--carte); border:1px solid var(--trait); border-radius:14px; padding:24px; }
  h1 { margin:0 0 4px; font-size:20px; text-wrap:balance; }
  p { margin:0 0 16px; color:var(--doux); font-size:14px; }
  strong { color:var(--encre); }
  label { display:block; font-size:13px; font-weight:600; margin:12px 0 4px; }
  input[type=email], input[type=password] { width:100%; padding:10px 12px; border:1px solid var(--trait); border-radius:8px; font:inherit; background:var(--carte); color:var(--encre); }
  input:focus-visible, button:focus-visible { outline:2px solid var(--vert); outline-offset:2px; }
  .erreur { background:var(--rouge-fond); color:var(--rouge); padding:8px 12px; border-radius:8px; font-size:13px; margin-bottom:8px; }
  .boutons { display:flex; gap:8px; margin-top:20px; }
  button { flex:1; padding:10px 12px; border-radius:8px; font:inherit; font-weight:600; cursor:pointer; border:1px solid var(--trait); background:transparent; color:var(--encre); }
  button.oui { background:var(--vert); border-color:var(--vert); color:#fff; }
  button.oui:hover { background:var(--vert-fort); }
  .note { font-size:12px; margin:16px 0 0; }
</style></head>
<body><main>
  <h1>Connexion à SuiviPro</h1>
  <p><strong>${echapper(client.nom)}</strong> demande à lire vos clients, prospects et rendez-vous, et à noter visites et comptes rendus avec votre accord.</p>
  ${erreur ? `<div class="erreur" role="alert">${echapper(erreur)}</div>` : ''}
  <form method="post" action="/oauth/authorize">
    ${caches}
    <label for="email">E-mail</label>
    <input id="email" name="email" type="email" autocomplete="username" required value="${echapper(email)}">
    <label for="mdp">Mot de passe SuiviPro</label>
    <input id="mdp" name="password" type="password" autocomplete="current-password" required>
    <div class="boutons">
      <button type="submit" name="decision" value="refuser" formnovalidate>Refuser</button>
      <button type="submit" name="decision" value="autoriser" class="oui">Autoriser</button>
    </div>
  </form>
  <p class="note">L'accès dure un an et ne montre que ce que vous voyez déjà dans l'appli. Il se coupe dans SuiviPro, Administration → Accès IA.</p>
</main></body></html>`);
}

/** Une erreur qu'on ne peut pas renvoyer à ChatGPT (client ou adresse de retour douteux). */
function impasse(res, message) {
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  return res.status(400).type('html').send(`<!doctype html><html lang="fr"><meta charset="utf-8"><title>Connexion impossible</title>
<body style="font:15px system-ui,sans-serif;padding:24px;max-width:480px;margin:auto"><h1 style="font-size:20px">Connexion impossible</h1><p>${echapper(message)}</p>
<p>Supprimez le connecteur dans ChatGPT et ajoutez-le de nouveau.</p></body></html>`);
}

function renvoyer(res, retour, champs) {
  const u = new URL(retour);
  for (const [k, v] of Object.entries(champs)) if (v !== undefined && v !== '') u.searchParams.set(k, v);
  return res.redirect(302, u.toString());
}

/** Vérifie la demande : client connu, adresse de retour déclarée, PKCE en S256. */
async function lireDemande(params, res) {
  const client = await clientInscrit(params.client_id);
  if (!client) { impasse(res, 'Ce client n\'est pas inscrit auprès de SuiviPro.'); return null; }
  const retour = String(params.redirect_uri || '');
  if (!client.redirect_uris.includes(retour)) { impasse(res, 'Adresse de retour inconnue pour ce client.'); return null; }
  if (params.response_type && params.response_type !== 'code') {
    renvoyer(res, retour, { error: 'unsupported_response_type', state: params.state }); return null;
  }
  if (!params.code_challenge || (params.code_challenge_method || 'plain') !== 'S256') {
    renvoyer(res, retour, { error: 'invalid_request', error_description: 'PKCE S256 obligatoire', state: params.state }); return null;
  }
  return { client, retour };
}

routeur.get('/oauth/authorize', async (req, res) => {
  const demande = await lireDemande(req.query, res);
  if (!demande) return undefined;
  return page(res, { client: demande.client, params: req.query });
});

// Contre les essais de mots de passe en série : même limite que la connexion de l'appli.
const limiteConnexion = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

routeur.post('/oauth/authorize', limiteConnexion, express.urlencoded({ extended: false, limit: '16kb' }), async (req, res) => {
  const params = req.body || {};
  const demande = await lireDemande(params, res);
  if (!demande) return undefined;
  const { client, retour } = demande;

  if (params.decision !== 'autoriser') return renvoyer(res, retour, { error: 'access_denied', state: params.state });

  const email = String(params.email || '').trim();
  const r = await db.query('SELECT id, prenom, nom, password, actif FROM commerciaux WHERE lower(email) = lower($1)', [email]);
  const personne = r.rows[0];
  if (!personne || !personne.password || !bcrypt.compareSync(String(params.password || ''), personne.password)) {
    return page(res, { client, params, email, erreur: 'E-mail ou mot de passe incorrect.' }, 401);
  }
  if (personne.actif === false) {
    return page(res, { client, params, email, erreur: 'Ce compte a été retiré de l\'équipe.' }, 403);
  }

  const code = base64url(crypto.randomBytes(32));
  await db.query(
    `INSERT INTO oauth_codes (empreinte, client_id, commercial_id, redirect_uri, code_challenge, expire_le)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [empreinte(code), client.id, personne.id, retour, String(params.code_challenge), new Date(Date.now() + DUREE_CODE_MS).toISOString()]
  );
  return renvoyer(res, retour, { code, state: params.state, iss: adressePublique(req) });
});

// ─── L'échange du code contre un jeton ────────────────────────────────────────────────

function refusJeton(res, erreur, description, statut = 400) {
  res.set('Cache-Control', 'no-store');
  return res.status(statut).json({ error: erreur, error_description: description });
}

/** L'identifiant de client, qu'il vienne du corps ou d'une authentification « Basic ». */
function clientDeLaRequete(req) {
  const basic = String(req.headers.authorization || '').match(/^Basic\s+(.+)$/i);
  if (basic) {
    try { return decodeURIComponent(Buffer.from(basic[1], 'base64').toString().split(':')[0]); } catch { /* ignoré */ }
  }
  return String(req.body?.client_id || '');
}

routeur.post('/oauth/token', ouvert, express.urlencoded({ extended: false, limit: '16kb' }), express.json({ limit: '16kb' }), async (req, res) => {
  const corps = req.body || {};
  if (corps.grant_type !== 'authorization_code') return refusJeton(res, 'unsupported_grant_type', 'Seul authorization_code est accepté.');
  if (!corps.code || !corps.code_verifier) return refusJeton(res, 'invalid_request', 'code et code_verifier obligatoires.');

  // Le code ne sert qu'une fois : on le retire en le lisant.
  const r = await db.query('DELETE FROM oauth_codes WHERE empreinte = $1 RETURNING *', [empreinte(corps.code)]);
  const c = r.rows[0];
  if (!c || new Date(c.expire_le) < new Date()) return refusJeton(res, 'invalid_grant', 'Code inconnu, déjà utilisé ou expiré.');

  const clientId = clientDeLaRequete(req);
  if (clientId && clientId !== c.client_id) return refusJeton(res, 'invalid_grant', 'Ce code appartient à un autre client.');
  if (corps.redirect_uri && corps.redirect_uri !== c.redirect_uri) return refusJeton(res, 'invalid_grant', 'Adresse de retour différente.');
  if (base64url(crypto.createHash('sha256').update(String(corps.code_verifier)).digest()) !== c.code_challenge) {
    return refusJeton(res, 'invalid_grant', 'Vérification PKCE échouée.');
  }

  const personne = await db.query('SELECT prenom, nom FROM commerciaux WHERE id = $1 AND actif IS NOT FALSE', [c.commercial_id]);
  if (!personne.rows.length) return refusJeton(res, 'invalid_grant', 'Compte retiré de l\'équipe.');
  const client = await clientInscrit(c.client_id);
  const nomClient = client?.nom || 'Assistant';

  const jeton = await creerJeton({ commercialId: c.commercial_id, nom: nomClient, creePar: `oauth:${c.client_id}` });
  try {
    await logActivity(c.commercial_id, 'mcp_jeton_cree', `Accès IA créé par connexion depuis ${nomClient}`, 'mcp', jeton.id);
  } catch { /* le journal ne doit pas bloquer la connexion */ }

  res.set('Cache-Control', 'no-store');
  return res.json({
    access_token: jeton.valeur,
    token_type: 'Bearer',
    expires_in: DUREE_JOURS * 24 * 60 * 60,
    scope: 'suivipro',
  });
});

export default routeur;
