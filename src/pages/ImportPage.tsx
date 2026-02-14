import { useState, useRef } from 'react';
import {
  Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle, X, Loader2, MapPin,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { Prospect, EstablishmentType, PipelineStage } from '../types';
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
        'Etablissement': p.nom_etablissement,
        'Type': p.type_etablissement,
        'Contact': p.nom_contact,
        'Telephone': p.telephone,
        'Email': p.email,
        'Adresse': p.adresse,
        'Ville': p.ville,
        'Code Postal': p.code_postal,
        'Departement': p.departement,
        'Secteur': p.secteur || '',
        'Latitude': p.latitude,
        'Longitude': p.longitude,
        'Etape': p.etape_pipeline,
        'Score': p.score,
        'Notes': p.notes,
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

      // Parse rows with flexible column names
      const parsed: { nom: string; contact: string; telephone: string; adresse: string; score: number; index: number }[] = [];

      rows.forEach((row, index) => {
        const nom = row['Etablissement'] || row['etablissement'] || row['Nom'] || row['nom'] || row['nom_etablissement'] || '';
        if (!String(nom).trim()) {
          errors.push(`Ligne ${index + 2}: Nom d'etablissement manquant`);
          return;
        }
        const nomStr = String(nom).trim();

        if (state.prospects.some(p => p.nom_etablissement.toLowerCase() === nomStr.toLowerCase())) {
          errors.push(`Ligne ${index + 2}: "${nomStr}" existe deja`);
          return;
        }

        const contact = String(
          row['Nom/Prenom'] || row['Nom/prenom'] || row['nom/prenom'] ||
          row['Nom Prenom'] || row['nom prenom'] ||
          row['Contact'] || row['contact'] ||
          row['Nom Contact'] || row['nom_contact'] || ''
        ).trim();

        const telephone = String(
          row['Telephone'] || row['telephone'] || row['Tel'] || row['tel'] ||
          row['Numero'] || row['numero'] || row['Numero de telephone'] || ''
        ).trim();

        const adresse = String(
          row['Adresse'] || row['adresse'] || row['Adresse complete'] || ''
        ).trim();

        const rawScore =
          row['Notes/qualite'] || row['notes/qualite'] || row['Notes/Qualite'] ||
          row['Qualite'] || row['qualite'] || row['Score'] || row['score'] ||
          row['Note'] || row['note'] || '';
        const scoreNum = parseInt(String(rawScore), 10);
        const score = !isNaN(scoreNum) && scoreNum >= 0 && scoreNum <= 100 ? scoreNum : 50;

        parsed.push({ nom: nomStr, contact, telephone, adresse, score, index });
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

        newProspects.push({
          id: generateId('p'),
          nom_etablissement: row.nom,
          type_etablissement: 'autre' as EstablishmentType,
          nom_contact: row.contact,
          telephone: row.telephone,
          email: '',
          adresse: row.adresse,
          ville: geo?.ville || '',
          code_postal: geo?.code_postal || '',
          departement: geo?.departement || '',
          secteur: importSecteur,
          latitude: geo?.latitude || 0,
          longitude: geo?.longitude || 0,
          etape_pipeline: 'nouveau' as PipelineStage,
          tags: [],
          commercial_id: state.currentUser?.id || 'com-1',
          notes: '',
          date_creation: now,
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
        'Etablissement': 'Exemple Cafe',
        'Nom/Prenom': 'Jean Dupont',
        'Telephone': '04 71 00 00 00',
        'Adresse': '1 Rue Exemple, 42000 Saint-Etienne',
        'Notes/qualite': '75',
      }];
      const ws = XLSX.utils.json_to_sheet(template);
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
    <div className="p-6 space-y-6 fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Import / Export</h1>
        <p className="text-sm text-gray-500 mt-0.5">Gestion des donnees prospects</p>
      </div>

      {/* Export section */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 mb-1">Exporter les prospects</h3>
        <p className="text-sm text-gray-500 mb-4">Exportez vos {state.prospects.length} prospects</p>
        <div className="flex gap-3">
          <button
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
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
        <div className="mt-4 bg-gray-50 rounded-lg p-4 text-xs text-gray-600 space-y-1">
          <p className="font-medium text-gray-700">Colonnes attendues:</p>
          <p>Etablissement, Nom/Prenom, Telephone, Adresse, Notes/qualite (score de 0 a 100)</p>
          <p className="mt-2 text-gray-500">Les adresses seront automatiquement geocodees pour la carte (via OpenStreetMap).</p>
          <p className="text-gray-500">La ville, le code postal et le departement seront remplis automatiquement.</p>
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
