import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Upload, Download, Trash2, Search, Filter, Plus, X, File, Image, FileSpreadsheet, Eye, FileSignature, CheckCircle2, ChevronDown, ChevronRight, RefreshCw, Lock } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import VisionneuseDocument from '../components/VisionneuseDocument';
import { Document, DocumentCategory, DocumentSignature, DOCUMENT_CATEGORY_LABELS } from '../types';
import { downloadDocument, apiPost, apiPut, apiDelete, liensDesDocuments } from '../api/client';
import { aSigne, concernes, doitSigner } from '../../shared/documents';

const CATEGORIES: DocumentCategory[] = ['bar_restaurant', 'prix_ce', 'cave_epicerie', 'grand_public', 'autre'];

/** La limite du serveur. L'écran annonçait 8 Mo : entre 5 et 8, l'envoi échouait sans dire pourquoi. */
const TAILLE_MAX = 5 * 1024 * 1024;

/** Les liens d'ouverture valent deux heures : on les renouvelle bien avant. */
const RENOUVELER_LIENS_MS = 60 * 60 * 1000;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function getFileIcon(typeMime: string) {
  if (typeMime.startsWith('image/')) return Image;
  if (typeMime.includes('spreadsheet') || typeMime.includes('excel') || typeMime.includes('csv')) return FileSpreadsheet;
  return File;
}

/** Ce que la visionneuse de SuiviPro sait afficher (même règle que le serveur). */
function affichable(typeMime: string): boolean {
  return typeMime === 'application/pdf' || /^image\/(png|jpeg|gif|webp)$/.test(typeMime || '');
}

function dateHeure(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

function lireEnBase64(fichier: globalThis.File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(fichier);
  });
}

function messageDe(e: unknown, parDefaut: string): string {
  return e instanceof Error && e.message ? e.message : parDefaut;
}

