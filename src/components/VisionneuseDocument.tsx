import { useEffect, useRef, useState } from 'react';
import { X, Loader2, FileSignature, Eye } from 'lucide-react';
import { Document } from '../types';
import { apercuDuDocument } from '../api/client';

/**
 * La visionneuse de SuiviPro : un document affiché dans l'application, sans bouton
 * Télécharger ni Partager. C'est le seul accès, pour l'équipe, aux documents en
 * « consultation seule ».
 *
 * Les pages d'un PDF sont dessinées en images (canvas) : un appui long n'y propose ni
 * « Enregistrer » ni « Partager », sur iPhone comme sur Android. Une capture d'écran
 * reste possible — aucune application ne peut l'empêcher.
 */
export default function VisionneuseDocument({ doc, onClose, onOuvert, signature }: {
  doc: Document;
  onClose: () => void;
  /** Appelé une fois le document affiché : l'ouverture est notée côté serveur. */
  onOuvert?: () => void;
  /** Quand la personne doit signer ce document : le bouton en bas de la visionneuse. */
  signature?: { onSigner: () => void };
}) {
  const [etat, setEtat] = useState<'chargement' | 'pret' | 'erreur'>('chargement');
  const [erreur, setErreur] = useState('');
  const [image, setImage] = useState('');
  const pages = useRef<HTMLDivElement>(null);
  const estPdf = doc.type_mime === 'application/pdf';

  useEffect(() => {
    let annule = false;
    let urlImage = '';
    (async () => {
      try {
        const blob = await apercuDuDocument(doc.id);
        if (annule) return;
        if (estPdf) {
          await dessinerLePdf(await blob.arrayBuffer(), pages.current, () => annule);
        } else {
          urlImage = URL.createObjectURL(blob);
          setImage(urlImage);
        }
        if (annule) return;
        setEtat('pret');
        onOuvert?.();
      } catch (e) {
        if (annule) return;
        setErreur(e instanceof Error ? e.message : 'Le document n\'a pas pu être ouvert');
        setEtat('erreur');
      }
    })();
    return () => { annule = true; if (urlImage) URL.revokeObjectURL(urlImage); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, doc.version]);

  const bloquer = (e: React.SyntheticEvent) => e.preventDefault();

  return (
    <div className="fixed inset-0 z-[60] bg-gray-900 flex flex-col" onContextMenu={bloquer}>
      <div className="flex items-center gap-3 px-4 py-3 text-white border-b border-white/10" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <Eye className="w-5 h-5 text-white/70 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{doc.nom}</p>
          {doc.consultation_seule && <p className="text-[11px] text-white/60">Consultation seule — ce document ne se télécharge pas</p>}
        </div>
        <button className="p-2 rounded-lg hover:bg-white/10" onClick={onClose} aria-label="Fermer">
          <X className="w-6 h-6" />
        </button>
      </div>

      <div
        className="flex-1 overflow-auto select-none"
        style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
      >
        {etat === 'chargement' && (
          <div className="flex items-center justify-center gap-2 text-white/70 py-16">
            <Loader2 className="w-5 h-5 animate-spin" /> Ouverture du document…
          </div>
        )}
        {etat === 'erreur' && (
          <p className="text-center text-red-200 py-16 px-6">{erreur}</p>
        )}
        {estPdf
          ? <div ref={pages} className="flex flex-col items-center gap-3 p-3" />
          : image && (
            <div className="p-3 flex justify-center">
              <img src={image} alt={doc.nom} draggable={false} onContextMenu={bloquer} className="max-w-full h-auto pointer-events-none" />
            </div>
          )}
      </div>

      {signature && etat === 'pret' && (
        <div className="p-3 bg-white border-t border-gray-200" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <button
            className="w-full px-4 py-3 rounded-lg bg-brewery-600 text-white font-semibold flex items-center justify-center gap-2 hover:bg-brewery-700"
            onClick={signature.onSigner}
          >
            <FileSignature className="w-5 h-5" /> J'ai lu et je prends connaissance
          </button>
        </div>
      )}
    </div>
  );
}

/** Dessine chaque page du PDF dans un canvas, à la largeur de l'écran. */
async function dessinerLePdf(donnees: ArrayBuffer, conteneur: HTMLDivElement | null, estAnnule: () => boolean) {
  if (!conteneur) return;
  // La version « legacy » de pdf.js : elle tourne aussi sur les iPhone qui ne sont pas à jour.
  const [pdfjs, { default: urlWorker }] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = urlWorker;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(donnees), isEvalSupported: false }).promise;
  conteneur.innerHTML = '';
  const largeur = Math.min(conteneur.clientWidth - 24, 900);
  const densite = Math.min(window.devicePixelRatio || 1, 2);
  for (let n = 1; n <= pdf.numPages; n++) {
    if (estAnnule()) return;
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const vue = page.getViewport({ scale: (largeur / base.width) * densite });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vue.width);
    canvas.height = Math.floor(vue.height);
    canvas.style.width = `${Math.floor(vue.width / densite)}px`;
    canvas.style.height = `${Math.floor(vue.height / densite)}px`;
    canvas.className = 'bg-white shadow-lg';
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    conteneur.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (ctx) await page.render({ canvasContext: ctx, viewport: vue }).promise;
  }
}
