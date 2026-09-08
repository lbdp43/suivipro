// La porte d'entrée du MCP : une route du serveur SuiviPro, pas un service à part.
//
// Elle lit la même base, réutilise les mêmes règles métier, et part avec l'application à
// chaque mise en production. Le jeton arrive dans l'en-tête Authorization, jamais dans
// l'adresse.
import express from 'express';
import cors from 'cors';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { porteurDuJeton, marquerUtilisation } from './jetons.js';
import { construireServeur, outilsDuRole } from './serveur.js';
import { verifierReveil } from './journal.js';
import db from '../db.js';

const routeur = express.Router();

// Un client MCP n'est pas un navigateur de l'application : il lui faut ses propres
// en-têtes, sinon la politique d'origine du site le refuse.
routeur.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id'],
  exposedHeaders: ['mcp-session-id', 'mcp-protocol-version'],
}));

routeur.use(rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  // Un quota par jeton : deux personnes derrière la même adresse ne se gênent pas.
  keyGenerator: (req) => (req.headers.authorization || '').slice(-12) || ipKeyGenerator(req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
}));

routeur.use(express.json({ limit: '1mb' }));

function refus(res, message) {
  res.setHeader('WWW-Authenticate', 'Bearer realm="SuiviPro"');
  return res.status(401).json({
    jsonrpc: '2.0',
    error: { code: -32001, message },
    id: null,
  });
}

/** Le porteur du jeton, ou une fin de non-recevoir. Révoqué, expiré, inconnu : même réponse. */
async function identifier(req, res) {
  const entete = req.headers.authorization || '';
  if (!entete.startsWith('Bearer ')) {
    refus(res, 'Jeton manquant : ajoutez votre accès Claude dans l\'en-tête Authorization.');
    return null;
  }
  const utilisateur = await porteurDuJeton(entete.slice(7).trim());
  if (!utilisateur) {
    refus(res, 'Jeton invalide, révoqué ou expiré. Demandez-en un nouveau dans SuiviPro (Administration → Équipe).');
    return null;
  }
  return utilisateur;
}

// Un coup d'œil rapide pour vérifier que le branchement est bon, sans passer par un client MCP.
routeur.get('/etat', async (req, res) => {
  const utilisateur = await identifier(req, res);
  if (!utilisateur) return undefined;
  return res.json({
    connexion: 'suivipro',
    lecture_seule: true,
    vous: `${utilisateur.prenom} ${utilisateur.nom}`,
    role: utilisateur.role,
    outils: outilsDuRole(utilisateur.role).map(o => o.nom),
  });
});

routeur.post('/', async (req, res) => {
  const utilisateur = await identifier(req, res);
  if (!utilisateur) return undefined;

  // La date de dernière utilisation est ce que l'écran d'administration montre ; un jeton
  // qui dormait depuis un mois et se réveille mérite qu'on prévienne l'admin.
  try {
    const r = await db.query('SELECT derniere_utilisation FROM mcp_jetons WHERE id = $1', [utilisateur.jetonId]);
    verifierReveil(utilisateur, r.rows[0]?.derniere_utilisation);
  } catch { /* la trace ne doit jamais empêcher de répondre */ }
  marquerUtilisation(utilisateur.jetonId);

  // Sans état d'un appel à l'autre : le montage le plus simple derrière un hébergement
  // qui redémarre quand il veut.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const serveur = construireServeur(utilisateur);
  res.on('close', () => { transport.close(); serveur.close(); });
  try {
    await serveur.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[MCP] Requête en échec :', err.stack || err.message);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Erreur interne' }, id: null });
  }
  return undefined;
});

// Sans état, il n'y a pas de flux à ouvrir ni de session à fermer : on le dit clairement.
const sansEtat = (_req, res) => res.status(405).json({
  jsonrpc: '2.0',
  error: { code: -32000, message: 'Ce serveur répond en une seule fois, sans flux ouvert : utilisez POST.' },
  id: null,
});
routeur.get('/', sansEtat);
routeur.delete('/', sansEtat);

export default routeur;
