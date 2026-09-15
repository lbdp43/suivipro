// Rejoue une synchronisation complète du répertoire Google, sans compte Google.
//
// Pourquoi ce script existe : la synchronisation est la partie du logiciel où une erreur
// coûte le plus cher — un numéro écrasé, un client en double dans le téléphone de toute
// l'équipe, un contact qui ne part jamais. Rien de tout ça ne se voit à la lecture du code,
// et on ne peut pas l'essayer « pour voir » sur le vrai répertoire de quelqu'un.
//
// Il remplace donc Google par un double en mémoire et fait tourner le vrai moteur contre la
// vraie base. Il ne touche QUE les fiches qu'il crée lui-même, et les efface en partant.
//
//   DATABASE_URL=postgresql://... node verifications/repertoire-google.mjs
//
// Refuse de démarrer sur autre chose qu'une base locale : il supprime des lignes.
const URL_BASE = process.env.DATABASE_URL || '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(URL_BASE)) {
  console.error('Refus : ce script écrit et supprime. Il ne tourne que sur une base locale.');
  console.error('DATABASE_URL doit pointer vers localhost.');
  process.exit(2);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'verification';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';

const { default: db } = await import('../server/db.js');
const { relever, deposer, bilanVierge } = await import('../server/google-contacts.js');
const { valeursDeLaPersonne } = await import('../server/lib/contactsGoogle.js');

let ko = 0;
const ok = (nom, cond, detail) => {
  console.log(`${cond ? '  ok  ' : ' ECHEC'} ${nom}${cond ? '' : ' -> ' + JSON.stringify(detail)}`);
  if (!cond) ko++;
};

// ---- Le double de Google -------------------------------------------------------
// Il se comporte comme l'API : il attribue des identifiants, exige l'etag courant pour
// toute modification, et ne rend que les contacts modifiés quand on lui donne un jeton.
function doubleGoogle() {
  const contacts = new Map();
  const modifies = new Set();
  let n = 0, version = 0;
  return {
    contacts,
    marquer: (rn) => modifies.add(rn),
    contactGroups: {
      list: async () => ({ data: { contactGroups: [] } }),
      create: async () => ({ data: { resourceName: 'contactGroups/suivipro' } }),
    },
    people: {
      connections: {
        list: async ({ syncToken }) => {
          const tous = [...contacts.values()];
          const rendus = syncToken ? tous.filter(p => modifies.has(p.resourceName)) : tous;
          modifies.clear();
          return { data: { connections: rendus, nextSyncToken: `jeton-${++version}` } };
        },
      },
      batchCreateContacts: async ({ requestBody }) => ({
        data: {
          createdPeople: requestBody.contacts.map(({ contactPerson }) => {
            const resourceName = `people/c${++n}`;
            const personne = { ...contactPerson, resourceName, etag: `e${n}` };
            contacts.set(resourceName, personne);
            return { person: personne };
          }),
        },
      }),
      getBatchGet: async ({ resourceNames }) => ({
        data: { responses: resourceNames.filter(r => contacts.has(r)).map(r => ({ person: contacts.get(r) })) },
      }),
      batchUpdateContacts: async ({ requestBody }) => {
        for (const [rn, personne] of Object.entries(requestBody.contacts)) {
          const actuel = contacts.get(rn);
          if (!actuel) continue;
          if (personne.etag !== actuel.etag) throw new Error(`etag perime sur ${rn}`);
          contacts.set(rn, { ...personne, resourceName: rn, etag: `e${++n}` });
        }
        return { data: {} };
      },
      batchDeleteContacts: async ({ requestBody }) => {
        for (const rn of requestBody.resourceNames) contacts.delete(rn);
        return { data: {} };
      },
    },
  };
}

// ---- Des fiches à nous, effacées en partant --------------------------------------
const MARQUE = 'zz-verif-repertoire';
const GROUPE = 'contactGroups/suivipro';

