// Le répertoire Google : les clients de SuiviPro déposés dans les contacts Google de chacun,
// et l'enrichissement fait là-bas ramené ici.
//
// À quoi ça sert, concrètement : quand un client appelle, son nom s'affiche sur le téléphone
// au lieu d'un numéro inconnu. Et ce qu'on corrige sur le téléphone — un numéro, un e-mail,
// une note — revient dans la fiche.
//
// La connexion est séparée de celle de l'agenda, volontairement : ajouter le droit « contacts »
// à l'autorisation existante aurait obligé tout le monde à reconnecter son agenda pour une
// fonction qu'il n'a peut-être pas demandée. Ici, qui veut le répertoire le branche, et les
// agendas ne bougent pas.
//
// Les règles de la maison, posées avec Guillaume :
// — tous les clients partent chez tous ceux qui se connectent, pas seulement leur portefeuille ;
// — le nom de l'établissement appartient à SuiviPro : il part, il ne revient jamais ;
// — un contact créé dans Google ne crée rien ici ;
// — une suppression dans Google ne supprime jamais une fiche.
import { Router } from 'express';
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import db from './db.js';
import { encrypt, decrypt } from './crypto.js';
import {
  CHAMPS_PERSONNE, CHAMPS_MODIFIABLES, NOM_DU_GROUPE,
  contactDepuisClient, valeursDuClient, valeursDeLaPersonne,
  empreinte, changementsDepuisContact, identifiantInscrit,
} from './lib/contactsGoogle.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
// L'adresse de retour. Google n'accepte que celles déclarées dans sa console : celle du
// répertoire doit y être ajoutée à côté de celle de l'agenda.
//
// Par défaut on la déduit de celle de l'agenda en changeant le dernier segment. Si cette
// déduction ne donne rien — adresse écrite autrement — on ne se rabat surtout pas sur celle
// de l'agenda : l'autorisation reviendrait sur le mauvais guichet et échouerait sans dire
// pourquoi. Dans ce cas la fonction est simplement déclarée non configurée, et
// GOOGLE_CONTACTS_REDIRECT_URI permet de la donner en toutes lettres.
const REDIRECT_AGENDA = process.env.GOOGLE_REDIRECT_URI || '';
const REDIRECT_DEDUIT = /google-calendar\/callback$/.test(REDIRECT_AGENDA)
  ? REDIRECT_AGENDA.replace(/google-calendar\/callback$/, 'google-contacts/callback')
  : '';
const REDIRECT_URI = process.env.GOOGLE_CONTACTS_REDIRECT_URI || REDIRECT_DEDUIT;
const PORTEE = ['https://www.googleapis.com/auth/contacts'];

/** Google refuse plus de 200 contacts par lot, et plus de 200 identifiants par relecture. */
const PAR_LOT = 200;

function clientOAuth() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Token invalide' }); }
}
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const configure = () => !!(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);

// ============================================================
// La connexion
// ============================================================

async function jetonDe(commercialId) {
  const r = await db.query('SELECT * FROM google_contacts_tokens WHERE commercial_id = $1', [commercialId]);
  return r.rows[0] || null;
}

/**
 * Le client Google prêt à parler, avec le rafraîchissement du jeton déjà branché.
 * Google renvoie un nouveau jeton d'accès quand l'ancien expire : si on ne le range pas,
 * la synchronisation suivante repart d'un jeton périmé et échoue.
 */
function connexion(jeton) {
  const oauth = clientOAuth();
  oauth.setCredentials({
    access_token: decrypt(jeton.access_token),
    refresh_token: decrypt(jeton.refresh_token),
    expiry_date: Number(jeton.expiry_date) || undefined,
  });
  oauth.on('tokens', (t) => {
    if (!t.access_token) return;
    db.query('UPDATE google_contacts_tokens SET access_token = $1, expiry_date = $2 WHERE commercial_id = $3',
      [encrypt(t.access_token), t.expiry_date || 0, jeton.commercial_id]).catch(() => {});
  });
  return google.people({ version: 'v1', auth: oauth });
}

