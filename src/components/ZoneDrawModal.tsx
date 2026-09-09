import { useMemo, useState } from 'react';
import { MapContainer, TileLayer, Polygon, Tooltip, CircleMarker } from 'react-leaflet';
import { X, Info, Building2 } from 'lucide-react';
import { CommercialZone, colorForCommercial } from '../types';
import { useApp } from '../store/AppContext';
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

/** Un client n'est plaçable sur la carte que s'il est géolocalisé et encore actif. */
function surLaCarte(c: { latitude?: number; longitude?: number; statut?: string }) {
  return !!Number(c.latitude) && !!Number(c.longitude) && c.statut !== 'INACTIF';
}

// Dessiner une zone sans voir les clients, c'est tracer à l'aveugle. Les points des
// clients s'affichent donc sous le tracé — ceux du commercial concerné par défaut, et on
// peut basculer sur toute l'équipe ou sur quelqu'un en particulier pour placer la limite
// entre deux secteurs.
export default function ZoneDrawModal({ commercialId, commercialName, color, initialZones, otherZones, onClose, onChanged }: Props) {
  const { state } = useApp();
  const [center] = useState<[number, number]>(() => {
    const withCoords = [...initialZones].find(z => z.coordinates.length > 0);
    if (withCoords) return withCoords.coordinates[0];
    return DEFAULT_CENTER;
  });
  // Par défaut, les clients de celui dont on dessine la zone : ce sont eux qui la justifient.
  const [clientsDe, setClientsDe] = useState<string>(commercialId);

  const geolocalises = useMemo(() => state.clients.filter(surLaCarte), [state.clients]);
  const clients = useMemo(
    () => (clientsDe === 'tous' ? geolocalises : geolocalises.filter(c => c.commercial_id === clientsDe)),
    [geolocalises, clientsDe],
  );
  // On propose ceux qui ont des clients placés, plus le commercial de la zone et moi-même :
  // sans eux, choisir « mes clients » deviendrait impossible tant qu'aucun n'est géocodé.
  const choix = useMemo(() => {
    const ids = new Set(geolocalises.map(c => c.commercial_id));
    return state.commerciaux.filter(c => ids.has(c.id) || c.id === commercialId || c.id === state.currentUser?.id);
  }, [geolocalises, state.commerciaux, commercialId, state.currentUser?.id]);

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

        <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-2 text-xs text-blue-700 flex-wrap">
          <Info className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Les zones grisées appartiennent aux autres commerciaux (lecture seule, pour référence).</span>
        </div>

        {/* Quels clients placer sous le tracé : ceux du commercial, de l'équipe, ou d'un collègue. */}
        <div className="px-4 py-2 border-b border-gray-200 flex items-center gap-2 text-xs flex-wrap">
          <Building2 className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          <label className="flex items-center gap-1.5 text-gray-700">
            Clients affichés :
            <select
              value={clientsDe}
              onChange={e => setClientsDe(e.target.value)}
              className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-800"
            >
              <option value="aucun">Aucun</option>
              <option value="tous">Toute l'équipe</option>
              {choix.map(c => (
                <option key={c.id} value={c.id}>
                  {c.id === state.currentUser?.id ? 'Mes clients' : `Clients de ${c.prenom}`}
                  {c.id === commercialId && c.id !== state.currentUser?.id ? ' (cette zone)' : ''}
                </option>
              ))}
            </select>
          </label>
          <span className="text-gray-500">{clientsDe === 'aucun' ? '—' : `${clients.length} sur la carte`}</span>
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
            {clientsDe !== 'aucun' && clients.map(client => {
              // Un client pas encore attribué n'a pas de couleur de commercial : gris neutre.
              const teinte = client.commercial_id ? colorForCommercial(client.commercial_id) : '#9ca3af';
              const aLui = client.commercial_id === commercialId;
              return (
                <CircleMarker
                  key={client.id}
                  center={[Number(client.latitude), Number(client.longitude)]}
                  radius={aLui ? 6 : 4}
                  pathOptions={{ color: '#fff', weight: 1.5, fillColor: teinte, fillOpacity: aLui ? 0.95 : 0.55 }}
                >
                  <Tooltip>
                    <span className="font-medium">{client.nom}</span>
                    {client.ville ? ` — ${client.ville}` : ''}
                    <br />
                    {state.commerciaux.find(c => c.id === client.commercial_id)?.prenom || 'sans commercial'}
                  </Tooltip>
                </CircleMarker>
              );
            })}
            <DessinZones commercialId={commercialId} color={color} zones={initialZones} onChanged={onChanged} />
          </MapContainer>
        </div>
      </div>
    </div>
  );
}