async function menage(commercialId) {
  await db.query('DELETE FROM google_contacts_liens WHERE client_id LIKE $1', [`${MARQUE}%`]);
  if (commercialId) await db.query('DELETE FROM google_contacts_liens WHERE commercial_id = $1', [commercialId]);
  await db.query('DELETE FROM clients WHERE id LIKE $1', [`${MARQUE}%`]);
}

const commercial = (await db.query('SELECT id FROM commerciaux LIMIT 1')).rows[0];
if (!commercial) { console.error('Aucun commercial dans la base : rien à vérifier.'); process.exit(2); }
const COM = commercial.id;

await menage(COM);
const maintenant = new Date().toISOString();
for (const [n, nom] of [['1', 'Verif Le Petit Bouchon'], ['2', 'Verif La Cave du Coin']]) {
  await db.query(
    `INSERT INTO clients (id, nom, ville, adresse, code_postal, telephone, telephone_mobile, email, contact,
       type_client, statut, commercial_id, notes, date_creation, date_modification)
     VALUES ($1,$2,'Saint-Etienne','2 rue des Martyrs','42000','04 77 12 34 5' || $3, '06 11 22 33 4' || $3,
       'verif' || $3 || '@exemple.fr','Jean Dupont','BAR_RESTAURANT_GENERAL','ACTIF',$4,'Livraison le mardi',$5,$5)`,
    [`${MARQUE}-${n}`, nom, n, COM, maintenant]
  );
}

const g = doubleGoogle();
const total = Number((await db.query('SELECT count(*) FROM clients')).rows[0].count);

