import { useState, useRef } from 'react';
import {
  Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle, X,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { Prospect, EstablishmentType, PipelineStage } from '../types';
import { generateId, exportProspectsCSV } from '../utils/helpers';

export default function ImportPage() {
  const { state, dispatch } = useApp();
  const [importResults, setImportResults] = useState<{ success: number; errors: string[] } | null>(null);
  const [importing, setImporting] = useState(false);
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
    const errors: string[] = [];
    let success = 0;

    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws);

      const validTypes: EstablishmentType[] = ['bar_restaurant', 'cave', 'epicerie', 'supermarche', 'marche', 'distributeur', 'hotel', 'autre'];
      const validStages: PipelineStage[] = ['nouveau', 'a_contacter', 'contacte', 'rdv_pris', 'proposition', 'negociation', 'gagne', 'perdu'];

      const newProspects: Prospect[] = [];
      const now = new Date().toISOString();

      rows.forEach((row, index) => {
        const nom = row['Etablissement'] || row['nom_etablissement'] || row['Nom'];
        if (!nom) {
          errors.push(`Ligne ${index + 2}: Nom d'etablissement manquant`);
          return;
        }

        // Check for duplicates
        if (state.prospects.some(p => p.nom_etablissement.toLowerCase() === String(nom).toLowerCase())) {
          errors.push(`Ligne ${index + 2}: "${nom}" existe deja`);
          return;
        }

        const type = (row['Type'] || row['type_etablissement'] || 'autre') as string;
        const etape = (row['Etape'] || row['etape_pipeline'] || 'nouveau') as string;

        newProspects.push({
          id: generateId('p'),
          nom_etablissement: String(nom),
          type_etablissement: validTypes.includes(type as EstablishmentType) ? type as EstablishmentType : 'autre',
          nom_contact: String(row['Contact'] || row['nom_contact'] || ''),
          telephone: String(row['Telephone'] || row['telephone'] || ''),
          email: String(row['Email'] || row['email'] || ''),
          adresse: String(row['Adresse'] || row['adresse'] || ''),
          ville: String(row['Ville'] || row['ville'] || ''),
          code_postal: String(row['Code Postal'] || row['code_postal'] || ''),
          departement: String(row['Departement'] || row['departement'] || ''),
          latitude: parseFloat(row['Latitude'] || row['latitude']) || 45.3,
          longitude: parseFloat(row['Longitude'] || row['longitude']) || 4.27,
          etape_pipeline: validStages.includes(etape as PipelineStage) ? etape as PipelineStage : 'nouveau',
          tags: [],
          commercial_id: state.currentUser?.id || 'com-1',
          notes: String(row['Notes'] || row['notes'] || ''),
          date_creation: now,
          date_modification: now,
          score: parseInt(row['Score'] || row['score']) || 50,
        });
        success++;
      });

      if (newProspects.length > 0) {
        dispatch({ type: 'IMPORT_PROSPECTS', payload: newProspects });
      }
    } catch (err) {
      errors.push('Erreur de lecture du fichier. Verifiez le format (Excel .xlsx ou .csv).');
    }

    setImportResults({ success, errors });
    setImporting(false);

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const downloadTemplate = async () => {
    try {
      const XLSX = await import('xlsx');
      const template = [{
        'Etablissement': 'Exemple Cafe',
        'Type': 'bar_restaurant',
        'Contact': 'Jean Dupont',
        'Telephone': '04 71 00 00 00',
        'Email': 'contact@exemple.fr',
        'Adresse': '1 Rue Exemple',
        'Ville': 'Saint-Etienne',
        'Code Postal': '42000',
        'Departement': 'Loire',
        'Latitude': 45.44,
        'Longitude': 4.39,
        'Etape': 'nouveau',
        'Score': 50,
        'Notes': 'Notes ici',
      }];
      const ws = XLSX.utils.json_to_sheet(template);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Template');
      XLSX.writeFile(wb, 'template-import-prospects.xlsx');
    } catch (err) {
      alert('Erreur lors de la creation du template');
    }
  };

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

        <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-brewery-500 transition-colors">
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
          <p>Etablissement, Type, Contact, Telephone, Email, Adresse, Ville, Code Postal, Departement, Latitude, Longitude, Etape, Score, Notes</p>
          <p className="mt-2 font-medium text-gray-700">Types valides:</p>
          <p>bar_restaurant, cave, epicerie, supermarche, marche, distributeur, hotel, autre</p>
          <p className="mt-2 font-medium text-gray-700">Etapes valides:</p>
          <p>nouveau, a_contacter, contacte, rdv_pris, proposition, negociation, gagne, perdu</p>
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
