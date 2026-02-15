import { useState, useRef } from 'react';
import {
  Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle, X, Loader2, MapPin,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { Prospect, EstablishmentType, PipelineStage, ESTABLISHMENT_LABELS, PIPELINE_LABELS } from '../types';
import { generateId, exportProspectsCSV, geocodeBatch } from '../utils/helpers';

export default function ImportPage() {
  const { state, dispatch } = useApp();
  const [importResults, setImportResults] = useState<{ success: number; errors: string[]; geocoded: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeProgress, setGeocodeProgress] = useState({ done: 0, total: 0 });
  const [importSecteur, setImportSecteur] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportCSV = () => {
    exportProspectsCSV(state.prospects);
  };

  const handleExportXLSX = async () => {
    try {
      const XLSX = await import('xlsx');
      const data = state.prospects.map(p => ({
        'Date de création': p.date_creation?.split('T')[0] || '',
        'Dénomination': p.nom_etablissement,
        'Etat du contact/ Etapes': PIPELINE_LABELS[p.etape_pipeline] || p.etape_pipeline,
        'Type de prospect': ESTABLISHMENT_LABELS[p.type_etablissement] || p.type_etablissement,
        'Tournée / Secteur': p.secteur || '',
        'Nom': p.nom_contact?.split(' ').slice(1).join(' ') || p.nom_contact,
        'Prénom': p.nom_contact?.split(' ')[0] || '',
        'E-mail': p.email,
        'Tél. fixe': '',
        'Tél. mobile': p.telephone,
        'Adresse': `${p.adresse}${p.ville ? `, ${p.code_postal} ${p.ville}` : ''}`,
        'Notes': p.notes,
        'Score': p.score,
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Prospects');
      XLSX.writeFile(wb, `prospects-${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (err) {
      alert('Erreur lors de l\'export Excel');
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResults(null);
    const errors: string[] = [];
    let success = 0;
    let geocoded = 0;

    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws);

      if (rows.length === 0) {
        errors.push('Le fichier est vide');
        setImportResults({ success: 0, errors, geocoded: 0 });
        setImporting(false);
        return;
      }

      // Helper: detect establishment type from string
      const detectType = (val: string): EstablishmentType => {
        const v = val.toLowerCase().trim();
        if (v.includes('bar') || v.includes('restaurant') || v.includes('brasserie') || v.includes('bistrot')) return 'bar_restaurant';
        if (v.includes('cave') || v.includes('caviste')) return 'cave';
        if (v.includes('epicerie') || v.includes('épicerie')) return 'epicerie';
        if (v.includes('supermarche') || v.includes('supermarché') || v.includes('gms') || v.includes('grande surface')) return 'supermarche';
        if (v.includes('marche') || v.includes('marché')) return 'marche';
        if (v.includes('distribut')) return 'distributeur';
        if (v.includes('hotel') || v.includes('hôtel')) return 'hotel';
        return 'autre';
      };

      // Helper: detect pipeline stage from string
      const detectStage = (val: string): PipelineStage => {
        const v = val.toLowerCase().trim();
        if (v.includes('nouveau') || v.includes('new')) return 'nouveau';
        if (v.includes('contacter') || v.includes('à contacter')) return 'a_contacter';
        if (v.includes('contacte') || v.includes('contacté')) return 'contacte';
        if (v.includes('proposition') || v.includes('offre')) return 'proposition';
        if (v.includes('negociation') || v.includes('négociation')) return 'negociation';
        if (v.includes('gagne') || v.includes('gagné') || v.includes('rdv') || v.includes('client')) return 'gagne';
        if (v.includes('perdu') || v.includes('refuse') || v.includes('refusé')) return 'perdu';
        return 'nouveau';
      };

      // Helper: get cell value flexibly
      const getVal = (row: Record<string, any>, ...keys: string[]): string => {
        for (const key of keys) {
          for (const rowKey of Object.keys(row)) {
            if (rowKey.toLowerCase().trim() === key.toLowerCase().trim()) {
              return String(row[rowKey] ?? '').trim();
            }
          }
        }
        return '';
      };

      // Parse rows with flexible column names
      interface ParsedRow {
        nom: string; contact: string; telephone: string; email: string;
        adresse: string; score: number; type: EstablishmentType;
        etape: PipelineStage; secteur: string; notes: string;
        dateCreation: string; index: number;
      }
      const parsed: ParsedRow[] = [];

      rows.forEach((row, index) => {
        // Denomination / Etablissement
        const nom = getVal(row,
          'Dénomination', 'Denomination', 'Etablissement', 'etablissement',
          'Nom', 'nom', 'nom_etablissement', 'Raison sociale'
        );
        if (!nom) {
          errors.push(`Ligne ${index + 2}: Nom d'etablissement manquant`);
          return;
        }

        if (state.prospects.some(p => p.nom_etablissement.toLowerCase() === nom.toLowerCase())) {
          errors.push(`Ligne ${index + 2}: "${nom}" existe deja`);
          return;
        }

        // Contact: Nom + Prenom or combined
        const contactNom = getVal(row, 'Nom', 'nom');
        const contactPrenom = getVal(row, 'Prénom', 'Prenom', 'prenom');
        let contact = '';
        if (contactPrenom || (contactNom && contactNom !== nom)) {
          contact = `${contactPrenom} ${contactNom}`.trim();
        }
        if (!contact) {
          contact = getVal(row,
            'Nom/Prenom', 'Nom/prenom', 'nom/prenom', 'Nom Prenom',
            'Contact', 'contact', 'Nom Contact', 'nom_contact'
          );
        }

        // Telephone: tel fixe + tel mobile
        const telFixe = getVal(row,
          'Tél. fixe', 'Tel. fixe', 'Tel fixe', 'Telephone fixe',
          'Telephone', 'telephone', 'Tel', 'tel',
          'Numero', 'numero'
        );
        const telMobile = getVal(row,
          'Tél. mobile', 'Tel. mobile', 'Tel mobile', 'Telephone mobile',
          'Mobile', 'mobile', 'Portable', 'portable'
        );
        const telephone = telMobile || telFixe;

        // Email
        const email = getVal(row,
          'E-mail', 'Email', 'email', 'e-mail', 'Mail', 'mail',
          'Adresse email', 'Adresse e-mail'
        );

        // Adresse
        const adresse = getVal(row,
          'Adresse', 'adresse', 'Adresse complete', 'Adresse Notes'
        );

        // Type de prospect
        const typeStr = getVal(row,
          'Type de prospect', 'Type', 'type', 'type_etablissement',
          'Type d\'établissement', 'Type etablissement'
        );
        const type = typeStr ? detectType(typeStr) : 'autre';

        // Etape / Etat du contact
        const etapeStr = getVal(row,
          'Etat du contact/ Etapes', 'Etat du contact/Etapes',
          'Etat du contact', 'Etapes', 'Etape', 'etape',
          'etape_pipeline', 'Pipeline', 'Statut'
        );
        const etape = etapeStr ? detectStage(etapeStr) : 'nouveau';

        // Secteur / Tournee
        const secteur = getVal(row,
          'Tournée / Secteur', 'Tournee / Secteur', 'Tournée/Secteur',
          'Tournee/Secteur', 'Secteur', 'secteur', 'Tournée', 'Tournee'
        ) || importSecteur;

        // Notes
        const notes = getVal(row, 'Notes', 'notes', 'Commentaire', 'commentaire');

        // Score
        const rawScore = getVal(row,
          'Score', 'score', 'Notes/qualite', 'Qualite', 'qualite', 'Note'
        );
        const scoreNum = parseInt(rawScore, 10);
        const score = !isNaN(scoreNum) && scoreNum >= 0 && scoreNum <= 100 ? scoreNum : 50;

        // Date de creation
        const dateCreation = getVal(row,
          'Date de création', 'Date de creation', 'date_creation',
          'Date creation', 'Date'
        );

        parsed.push({
          nom, contact, telephone, email, adresse, score,
          type, etape, secteur, notes, dateCreation, index,
        });
      });

      if (parsed.length === 0) {
        setImportResults({ success: 0, errors, geocoded: 0 });
        setImporting(false);
        return;
      }

      // Geocode all addresses
      const addresses = parsed.map(p => p.adresse).filter(a => a.length > 0);
      let geoResults: (Awaited<ReturnType<typeof geocodeBatch>>[number])[] = [];

      if (addresses.length > 0) {
        setGeocoding(true);
        setGeocodeProgress({ done: 0, total: parsed.length });

        const allAddresses = parsed.map(p => p.adresse);
        geoResults = await geocodeBatch(allAddresses, (done, total) => {
          setGeocodeProgress({ done, total });
        });
        setGeocoding(false);
      }

      // Build prospects
      const now = new Date().toISOString();
      const newProspects: Prospect[] = [];

      parsed.forEach((row, i) => {
        const geo = geoResults[i];
        if (geo) geocoded++;

        // Parse date de creation from file or use now
        let dateCreation = now;
        if (row.dateCreation) {
          const d = new Date(row.dateCreation);
          if (!isNaN(d.getTime())) dateCreation = d.toISOString();
        }

        newProspects.push({
          id: generateId('p'),
          nom_etablissement: row.nom,
          type_etablissement: row.type,
          nom_contact: row.contact,
          telephone: row.telephone,
          email: row.email,
          adresse: row.adresse,
          ville: geo?.ville || '',
          code_postal: geo?.code_postal || '',
          departement: geo?.departement || '',
          secteur: row.secteur,
          latitude: geo?.latitude || 0,
          longitude: geo?.longitude || 0,
          etape_pipeline: row.etape,
          tags: [],
          commercial_id: state.currentUser?.id || 'com-1',
          notes: row.notes,
          date_creation: dateCreation,
          date_modification: now,
          score: row.score,
        });
        success++;
      });

      if (newProspects.length > 0) {
        dispatch({ type: 'IMPORT_PROSPECTS', payload: newProspects });
      }
    } catch (err) {
      errors.push('Erreur de lecture du fichier. Verifiez le format (Excel .xlsx ou .csv).');
    }

    setImportResults({ success, errors, geocoded });
    setImporting(false);
    setGeocoding(false);

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const downloadTemplate = async () => {
    try {
      const XLSX = await import('xlsx');
      const template = [{
        'Date de création': '2025-01-15',
        'Dénomination': 'Exemple Cafe',
        'Etat du contact/ Etapes': 'Nouveau',
        'Type de prospect': 'Bar / Restaurant',
        'Tournée / Secteur': 'Loire',
        'Nom': 'Dupont',
        'Prénom': 'Jean',
        'E-mail': 'contact@exemple.fr',
        'Tél. fixe': '04 71 00 00 00',
        'Tél. mobile': '06 12 34 56 78',
        'Adresse': '1 Rue Exemple, 42000 Saint-Etienne',
        'Notes': 'Premier contact au marche',
        'Score': '75',
      }];
      const ws = XLSX.utils.json_to_sheet(template);
      // Ajuster la largeur des colonnes
      ws['!cols'] = [
        { wch: 15 }, { wch: 25 }, { wch: 22 }, { wch: 18 },
        { wch: 18 }, { wch: 15 }, { wch: 12 }, { wch: 25 },
        { wch: 16 }, { wch: 16 }, { wch: 35 }, { wch: 30 }, { wch: 6 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Template');
      XLSX.writeFile(wb, 'template-import-prospects.xlsx');
    } catch (err) {
      alert('Erreur lors de la creation du template');
    }
  };

  // Get unique sectors for suggestions
  const existingSecteurs = [...new Set(state.prospects.map(p => p.secteur).filter(Boolean))];

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Import / Export</h1>
        <p className="text-xs sm:text-sm text-gray-500 mt-0.5">Gestion des donnees prospects</p>
      </div>

      {/* Export section */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
        <h3 className="font-semibold text-gray-900 text-sm sm:text-base mb-1">Exporter les prospects</h3>
        <p className="text-xs sm:text-sm text-gray-500 mb-4">Exportez vos {state.prospects.length} prospects</p>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <button
            className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-xs sm:text-sm font-medium"
            onClick={handleExportXLSX}
          >
            <FileSpreadsheet className="w-4 h-4" /> Export Excel (.xlsx)
          </button>
          <button
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
            onClick={handleExportCSV}
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
      </div>

      {/* Import section */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 mb-1">Importer des prospects</h3>
        <p className="text-sm text-gray-500 mb-4">Importez depuis un fichier Excel ou CSV</p>

        {/* Sector selection before import */}
        <div className="mb-4 p-4 bg-brewery-50 rounded-lg border border-brewery-200">
          <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-brewery-600" />
            Secteur pour cet import
          </label>
          <input
            type="text"
            placeholder="Ex: Loire, Haute-Loire, Rhone..."
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
            value={importSecteur}
            onChange={e => setImportSecteur(e.target.value)}
            list="secteurs-list"
          />
          {existingSecteurs.length > 0 && (
            <datalist id="secteurs-list">
              {existingSecteurs.map(s => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
          <p className="text-xs text-gray-500 mt-1">Tous les prospects importes seront assignes a ce secteur</p>
        </div>

        <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-brewery-500 transition-colors">
          {geocoding ? (
            <div className="space-y-3">
              <Loader2 className="w-10 h-10 text-brewery-500 mx-auto animate-spin" />
              <p className="text-sm font-medium text-gray-700">Geocodage des adresses en cours...</p>
              <div className="w-64 mx-auto bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-brewery-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${geocodeProgress.total > 0 ? (geocodeProgress.done / geocodeProgress.total) * 100 : 0}%` }}
                />
              </div>
              <p className="text-xs text-gray-500">{geocodeProgress.done} / {geocodeProgress.total} adresses traitees</p>
            </div>
          ) : (
            <>
              <Upload className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-600 mb-3">
                Glissez un fichier ou cliquez pour selectionner
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleImport}
              />
              <button
                className="px-4 py-2 bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 text-sm font-medium"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
              >
                {importing ? 'Import en cours...' : 'Choisir un fichier'}
              </button>
            </>
          )}
        </div>

        <div className="mt-4">
          <button
            className="text-sm text-brewery-600 hover:text-brewery-700 font-medium flex items-center gap-1"
            onClick={downloadTemplate}
          >
            <Download className="w-4 h-4" /> Telecharger le template d'import
          </button>
        </div>

        {/* Validation info */}
        <div className="mt-4 bg-gray-50 rounded-lg p-4 text-xs text-gray-600 space-y-2">
          <p className="font-medium text-gray-700">Colonnes attendues :</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            <p><span className="font-medium text-gray-700">Date de creation</span> - date (optionnel)</p>
            <p><span className="font-medium text-gray-700">Denomination</span> - nom de l'etablissement *</p>
            <p><span className="font-medium text-gray-700">Etat du contact/ Etapes</span> - etape pipeline</p>
            <p><span className="font-medium text-gray-700">Type de prospect</span> - type d'etablissement</p>
            <p><span className="font-medium text-gray-700">Tournee / Secteur</span> - secteur geographique</p>
            <p><span className="font-medium text-gray-700">Nom</span> - nom du contact</p>
            <p><span className="font-medium text-gray-700">Prenom</span> - prenom du contact</p>
            <p><span className="font-medium text-gray-700">E-mail</span> - adresse email</p>
            <p><span className="font-medium text-gray-700">Tel. fixe</span> - telephone fixe</p>
            <p><span className="font-medium text-gray-700">Tel. mobile</span> - telephone mobile (prioritaire)</p>
            <p><span className="font-medium text-gray-700">Adresse</span> - adresse complete</p>
            <p><span className="font-medium text-gray-700">Notes</span> - notes / commentaires</p>
            <p><span className="font-medium text-gray-700">Score</span> - score de 0 a 100</p>
          </div>
          <p className="mt-2 text-gray-500">* Seule la denomination est obligatoire. Les types de prospect et etapes sont detectes automatiquement.</p>
          <p className="text-gray-500">Les adresses seront geocodees automatiquement pour la carte (via OpenStreetMap).</p>
          <p className="text-gray-500">Si le secteur est renseigne dans le fichier, il sera prioritaire sur le champ ci-dessus.</p>
        </div>
      </div>

      {/* Import results */}
      {importResults && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Resultats de l'import</h3>
            <button className="p-1 rounded hover:bg-gray-100" onClick={() => setImportResults(null)}>
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
          {importResults.success > 0 && (
            <div className="flex items-center gap-2 text-green-600 mb-2">
              <CheckCircle className="w-4 h-4" />
              <span className="text-sm font-medium">{importResults.success} prospect(s) importe(s) avec succes</span>
            </div>
          )}
          {importResults.geocoded > 0 && (
            <div className="flex items-center gap-2 text-blue-600 mb-2">
              <MapPin className="w-4 h-4" />
              <span className="text-sm font-medium">{importResults.geocoded} adresse(s) geocodee(s) sur la carte</span>
            </div>
          )}
          {importResults.success > 0 && importResults.geocoded < importResults.success && (
            <div className="flex items-center gap-2 text-amber-600 mb-2">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm font-medium">{importResults.success - importResults.geocoded} adresse(s) non trouvee(s) - verifiez les adresses</span>
            </div>
          )}
          {importResults.errors.length > 0 && (
            <div className="space-y-1">
              {importResults.errors.map((err, i) => (
                <div key={i} className="flex items-start gap-2 text-red-600 text-xs">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>{err}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
