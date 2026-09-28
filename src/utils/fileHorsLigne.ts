// La tournée sans réseau : les visites et appels notés chez un client quand le téléphone
// n'a pas de réseau sont gardés ici, puis envoyés tout seuls, dans l'ordre, dès que le
// réseau revient (ou à la prochaine ouverture de l'appli).
//
// Chaque envoi porte l'identifiant de la visite, choisi sur le téléphone : si un envoi part
// deux fois (réseau qui coupe au mauvais moment), le serveur reconnaît la visite et ne
// l'enregistre pas une seconde fois. La date est celle où la visite a été notée, pas celle
// de l'envoi. Le calendrier du client ne bouge qu'une fois la visite reçue par le serveur,
// qui applique ses règles.
//
// Un refus du serveur (client désactivé entre-temps, par exemple) ne perd rien : la visite
// passe « à revoir », avec la raison, pour être renvoyée ou retirée.
//
// Rangée à part de l'état gardé (cacheEtat.ts) : ni une déconnexion ni une nouvelle version
// de l'appli ne l'effacent.
import type { SaisieInteraction } from './interactions';

const BASE = 'suivipro-envois';
const MAGASIN = 'envois';

export interface EnvoiEnAttente {
  id: string;
  utilisateur: string;
  saisie: SaisieInteraction & { id: string; date: string };
  note_le: string;
  etat: 'attente' | 'a_revoir';
  raison?: string;
  /** Pour l'affichage sans aller chercher la fiche. */
  client_nom?: string;
}

function ouvrir(): Promise<IDBDatabase> {
  return new Promise((ok, ko) => {
    if (typeof indexedDB === 'undefined') { ko(new Error('IndexedDB absent')); return; }
    const req = indexedDB.open(BASE, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(MAGASIN, { keyPath: 'id' }); };
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

// Ceux qui affichent la file (en-tête, fiche client) sont prévenus à chaque changement.
type Ecouteur = (envois: EnvoiEnAttente[]) => void;
const ecouteurs = new Set<Ecouteur>();
let derniere: EnvoiEnAttente[] = [];

export function ecouterLaFile(f: Ecouteur): () => void {
  ecouteurs.add(f);
  f(derniere);
  return () => { ecouteurs.delete(f); };
}

async function tout(): Promise<EnvoiEnAttente[]> {
  return (await operation<EnvoiEnAttente[]>('readonly', m => m.getAll())) || [];
}

/** La file de cette personne, dans l'ordre où les visites ont été notées. */
export async function lireLaFile(utilisateur: string): Promise<EnvoiEnAttente[]> {
  const liste = (await tout()).filter(e => e.utilisateur === utilisateur);
  return liste.sort((a, b) => a.note_le.localeCompare(b.note_le));
}

async function prevenir(utilisateur: string) {
  derniere = await lireLaFile(utilisateur);
  for (const f of ecouteurs) f(derniere);
}

export async function mettreEnFile(e: Omit<EnvoiEnAttente, 'etat' | 'note_le'>) {
  const envoi: EnvoiEnAttente = { ...e, etat: 'attente', note_le: new Date().toISOString() };
  await operation('readwrite', m => m.put(envoi));
  await prevenir(e.utilisateur);
}

export async function retirerDeLaFile(id: string, utilisateur: string) {
  await operation('readwrite', m => m.delete(id));
  await prevenir(utilisateur);
}

async function changer(id: string, utilisateur: string, modif: Partial<EnvoiEnAttente>) {
  const e = await operation<EnvoiEnAttente>('readonly', m => m.get(id));
  if (!e) return;
  await operation('readwrite', m => m.put({ ...e, ...modif }));
  await prevenir(utilisateur);
}

/** Une visite « à revoir » repart dans la file, à renvoyer au prochain passage. */
export function remettreEnAttente(id: string, utilisateur: string) {
  return changer(id, utilisateur, { etat: 'attente', raison: undefined });
}

export function marquerARevoir(id: string, utilisateur: string, raison: string) {
  return changer(id, utilisateur, { etat: 'a_revoir', raison });
}

/** Au démarrage : la file de cette personne, pour l'en-tête. */
export function chargerLaFile(utilisateur: string) {
  return prevenir(utilisateur);
}

/** Une erreur de réseau (pas de réponse du serveur), et non un refus. */
export function estUneErreurReseau(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return err instanceof TypeError; // fetch échoue en TypeError quand la requête ne part pas
}
