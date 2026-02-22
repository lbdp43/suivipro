import { useState } from 'react';
import { FileText, Upload, Download, Trash2, Search, Filter, Plus, X, File, Image, FileSpreadsheet } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { Document, DocumentCategory, DOCUMENT_CATEGORY_LABELS } from '../types';
import { downloadDocument } from '../api/client';

const CATEGORIES: DocumentCategory[] = ['bar_restaurant', 'prix_ce', 'cave_epicerie', 'grand_public', 'autre'];

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

export default function DocumentsPage() {
  const { state, dispatch } = useApp();
  const isAdmin = state.currentUser?.role === 'admin';

  const [showUpload, setShowUpload] = useState(false);
  const [filterCategory, setFilterCategory] = useState<DocumentCategory | ''>('');
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);

  // Upload form state
  const [uploadNom, setUploadNom] = useState('');
  const [uploadCategorie, setUploadCategorie] = useState<DocumentCategory>('autre');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const filteredDocs = state.documents.filter(doc => {
    if (filterCategory && doc.categorie !== filterCategory) return false;
    if (search) {
      const s = search.toLowerCase();
      return doc.nom.toLowerCase().includes(s) || doc.nom_fichier.toLowerCase().includes(s) || doc.description.toLowerCase().includes(s);
    }
    return true;
  });

  const handleUpload = async () => {
    if (!uploadFile || !uploadNom) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        const newDoc: Document & { contenu: string } = {
          id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          nom: uploadNom,
          categorie: uploadCategorie,
          description: uploadDescription,
          nom_fichier: uploadFile.name,
          type_mime: uploadFile.type || 'application/octet-stream',
          taille: uploadFile.size,
          uploaded_by: state.currentUser?.id || '',
          date_creation: new Date().toISOString(),
          contenu: base64,
        };
        dispatch({ type: 'ADD_DOCUMENT', payload: newDoc });
        setShowUpload(false);
        setUploadNom('');
        setUploadCategorie('autre');
        setUploadDescription('');
        setUploadFile(null);
        setUploading(false);
      };
      reader.readAsDataURL(uploadFile);
    } catch {
      setUploading(false);
    }
  };

  const handleDelete = (doc: Document) => {
    if (confirm(`Supprimer le document "${doc.nom}" ?`)) {
      dispatch({ type: 'DELETE_DOCUMENT', payload: doc.id });
    }
  };

  const handleDownload = async (doc: Document) => {
    try {
      await downloadDocument(doc.id, doc.nom_fichier);
    } catch {
      // Error handled by API client
    }
  };

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

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-brewery-600" />
            Documents
          </h1>
          <p className="text-sm text-gray-500 mt-1">Catalogues, grilles tarifaires et documents partages</p>
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
            <option value="">Toutes les categories</option>
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
              <div className="grid gap-3">
                {groupedDocs[cat].map(doc => {
                  const IconComponent = getFileIcon(doc.type_mime);
                  return (
                    <div key={doc.id} className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition-shadow">
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
                          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400">
                            <span>{doc.nom_fichier}</span>
                            <span>{formatFileSize(doc.taille)}</span>
                            <span>Par {getUploaderName(doc.uploaded_by)}</span>
                            <span>{new Date(doc.date_creation).toLocaleDateString('fr-FR')}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            className="p-2 rounded-lg text-gray-400 hover:text-brewery-600 hover:bg-brewery-50 transition-colors"
                            onClick={() => handleDownload(doc)}
                            title="Telecharger"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          {isAdmin && (
                            <button
                              className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                              onClick={() => handleDelete(doc)}
                              title="Supprimer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
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
              <button className="p-1 rounded hover:bg-gray-100" onClick={() => setShowUpload(false)}>
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
                <label className="block text-xs font-medium text-gray-600 mb-1">Categorie *</label>
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
                      <button className="text-gray-400 hover:text-red-500" onClick={() => setUploadFile(null)}>
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <label className="cursor-pointer">
                      <Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm text-gray-500">Cliquer pour choisir un fichier</p>
                      <p className="text-xs text-gray-400 mt-1">PDF, images, Excel... (max 8 Mo)</p>
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.gif,.webp"
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) {
                            if (file.size > 8 * 1024 * 1024) {
                              alert('Le fichier ne doit pas depasser 8 Mo');
                              return;
                            }
                            setUploadFile(file);
                          }
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
              <button
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                onClick={() => setShowUpload(false)}
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
