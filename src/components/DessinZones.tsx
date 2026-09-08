// Outil de dessin des zones sur une carte Leaflet : polygone point par point, modification,
// suppression. Un seul moteur pour la fenêtre « Zone de … » (page Tournées) et pour la Carte.
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import { CommercialZone } from '../types';
import { apiPost, apiPut, apiDelete } from '../api/client';
import { useToast } from './Toast';

interface Props {
  /** Commercial à qui appartiennent les zones dessinées ici. */
  commercialId: string;
  color: string;
  /** Zones modifiables (celles du commercial, ou toutes pour l'admin). */
  zones: CommercialZone[];
  /** Demande un nom à la création ; sans réponse, « Secteur N ». */
  demanderUnNom?: boolean;
  /** La zone dessinée est prioritaire pour la prospection, avec cette consigne. */
  prioritaire?: boolean;
  consigne?: string;
  onChanged: () => void;
}

type CoucheZone = L.Polygon & { _zoneId?: string };

export default function DessinZones({ commercialId, color, zones, demanderUnNom = false, prioritaire = false, consigne = '', onChanged }: Props) {
  const map = useMap();
  const toast = useToast();
  const countRef = useRef(zones.length);

  useEffect(() => {
    const featureGroup = new L.FeatureGroup();
    map.addLayer(featureGroup);

    zones.forEach(z => {
      const polygon = L.polygon(z.coordinates as L.LatLngExpression[], {
        color: z.prioritaire ? '#dc2626' : (z.couleur || color),
        fillOpacity: 0.25,
        dashArray: z.prioritaire ? '8 4' : undefined,
      }) as CoucheZone;
      polygon._zoneId = z.id;
      polygon.bindTooltip(`${z.prioritaire ? '★ Prioritaire · ' : ''}${z.nom || 'Zone'}`, { sticky: true });
      featureGroup.addLayer(polygon);
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const drawControl = new (L.Control as any).Draw({
      position: 'topright',
      draw: {
        polygon: { shapeOptions: { color, fillOpacity: 0.25 }, allowIntersection: true, showArea: true },
        polyline: false,
        rectangle: false,
        circle: false,
        circlemarker: false,
        marker: false,
      },
      edit: { featureGroup, remove: true },
    });
    map.addControl(drawControl);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleCreated = async (e: any) => {
      const layer = e.layer as CoucheZone;
      featureGroup.addLayer(layer);
      const latlngs = (layer.getLatLngs()[0] as L.LatLng[]).map(p => [p.lat, p.lng] as [number, number]);
      countRef.current += 1;
      let nom = `Secteur ${countRef.current}`;
      if (demanderUnNom) {
        const saisi = window.prompt('Nom de la zone :', nom);
        if (saisi && saisi.trim()) nom = saisi.trim();
      }
      try {
        const created = await apiPost('/commercial-zones', { commercial_id: commercialId, nom, couleur: color, coordinates: latlngs, prioritaire, consigne }) as { id: string };
        layer._zoneId = created.id;
        layer.bindTooltip(`${prioritaire ? '★ Prioritaire · ' : ''}${nom}`, { sticky: true });
        toast.success(`Zone « ${nom} » enregistrée${prioritaire ? ', prioritaire' : ''}`);
        onChanged();
      } catch {
        toast.error('Erreur enregistrement de la zone');
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleEdited = async (e: any) => {
      const layers: CoucheZone[] = [];
      e.layers.eachLayer((layer: CoucheZone) => layers.push(layer));
      for (const layer of layers) {
        if (!layer._zoneId) continue;
        const latlngs = (layer.getLatLngs()[0] as L.LatLng[]).map(p => [p.lat, p.lng] as [number, number]);
        try {
          await apiPut(`/commercial-zones/${layer._zoneId}`, { coordinates: latlngs });
        } catch {
          toast.error('Erreur mise à jour de la zone');
        }
      }
      if (layers.length > 0) toast.success('Tracé mis à jour');
      onChanged();
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleDeleted = async (e: any) => {
      const ids: string[] = [];
      e.layers.eachLayer((layer: CoucheZone) => { if (layer._zoneId) ids.push(layer._zoneId); });
      for (const id of ids) {
        try {
          await apiDelete(`/commercial-zones/${id}`);
        } catch {
          toast.error('Erreur suppression de la zone');
        }
      }
      if (ids.length > 0) toast.success('Zone(s) supprimée(s)');
      onChanged();
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const L_ANY = L as any;
    map.on(L_ANY.Draw.Event.CREATED, handleCreated);
    map.on(L_ANY.Draw.Event.EDITED, handleEdited);
    map.on(L_ANY.Draw.Event.DELETED, handleDeleted);

    return () => {
      map.off(L_ANY.Draw.Event.CREATED, handleCreated);
      map.off(L_ANY.Draw.Event.EDITED, handleEdited);
      map.off(L_ANY.Draw.Event.DELETED, handleDeleted);
      map.removeControl(drawControl);
      map.removeLayer(featureGroup);
    };
    // Les zones sont rechargées par le parent après chaque changement ; on remonte l'outil à ce moment-là.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, zones, commercialId, prioritaire, consigne]);

  return null;
}
