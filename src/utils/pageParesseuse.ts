// Une page chargée à la demande, qui réessaie une fois puis recharge l'application si le
// fichier de la page n'est plus là (nouvelle version déployée pendant que l'onglet était ouvert).
import { lazy, ComponentType, LazyExoticComponent } from 'react';
import { estUneErreurDeChargement, rechargerUneFois } from './version';

const attendre = (ms: number) => new Promise(r => setTimeout(r, ms));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pageParesseuse<T extends ComponentType<any>>(charger: () => Promise<{ default: T }>): LazyExoticComponent<T> {
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
