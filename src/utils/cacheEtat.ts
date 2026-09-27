// Le dernier état reçu, gardé sur le téléphone : au démarrage, l'appli s'affiche tout de
// suite avec, puis se met à jour en arrière-plan. Sans lui, chaque ouverture de l'appli
// installée retéléchargeait toute la base derrière un écran de chargement.
//
// IndexedDB plutôt que localStorage : l'état pèse plusieurs Mo, bien au-delà de ce que
// localStorage accepte. Tout échec (navigation privée, stockage plein, iOS qui a vidé le
// cache) revient simplement à « pas de cache » : l'appli charge depuis le serveur.
const BASE = 'suivipro';
const MAGASIN = 'etat';
const CLE = 'dernier';

export interface EtatGarde {
  build: string;
  userId: string;
  empreinte: string | null;
  currentUser: unknown;
  data: unknown;
  garde: number;
}

function ouvrir(): Promise<IDBDatabase> {
  return new Promise((ok, ko) => {
    if (typeof indexedDB === 'undefined') { ko(new Error('IndexedDB absent')); return; }
    const req = indexedDB.open(BASE, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(MAGASIN); };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => ko(req.error);
  });
}

async function operation<T>(mode: IDBTransactionMode, fn: (m: IDBObjectStore) => IDBRequest): Promise<T | null> {
  try {
    const db = await ouvrir();
    return await new Promise<T | null>((ok) => {
      const tx = db.transaction(MAGASIN, mode);
      const req = fn(tx.objectStore(MAGASIN));
      req.onsuccess = () => ok((req.result as T) ?? null);
      req.onerror = () => ok(null);
      tx.oncomplete = () => db.close();
      tx.onabort = () => { db.close(); ok(null); };
    });
  } catch {
    return null;
  }
}

/** L'état gardé pour cette personne et cette version de l'appli, ou null. */
export async function lireEtatGarde(userId: string): Promise<EtatGarde | null> {
  const e = await operation<EtatGarde>('readonly', m => m.get(CLE));
  if (!e || e.userId !== userId || e.build !== __BUILD__) return null;
  return e;
}

let dernierEnregistrement: Promise<unknown> = Promise.resolve();

export function garderEtat(e: Omit<EtatGarde, 'build' | 'garde'>) {
  // Les enregistrements s'enchaînent : le plus récent gagne toujours.
  dernierEnregistrement = dernierEnregistrement.then(() =>
    operation('readwrite', m => m.put({ ...e, build: __BUILD__, garde: Date.now() }, CLE))
  );
}

/** À la déconnexion : rien de la personne ne reste sur l'appareil. */
export function oublierEtat() {
  dernierEnregistrement = dernierEnregistrement.then(() => operation('readwrite', m => m.delete(CLE)));
}

/** L'identifiant de la personne dans le jeton, sans le vérifier (le serveur le fera). */
export function idDuJeton(jeton: string | null): string | null {
  if (!jeton) return null;
  try {
    const charge = JSON.parse(atob(jeton.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof charge.id === 'string' ? charge.id : null;
  } catch {
    return null;
  }
}