export default function DocumentsPage() {
  const { state, dispatchLocal } = useApp();
  const toast = useToast();
  const moi = state.currentUser;
  const isAdmin = moi?.role === 'admin';

  const [showUpload, setShowUpload] = useState(false);
  const [filterCategory, setFilterCategory] = useState<DocumentCategory | ''>('');
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);

  // Upload form state
  const [uploadNom, setUploadNom] = useState('');
  const [uploadCategorie, setUploadCategorie] = useState<DocumentCategory>('autre');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadFile, setUploadFile] = useState<globalThis.File | null>(null);
  const [uploadASigner, setUploadASigner] = useState(false);
  const [uploadTouteLEquipe, setUploadTouteLEquipe] = useState(true);
  const [uploadSignataires, setUploadSignataires] = useState<string[]>([]);
  const [uploadConsultationSeule, setUploadConsultationSeule] = useState(false);

  // Ouvrir, signer, suivre
  const [liens, setLiens] = useState<Record<string, string>>({});
  const [visionneuse, setVisionneuse] = useState<Document | null>(null);
  const [aConfirmer, setAConfirmer] = useState<Document | null>(null);
  const [signatureEnCours, setSignatureEnCours] = useState(false);
  const [suiviOuvert, setSuiviOuvert] = useState<Set<string>>(new Set());
  const [remplacement, setRemplacement] = useState<Document | null>(null);
  const champRemplacement = useRef<HTMLInputElement>(null);

  const signatures = state.documentSignatures || [];
  const ouvertures = state.documentOuvertures || [];

  // Les liens d'ouverture : demandés à l'arrivée, à chaque nouveau document, et chaque heure.
  const cleDocuments = state.documents.map(d => `${d.id}:${d.version || 1}:${d.consultation_seule ? 1 : 0}`).join(',');
  useEffect(() => {
    let actif = true;
    const charger = () => liensDesDocuments().then(l => { if (actif) setLiens(l || {}); }).catch(() => { /* on retombe sur l'ancien téléchargement */ });
    charger();
    const id = setInterval(charger, RENOUVELER_LIENS_MS);
    return () => { actif = false; clearInterval(id); };
  }, [cleDocuments]);

  const filteredDocs = state.documents.filter(doc => {
    if (filterCategory && doc.categorie !== filterCategory) return false;
    if (search) {
      const s = search.toLowerCase();
      return doc.nom.toLowerCase().includes(s) || doc.nom_fichier.toLowerCase().includes(s) || doc.description.toLowerCase().includes(s);
    }
    return true;
  });

  const aSignerParMoi = useMemo(
    () => moi ? state.documents.filter(d => doitSigner(d, moi.id) && !aSigne(d, moi.id, signatures)) : [],
    [state.documents, signatures, moi],
  );

  const ouvertParMoi = (doc: Document) => ouvertures.some(o => o.doc_id === doc.id && Number(o.version) === (doc.version || 1));
  const noterOuverture = (doc: Document) => dispatchLocal({ type: 'ADD_DOCUMENT_OUVERTURE', payload: { doc_id: doc.id, version: doc.version || 1 } });

  const nomDe = (id: string) => {
    const c = state.commerciaux.find(p => p.id === id);
    return c ? `${c.prenom} ${c.nom}` : 'Ancien membre';
  };

  const reinitialiserEnvoi = () => {
    setShowUpload(false);
    setUploadNom('');
    setUploadCategorie('autre');
    setUploadDescription('');
    setUploadFile(null);
    setUploadASigner(false);
    setUploadTouteLEquipe(true);
    setUploadSignataires([]);
    setUploadConsultationSeule(false);
  };

  const handleUpload = async () => {
    if (!uploadFile || !uploadNom) return;
    if (uploadASigner && !uploadTouteLEquipe && uploadSignataires.length === 0) {
      toast.error('Choisissez au moins une personne qui doit signer');
      return;
    }
    setUploading(true);
    try {
      const base64 = await lireEnBase64(uploadFile);
      const typeMime = uploadFile.type || 'application/octet-stream';
      const saved = await apiPost('/documents', {
        nom: uploadNom,
        categorie: uploadCategorie,
        description: uploadDescription,
        nom_fichier: uploadFile.name,
        type_mime: typeMime,
        taille: uploadFile.size,
        contenu: base64,
        a_signer: uploadASigner,
        signataires: uploadASigner && !uploadTouteLEquipe ? uploadSignataires : null,
        consultation_seule: uploadConsultationSeule && affichable(typeMime),
      }) as Document;
      dispatchLocal({ type: 'ADD_DOCUMENT', payload: saved });
      reinitialiserEnvoi();
      toast.success('Document ajouté');
    } catch (e) {
      toast.error(messageDe(e, 'Erreur lors de l\'envoi du document'));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc: Document) => {
    if (confirm(`Supprimer le document "${doc.nom}" ?`)) {
      try {
        await apiDelete(`/documents/${doc.id}`);
        dispatchLocal({ type: 'DELETE_DOCUMENT', payload: doc.id });
      } catch {
        toast.error('Erreur lors de la suppression du document');
      }
    }
  };

  // Avant que les liens soient arrivés (ou s'ils n'arrivent pas) : l'ancien téléchargement,
  // qui dit maintenant pourquoi il échoue au lieu de ne rien faire.
  const handleDownload = async (doc: Document) => {
    try {
      await downloadDocument(doc.id, doc.nom_fichier);
      noterOuverture(doc);
    } catch (e) {
      toast.error(messageDe(e, 'Le document n\'a pas pu être récupéré'));
    }
  };

  const remplacerLeFichier = async (doc: Document, fichier: globalThis.File) => {
    if (fichier.size > TAILLE_MAX) { toast.error('Le fichier ne doit pas dépasser 5 Mo'); return; }
    try {
      const saved = await apiPut(`/documents/${doc.id}/fichier`, {
        nom_fichier: fichier.name,
        type_mime: fichier.type || 'application/octet-stream',
        taille: fichier.size,
        contenu: await lireEnBase64(fichier),
      }) as Document;
      dispatchLocal({ type: 'UPDATE_DOCUMENT', payload: saved });
      toast.success(saved.a_signer ? `Version ${saved.version} en ligne : chacun doit la signer de nouveau` : 'Fichier remplacé');
    } catch (e) {
      toast.error(messageDe(e, 'Le fichier n\'a pas pu être remplacé'));
    }
  };

  const signer = async (doc: Document) => {
    setSignatureEnCours(true);
    try {
      const s = await apiPost(`/documents/${doc.id}/signer`, {}) as DocumentSignature;
      dispatchLocal({ type: 'ADD_DOCUMENT_SIGNATURE', payload: s });
      setAConfirmer(null);
      toast.success('C\'est signé : votre prise de connaissance est enregistrée');
    } catch (e) {
      toast.error(messageDe(e, 'La signature n\'a pas pu être enregistrée'));
    } finally {
      setSignatureEnCours(false);
    }
  };

  const basculerSuivi = (id: string) => setSuiviOuvert(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const getUploaderName = (uploadedBy: string) => {
    const commercial = state.commerciaux.find(c => c.id === uploadedBy);
    return commercial ? `${commercial.prenom} ${commercial.nom}` : 'Inconnu';
  };

  // Group documents by category
  const groupedDocs: Record<string, Document[]> = {};
  for (const doc of filteredDocs) {
    const cat = doc.categorie || 'autre';
    if (!groupedDocs[cat]) groupedDocs[cat] = [];
    groupedDocs[cat].push(doc);
  }

  const equipeSaufMoi = state.commerciaux.filter(c => c.id !== moi?.id); // l'état ne contient que les membres actifs
  const fichierAffichable = !!uploadFile && affichable(uploadFile.type);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-brewery-600" />
            Documents
          </h1>
          <p className="text-sm text-gray-500 mt-1">Catalogues, grilles tarifaires et documents partagés</p>
        </div>
        {isAdmin && (
          <button
            className="px-4 py-2 bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 text-sm font-medium flex items-center gap-2"
            onClick={() => setShowUpload(true)}
          >
            <Plus className="w-4 h-4" /> Ajouter un document
          </button>
        )}
      </div>

      {/* À lire et signer */}
      {aSignerParMoi.length > 0 && (
        <div className="mb-6 bg-amber-50 border-2 border-amber-300 rounded-xl p-4">
          <p className="font-bold text-amber-900 flex items-center gap-2">
            <FileSignature className="w-5 h-5" /> À lire et signer
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-200 tabular-nums">{aSignerParMoi.length}</span>
          </p>
          <p className="text-xs text-amber-800 mt-1">Ouvrez chaque document, lisez-le, puis confirmez que vous en avez pris connaissance.</p>
          <ul className="mt-2 space-y-1">
            {aSignerParMoi.map(d => (
              <li key={d.id}>
                <a href={`#doc-${d.id}`} className="text-sm font-medium text-amber-900 underline underline-offset-2">{d.nom}</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher un document..."
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <select
            className="pl-10 pr-8 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500 appearance-none bg-white"
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value as DocumentCategory | '')}
          >
            <option value="">Toutes les catégories</option>
            {CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{DOCUMENT_CATEGORY_LABELS[cat]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Documents list */}
      {filteredDocs.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Aucun document</p>
          {isAdmin && (
            <p className="text-gray-400 text-xs mt-1">Cliquez sur "Ajouter un document" pour commencer</p>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {CATEGORIES.filter(cat => groupedDocs[cat]?.length > 0).map(cat => (
            <div key={cat}>
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${
                  cat === 'bar_restaurant' ? 'bg-blue-500' :
                  cat === 'prix_ce' ? 'bg-purple-500' :
                  cat === 'cave_epicerie' ? 'bg-amber-500' :
                  cat === 'grand_public' ? 'bg-green-500' :
                  'bg-gray-400'
                }`} />
                {DOCUMENT_CATEGORY_LABELS[cat]}
                <span className="text-xs text-gray-400 font-normal">({groupedDocs[cat].length})</span>
              </h2>
              <div className="grid grid-cols-1 gap-3">
                {groupedDocs[cat].map(doc => {
                  const IconComponent = getFileIcon(doc.type_mime);
                  const version = doc.version || 1;
                  const lectureSeule = !!doc.consultation_seule && !isAdmin;
                  const lien = liens[doc.id];
                  const jeDoisSigner = !!moi && doitSigner(doc, moi.id);
                  const maSignature = moi ? signatures.find(s => s.doc_id === doc.id && s.user_id === moi.id && Number(s.version) === version) : undefined;
                  const ouvert = ouvertParMoi(doc);
                  const signeesVersion = signatures.filter(s => s.doc_id === doc.id && Number(s.version) === version);
                  const aSignerQui = doc.a_signer ? concernes(doc, state.commerciaux) : [];
                  const signeIds = new Set(signeesVersion.map(s => s.user_id));
                  const anciennes = signatures.filter(s => s.doc_id === doc.id && Number(s.version) < version);
                  return (
                    <div key={doc.id} id={`doc-${doc.id}`} className={`bg-white rounded-lg border p-4 hover:shadow-sm transition-shadow scroll-mt-4 ${jeDoisSigner && !maSignature ? 'border-amber-300' : 'border-gray-200'}`}>
                      <div className="flex items-start gap-4">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          doc.type_mime.includes('pdf') ? 'bg-red-100 text-red-600' :
                          doc.type_mime.startsWith('image/') ? 'bg-blue-100 text-blue-600' :
                          doc.type_mime.includes('spreadsheet') || doc.type_mime.includes('excel') ? 'bg-green-100 text-green-600' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          <IconComponent className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium text-gray-900 truncate">{doc.nom}</h3>
                          {doc.description && (
                            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{doc.description}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-gray-400">
                            <span className="truncate max-w-full">{doc.nom_fichier}</span>
                            <span>{formatFileSize(doc.taille)}</span>
                            <span>Par {getUploaderName(doc.uploaded_by)}</span>
                            <span>{new Date(doc.date_creation).toLocaleDateString('fr-FR')}</span>
                            {version > 1 && <span>Version {version}</span>}
                            {doc.consultation_seule && (
                              <span className="inline-flex items-center gap-1 text-gray-500"><Lock className="w-3 h-3" /> Consultation seule</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {/* Lire : dans SuiviPro, pour les PDF et les images. Télécharger : le fichier
                              est enregistré sur le téléphone. Deux gestes, deux boutons. */}
                          {affichable(doc.type_mime) && (
                            <button
                              className="p-2 rounded-lg text-gray-500 hover:text-brewery-600 hover:bg-brewery-50 transition-colors"
                              onClick={() => setVisionneuse(doc)}
                              title="Lire"
                              aria-label="Lire"
                            >
                              <Eye className="w-5 h-5" />
                            </button>
                          )}
                          {!lectureSeule && (lien ? (
                            <a
                              href={`${lien}&telecharger=1`}
                              download={doc.nom_fichier}
                              target="_blank"
                              rel="noopener"
                              className="p-2 rounded-lg text-gray-500 hover:text-brewery-600 hover:bg-brewery-50 transition-colors"
                              onClick={() => noterOuverture(doc)}
                              title="Télécharger"
                              aria-label="Télécharger"
                            >
                              <Download className="w-5 h-5" />
                            </a>
                          ) : (
                            <button
                              className="p-2 rounded-lg text-gray-500 hover:text-brewery-600 hover:bg-brewery-50 transition-colors"
                              onClick={() => handleDownload(doc)}
                              title="Télécharger"
                              aria-label="Télécharger"
                            >
                              <Download className="w-5 h-5" />
                            </button>
                          ))}
                          {isAdmin && (
                            <button
                              className="p-2 rounded-lg text-gray-400 hover:text-brewery-600 hover:bg-brewery-50 transition-colors"
                              onClick={() => { setRemplacement(doc); champRemplacement.current?.click(); }}
                              title="Remplacer le fichier (nouvelle version)"
                              aria-label="Remplacer le fichier"
                            >
                              <RefreshCw className="w-4 h-4" />
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                              onClick={() => handleDelete(doc)}
                              title="Supprimer"
                              aria-label="Supprimer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Ma signature */}
                      {jeDoisSigner && (maSignature ? (
                        <p className="mt-3 text-xs text-green-700 flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4" /> Lu et signé le {dateHeure(maSignature.signe_le)}
                        </p>
                      ) : (
                        <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3">
                          <p className="text-xs font-semibold text-amber-900">À lire et signer{version > 1 ? ` (version ${version})` : ''}</p>
                          {!ouvert && (
                            <p className="text-xs text-amber-800 mt-0.5">
                              {affichable(doc.type_mime) ? 'Lisez le document (bouton œil) pour pouvoir le signer.' : 'Téléchargez le document pour pouvoir le signer.'}
                            </p>
                          )}
                          <button
                            className="mt-2 w-full sm:w-auto px-4 py-2 rounded-lg bg-brewery-600 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-brewery-700 disabled:opacity-40 disabled:cursor-not-allowed"
                            disabled={!ouvert}
                            onClick={() => setAConfirmer(doc)}
                          >
                            <FileSignature className="w-4 h-4" /> J'ai lu et je prends connaissance
                          </button>
                        </div>
                      ))}

                      {/* Le suivi, pour l'administration */}
                      {isAdmin && doc.a_signer && (
                        <div className="mt-3 border-t border-gray-100 pt-2">
                          <button className="text-xs font-medium text-gray-700 flex items-center gap-1" onClick={() => basculerSuivi(doc.id)}>
                            {suiviOuvert.has(doc.id) ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            Signatures : <span className={`tabular-nums ${signeIds.size >= aSignerQui.length && aSignerQui.length > 0 ? 'text-green-700' : 'text-amber-700'}`}>
                              {aSignerQui.filter(p => signeIds.has(p.id)).length}/{aSignerQui.length}
                            </span>
                            <span className="text-gray-400 font-normal">· {doc.signataires?.length ? 'personnes choisies' : 'toute l\'équipe'}</span>
                          </button>
                          {suiviOuvert.has(doc.id) && (
                            <div className="mt-2 space-y-1 text-xs">
                              {aSignerQui.map(p => {
                                const s = signeesVersion.find(x => x.user_id === p.id);
                                return (
                                  <div key={p.id} className="flex items-center justify-between gap-2">
                                    <span className="text-gray-700">{p.prenom} {p.nom}</span>
                                    {s
                                      ? <span className="text-green-700 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> {dateHeure(s.signe_le)}</span>
                                      : <span className="text-amber-700">pas encore signé</span>}
                                  </div>
                                );
                              })}
                              {anciennes.length > 0 && (
                                <p className="text-[11px] text-gray-400 pt-1">
                                  Versions précédentes : {anciennes.map(s => `${nomDe(s.user_id)} (v${s.version}, ${new Date(s.signe_le).toLocaleDateString('fr-FR')})`).join(' · ')}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Remplacer un fichier : un seul champ caché pour toute la page */}
      <input
        ref={champRemplacement}
        type="file"
        className="hidden"
        accept={remplacement?.consultation_seule ? '.pdf,.png,.jpg,.jpeg,.gif,.webp' : '.pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.gif,.webp'}
        onChange={e => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && remplacement) {
            const ok = !remplacement.a_signer || confirm(`Remplacer le fichier de « ${remplacement.nom} » ? Ce sera une nouvelle version : tout le monde devra la signer de nouveau.`);
            if (ok) remplacerLeFichier(remplacement, f);
          }
          setRemplacement(null);
        }}
      />

      {/* La visionneuse */}
      {visionneuse && (
        <VisionneuseDocument
          doc={visionneuse}
          onClose={() => setVisionneuse(null)}
          onOuvert={() => noterOuverture(visionneuse)}
          signature={moi && doitSigner(visionneuse, moi.id) && !aSigne(visionneuse, moi.id, signatures)
            ? { onSigner: () => { const d = visionneuse; setVisionneuse(null); setAConfirmer(d); } }
            : undefined}
        />
      )}

      {/* Confirmer la prise de connaissance */}
      {aConfirmer && moi && (
        <div className="modal-backdrop" onClick={() => !signatureEnCours && setAConfirmer(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <FileSignature className="w-5 h-5 text-brewery-600" /> Prise de connaissance
              </h3>
            </div>
            <div className="p-5 space-y-3 text-sm text-gray-700">
              <p>
                Je soussigné(e) <strong>{moi.prenom} {moi.nom}</strong> déclare avoir lu le document
                « <strong>{aConfirmer.nom}</strong> »{(aConfirmer.version || 1) > 1 ? ` (version ${aConfirmer.version})` : ''} et en avoir pris connaissance.
              </p>
              <p className="text-xs text-gray-500">
                Sont enregistrés : votre nom, la date et l'heure, et l'empreinte du fichier lu. Si le document change, il vous sera demandé de signer la nouvelle version.
              </p>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
              <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" disabled={signatureEnCours} onClick={() => setAConfirmer(null)}>
                Annuler
              </button>
              <button
                className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2 disabled:opacity-50"
                disabled={signatureEnCours}
                onClick={() => signer(aConfirmer)}
              >
                <FileSignature className="w-4 h-4" /> {signatureEnCours ? 'Signature…' : 'Je signe'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <div className="modal-backdrop">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <Upload className="w-5 h-5 text-brewery-600" /> Ajouter un document
              </h3>
              <button className="p-1 rounded hover:bg-gray-100" onClick={reinitialiserEnvoi}>
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nom du document *</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
                  placeholder="Ex: Catalogue Cave 2025"
                  value={uploadNom}
                  onChange={e => setUploadNom(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Catégorie *</label>
                <select
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
                  value={uploadCategorie}
                  onChange={e => setUploadCategorie(e.target.value as DocumentCategory)}
                >
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{DOCUMENT_CATEGORY_LABELS[cat]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
                  rows={2}
                  placeholder="Description optionnelle..."
                  value={uploadDescription}
                  onChange={e => setUploadDescription(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Fichier *</label>
                <div className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center hover:border-brewery-300 transition-colors">
                  {uploadFile ? (
                    <div className="flex items-center gap-3">
                      <File className="w-8 h-8 text-brewery-500" />
                      <div className="text-left flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{uploadFile.name}</p>
                        <p className="text-xs text-gray-500">{formatFileSize(uploadFile.size)}</p>
                      </div>
                      <button className="text-gray-400 hover:text-red-500" onClick={() => { setUploadFile(null); setUploadConsultationSeule(false); }}>
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <label className="cursor-pointer">
                      <Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm text-gray-500">Cliquer pour choisir un fichier</p>
                      <p className="text-xs text-gray-400 mt-1">PDF, images, Excel... (max 5 Mo)</p>
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.gif,.webp"
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) {
                            if (file.size > TAILLE_MAX) {
                              alert('Le fichier ne doit pas dépasser 5 Mo');
                              return;
                            }
                            setUploadFile(file);
                            if (!affichable(file.type)) setUploadConsultationSeule(false);
                          }
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>

              {/* Consultation seule */}
              <div className={`rounded-lg border p-3 ${fichierAffichable ? 'border-gray-200' : 'border-gray-100 bg-gray-50'}`}>
                <label className={`flex items-start gap-2 text-sm ${fichierAffichable ? 'cursor-pointer text-gray-800' : 'cursor-not-allowed text-gray-400'}`}>
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={uploadConsultationSeule}
                    disabled={!fichierAffichable}
                    onChange={e => setUploadConsultationSeule(e.target.checked)}
                  />
                  <span>
                    <span className="font-medium flex items-center gap-1"><Lock className="w-3.5 h-3.5" /> Consultation seule</span>
                    <span className="block text-xs text-gray-500 mt-0.5">
                      {fichierAffichable || !uploadFile
                        ? 'L\'équipe le lit dans SuiviPro, sans pouvoir le télécharger ni le partager. Les administrateurs gardent le téléchargement.'
                        : 'Réservé aux PDF et aux images : exportez ce fichier en PDF pour pouvoir le cocher.'}
                    </span>
                  </span>
                </label>
              </div>

              {/* À faire signer */}
              <div className="rounded-lg border border-gray-200 p-3 space-y-2">
                <label className="flex items-start gap-2 text-sm text-gray-800 cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={uploadASigner} onChange={e => setUploadASigner(e.target.checked)} />
                  <span>
                    <span className="font-medium flex items-center gap-1"><FileSignature className="w-3.5 h-3.5" /> À faire lire et signer</span>
                    <span className="block text-xs text-gray-500 mt-0.5">Chacun devra l'ouvrir puis confirmer « J'ai lu et je prends connaissance ».</span>
                  </span>
                </label>
                {uploadASigner && (
                  <div className="pl-6 space-y-2">
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input type="radio" name="qui-signe" checked={uploadTouteLEquipe} onChange={() => setUploadTouteLEquipe(true)} />
                      Toute l'équipe
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input type="radio" name="qui-signe" checked={!uploadTouteLEquipe} onChange={() => setUploadTouteLEquipe(false)} />
                      Certaines personnes
                    </label>
                    {!uploadTouteLEquipe && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 pl-6">
                        {equipeSaufMoi.map(p => (
                          <label key={p.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={uploadSignataires.includes(p.id)}
                              onChange={e => setUploadSignataires(prev => e.target.checked ? [...prev, p.id] : prev.filter(x => x !== p.id))}
                            />
                            {p.prenom} {p.nom}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
              <button
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                onClick={reinitialiserEnvoi}
              >
                Annuler
              </button>
              <button
                className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleUpload}
                disabled={!uploadNom || !uploadFile || uploading}
              >
                <Upload className="w-4 h-4" /> {uploading ? 'Envoi...' : 'Envoyer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
