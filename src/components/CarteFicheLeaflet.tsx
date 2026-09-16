// La carte qui montre où se trouve un établissement, au bas de sa fiche.
//
// Ce fichier est charge a la demande (voir CarteFiche) : Leaflet pese plus de cent kilos,
// et il n'a rien a faire dans le paquet principal pour une carte qu'on ne regarde qu'en
// ouvrant une fiche.
import { useEffect } from 'react';
import { MapContainer, Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import TuilesCarte from './TuilesCarte';

/**
 * Leaflet mesure son conteneur au moment où il se construit. Dans un panneau ou une fenêtre
 * qui vient de s'ouvrir, cette mesure est souvent fausse — la carte se retrouve alors
 * dessinée sur un huitième de sa place, ou en travers. On lui redemande donc de se mesurer
 * une fois la fiche réellement posée à l'écran.
 */
function RemesurerQuandVisible() {
  const carte = useMap();
  useEffect(() => {
    const recaler = () => carte.invalidateSize();
    const t = setTimeout(recaler, 80);
    // Le panneau peut aussi changer de taille apres coup : fiche repliee, fenetre
    // redimensionnee, telephone tourne.
    const observateur = new ResizeObserver(recaler);
    const conteneur = carte.getContainer();
    observateur.observe(conteneur);
    return () => { clearTimeout(t); observateur.disconnect(); };
  }, [carte]);
  return null;
}

function marqueur(couleur: string): L.DivIcon {
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${couleur};border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35)"></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

export default function CarteFicheLeaflet({
  latitude, longitude, nom, couleur, hauteur,
}: {
  latitude: number;
  longitude: number;
  nom: string;
  couleur: string;
  hauteur: number;
}) {
  return (
    <MapContainer
      center={[latitude, longitude]}
      zoom={15}
      // La molette ne zoome pas : la fiche est un panneau qui defile, et une carte qui
      // capture le defilement empeche d'en lire la suite. Le zoom reste possible par les
      // boutons + et -, et par le pincement sur telephone.
      scrollWheelZoom={false}
      style={{ height: hauteur, width: '100%' }}
    >
      <TuilesCarte />
      <RemesurerQuandVisible />
      <Marker position={[latitude, longitude]} icon={marqueur(couleur)}>
        <Tooltip direction="top" offset={[0, -14]} permanent={false}>{nom}</Tooltip>
      </Marker>
    </MapContainer>
  );
}