// On renvoie aussi l'adresse de retour attendue. Elle n'est pas secrete — elle figure en
// clair dans l'URL d'autorisation — et c'est la seule chose a savoir quand Google refuse
// avec « redirect_uri_mismatch » : il suffit de la declarer dans la console. Sans ca, il
// faut la deviner.
router.get('/google-contacts/config-status', authMiddleware, (req, res) => {
  res.json({ configured: configure(), retour: REDIRECT_URI });
});

router.get('/google-contacts/status', authMiddleware, asyncHandler(async (req, res) => {
  const r = await db.query('SELECT commercial_id, contacts_email, connected_at, derniere_sync, dernier_bilan FROM google_contacts_tokens');
  const etats = {};
  for (const t of r.rows) {
    etats[t.commercial_id] = {
      connected: true,
      contacts_email: t.contacts_email,
      connected_at: t.connected_at,
      derniere_sync: t.derniere_sync || '',
      dernier_bilan: t.dernier_bilan || '',
    };
  }
  res.json(etats);
}));

router.get('/google-contacts/authorize', authMiddleware, (req, res) => {
  if (!configure()) {
    return res.status(400).json({
      error: 'Repertoire Google non configure. Il faut GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, et une adresse de retour se terminant par /api/google-contacts/callback (deduite de GOOGLE_REDIRECT_URI, ou donnee par GOOGLE_CONTACTS_REDIRECT_URI) declaree dans la console Google.',
    });
  }
  const etat = jwt.sign({ userId: req.user.id }, JWT_SECRET, { expiresIn: '10m' });
  const url = clientOAuth().generateAuthUrl({
    access_type: 'offline', prompt: 'consent', scope: PORTEE, state: etat,
  });
  res.json({ url });
});

