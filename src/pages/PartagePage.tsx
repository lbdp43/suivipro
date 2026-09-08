import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Share2, ClipboardPaste, Send, Inbox, Loader2, AlertTriangle, CheckCircle, Smartphone, MapPin, Phone, ExternalLink, Building2, Camera, X } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import { apiPost } from '../api/client';
import { Signalement } from '../types';
import { LIBELLES_SOURCE, titreDuSignalement } from '../utils/signalements';
import { faitDeLaProspection } from '../utils/roles';
import { PHOTOS_MAX, PhotoPrete, imagesCollees, lirePhotosPartagees, reduirePhoto } from '../utils/photos';
import { GaleriePhotos } from '../components/PhotosSignalement';

// Point d'arrivée du bouton « Partager » du téléphone (Android) et de la saisie par collage
// (iPhone) : ce que l'on a reçu sur WhatsApp — lien Google Maps, Instagram, Facebook, TikTok,
// article, ou un simple nom — part dans la boîte de prospection, avec un commentaire et le
// commercial à qui c'est destiné. Rien n'entre dans le pipeline avant d'être qualifié.
export default function PartagePage() {
  const [searchParams] = useSearchParams();
  const { state, dispatchLocal } = useApp();
  const toast = useToast();
  const partage = [searchParams.get('title'), searchParams.get('text'), searchParams.get('url')].filter(Boolean).join('\n').trim();
  const [texte, setTexte] = useState(partage);
  const [commentaire, setCommentaire] = useState('');
  const [commercialId, setCommercialId] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState('');
  const [envoye, setEnvoye] = useState<Signalement | null>(null);
  const [photos, setPhotos] = useState<PhotoPrete[]>([]);
  const [photosEnCours, setPhotosEnCours] = useState(false);
  const fichiersRef = useRef<HTMLInputElement>(null);
  const peutColler = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;
  const nbFichiersPartages = parseInt(searchParams.get('fichiers') || '0', 10) || 0;
  const sansFichiers = searchParams.get('sans_fichiers') === '1';

  const ajouterPhotos = async (fichiers: Blob[]) => {
    if (fichiers.length === 0) return;
    setPhotosEnCours(true);
    try {
      const pretes: PhotoPrete[] = [];
      for (const f of fichiers.slice(0, PHOTOS_MAX)) {
        try { pretes.push(await reduirePhoto(f)); } catch { toast.error('Une image n\'a pas pu être lue'); }
      }
      setPhotos(prev => [...prev, ...pretes].slice(0, PHOTOS_MAX));
      if (photos.length + pretes.length > PHOTOS_MAX) toast.info(`${PHOTOS_MAX} photos au plus par signalement`);
    } finally { setPhotosEnCours(false); }
  };

  // Partage Android avec des fichiers : le service worker les a déposés dans un cache.
  const fichiersLus = useRef(false);
  useEffect(() => {
    if (nbFichiersPartages > 0 && !fichiersLus.current) { fichiersLus.current = true; lirePhotosPartagees(nbFichiersPartages).then(ajouterPhotos); }
  }, [nbFichiersPartages]); // eslint-disable-line react-hooks/exhaustive-deps

  // iPhone : copier l'image dans WhatsApp, puis coller n'importe où sur cette page.
  useEffect(() => {
    const surCollage = (e: ClipboardEvent) => { const images = imagesCollees(e); if (images.length > 0) { e.preventDefault(); ajouterPhotos(images); } };
    document.addEventListener('paste', surCollage);
    return () => document.removeEventListener('paste', surCollage);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const nomDe = (id: string) => { const c = state.commerciaux.find(x => x.id === id); return c ? c.prenom : id; };

  const coller = async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (!t) { toast.info('Le presse-papiers est vide'); return; }
      setTexte(prev => (prev ? `${prev}\n${t}` : t));
    } catch {
      toast.error('Impossible de lire le presse-papiers : collez avec un appui long dans le champ');
    }
  };

  const envoyer = async () => {
    if (!texte.trim() && photos.length === 0) return;
    setEnCours(true); setErreur('');
    try {
      const s = await apiPost('/signalements', { texte, commentaire, commercial_id: commercialId, photos: photos.map(p => ({ type_mime: p.type_mime, contenu: p.contenu })) }) as Signalement;
      dispatchLocal({ type: 'UPSERT_SIGNALEMENT', payload: s });
      setEnvoye(s);
      toast.success('Ajouté à la boîte de prospection');
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Impossible d'envoyer le signalement");
    } finally {
      setEnCours(false);
    }
  };

  const recommencer = () => { setEnvoye(null); setTexte(''); setCommentaire(''); setErreur(''); setPhotos([]); };
  const enAttente = state.signalements.filter(s => s.statut === 'a_qualifier').length;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Share2 className="w-5 h-5 text-brewery-600" /> Signaler un prospect</h1>
        <p className="text-sm text-gray-500 mt-1">Un lien Google Maps, Instagram, Facebook, TikTok, un article ou juste un nom : tout part dans la <span className="font-medium">boîte de prospection</span>, où il sera qualifié avant d'entrer dans le pipeline.</p>
      </div>

      {sansFichiers && !envoye && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">L'application n'était pas encore prête à recevoir des photos : le partage est arrivé sans elles. Réessayez le partage, ou ajoutez-les ci-dessous.</p>
      )}

      {!envoye && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="partage-texte" className="text-sm font-medium text-gray-700">Ce que vous avez reçu</label>
              {peutColler && (
                <button type="button" onClick={coller} className="flex items-center gap-1 text-xs font-medium text-brewery-700 hover:underline">
                  <ClipboardPaste className="w-3.5 h-3.5" /> Coller
                </button>
              )}
            </div>
            <textarea
              id="partage-texte"
              className="w-full min-h-[110px] px-3 py-2 border border-gray-200 rounded-lg text-sm"
              placeholder={'Le message WhatsApp tel quel, un lien, ou le nom de l\'établissement…'}
              value={texte}
              onChange={e => setTexte(e.target.value)}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-gray-700">Photos <span className="font-normal text-gray-400">(optionnel, {PHOTOS_MAX} au plus)</span></span>
              <button type="button" onClick={() => fichiersRef.current?.click()} disabled={photosEnCours || photos.length >= PHOTOS_MAX} className="flex items-center gap-1 text-xs font-medium text-brewery-700 hover:underline disabled:opacity-50">
                {photosEnCours ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />} Ajouter des photos
              </button>
              <input ref={fichiersRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { ajouterPhotos(Array.from(e.target.files || [])); e.target.value = ''; }} />
            </div>
            {photos.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {photos.map((p, i) => (
                  <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                    <img src={p.apercu} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                    <button type="button" onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))} className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/60 text-white hover:bg-black/80" aria-label="Retirer la photo"><X className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">Devanture, carte, ardoise… Sur iPhone, copiez l'image dans WhatsApp puis collez-la ici.</p>
            )}
          </div>
          <div>
            <label htmlFor="partage-commentaire" className="block text-sm font-medium text-gray-700 mb-1">Commentaire <span className="font-normal text-gray-400">(optionnel)</span></label>
            <input
              id="partage-commentaire"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              placeholder="Bonne réputation, recommandé par Amélie, vu en passant…"
              value={commentaire}
              onChange={e => setCommentaire(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="partage-pour" className="block text-sm font-medium text-gray-700 mb-1">Pour qui ?</label>
            <select id="partage-pour" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" value={commercialId} onChange={e => setCommercialId(e.target.value)}>
              <option value="">La prospection</option>
              {state.commerciaux.map(c => <option key={c.id} value={c.id}>{c.prenom} {c.nom}{faitDeLaProspection(c) ? ' · prospection' : ''}</option>)}
            </select>
          </div>
          {erreur && <p className="text-sm text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {erreur}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={envoyer}
              disabled={enCours || photosEnCours || (!texte.trim() && photos.length === 0)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brewery-600 text-white text-sm font-semibold hover:bg-brewery-700 disabled:opacity-50"
            >
              {enCours ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Envoyer dans la boîte
            </button>
            <Link to="/boite" className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200">
              <Inbox className="w-4 h-4" /> {enAttente > 0 ? `${enAttente} à qualifier` : 'Ouvrir la boîte'}
            </Link>
          </div>
        </div>
      )}

      {envoye && (
        <div className="bg-white rounded-xl border border-green-200 shadow-sm p-4 space-y-3">
          <p className="text-sm font-medium text-green-800 flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Ajouté à la boîte de prospection</p>
          <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
            <div className="px-3 py-2 flex items-center justify-between gap-2">
              <span className="font-semibold text-gray-900 truncate">{titreDuSignalement(envoye)}</span>
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 whitespace-nowrap">{LIBELLES_SOURCE[envoye.source]}</span>
            </div>
            {(envoye.fiche.adresse || envoye.fiche.ville) && (
              <div className="px-3 py-2 flex items-center gap-2"><MapPin className="w-3.5 h-3.5 text-gray-400" /><span className="text-gray-800">{[envoye.fiche.adresse, [envoye.fiche.code_postal, envoye.fiche.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</span></div>
            )}
            {envoye.fiche.telephone && <div className="px-3 py-2 flex items-center gap-2"><Phone className="w-3.5 h-3.5 text-gray-400" /><span className="text-gray-800">{envoye.fiche.telephone}</span></div>}
            {envoye.lien && <a href={envoye.lien} target="_blank" rel="noopener noreferrer" className="px-3 py-2 flex items-center gap-2 text-blue-600 hover:underline"><ExternalLink className="w-3.5 h-3.5" /> Ouvrir le lien</a>}
            <div className="px-3 py-2 text-gray-600">Pour : <span className="font-medium text-gray-800">{envoye.commercial_id ? nomDe(envoye.commercial_id) : 'la prospection'}</span>{envoye.commentaire ? <> · « {envoye.commentaire} »</> : null}</div>
            {envoye.photos.length > 0 && <div className="px-3 py-2"><GaleriePhotos signalements={[envoye]} /></div>}
          </div>
          {envoye.fiche.doublons && envoye.fiche.doublons.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Ressemble à une fiche existante</p>
              <ul className="mt-1 space-y-0.5">
                {envoye.fiche.doublons.map(d => (
                  <li key={`${d.genre}-${d.id}`} className="flex items-center gap-2">
                    <Building2 className="w-3.5 h-3.5 text-amber-600" />
                    <Link to={d.genre === 'client' ? `/clients?id=${d.id}` : `/prospects?id=${d.id}`} className="text-brewery-700 hover:underline">{d.nom}{d.ville ? ` · ${d.ville}` : ''}</Link>
                    <span className="text-[11px] bg-amber-100 px-1.5 py-0.5 rounded-full">{d.genre === 'client' ? 'client' : 'prospect'}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs mt-1">La personne qui qualifie pourra rattacher ce signalement à cette fiche.</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Link to="/boite" className="px-4 py-2 rounded-lg bg-brewery-600 text-white text-sm font-semibold hover:bg-brewery-700">Voir la boîte</Link>
            <button type="button" onClick={recommencer} className="px-3 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200">Signaler un autre</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3 text-sm text-gray-700">
        <p className="font-medium text-gray-900 flex items-center gap-2"><Smartphone className="w-4 h-4 text-brewery-600" /> Depuis le téléphone</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <p className="font-medium text-gray-800 mb-1">Android</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Installez SuiviPro une fois : menu du navigateur → « Ajouter à l'écran d'accueil ».</li>
              <li>Dans WhatsApp, Google Maps, Instagram ou la galerie photos, touchez « Partager » puis choisissez SuiviPro. Les photos partagées arrivent avec.</li>
              <li>Le contenu arrive ici : ajoutez un commentaire, choisissez pour qui, envoyez.</li>
            </ol>
          </div>
          <div>
            <p className="font-medium text-gray-800 mb-1">iPhone</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Dans WhatsApp, appui long sur le message → « Copier ».</li>
              <li>Ouvrez SuiviPro → « Signaler un prospect » (ou cette page).</li>
              <li>Touchez « Coller » ; pour une photo, « Ajouter des photos » ou collez l'image copiée.</li>
            </ol>
          </div>
        </div>
        <p className="text-xs text-gray-500">Un lien Google Maps donne le nom, l'adresse et la position. Un lien Instagram, Facebook ou TikTok ne donne que le nom du compte : le reste se complète à la qualification.</p>
      </div>
    </div>
  );
}
