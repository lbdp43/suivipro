import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Polygon, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import { X, Info } from 'lucide-react';
import { CommercialZone } from '../types';
import { apiPost, apiPut, apiDelete } from '../api/client';
import { useToast } from './Toast';

interface Props {
  commercialId: string;
  commercialName: string;
  color: string;
  initialZones: CommercialZone[];
  otherZones: CommercialZone[];
  onClose: () => void;
  onChanged: () => void;
}

const DEFAULT_CENTER: [number, number] = [45.37, 4.27];

function DrawController({ commercialId, color, initialZones, onChanged }: {
  commercialId: string;
  color: string;
  initialZones: CommercialZone[];
  onChanged: () => void;
}) {
  const map = useMap();
  const toast = useToast();
  const countRef = useRef(initialZones.length);

  useEffect(() => {
    const featureGroup = new L.FeatureGroup();
    map.addLayer(featureGroup);

    initialZones.forEach(z => {
      const polygon = L.polygon(z.coordinates as L.LatLngExpression[], { color, fillOpacity: 0.25 });
      (polygon as unknown as { _zoneId: string })._zoneId = z.id;
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
      edit: {
        featureGroup,
        remove: true,
      },
    });
    map.addControl(drawControl);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleCreated = async (e: any) => {
      const layer = e.layer;
      featureGroup.addLayer(layer);
      const latlngs = (layer.getLatLngs()[0] as L.LatLng[]).map(p => [p.lat, p.lng] as [number, number]);
      countRef.current += 1;
      try {
        const created = await apiPost('/commercial-zones', {
          commercial_id: commercialId,
          nom: `Secteur ${countRef.current}`,
          couleur: color,
          coordinates: latlngs,
        }) as { id: string };
        layer._zoneId = created.id;
        toast.success('Zone enregistree');
        onChanged();
      } catch {
        toast.error('Erreur enregistrement de la zone');
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleEdited = async (e: any) => {
      const layers: L.Layer[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      e.layers.eachLayer((layer: any) => layers.push(layer));
      for (const layer of layers as unknown as { _zoneId?: string; getLatLngs: () => L.LatLng[][] }[]) {
        if (!layer._zoneId) continue;
        const latlngs = layer.getLatLngs()[0].map(p => [p.lat, p.lng] as [number, number]);
        try {
          await apiPut(`/commercial-zones/${layer._zoneId}`, { couleur: color, coordinates: latlngs });
        } catch {
          toast.error('Erreur mise a jour de la zone');
        }
      }
      toast.success('Zone(s) mise(s) a jour');
      onChanged();
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleDeleted = async (e: any) => {
      const ids: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      e.layers.eachLayer((layer: any) => { if (layer._zoneId) ids.push(layer._zoneId); });
      for (const id of ids) {
        try {
          await apiDelete(`/commercial-zones/${id}`);
        } catch {
          toast.error('Erreur suppression de la zone');
        }
      }
      if (ids.length > 0) toast.success('Zone(s) supprimee(s)');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return null;
}

export default function ZoneDrawModal({ commercialId, commercialName, color, initialZones, otherZones, onClose, onChanged }: Props) {
  const [center] = useState<[number, number]>(() => {
    const withCoords = [...initialZones].find(z => z.coordinates.length > 0);
    if (withCoords) return withCoords.coordinates[0];
    return DEFAULT_CENTER;
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full inline-block" style={{ background: color }} />
              Zone de {commercialName}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Utilisez l'outil polygone (en haut a droite de la carte) pour dessiner, modifier ou supprimer la zone.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-2 text-xs text-blue-700">
          <Info className="w-3.5 h-3.5 flex-shrink-0" />
          Les zones grisees appartiennent aux autres commerciaux (lecture seule, pour reference).
        </div>

        <div className="flex-1 relative">
          <MapContainer center={center} zoom={9} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; OpenStreetMap contributors'
            />
            {otherZones.map(z => (
              <Polygon
                key={z.id}
                positions={z.coordinates}
                pathOptions={{ color: '#9ca3af', fillOpacity: 0.08, dashArray: '4 4', weight: 1 }}
              >
                <Tooltip sticky>{z.nom || 'Zone'}</Tooltip>
              </Polygon>
            ))}
            <DrawController commercialId={commercialId} color={color} initialZones={initialZones} onChanged={onChanged} />
          </MapContainer>
        </div>
      </div>
    </div>
  );
}
