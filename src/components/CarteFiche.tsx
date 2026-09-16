// « Où est-ce, exactement ? » — la carte au bas d'une fiche de prospect ou de client.
//
// Une adresse écrite ne dit pas grand-chose : savoir qu'un bar est à Riom ne dit pas s'il
// est sur la route de la tournée de jeudi. La carte répond à ça d'un coup d'œil.
import { lazy, Suspense } from 'react';
import { MapPin, ExternalLink } from 'lucide-react';

// Chargee seulement quand une fiche s'ouvre : Leaflet ne doit pas peser sur le demarrage
// de l'application pour tous ceux qui n'ouvriront aucune fiche.
const CarteLeaflet = lazy(() => import('./CarteFicheLeaflet'));

/** Une fiche jamais géocodée porte des coordonnées à zéro, pas des coordonnées absentes. */
export function estLocalise(latitude?: number | null, longitude?: number | null): boolean {
  const la = Number(latitude);
  const lo = Number(longitude);
  return Number.isFinite(la) && Number.isFinite(lo) && la !== 0 && lo !== 0;
}

export default function CarteFiche({
  latitude, longitude, nom, adresse = '', lienMaps = '', couleur = '#16a34a', hauteur = 220,
}: {
  latitude?: number | null;
  longitude?: number | null;
  nom: string;
  adresse?: string;
  lienMaps?: string;
  couleur?: string;
  hauteur?: number;
}) {
  const localise = estLocalise(latitude, longitude);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Où c'est</p>
        {lienMaps && (
          <a
            href={lienMaps}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-blue-600 hover:underline flex items-center gap-0.5"
          >
            Itinéraire <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {!localise ? (
        // Pas de carte vide : on dit pourquoi. Une fiche sans coordonnees n'a jamais ete
        // geocodee — souvent parce que son adresse est incomplete.
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-center">
          <MapPin className="w-4 h-4 text-gray-300 mx-auto mb-1" />
          <p className="text-xs text-gray-500">Pas encore situé sur la carte</p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {adresse ? 'L’adresse n’a pas pu être localisée.' : 'Renseignez une adresse pour la voir ici.'}
          </p>
        </div>
      ) : (
        <div className="rounded-lg overflow-hidden border border-gray-200" style={{ height: hauteur }}>
          <Suspense fallback={<div className="w-full h-full bg-gray-100 animate-pulse" />}>
            <CarteLeaflet
              latitude={Number(latitude)}
              longitude={Number(longitude)}
              nom={nom}
              couleur={couleur}
              hauteur={hauteur}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
