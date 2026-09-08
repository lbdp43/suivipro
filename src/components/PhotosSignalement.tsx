import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, X } from 'lucide-react';
import { apiFetch } from '../api/client';
import { useApp } from '../store/AppContext';
import { Signalement } from '../types';

// Une photo de signalement se lit avec le jeton (l'adresse n'est pas publique) : on la
// charge une fois et on l'affiche depuis la mémoire. Un appui l'ouvre en grand.
const memoire = new Map<string, string>();

async function urlDeLaPhoto(signalementId: string, photoId: string): Promise<string> {
  const cle = `${signalementId}/${photoId}`;
  const connue = memoire.get(cle);
  if (connue) return connue;
  const rep = await apiFetch(`/signalements/${signalementId}/photos/${photoId}`);
  if (!rep.ok) throw new Error('Photo illisible');
  const url = URL.createObjectURL(await rep.blob());
  memoire.set(cle, url);
  return url;
}

export function PhotoSignalement({ signalementId, photoId, taille = 'petite', onOuvrir }: { signalementId: string; photoId: string; taille?: 'petite' | 'grande'; onOuvrir?: (url: string) => void }) {
  const [url, setUrl] = useState<string>(() => memoire.get(`${signalementId}/${photoId}`) || '');
  const [erreur, setErreur] = useState(false);
  useEffect(() => {
    let vivant = true;
    if (!url) urlDeLaPhoto(signalementId, photoId).then(u => { if (vivant) setUrl(u); }).catch(() => { if (vivant) setErreur(true); });
    return () => { vivant = false; };
  }, [signalementId, photoId, url]);
  const classe = taille === 'grande' ? 'w-28 h-28' : 'w-16 h-16';
  if (erreur) return <div className={`${classe} rounded-lg bg-gray-100 flex items-center justify-center text-gray-400`}><Camera className="w-4 h-4" /></div>;
  if (!url) return <div className={`${classe} rounded-lg bg-gray-100 animate-pulse`} />;
  return (
    <button type="button" onClick={() => onOuvrir?.(url)} className={`${classe} rounded-lg overflow-hidden border border-gray-200 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brewery-500`} title="Voir en grand">
      <img src={url} alt="Photo partagée" className="w-full h-full object-cover" />
    </button>
  );
}

/** Les photos d'un ou plusieurs signalements, en vignettes, avec l'ouverture en grand. */
export function GaleriePhotos({ signalements, taille = 'petite' }: { signalements: Signalement[]; taille?: 'petite' | 'grande' }) {
  const [ouverte, setOuverte] = useState('');
  const photos = signalements.flatMap(s => (s.photos || []).map(p => ({ signalementId: s.id, photoId: p.id })));
  if (photos.length === 0) return null;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {photos.map(p => <PhotoSignalement key={p.photoId} signalementId={p.signalementId} photoId={p.photoId} taille={taille} onOuvrir={setOuverte} />)}
      </div>
      {ouverte && (
        <div className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-4" onClick={() => setOuverte('')}>
          <button type="button" className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20" onClick={() => setOuverte('')} aria-label="Fermer"><X className="w-5 h-5" /></button>
          <img src={ouverte} alt="Photo partagée" className="max-w-full max-h-full object-contain rounded-lg" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

/** Sur une fiche prospect ou client : les photos des signalements qui lui sont rattachés. */
export function PhotosPartagees({ prospectId, clientId }: { prospectId?: string; clientId?: string }) {
  const { state } = useApp();
  const lies = useMemo(() => state.signalements.filter(s => ((prospectId && s.prospect_id === prospectId) || (clientId && s.client_id === clientId)) && (s.photos || []).length > 0), [state.signalements, prospectId, clientId]);
  if (lies.length === 0) return null;
  const nomDe = (id: string) => state.commerciaux.find(c => c.id === id)?.prenom || id;
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5 mb-1.5"><Camera className="w-3.5 h-3.5" /> Photos partagées <span className="font-normal text-gray-500">· {lies.map(s => nomDe(s.partage_par)).filter((v, i, a) => a.indexOf(v) === i).join(', ')}</span> <Link to="/boite" className="font-normal text-brewery-600 hover:underline ml-auto">Boîte</Link></p>
      <GaleriePhotos signalements={lies} />
    </div>
  );
}
