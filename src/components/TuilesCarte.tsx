// Le fond de carte, déclaré à un seul endroit.
//
// Les tuiles venaient des serveurs d'OpenStreetMap, qui ont fini par bloquer l'application :
// leur politique d'usage réserve ces serveurs, tenus par des bénévoles, aux essais et aux
// petits projets — pas à un logiciel qui tourne tous les jours. Le blocage ne se voit pas
// dans les journaux, il s'affiche : chaque tuile devient une image « Access blocked ».
//
// On prend donc un fournisseur qui accepte cet usage, et on garde de quoi en changer sans
// toucher au code — parce que ce genre de blocage revient, et qu'il ne doit plus jamais
// falloir une mise en production pour le débloquer.
import { useEffect, useRef, useState } from 'react';
import { TileLayer } from 'react-leaflet';

interface Fournisseur {
  nom: string;
  url: string;
  attribution: string;
  /** Sous-domaines pour répartir les requêtes, quand le fournisseur en propose. */
  sousDomaines?: string;
  zoomMax?: number;
}

/**
 * Les fonds, dans l'ordre où on les essaie.
 *
 * L'IGN d'abord : c'est un service public français, ouvert, sans clé et sans limite d'usage
 * commercial — et SuiviPro ne sort pas de France. Carto ensuite, au cas où la Géoplateforme
 * serait indisponible : c'est le fond sans clé le plus répandu.
 */
/**
 * Les fonds, dans l'ordre où on les essaie.
 *
 * Carto d'abord : c'est le fond sans clé le plus répandu, celui qui a le moins de chances
 * de refuser un logiciel métier. L'IGN ensuite — service public français, ouvert, sans clé
 * — puis Esri. Trois maisons différentes : si l'une ferme sa porte, les deux autres ne
 * ferment pas en même temps.
 */
const FOURNISSEURS: Fournisseur[] = [
  {
    nom: 'Carto',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    sousDomaines: 'abcd',
    zoomMax: 20,
  },
  {
    nom: 'IGN',
    url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
      + '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM'
      + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png',
    attribution: '&copy; <a href="https://www.ign.fr/">IGN</a> — Géoplateforme',
    zoomMax: 19,
  },
  {
    nom: 'Esri',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
    zoomMax: 19,
  },
];

/**
 * Un fond imposé par la configuration (VITE_TUILES_URL), qui passe devant tout le reste.
 * C'est la porte de sortie quand un fournisseur bloque à son tour. Attention : Vite fige
 * ces valeurs au moment de la construction — changer la variable demande un redéploiement,
 * pas seulement un redémarrage.
 */
function fondImpose(): Fournisseur | null {
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
 * indéfiniment. C'est exactement ce qui s'est produit en production. On ne surveille donc
 * pas les échecs, on surveille l'absence de réussite.
 */
const DELAI_SANS_TUILE_MS = 6000;

export default function TuilesCarte() {
  const impose = fondImpose();
  const liste = impose ? [impose, ...FOURNISSEURS] : FOURNISSEURS;
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
  // serait condamné avant d'avoir servi une seule tuile. C'est ce qui le faisait sauter.
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