try {
  // 1. Premier dépôt : tous les clients partent, un lien par fiche.
  let b = bilanVierge();
  let jeton = await relever(g, COM, '', b);
  await deposer(g, COM, GROUPE, b);
  ok(`premier dépôt : les ${total} clients partent`, b.crees === total, b);
  ok('un lien par fiche',
    Number((await db.query('SELECT count(*) FROM google_contacts_liens WHERE commercial_id=$1', [COM])).rows[0].count) === total);

  // 2. Rien n'a bougé : une deuxième synchronisation ne doit rien faire.
  b = bilanVierge();
  jeton = await relever(g, COM, jeton, b);
  await deposer(g, COM, GROUPE, b);
  ok('deuxième passage à vide', b.crees === 0 && b.mis_a_jour === 0 && b.rapatries === 0, b);

  // 3. Enrichissement fait dans Google : ce qui remonte, et ce qui ne remonte pas.
  const lien = (await db.query('SELECT * FROM google_contacts_liens WHERE commercial_id=$1 AND client_id=$2', [COM, `${MARQUE}-1`])).rows[0];
  const avant = (await db.query('SELECT nom, telephone, notes FROM clients WHERE id=$1', [`${MARQUE}-1`])).rows[0];
  g.contacts.set(lien.resource_name, {
    ...g.contacts.get(lien.resource_name),
    names: [{ displayName: 'NOM CHANGE SUR LE TELEPHONE', givenName: 'NOM CHANGE SUR LE TELEPHONE' }],
    phoneNumbers: [{ value: '04 00 00 00 00', type: 'work' }],
    biographies: [{ value: 'Code portail 4512.' }],
  });
  g.marquer(lien.resource_name);
  b = bilanVierge();
  jeton = await relever(g, COM, jeton, b);
  let fiche = (await db.query('SELECT nom, telephone, notes FROM clients WHERE id=$1', [`${MARQUE}-1`])).rows[0];
  ok('le numéro corrigé dans Google remonte', fiche.telephone === '04 00 00 00 00', fiche);
  ok('la note ajoutée dans Google remonte', fiche.notes === 'Code portail 4512.', fiche);
  ok('le nom changé dans Google ne remonte PAS', fiche.nom === avant.nom, { avant: avant.nom, apres: fiche.nom });

  b = bilanVierge();
  await deposer(g, COM, GROUPE, b);
  ok('et le dépôt suivant remet le bon nom dans Google',
    valeursDeLaPersonne(g.contacts.get(lien.resource_name)).nom === avant.nom);

  // 4. Le cas dangereux : corriger dans SuiviPro pendant que Google ne bouge pas.
  await db.query("UPDATE clients SET telephone='04 99 99 99 99' WHERE id=$1", [`${MARQUE}-1`]);
  b = bilanVierge();
  jeton = await relever(g, COM, jeton, b);
  fiche = (await db.query('SELECT telephone FROM clients WHERE id=$1', [`${MARQUE}-1`])).rows[0];
  ok('une correction faite dans SuiviPro n\'est pas écrasée', fiche.telephone === '04 99 99 99 99', fiche);
  b = bilanVierge();
  await deposer(g, COM, GROUPE, b);
  ok('et elle part bien vers Google',
    valeursDeLaPersonne(g.contacts.get(lien.resource_name)).telephone === '04 99 99 99 99');

  // 5. Fiche supprimée dans SuiviPro : le contact doit quitter le répertoire.
  const lien2 = (await db.query('SELECT * FROM google_contacts_liens WHERE commercial_id=$1 AND client_id=$2', [COM, `${MARQUE}-2`])).rows[0];
  await db.query('DELETE FROM clients WHERE id=$1', [`${MARQUE}-2`]);
  ok('le lien survit à la fiche (sinon le contact resterait orphelin dans le téléphone)',
    Number((await db.query('SELECT count(*) FROM google_contacts_liens WHERE commercial_id=$1 AND client_id=$2', [COM, `${MARQUE}-2`])).rows[0].count) === 1);
  b = bilanVierge();
  await deposer(g, COM, GROUPE, b);
  ok('le contact est retiré de Google', b.retires === 1 && !g.contacts.has(lien2.resource_name), b);

  // 6. Déconnexion puis reconnexion : reprendre l'existant, ne pas le recréer.
  const avantReconnexion = g.contacts.size;
  await db.query('DELETE FROM google_contacts_liens WHERE commercial_id=$1', [COM]);
  b = bilanVierge();
  jeton = await relever(g, COM, '', b);
  await deposer(g, COM, GROUPE, b);
  ok(`reconnexion sans doublon (${g.contacts.size} contacts, ${avantReconnexion} avant)`,
    g.contacts.size === avantReconnexion, { avant: avantReconnexion, apres: g.contacts.size });
  ok('les contacts déjà là sont repris, pas recréés', b.crees === 0 && b.readoptes === avantReconnexion, b);

  // 7. Contact revenu entièrement vide : accident, pas modification.
  const lien3 = (await db.query('SELECT * FROM google_contacts_liens WHERE commercial_id=$1 AND client_id=$2', [COM, `${MARQUE}-1`])).rows[0];
  const plein = (await db.query('SELECT telephone, email, notes FROM clients WHERE id=$1', [`${MARQUE}-1`])).rows[0];
  g.contacts.set(lien3.resource_name, { resourceName: lien3.resource_name, etag: 'vide', names: [{ displayName: 'x' }] });
  g.marquer(lien3.resource_name);
  b = bilanVierge();
  await relever(g, COM, jeton, b);
  const apres = (await db.query('SELECT telephone, email, notes FROM clients WHERE id=$1', [`${MARQUE}-1`])).rows[0];
  ok('un contact revenu vide ne vide pas la fiche',
    apres.telephone === plein.telephone && apres.email === plein.email && apres.notes === plein.notes,
    { avant: plein, apres });
  ok('et le refus apparaît dans le compte rendu', b.refuses_vides === 1, b);
} finally {
  await menage(COM);
}

console.log(ko === 0 ? '\nTOUT PASSE' : `\n${ko} ECHEC(S)`);
process.exit(ko === 0 ? 0 : 1);
