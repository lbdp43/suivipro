// Le fond de carte côté navigateur : quel fournisseur on affiche, et comment on en change
// tout seul quand il ne répond pas.
//
// La liste des fournisseurs n'est pas ici : elle est dans shared/fondsDeCarte.js, parce
// que le serveur doit l'autoriser dans sa politique de sécurité (Content-Security-Policy).
// Deux listes qui divergent, c'est une carte blanche sans le moindre message d'erreur.
import { useEffect, useRef, useState } from 'react';
import { TileLayer } from 'react-leaflet';
import { FONDS_DE_CARTE, type FondDeCarte } from '../../shared/fondsDeCarte';

/**
 * Un fond imposé par la configuration (VITE_TUILES_URL), qui passe devant tout le reste.
 * C'est la porte de sortie quand un fournisseur bloque à son tour. Deux pièges :
 * — Vite fige ces valeurs à la construction, donc il faut redéployer, pas juste redémarrer ;
 * — le serveur doit AUSSI connaître ce domaine, par la variable TUILES_HOTES, sinon sa
 *   politique de sécurité refusera les tuiles et la carte restera blanche.
 */
function fondImpose(): FondDeCarte | null {
  const url = String(import.meta.env.VITE_TUILES_URL || '').trim();
  if (!url) return null;
  return {
    nom: 'configuré',
    url,
    attribution: String(import.meta.env.VITE_TUILES_ATTRIBUTION || '') || '&copy; les contributeurs',
    sousDomaines: String(import.meta.env.VITE_TUILES_SOUS_DOMAINES || '') || undefined,
  };
}

/** Au-delà, ce n'est plus une tuile qui manque, c'est le fournisseur qui ne répond pas. */
const ERREURS_AVANT_BASCULE = 8;

/**
 * Et surtout : le délai sans la moindre tuile affichée.
 *
 * Un fournisseur ne tombe pas toujours en erreur. Il peut répondre « poliment » quelque
 * chose que le navigateur n'affiche pas, ou ne jamais répondre du tout — et là, aucun
 * événement d'erreur ne part, la bascule ne se déclenche pas, et la carte reste blanche
 * indéfiniment. On ne surveille donc pas les échecs, on surveille l'absence de réussite.
 */
const DELAI_SANS_TUILE_MS = 6000;

export default function TuilesCarte() {
  const impose = fondImpose();
  const liste = impose ? [impose, ...FONDS_DE_CARTE] : FONDS_DE_CARTE;
  const [rang, setRang] = useState(0);
  const dernier = rang >= liste.length - 1;
  const fournisseur = liste[Math.min(rang, liste.length - 1)];

  // Les tuiles en échec se comptent hors du rendu : une carte entière qui rate, c'est des
  // centaines d'événements, et autant de rendus qu'on ne veut pas déclencher.
  const rates = useRef(0);
  const auMoinsUne = useRef(false);

  // Les compteurs se remettent à zéro ICI, au moment de la bascule, et pas dans un effet
  // qui ne s'exécuterait qu'après le rendu : entre les deux, le fournisseur suivant a le
  // temps de lever ses premières erreurs, et il hériterait des échecs du précédent — il
  // serait condamné avant d'avoir servi une seule tuile.
  const suivant = () => setRang(r => {
    if (r >= liste.length - 1) return r;
    rates.current = 0;
    auMoinsUne.current = false;
    return r + 1;
  });

  // Le garde-fou : si rien ne s'est affiché au bout de quelques secondes, on passe au
  // fournisseur d'après sans attendre une erreur qui ne viendra peut-être jamais.
  useEffect(() => {
    if (dernier) return undefined;
    const t = setTimeout(() => { if (!auMoinsUne.current) suivant(); }, DELAI_SANS_TUILE_MS);
    return () => clearTimeout(t);
  }, [rang, dernier]);

  return (
    <TileLayer
      key={fournisseur.nom}
      url={fournisseur.url}
      attribution={fournisseur.attribution}
      {...(fournisseur.sousDomaines ? { subdomains: fournisseur.sousDomaines } : {})}
      maxZoom={fournisseur.zoomMax || 19}
      eventHandlers={{
        tileload: () => { auMoinsUne.current = true; },
        tileerror: () => {
          rates.current += 1;
          if (rates.current >= ERREURS_AVANT_BASCULE) suivant();
        },
      }}
    />
  );
}
