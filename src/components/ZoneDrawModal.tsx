import { useState } from 'react';
import { MapContainer, TileLayer, Polygon, Tooltip } from 'react-leaflet';
import { X, Info } from 'lucide-react';
import { CommercialZone } from '../types';
import DessinZones from './DessinZones';

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
              Utilisez l'outil polygone (en haut à droite de la carte) pour dessiner, modifier ou supprimer la zone.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-2 text-xs text-blue-700">
          <Info className="w-3.5 h-3.5 flex-shrink-0" />
          Les zones grisees appartiennent aux autres commerciaux (lecture seule, pour référence).
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
            <DessinZones commercialId={commercialId} color={color} zones={initialZones} onChanged={onChanged} />
          </MapContainer>
        </div>
      </div>
    </div>
  );
}
