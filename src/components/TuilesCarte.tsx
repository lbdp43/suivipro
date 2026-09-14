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
const FOURNISSEURS: Fournisseur[] = [
  {
    nom: 'IGN',
    url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
      + '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM'
      + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png',
    attribution: '&copy; <a href="https://www.ign.fr/">IGN</a> — Géoplateforme',
    zoomMax: 19,
  },
  {
    nom: 'Carto',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    sousDomaines: 'abcd',
    zoomMax: 20,
  },
];

/**
 * Un fond imposé par la configuration du serveur (VITE_TUILES_URL), qui passe devant tout
 * le reste. C'est la porte de sortie : si un fournisseur bloque à son tour, une variable
 * d'environnement suffit à en changer, sans attendre une mise en production.
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

export default function TuilesCarte() {
  const impose = fondImpose();
  const liste = impose ? [impose, ...FOURNISSEURS] : FOURNISSEURS;
  const [rang, setRang] = useState(0);
  const fournisseur = liste[Math.min(rang, liste.length - 1)];
  // Les tuiles en échec se comptent hors du rendu : une carte entière qui rate, c'est des
  // centaines d'événements, et autant de rendus qu'on ne veut pas déclencher.
  const rates = useRef(0);

  // Chaque fournisseur repart à zéro : les erreurs de l'un ne condamnent pas le suivant.
  useEffect(() => { rates.current = 0; }, [rang]);

  return (
    <TileLayer
      key={fournisseur.nom}
      url={fournisseur.url}
      attribution={fournisseur.attribution}
      {...(fournisseur.sousDomaines ? { subdomains: fournisseur.sousDomaines } : {})}
      maxZoom={fournisseur.zoomMax || 19}
      eventHandlers={{
        tileerror: () => {
          rates.current += 1;
          if (rates.current >= ERREURS_AVANT_BASCULE && rang < liste.length - 1) setRang(r => r + 1);
        },
      }}
    />
  );
}
