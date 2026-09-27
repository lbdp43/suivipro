// L'état commun (/state) calculé une fois, pas à chaque passage de chaque téléphone.
//
// Chaque écran redemande l'état toutes les 30 s. Sans cache, le serveur refaisait à chaque
// fois ses 19 requêtes, sérialisait plusieurs Mo et en calculait l'empreinte — pour répondre
// « rien n'a changé » neuf fois sur dix. Ici, l'état commun est gardé en mémoire avec son
// empreinte, et jeté dès qu'une écriture réussit (toute requête autre que GET sur l'API ou
// sur le serveur MCP). Les écritures faites en tâche de fond (synchronisations, tâches
// planifiées) ne passent pas par là : une durée de vie courte les rattrape.
import crypto from 'crypto';

const DUREE_DE_VIE_MS = 60 * 1000;

let generation = 0;
let entree = null;       // { generation, calculeLe, corps, empreinte }
let enCours = null;      // { generation, promesse } : un seul calcul à la fois

/** Une écriture a réussi : l'état en mémoire n'est plus bon. */
export function marquerEcriture() {
  generation++;
  entree = null;
}

/** Middleware : toute requête d'écriture qui réussit invalide l'état commun. */
export function invaliderApresEcriture(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    res.on('finish', () => { if (res.statusCode < 400) marquerEcriture(); });
  }
  next();
}

/**
 * L'état commun sérialisé et son empreinte. `calculer` produit l'objet ; il n'est appelé
 * que si rien de valable n'est en mémoire, et une seule fois même si dix écrans demandent
 * en même temps. Un calcul commencé avant une écriture n'est pas gardé.
 */
export async function etatCommun(calculer) {
  const maintenant = Date.now();
  if (entree && entree.generation === generation && maintenant - entree.calculeLe < DUREE_DE_VIE_MS) return entree;
  if (enCours && enCours.generation === generation) return enCours.promesse;

  const depart = generation;
  const promesse = (async () => {
    const corps = JSON.stringify(await calculer());
    const empreinte = crypto.createHash('md5').update(corps).digest('hex');
    const resultat = { generation: depart, calculeLe: Date.now(), corps, empreinte };
    if (generation === depart) entree = resultat;
    return resultat;
  })();
  enCours = { generation: depart, promesse };
  try {
    return await promesse;
  } finally {
    if (enCours && enCours.promesse === promesse) enCours = null;
  }
}
