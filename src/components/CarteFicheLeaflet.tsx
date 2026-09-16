// La carte qui montre où se trouve un établissement, au bas de sa fiche.
//
// Ce fichier est charge a la demande (voir CarteFiche) : Leaflet pese plus de cent kilos,
// et il n'a rien a faire dans le paquet principal pour une carte qu'on ne regarde qu'en
// ouvrant une fiche.
import { useEffect } from 'react';
import { MapContainer, Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import TuilesCarte from './TuilesCarte';
import type { Voisin } from '../utils/voisinage';
import { distanceLisible } from '../utils/voisinage';

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

function marqueur(couleur: string, taille = 26): L.DivIcon {
  const bord = taille >= 24 ? 3 : 2;
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="width:${taille}px;height:${taille}px;border-radius:50%;background:${couleur};border:${bord}px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35)"></div>`,
    iconSize: [taille, taille],
    iconAnchor: [taille / 2, taille / 2],
  });
}

/** Bleu pour un rendez-vous déjà calé, ambre pour une visite en retard. */
export const COULEUR_VOISIN: Record<Voisin['genre'], string> = { rdv: '#2563eb', retard: '#d97706' };

/**
 * Cadrer sur tout le monde, et pas seulement sur l'établissement.
 *
 * Sans ça, un voisin à deux kilomètres tomberait hors de l'écran : la carte montrerait un
 * point seul en affirmant juste en dessous qu'il y a un rendez-vous à côté. On plafonne
 * quand même le zoom, pour ne pas se retrouver collé au trottoir quand tout est au même
 * endroit.
 */
function CadrerSurTout({ points }: { points: [number, number][] }) {
  const carte = useMap();
  const empreinte = points.map(p => p.join(',')).join('|');
  useEffect(() => {
    if (points.length < 2) return;
    carte.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carte, empreinte]);
  return null;
}

export default function CarteFicheLeaflet({
  latitude, longitude, nom, couleur, hauteur, voisins = [],
}: {
  latitude: number;
  longitude: number;
  nom: string;
  couleur: string;
  hauteur: number;
  voisins?: Voisin[];
}) {
  const points: [number, number][] = [[latitude, longitude], ...voisins.map(v => [v.latitude, v.longitude] as [number, number])];
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
      <CadrerSurTout points={points} />
      {/* Les voisins d'abord : l'etablissement de la fiche passe par-dessus, c'est lui
          qu'on regarde. */}
      {voisins.map(v => (
        <Marker key={v.cle} position={[v.latitude, v.longitude]} icon={marqueur(COULEUR_VOISIN[v.genre], 18)}>
          <Tooltip direction="top" offset={[0, -10]}>
            {v.genre === 'rdv'
              ? `${v.nom} — RDV${v.qui ? ` (${v.qui})` : ''} · ${distanceLisible(v.km)}`
              : `${v.nom} — visite en retard · ${distanceLisible(v.km)}`}
          </Tooltip>
        </Marker>
      ))}
      <Marker position={[latitude, longitude]} icon={marqueur(couleur)} zIndexOffset={1000}>
        <Tooltip direction="top" offset={[0, -14]} permanent={false}>{nom}</Tooltip>
      </Marker>
    </MapContainer>
  );
}
