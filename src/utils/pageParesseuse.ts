// Une page chargée à la demande, qui réessaie une fois puis recharge l'application si le
// fichier de la page n'est plus là (nouvelle version déployée pendant que l'onglet était ouvert).
import { lazy, ComponentType, LazyExoticComponent } from 'react';
import { estUneErreurDeChargement, rechargerUneFois } from './version';

const attendre = (ms: number) => new Promise(r => setTimeout(r, ms));

// Tout ce qui se charge à la demande est noté ici, pour être préchargé au calme.
const aPrecharger: Array<() => Promise<unknown>> = [];
let prechargementLance = false;

/**
 * Une fois l'écran affiché, et quand le téléphone n'a rien d'autre à faire, on télécharge une
 * à une les pages et fenêtres qui ne sont pas encore là : la navigation devient immédiate, et
 * le service worker les garde — l'appli reste utilisable hors connexion, même sur une page
 * jamais ouverte. Pas en « économie de données », ni sur une connexion très lente.
 */
export function prechargerAuCalme() {
  if (prechargementLance) return;
  prechargementLance = true;
  const connexion = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connexion?.saveData || /(^|-)2g$/.test(connexion?.effectiveType || '')) return;
  const auCalme = (f: () => void) => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(f, { timeout: 4000 });
    else setTimeout(f, 1500);
  };
  const suivant = (i: number) => {
    if (i >= aPrecharger.length) return;
    auCalme(() => { aPrecharger[i]().catch(() => { /* hors ligne : ce sera pour la prochaine fois */ }).finally(() => suivant(i + 1)); });
  };
  // On laisse d'abord la première page finir de s'afficher et ses données arriver.
  setTimeout(() => suivant(0), 2500);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pageParesseuse<T extends ComponentType<any>>(charger: () => Promise<{ default: T }>): LazyExoticComponent<T> {
  aPrecharger.push(charger);
  return lazy(async () => {
    try {
      return await charger();
    } catch (err) {
      if (!estUneErreurDeChargement(err)) throw err;
      await attendre(600);
      try {
        return await charger();
      } catch (err2) {
        if (estUneErreurDeChargement(err2) && rechargerUneFois()) {
          // La page se recharge : on rend un composant vide le temps que ça parte.
          return { default: (() => null) as unknown as T };
        }
        throw err2;
      }
    }
  });
}