function pageFermeture(titre, couleur, fond, message) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${titre}</title></head>
    <body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:${fond};">
      <div style="text-align:center;padding:2rem;">
        <h2 style="color:${couleur};">${titre}</h2>
        <p style="color:#6b7280;">${message}</p>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'GOOGLE_CONTACTS_CONNECTED' }, '*');
            setTimeout(function () { window.close(); }, 2000);
          }
        </script>
      </div>
    </body></html>`;
}

router.get('/google-contacts/callback', asyncHandler(async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send(pageFermeture('Parametres manquants', '#dc2626', '#fef2f2', 'Fermez cette fenetre et reessayez.'));

  let userId;
  try { userId = jwt.verify(state, JWT_SECRET).userId; }
  catch { return res.status(400).send(pageFermeture('Lien expire', '#dc2626', '#fef2f2', 'Fermez cette fenetre et reessayez.')); }

  const existe = await db.query('SELECT id FROM commerciaux WHERE id = $1', [userId]);
  if (existe.rows.length === 0) return res.status(404).send(pageFermeture('Utilisateur introuvable', '#dc2626', '#fef2f2', 'Fermez cette fenetre.'));

  try {
    const oauth = clientOAuth();
    const { tokens } = await oauth.getToken(code);
    oauth.setCredentials(tokens);

    let adresse = '';
    try {
      const people = google.people({ version: 'v1', auth: oauth });
      const moi = await people.people.get({ resourceName: 'people/me', personFields: 'emailAddresses' });
      adresse = moi.data.emailAddresses?.[0]?.value || '';
    } catch { /* pas critique */ }

    // Un jeton de rafraichissement vide ecraserait celui qu'on a deja : Google ne le renvoie
    // qu'a la premiere autorisation. On garde l'ancien dans ce cas.
    const ancien = await jetonDe(userId);
    const rafraichissement = tokens.refresh_token
      ? encrypt(tokens.refresh_token)
      : (ancien ? ancien.refresh_token : encrypt(''));

    await db.query(
      `INSERT INTO google_contacts_tokens (commercial_id, access_token, refresh_token, expiry_date, contacts_email, connected_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (commercial_id) DO UPDATE SET access_token=$2, refresh_token=$3, expiry_date=$4, contacts_email=$5, connected_at=$6`,
      [userId, encrypt(tokens.access_token || ''), rafraichissement, tokens.expiry_date || 0, adresse, new Date().toISOString()]
    );
    res.send(pageFermeture('Repertoire Google connecte', '#16a34a', '#f9fafb', 'Vous pouvez fermer cette fenetre.'));
  } catch (err) {
    console.error('Google Contacts callback:', err.message);
    res.status(500).send(pageFermeture('Erreur de connexion', '#dc2626', '#fef2f2', 'Fermez cette fenetre et reessayez.'));
  }
}));

router.post('/google-contacts/disconnect', authMiddleware, asyncHandler(async (req, res) => {
  const cible = req.body.commercial_id || req.user.id;
  if (cible !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Non autorise' });

  const jeton = await jetonDe(cible);
  if (jeton) {
    try { clientOAuth().revokeToken(decrypt(jeton.access_token)).catch(() => {}); } catch { /* non critique */ }
  }
  // Les liens partent avec la connexion : si l'on se reconnecte, on repart d'un repertoire
  // propre plutot que de pointer vers des contacts qui n'existent peut-etre plus.
  await db.query('DELETE FROM google_contacts_liens WHERE commercial_id = $1', [cible]);
  await db.query('DELETE FROM google_contacts_tokens WHERE commercial_id = $1', [cible]);
  res.json({ ok: true });
}));


// ============================================================
// La synchronisation
// ============================================================

/** Les colonnes que Google a le droit de modifier. Le nom n'y est pas, et n'y sera pas. */
const COLONNES = ['contact', 'telephone', 'telephone_mobile', 'email', 'adresse', 'code_postal', 'ville', 'notes'];

const parPaquets = (liste, taille) => {
  const paquets = [];
  for (let i = 0; i < liste.length; i += taille) paquets.push(liste.slice(i, i + taille));
  return paquets;
};

/**
 * Le libellé « SuiviPro » dans les contacts Google, créé au besoin.
 * Tout ce que SuiviPro dépose y est rangé : c'est ce qui permet de tout retirer d'un geste
 * depuis Google, sans toucher au reste du répertoire.
 */
async function groupeDe(people, jeton) {
  if (jeton.groupe_resource) return jeton.groupe_resource;
  const liste = await people.contactGroups.list({ pageSize: 1000 });
  const existant = (liste.data.contactGroups || []).find(g => g.name === NOM_DU_GROUPE && g.groupType === 'USER_CONTACT_GROUP');
  const resource = existant
    ? existant.resourceName
    : (await people.contactGroups.create({ requestBody: { contactGroup: { name: NOM_DU_GROUPE } } })).data.resourceName;
  await db.query('UPDATE google_contacts_tokens SET groupe_resource = $1 WHERE commercial_id = $2', [resource, jeton.commercial_id]);
  return resource;
}

/**
 * Ce qui a changé dans Google depuis la dernière fois, ramené dans les fiches.
 *
 * On ne relit pas tout le répertoire : Google sait rendre la liste des contacts modifiés
 * depuis un jeton. C'est ce qui garantit qu'une valeur que personne n'a touchée dans Google
 * ne peut pas écraser une correction faite dans SuiviPro.
 *
 * @returns {Promise<string>} le nouveau jeton de suivi.
 */
/** Le compte rendu d'une synchronisation, remis à zéro. */
export function bilanVierge() {
  return {
    crees: 0, mis_a_jour: 0, retires: 0, readoptes: 0,
    rapatries: 0, ignores: 0, refuses_vides: 0, supprimes_chez_google: 0,
    champs_rapatries: [], notes: [],
  };
}

// Exportées pour pouvoir être éprouvées sans compte Google : elles reçoivent le client
// People en paramètre, donc un double suffit à rejouer une synchronisation entière contre
// une vraie base. C'est la seule façon de vérifier ici ce qui casse le plus facilement —
// les doublons, les contacts orphelins, l'écrasement d'une correction.
export async function relever(people, commercialId, jetonSync, bilan) {
  const liens = await db.query('SELECT * FROM google_contacts_liens WHERE commercial_id = $1', [commercialId]);
  const parResource = new Map(liens.rows.map(l => [l.resource_name, l]));
  const parClient = new Map(liens.rows.map(l => [l.client_id, l]));
  // Les fiches existantes, pour reconnaitre nos propres contacts quand le lien a ete perdu.
  const fiches = new Set((await db.query('SELECT id FROM clients')).rows.map(r => r.id));

  const lire = async (avecJeton) => {
    const pages = [];
    let pageToken;
    let suivant = '';
    do {
      const r = await people.people.connections.list({
        resourceName: 'people/me',
        personFields: CHAMPS_PERSONNE,
        pageSize: 1000,
        requestSyncToken: true,
        ...(avecJeton ? { syncToken: avecJeton } : {}),
        ...(pageToken ? { pageToken } : {}),
      });
      pages.push(...(r.data.connections || []));
      pageToken = r.data.nextPageToken || '';
      suivant = r.data.nextSyncToken || suivant;
    } while (pageToken);
    return { personnes: pages, jeton: suivant };
  };

  let resultat;
  try {
    resultat = await lire(jetonSync);
  } catch (err) {
    // 410 : le jeton de suivi a expiré (Google les périme au bout de sept jours).
    // On relit alors tout le répertoire — c'est plus long, mais sans danger : chaque contact
    // est comparé à ce qu'on avait déposé, donc rien ne bouge là où rien n'a changé.
    if (err?.code === 410 || err?.response?.status === 410) {
      bilan.notes.push('Jeton de suivi expiré : répertoire relu en entier.');
      resultat = await lire('');
    } else throw err;
  }

  for (const personne of resultat.personnes) {
    if (personne.metadata?.deleted) {
      // Une suppression dans Google ne touche jamais la fiche. On oublie seulement le lien :
      // le contact sera redéposé à la prochaine synchronisation, puisque le répertoire est
      // le reflet de SuiviPro et non l'inverse.
      const lien = parResource.get(personne.resourceName);
      if (lien) {
        await db.query('DELETE FROM google_contacts_liens WHERE commercial_id = $1 AND client_id = $2', [commercialId, lien.client_id]);
        parResource.delete(personne.resourceName);
        parClient.delete(lien.client_id);
        bilan.supprimes_chez_google += 1;
      }
      continue;
    }

    // Un contact qu'on n'a pas déposé ne crée rien dans SuiviPro : c'est la règle.
    //
    // Mais un contact que nous avons déposé nous-mêmes porte l'identifiant de sa fiche. Si le
    // lien a été perdu — répertoire déconnecté puis rebranché — il faut le reconnaître et le
    // réadopter, sinon la synchronisation suivante le recrée et le téléphone se retrouve avec
    // deux exemplaires de chaque client.
    let lien = parResource.get(personne.resourceName);
    if (!lien) {
      const id = identifiantInscrit(personne);
      if (id && parClient.has(id)) {
        lien = parClient.get(id);
      } else if (id && fiches.has(id)) {
        lien = {
          client_id: id,
          resource_name: personne.resourceName,
          etag: personne.etag || '',
          // L'empreinte prend les valeurs de Google : le prochain dépôt corrigera de lui-même
          // ce qui diffère de la fiche, à commencer par le nom.
          empreinte: empreinte(valeursDeLaPersonne(personne)),
        };
        await db.query(
          `INSERT INTO google_contacts_liens (commercial_id, client_id, resource_name, etag, empreinte)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (commercial_id, client_id) DO UPDATE SET resource_name=$3, etag=$4, empreinte=$5`,
          [commercialId, id, lien.resource_name, lien.etag, lien.empreinte]
        );
        parResource.set(personne.resourceName, lien);
        parClient.set(id, lien);
        bilan.readoptes += 1;
        continue;
      } else { bilan.ignores += 1; continue; }
    }

    const changements = changementsDepuisContact(personne, lien.empreinte);
    const cles = Object.keys(changements).filter(c => COLONNES.includes(c));
    if (cles.length === 0) continue;

    // Garde-fou : un contact qui revient entièrement vide alors qu'il portait des
    // coordonnées n'est pas une modification, c'est un accident — contact vidé sur le
    // téléphone, synchronisation à moitié faite. On refuse plutôt que de vider la fiche.
    // Effacer un seul champ reste permis : c'est une correction ordinaire.
    let avant;
    try { avant = JSON.parse(lien.empreinte || '{}'); } catch { avant = {}; }
    const toutSeraitVide = COLONNES.every(c => (c in changements ? changements[c] : (avant[c] || '')) === '');
    const portaitQuelqueChose = COLONNES.some(c => (avant[c] || '') !== '');
    if (toutSeraitVide && portaitQuelqueChose) {
      bilan.refuses_vides += 1;
      bilan.notes.push(`Contact revenu vide, fiche laissée intacte : ${valeursDeLaPersonne(personne).nom || personne.resourceName}`);
      continue;
    }

    const set = cles.map((c, i) => `${c} = $${i + 1}`).join(', ');
    const valeurs = cles.map(c => changements[c]);
    await db.query(
      `UPDATE clients SET ${set}, date_modification = $${cles.length + 1} WHERE id = $${cles.length + 2}`,
      [...valeurs, new Date().toISOString(), lien.client_id]
    );
    await db.query(
      'UPDATE google_contacts_liens SET empreinte = $1, etag = $2, resource_name = $3 WHERE commercial_id = $4 AND client_id = $5',
      [empreinte(valeursDeLaPersonne(personne)), personne.etag || '', personne.resourceName, commercialId, lien.client_id]
    );
    bilan.rapatries += 1;
    bilan.champs_rapatries.push(`${lien.client_id} : ${cles.join(', ')}`);
  }

  return resultat.jeton || jetonSync || '';
}

/** Les clients déposés dans le répertoire : créés, mis à jour, ou retirés s'ils n'existent plus. */
export async function deposer(people, commercialId, groupe, bilan) {
  const clients = (await db.query(
    'SELECT id, nom, contact, telephone, telephone_mobile, email, adresse, code_postal, ville, notes FROM clients ORDER BY nom'
  )).rows;
  const liens = (await db.query('SELECT * FROM google_contacts_liens WHERE commercial_id = $1', [commercialId])).rows;
  const parClient = new Map(liens.map(l => [l.client_id, l]));

  const aCreer = [];
  const aMettreAJour = [];
  for (const client of clients) {
    const valeurs = valeursDuClient(client);
    const marque = empreinte(valeurs);
    const lien = parClient.get(client.id);
    if (!lien) aCreer.push({ client, marque });
    else if (lien.empreinte !== marque) aMettreAJour.push({ client, marque, lien });
  }

  // Créations
  for (const paquet of parPaquets(aCreer, PAR_LOT)) {
    const r = await people.people.batchCreateContacts({
      requestBody: {
        contacts: paquet.map(({ client }) => ({ contactPerson: contactDepuisClient(client, groupe) })),
        readMask: CHAMPS_PERSONNE,
      },
    });
    // On retrouve chaque contact par l'identifiant qu'on y a inscrit, et non par sa position
    // dans la réponse : un décalage silencieux rattacherait une fiche au mauvais contact.
    for (const reponse of (r.data.createdPeople || [])) {
      const personne = reponse.person;
      if (!personne) continue;
      const id = identifiantInscrit(personne);
      const attendu = paquet.find(p => p.client.id === id);
      if (!attendu) { bilan.notes.push('Contact créé sans identifiant reconnaissable, ignoré.'); continue; }
      await db.query(
        `INSERT INTO google_contacts_liens (commercial_id, client_id, resource_name, etag, empreinte)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (commercial_id, client_id) DO UPDATE SET resource_name=$3, etag=$4, empreinte=$5`,
        [commercialId, id, personne.resourceName, personne.etag || '', attendu.marque]
      );
      bilan.crees += 1;
    }
  }

  // Mises à jour. Google exige l'etag courant du contact : on le rafraîchit juste avant,
  // sinon une modification faite sur le téléphone entre deux synchronisations ferait échouer
  // la mise à jour, et elle échouerait de nouveau à chaque fois.
  for (const paquet of parPaquets(aMettreAJour, PAR_LOT)) {
    const noms = paquet.map(p => p.lien.resource_name);
    const frais = await people.people.getBatchGet({ resourceNames: noms, personFields: CHAMPS_PERSONNE });
    const etags = new Map();
    for (const rep of (frais.data.responses || [])) {
      if (rep.person?.resourceName) etags.set(rep.person.resourceName, rep.person.etag || '');
    }

    const contacts = {};
    const retenus = [];
    for (const item of paquet) {
      const etag = etags.get(item.lien.resource_name);
      // Sans etag, le contact n'existe plus chez Google : on oublie le lien et il sera
      // recréé à la synchronisation suivante.
      if (etag === undefined) {
        await db.query('DELETE FROM google_contacts_liens WHERE commercial_id = $1 AND client_id = $2', [commercialId, item.client.id]);
        bilan.notes.push(`Contact introuvable chez Google, sera recréé : ${item.client.nom}`);
        continue;
      }
      contacts[item.lien.resource_name] = { etag, ...contactDepuisClient(item.client) };
      retenus.push(item);
    }
    if (retenus.length === 0) continue;

    await people.people.batchUpdateContacts({
      requestBody: { contacts, updateMask: CHAMPS_MODIFIABLES, readMask: CHAMPS_PERSONNE },
    });
    for (const item of retenus) {
      await db.query(
        'UPDATE google_contacts_liens SET empreinte = $1 WHERE commercial_id = $2 AND client_id = $3',
        [item.marque, commercialId, item.client.id]
      );
      bilan.mis_a_jour += 1;
    }
  }

  // Les fiches disparues de SuiviPro quittent le répertoire : il en est le reflet.
  const vivants = new Set(clients.map(c => c.id));
  const orphelins = liens.filter(l => !vivants.has(l.client_id));
  for (const paquet of parPaquets(orphelins, PAR_LOT)) {
    await people.people.batchDeleteContacts({ requestBody: { resourceNames: paquet.map(l => l.resource_name) } });
    for (const l of paquet) {
      await db.query('DELETE FROM google_contacts_liens WHERE commercial_id = $1 AND client_id = $2', [commercialId, l.client_id]);
      bilan.retires += 1;
    }
  }
}

router.post('/google-contacts/sync', authMiddleware, asyncHandler(async (req, res) => {
  const commercialId = req.user.id;
  const jeton = await jetonDe(commercialId);
  if (!jeton) return res.status(400).json({ error: 'Repertoire Google non connecte.' });

  const bilan = bilanVierge();

  try {
    const people = connexion(jeton);
    const groupe = await groupeDe(people, jeton);

    // L'ordre compte. On relève d'abord ce qui a changé chez Google, puis on dépose. Une
    // deuxième relève referme la boucle et rafraîchit le jeton : nos propres écritures y
    // reviennent, mais l'empreinte les reconnaît et rien n'est réappliqué.
    let jetonSync = await relever(people, commercialId, jeton.jeton_sync || '', bilan);
    await deposer(people, commercialId, groupe, bilan);
    jetonSync = await relever(people, commercialId, jetonSync, bilan);

    const resume = `${bilan.crees} ajoutés, ${bilan.mis_a_jour} mis à jour, ${bilan.retires} retirés, ${bilan.rapatries} rapatriés`;
    await db.query(
      'UPDATE google_contacts_tokens SET jeton_sync = $1, derniere_sync = $2, dernier_bilan = $3 WHERE commercial_id = $4',
      [jetonSync, new Date().toISOString(), resume, commercialId]
    );
    res.json({ ok: true, resume, ...bilan });
  } catch (err) {
    console.error('Google Contacts sync:', err?.message, err?.response?.data?.error?.message || '');
    const detail = err?.response?.data?.error?.message || err?.message || 'erreur inconnue';
    res.status(502).json({ error: `La synchronisation a echoue : ${detail}`, ...bilan });
  }
}));

export default router;
