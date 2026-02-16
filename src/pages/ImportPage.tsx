import { useState, useRef } from 'react';
import {
  Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle, X, Loader2, MapPin,
  Search, Trash2, Trophy, CheckSquare, Square,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { Prospect, EstablishmentType, PipelineStage, ESTABLISHMENT_LABELS, PIPELINE_LABELS } from '../types';
import { generateId, exportProspectsCSV, geocodeBatch } from '../utils/helpers';

export default function ImportPage() {
  const { state, dispatch } = useApp();
  const [importResults, setImportResults] = useState<{ success: number; errors: string[]; geocoded: number; duplicates: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeProgress, setGeocodeProgress] = useState({ done: 0, total: 0 });
  const [importSecteur, setImportSecteur] = useState('');
  const [skipGeocoding, setSkipGeocoding] = useState(false);
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
        setImportResults({ success: 0, errors, geocoded: 0, duplicates: 0 });
        setImporting(false);
        return;
      }

      // Helper: detect establishment type from string
      const detectType = (val: string): EstablishmentType => {
        const v = val.toLowerCase().trim();
        if (v.includes('bar') || v.includes('restaurant') || v.includes('brasserie') || v.includes('bistrot') || v.includes('resto')) return 'bar_restaurant';
        if (v.includes('cave') || v.includes('caviste')) return 'cave';
        if (v.includes('epicerie') || v.includes('épicerie') || v.includes('primeur')) return 'epicerie';
        if (v.includes('supermarche') || v.includes('supermarché') || v.includes('gms') || v.includes('grande surface') || v.includes('hyper')) return 'supermarche';
        if (v.includes('marche') || v.includes('marché')) return 'marche';
        if (v.includes('distribut') || v.includes('grossiste')) return 'distributeur';
        if (v.includes('hotel') || v.includes('hôtel') || v.includes('gite') || v.includes('gîte') || v.includes('chambre d')) return 'hotel';
        if (v.includes('camping') || v.includes('camp')) return 'camping';
        if (v.includes('traiteur')) return 'traiteur';
        if (v.includes('association') || v.includes('asso')) return 'association';
        if (v.includes('comite') || v.includes('comité') || v.includes('ce ') || v.includes('cse')) return 'comite_entreprise';
        if (v.includes('collectivite') || v.includes('collectivité') || v.includes('mairie') || v.includes('commune')) return 'collectivite';
        return 'autre';
      };

      // Helper: detect pipeline stage from string
      const detectStage = (val: string): PipelineStage => {
        const v = val.toLowerCase().trim();
        // Ne pas contacter
        if (v.includes('ne pas contact') || v.includes('do not contact') || v.includes('blacklist')) return 'ne_pas_contacter';
        // Perdu: echec, non qualifie, besoin non identifie
        if (v.includes('echec') || v.includes('échec')) return 'perdu';
        if (v.includes('non qualifi') || v.includes('non qualifié')) return 'perdu';
        if (v.includes('besoin non identifi') || v.includes('besoin non identifié')) return 'perdu';
        // Gagne: valide
        if (v.includes('validé') || v.includes('valide') && !v.includes('validation')) return 'gagne';
        // Proposition: validation en cours
        if (v.includes('validation en cours') || v.includes('validation')) return 'proposition';
        // Contacte: qualification, contacte, contact en cours
        if (v.includes('qualification')) return 'contacte';
        if (v.includes('contacté') || v.includes('contacte') || v.includes('contact en cours')) return 'contacte';
        // A contacter: non contacte, tentative
        if (v.includes('non contacté') || v.includes('non contacte')) return 'a_contacter';
        if (v.includes('tentative')) return 'a_contacter';
        if (v.includes('a contacter') || v.includes('à contacter')) return 'a_contacter';
        // Autres
        if (v.includes('nouveau') || v.includes('new')) return 'nouveau';
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
      const importedNames = new Set<string>();
      const importedPhones = new Set<string>();

      // Normalize phone for comparison (remove spaces, dots, dashes)
      const normalizePhone = (tel: string) => tel.replace(/[\s.\-()]/g, '');

      // Build lookup sets from existing prospects
      const existingNames = new Set(state.prospects.map(p => p.nom_etablissement.toLowerCase().trim()));
      const existingPhones = new Set(
        state.prospects.map(p => normalizePhone(p.telephone)).filter(t => t.length >= 6)
      );

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

        const nomLower = nom.toLowerCase().trim();

        // Check duplicate against existing prospects
        if (existingNames.has(nomLower)) {
          errors.push(`Ligne ${index + 2}: "${nom}" existe deja (doublon nom)`);
          return;
        }

        // Check duplicate within current import file
        if (importedNames.has(nomLower)) {
          errors.push(`Ligne ${index + 2}: "${nom}" en double dans le fichier`);
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

        // Check phone duplicate (if phone exists and is long enough)
        const normPhone = normalizePhone(telephone);
        if (normPhone.length >= 6) {
          if (existingPhones.has(normPhone)) {
            errors.push(`Ligne ${index + 2}: "${nom}" - telephone ${telephone} deja existant (doublon tel)`);
            return;
          }
          if (importedPhones.has(normPhone)) {
            errors.push(`Ligne ${index + 2}: "${nom}" - telephone ${telephone} en double dans le fichier`);
            return;
          }
        }

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
        const etape = etapeStr ? detectStage(etapeStr) : 'a_contacter';

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

        // Register in dedup sets
        importedNames.add(nomLower);
        if (normPhone.length >= 6) importedPhones.add(normPhone);

        parsed.push({
          nom, contact, telephone, email, adresse, score,
          type, etape, secteur, notes, dateCreation, index,
        });
      });

      if (parsed.length === 0) {
        setImportResults({ success: 0, errors, geocoded: 0, duplicates: 0 });
        setImporting(false);
        return;
      }

      // Geocode all addresses via batch API (skippable)
      const allAddresses = parsed.map(p => p.adresse);
      const hasAddresses = allAddresses.some(a => a && a.trim().length >= 3);
      let geoResults: (Awaited<ReturnType<typeof geocodeBatch>>[number])[] = [];

      if (hasAddresses && !skipGeocoding) {
        setGeocoding(true);
        setGeocodeProgress({ done: 0, total: parsed.length });

        try {
          geoResults = await geocodeBatch(allAddresses, (done, total) => {
            setGeocodeProgress({ done, total });
          });
        } catch {
          // Geocoding failed entirely — continue without coordinates
        }
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

    const duplicates = errors.filter(e => e.includes('doublon') || e.includes('en double')).length;
    setImportResults({ success, errors, geocoded, duplicates });
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

  // ============================================
  // Croisement base clients
  // ============================================
  interface ClientMatch {
    clientRow: { denomination: string; telFixe: string; telMobile: string; adresse: string; rowIndex: number };
    prospect: Prospect;
    matchType: string;
  }
  const [crossMatches, setCrossMatches] = useState<ClientMatch[]>([]);
  const [crossSearching, setCrossSearching] = useState(false);
  const [crossDone, setCrossDone] = useState(false);
  const [crossTotalRows, setCrossTotalRows] = useState(0);
  const [crossSelected, setCrossSelected] = useState<Set<string>>(new Set());
  const [crossDetectedCols, setCrossDetectedCols] = useState<{ denomination: string; telFixe: string; telMobile: string; adresse: string }>({ denomination: '', telFixe: '', telMobile: '', adresse: '' });
  const crossFileRef = useRef<HTMLInputElement>(null);

  const normalizeStr = (s: string) => s.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const normalizePhone = (tel: string) => tel.replace(/[\s.\-()\/+]/g, '').replace(/^0033/, '0').replace(/^33/, '0');

  const handleCrossRef = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCrossSearching(true);
    setCrossMatches([]);
    setCrossSelected(new Set());
    setCrossDone(false);
    setCrossDetectedCols({ denomination: '', telFixe: '', telMobile: '', adresse: '' });

    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws);
      setCrossTotalRows(rows.length);
      if (rows.length === 0) { setCrossSearching(false); setCrossDone(true); return; }

      // Auto-detect columns from first row headers
      const headers = Object.keys(rows[0]);
      const findCol = (patterns: string[]): string => {
        for (const pat of patterns) {
          const p = pat.toLowerCase();
          const found = headers.find(h => h.toLowerCase().includes(p));
          if (found) return found;
        }
        return '';
      };

      const colDenom = findCol(['dénomination', 'denomination', 'raison sociale', 'etablissement', 'société', 'societe', 'enseigne', 'nom du', 'nom_etablissement', 'client']);
      // Fallback: use first string-looking column if nothing found
      const colDenomFinal = colDenom || headers.find(h => {
        const sample = String(rows[0][h] || '');
        return sample.length > 2 && !/^\d+$/.test(sample);
      }) || headers[0];

      const colTelFixe = findCol(['tél. fixe', 'tel. fixe', 'tel fixe', 'telephone fixe', 'fixe', 'tel.', 'téléphone', 'telephone', 'tel']);
      const colTelMobile = findCol(['tél. mobile', 'tel. mobile', 'tel mobile', 'mobile', 'portable', 'gsm', 'cellulaire']);
      const colAdresse = findCol(['adresse', 'address', 'adresse postale', 'adresse complete']);

      setCrossDetectedCols({
        denomination: colDenomFinal,
        telFixe: colTelFixe,
        telMobile: colTelMobile,
        adresse: colAdresse,
      });

      // Build fuzzy lookup from existing prospects
      const prospectsList = state.prospects;
      const prospectNorms = prospectsList.map(p => ({
        prospect: p,
        normName: normalizeStr(p.nom_etablissement),
        normPhone: normalizePhone(p.telephone),
      }));

      const matches: ClientMatch[] = [];
      const matchedProspectIds = new Set<string>();

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const denomination = String(row[colDenomFinal] ?? '').trim();
        const telFixe = colTelFixe ? String(row[colTelFixe] ?? '').trim() : '';
        const telMobile = colTelMobile ? String(row[colTelMobile] ?? '').trim() : '';
        const adresse = colAdresse ? String(row[colAdresse] ?? '').trim() : '';

        if (!denomination) continue;

        const clientRow = { denomination, telFixe, telMobile, adresse, rowIndex: i + 2 };
        const normClientName = normalizeStr(denomination);
        const normTelFixe = normalizePhone(telFixe);
        const normTelMobile = normalizePhone(telMobile);
        // Use last 8 digits for partial phone match
        const phoneTail = (ph: string) => ph.length >= 8 ? ph.slice(-8) : ph;
        const clientPhoneTails = [
          normTelFixe.length >= 6 ? phoneTail(normTelFixe) : '',
          normTelMobile.length >= 6 ? phoneTail(normTelMobile) : '',
        ].filter(Boolean);

        for (const { prospect, normName, normPhone } of prospectNorms) {
          if (matchedProspectIds.has(prospect.id)) continue;
          const reasons: string[] = [];

          // Fuzzy name match: exact, contains, or one contains the other
          if (normClientName.length >= 3 && normName.length >= 3) {
            if (normClientName === normName) {
              reasons.push('nom');
            } else if (normClientName.length >= 5 && normName.length >= 5) {
              // One contains the other (min 5 chars to avoid false positives)
              if (normClientName.includes(normName) || normName.includes(normClientName)) {
                reasons.push('nom');
              } else {
                // Check word overlap: if most words match
                const clientWords = normClientName.split(' ').filter(w => w.length >= 3);
                const prospectWords = normName.split(' ').filter(w => w.length >= 3);
                if (clientWords.length >= 2 && prospectWords.length >= 2) {
                  const common = clientWords.filter(w => prospectWords.includes(w));
                  if (common.length >= Math.min(clientWords.length, prospectWords.length) * 0.6) {
                    reasons.push('nom');
                  }
                }
              }
            }
          }

          // Phone match (partial: last 8 digits)
          if (normPhone.length >= 6 && clientPhoneTails.length > 0) {
            const prospectTail = phoneTail(normPhone);
            if (clientPhoneTails.some(ct => ct === prospectTail)) {
              reasons.push('tel');
            }
          }

          if (reasons.length > 0) {
            matchedProspectIds.add(prospect.id);
            matches.push({ clientRow, prospect, matchType: reasons.join('+') });
          }
        }
      }

      // Sort: nom+tel first, then nom, then tel
      matches.sort((a, b) => {
        const score = (m: ClientMatch) => (m.matchType.includes('nom') ? 2 : 0) + (m.matchType.includes('tel') ? 1 : 0);
        return score(b) - score(a);
      });

      setCrossMatches(matches);
      setCrossSelected(new Set(matches.map(m => m.prospect.id)));
    } catch {
      alert('Erreur de lecture du fichier. Verifiez le format.');
    }
    setCrossSearching(false);
    setCrossDone(true);
    if (crossFileRef.current) crossFileRef.current.value = '';
  };

  const toggleCrossSelect = (id: string) => {
    setCrossSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCrossAll = () => {
    if (crossSelected.size === crossMatches.length) {
      setCrossSelected(new Set());
    } else {
      setCrossSelected(new Set(crossMatches.map(m => m.prospect.id)));
    }
  };

  const handleCrossAction = (action: 'delete' | 'gagne') => {
    if (crossSelected.size === 0) return;
    const selectedIds = [...crossSelected];
    const label = action === 'delete' ? 'SUPPRIMER' : 'passer en "RDV / Gagne"';
    const count = selectedIds.length;
    if (!confirm(`${label} ${count} prospect(s) selectionne(s) ?`)) return;

    for (const id of selectedIds) {
      if (action === 'delete') {
        dispatch({ type: 'DELETE_PROSPECT', payload: id });
      } else {
        const prospect = state.prospects.find(p => p.id === id);
        if (prospect) {
          dispatch({
            type: 'UPDATE_PROSPECT',
            payload: { ...prospect, etape_pipeline: 'gagne' as PipelineStage, date_modification: new Date().toISOString() },
          });
        }
      }
    }
    // Remove processed from matches
    setCrossMatches(prev => prev.filter(m => !crossSelected.has(m.prospect.id)));
    setCrossSelected(new Set());
  };

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

        {/* Skip geocoding option */}
        <div className="mb-4 flex items-center gap-2">
          <input
            type="checkbox"
            id="skip-geocoding"
            checked={skipGeocoding}
            onChange={e => setSkipGeocoding(e.target.checked)}
            className="rounded border-gray-300 text-brewery-600 focus:ring-brewery-500"
          />
          <label htmlFor="skip-geocoding" className="text-sm text-gray-600">
            Passer le geocodage des adresses (import plus rapide, sans coordonnees GPS)
          </label>
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
              <p className="text-xs text-gray-500">
                {geocodeProgress.done === 0
                  ? `Envoi de ${geocodeProgress.total} adresses au service de geocodage...`
                  : `${geocodeProgress.done} / ${geocodeProgress.total} adresses traitees`
                }
              </p>
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

      {/* ========== Croisement base clients ========== */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
        <h3 className="font-semibold text-gray-900 text-sm sm:text-base mb-1 flex items-center gap-2">
          <Search className="w-4 h-4 text-brewery-600" />
          Croisement base clients (detection doublons)
        </h3>
        <p className="text-xs sm:text-sm text-gray-500 mb-4">
          Importez votre fichier clients pour detecter les prospects qui sont deja clients.
          Colonnes utilisees : <strong>Denomination</strong>, <strong>Tel. fixe</strong>, <strong>Tel. mobile</strong>, <strong>Adresse</strong>.
        </p>

        <div className="border-2 border-dashed border-amber-300 rounded-xl p-6 sm:p-8 text-center hover:border-amber-500 transition-colors bg-amber-50/30">
          {crossSearching ? (
            <div className="space-y-2">
              <Loader2 className="w-8 h-8 text-amber-500 mx-auto animate-spin" />
              <p className="text-sm font-medium text-gray-700">Analyse en cours...</p>
            </div>
          ) : (
            <>
              <Search className="w-8 h-8 text-amber-400 mx-auto mb-2" />
              <p className="text-xs sm:text-sm text-gray-600 mb-3">
                Glissez votre fichier clients (.xlsx, .csv)
              </p>
              <input
                ref={crossFileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleCrossRef}
              />
              <button
                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-xs sm:text-sm font-medium"
                onClick={() => crossFileRef.current?.click()}
              >
                Choisir un fichier clients
              </button>
            </>
          )}
        </div>

        {/* Results */}
        {crossDone && (
          <div className="mt-4 space-y-3">
            {/* Detected columns info */}
            <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-600 space-y-1">
              <p className="font-medium text-gray-700">Colonnes detectees dans le fichier :</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <p>Denomination : <span className={crossDetectedCols.denomination ? 'font-medium text-green-700' : 'text-red-500'}>{crossDetectedCols.denomination || 'Non trouvee'}</span></p>
                <p>Tel. fixe : <span className={crossDetectedCols.telFixe ? 'font-medium text-green-700' : 'text-gray-400'}>{crossDetectedCols.telFixe || 'Non trouvee'}</span></p>
                <p>Tel. mobile : <span className={crossDetectedCols.telMobile ? 'font-medium text-green-700' : 'text-gray-400'}>{crossDetectedCols.telMobile || 'Non trouvee'}</span></p>
                <p>Adresse : <span className={crossDetectedCols.adresse ? 'font-medium text-green-700' : 'text-gray-400'}>{crossDetectedCols.adresse || 'Non trouvee'}</span></p>
              </div>
            </div>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {crossMatches.length} doublon(s) trouve(s) sur {crossTotalRows} clients analyses
                </p>
                {crossMatches.length === 0 && (
                  <p className="text-xs text-green-600 mt-1">Aucun doublon detecte — votre base est propre !</p>
                )}
              </div>
              {crossMatches.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-xs font-medium disabled:opacity-40"
                    onClick={() => handleCrossAction('gagne')}
                    disabled={crossSelected.size === 0}
                  >
                    <Trophy className="w-3.5 h-3.5" />
                    Passer en Gagne ({crossSelected.size})
                  </button>
                  <button
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 text-xs font-medium disabled:opacity-40"
                    onClick={() => handleCrossAction('delete')}
                    disabled={crossSelected.size === 0}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Supprimer ({crossSelected.size})
                  </button>
                </div>
              )}
            </div>

            {crossMatches.length > 0 && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                {/* Header */}
                <div className="bg-gray-50 px-3 py-2 flex items-center gap-3 border-b border-gray-200 text-[10px] sm:text-xs font-medium text-gray-500">
                  <button onClick={toggleCrossAll} className="flex-shrink-0">
                    {crossSelected.size === crossMatches.length
                      ? <CheckSquare className="w-4 h-4 text-brewery-600" />
                      : <Square className="w-4 h-4 text-gray-400" />
                    }
                  </button>
                  <span className="w-1/4 min-w-0">Client (fichier)</span>
                  <span className="w-1/4 min-w-0">Prospect (existant)</span>
                  <span className="w-1/6 min-w-0">Tel prospect</span>
                  <span className="w-1/6 min-w-0">Etape actuelle</span>
                  <span className="w-1/6 min-w-0">Match</span>
                </div>
                {/* Rows */}
                <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
                  {crossMatches.map(m => {
                    const isSelected = crossSelected.has(m.prospect.id);
                    const stageLabel = state.pipelineColumns.find(c => c.id === m.prospect.etape_pipeline)?.label
                      || PIPELINE_LABELS[m.prospect.etape_pipeline] || m.prospect.etape_pipeline;
                    return (
                      <div
                        key={m.prospect.id}
                        className={`px-3 py-2 flex items-center gap-3 text-[10px] sm:text-xs cursor-pointer hover:bg-gray-50 ${isSelected ? 'bg-brewery-50' : ''}`}
                        onClick={() => toggleCrossSelect(m.prospect.id)}
                      >
                        <div className="flex-shrink-0">
                          {isSelected
                            ? <CheckSquare className="w-4 h-4 text-brewery-600" />
                            : <Square className="w-4 h-4 text-gray-300" />
                          }
                        </div>
                        <div className="w-1/4 min-w-0 truncate text-gray-700" title={m.clientRow.denomination}>
                          <p className="font-medium truncate">{m.clientRow.denomination}</p>
                          <p className="text-gray-400 truncate">{m.clientRow.telFixe || m.clientRow.telMobile}</p>
                        </div>
                        <div className="w-1/4 min-w-0 truncate" title={m.prospect.nom_etablissement}>
                          <p className="font-medium text-gray-900 truncate">{m.prospect.nom_etablissement}</p>
                          <p className="text-gray-400 truncate">{m.prospect.ville || m.prospect.adresse}</p>
                        </div>
                        <div className="w-1/6 min-w-0 truncate text-gray-600">
                          {m.prospect.telephone}
                        </div>
                        <div className="w-1/6 min-w-0">
                          <span className="badge text-white text-[9px]" style={{ backgroundColor: PIPELINE_LABELS[m.prospect.etape_pipeline] ? '#6b7280' : '#6b7280' }}>
                            {stageLabel}
                          </span>
                        </div>
                        <div className="w-1/6 min-w-0">
                          {m.matchType.includes('nom') && m.matchType.includes('tel') ? (
                            <span className="badge bg-red-100 text-red-700 text-[9px]">Nom + Tel</span>
                          ) : m.matchType.includes('nom') ? (
                            <span className="badge bg-amber-100 text-amber-700 text-[9px]">Nom</span>
                          ) : (
                            <span className="badge bg-blue-100 text-blue-700 text-[9px]">Telephone</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
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
          {importResults.duplicates > 0 && (
            <div className="flex items-center gap-2 text-amber-600 mb-2">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm font-medium">{importResults.duplicates} doublon(s) ignore(s)</span>
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
