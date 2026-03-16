import { useState, useRef } from 'react';
import {
  Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle, X, Loader2, MapPin,
  Search, Trash2, Trophy, CheckSquare, Square, Building2,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import { Prospect, EstablishmentType, PipelineStage, ESTABLISHMENT_LABELS, PIPELINE_LABELS, CLIENT_TYPE_LABELS, CLIENT_TYPE_FAMILIES, ClientType } from '../types';
import { generateId, exportProspectsCSV, geocodeBatch, toLocalDateStr } from '../utils/helpers';
import { apiPost, apiPut, apiDelete } from '../api/client';

export default function ImportPage() {
  const { state, dispatchLocal } = useApp();
  const toast = useToast();
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
      XLSX.writeFile(wb, `prospects-${toLocalDateStr(new Date())}.xlsx`);
    } catch (err) {
      toast.error('Erreur lors de l\'export Excel');
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

      // Auto-detect the real header row (skip title rows, merged cells, etc.)
      const importHeaderPatterns = ['denom', 'raison', 'societe', 'société', 'enseigne', 'nom', 'client', 'tel', 'adresse', 'address', 'mobile', 'fixe', 'portable', 'mail', 'email', 'ville', 'code postal', 'siret', 'siren', 'secteur', 'tournee', 'tournée', 'etape', 'état', 'etat', 'type', 'score', 'note'];
      const importRawArrays = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
      let importHeaderRow = 0;
      for (let r = 0; r < Math.min(15, importRawArrays.length); r++) {
        const rowVals = (importRawArrays[r] || []).map(v => String(v ?? '').toLowerCase().trim()).filter(Boolean);
        if (rowVals.length < 2) continue;
        const recognizable = rowVals.filter(v => importHeaderPatterns.some(p => v.includes(p)));
        if (recognizable.length >= 2) {
          importHeaderRow = r;
          break;
        }
      }

      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { range: importHeaderRow });

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
        // Gagne: valide, client
        if (v.includes('validé') || v.includes('valide') && !v.includes('validation')) return 'client_gagne';
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
        if (v.includes('rdv')) return 'gagne';
        if (v.includes('gagne') || v.includes('gagné') || v.includes('client')) return 'client_gagne';
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
        try {
          await apiPost('/prospects/import', newProspects);
          dispatchLocal({ type: 'IMPORT_PROSPECTS', payload: newProspects });
        } catch (err) {
          toast.error('Erreur lors de l\'import des prospects');
        }
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
      toast.error('Erreur lors de la creation du template');
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

  // ============================================
  // Client import state - multi-step flow
  // ============================================
  interface ParsedClient {
    id: string;
    nom: string;
    ville: string;
    adresse: string;
    code_postal: string;
    telephone: string;
    telephone_mobile: string;
    email: string;
    contact: string;
    type_client: ClientType;
    commercial_id: string;
    commercial_email_raw: string; // original email from file
    notes: string;
    tournee: string;
    siret: string;
    latitude: number;
    longitude: number;
    last_visit: string | null;
    custom_recurrence: number | null;
    tags_raw: string;
    numero_client: string;
    raison_sociale: string;
  }
  interface DuplicateMatch {
    parsed: ParsedClient;
    existing: typeof state.clients[0];
    matchType: string; // 'nom', 'siret', 'tel', 'nom+tel', etc.
    action: 'skip' | 'overwrite' | 'import'; // admin decision
  }
  interface UnknownCommercial {
    email: string;
    name: string; // from "Commercial principal" column
    create: boolean; // admin decision
    prenom: string;
    nom: string;
  }

  const [clientImportStep, setClientImportStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [clientImporting, setClientImporting] = useState(false);
  const [clientImportResults, setClientImportResults] = useState<{ success: number; skipped: number; errors: string[]; commerciauxCreated: number } | null>(null);
  const [clientImportType, setClientImportType] = useState<ClientType | ''>('');
  const [clientImportCommercial, setClientImportCommercial] = useState('');
  const clientFileRef = useRef<HTMLInputElement>(null);

  // Preview state
  const [parsedClients, setParsedClients] = useState<ParsedClient[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [unknownCommerciaux, setUnknownCommerciaux] = useState<UnknownCommercial[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [parsedTotal, setParsedTotal] = useState(0);

  // Helpers shared between parse and import
  const detectClientType = (val: string): ClientType => {
    const v = val.toLowerCase().trim();
    if (v.includes('bar') || v.includes('restaurant') || v.includes('brasserie') || v.includes('bistrot') || v.includes('cafe') || v.includes('café') || v.includes('pub')) return 'BAR_RESTAURANT_GENERAL';
    if (v.includes('cave') || v.includes('caviste') || v.includes('epicerie') || v.includes('épicerie') || v.includes('bio')) return 'CAVE_EPICERIE';
    if (v.includes('souchon hors') || v.includes('hors droit')) return 'SOUCHON_HORS_DROIT';
    if (v.includes('souchon')) return 'SOUCHON';
    if (v.includes('grand public') || v.includes('particulier') || v.includes('public')) return 'GRAND_PUBLIC';
    if (v.includes('comite') || v.includes('comité') || v.includes('entreprise') || v.includes('ce ') || v.includes(' ce')) return 'COMITE_ENTREPRISE';
    if (v.includes('distribut') || v.includes('grossiste') || v.includes('import')) return 'DISTRIBUTEUR';
    if (v.includes('export')) return 'EXPORT';
    if (v.includes('mariage') || v.includes('traiteur') || v.includes('event')) return 'MARIAGE';
    if (v.includes('picologie') || v.includes('oenologie') || v.includes('œnologie')) return 'PICOLOGIE';
    return (clientImportType || 'BAR_RESTAURANT_GENERAL') as ClientType;
  };

  const parseLatLng = (val: string): { lat: number; lng: number } | null => {
    if (!val) return null;
    const sep = val.includes('/') ? '/' : val.includes(',') ? ',' : null;
    if (!sep) return null;
    const parts = val.split(sep).map(s => parseFloat(s.trim()));
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return { lat: parts[0], lng: parts[1] };
    return null;
  };

  const extractVilleFromAdresse = (adresse: string): { ville: string; cp: string; adresseClean: string } => {
    const match = adresse.match(/(\d{5})\s+([^,]+)/);
    if (match) return { ville: match[2].trim(), cp: match[1], adresseClean: adresse.split(',')[0]?.trim() || adresse };
    return { ville: '', cp: '', adresseClean: adresse };
  };

  const normalizeForMatch = (s: string) => s.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const normalizePhoneForMatch = (tel: string) => tel.replace(/[\s.\-()\/+]/g, '').replace(/^0033/, '0').replace(/^33/, '0');

  // Step 1: Parse file and generate preview
  const handleClientFileParse = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setClientImporting(true);
    setClientImportResults(null);
    setParseErrors([]);
    setParsedClients([]);
    setDuplicates([]);
    setUnknownCommerciaux([]);

    const errors: string[] = [];

    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];

      // Auto-detect header row
      const headerPatterns = ['denom', 'raison', 'societe', 'société', 'nom', 'client', 'tel', 'adresse', 'address', 'mobile', 'fixe', 'mail', 'email', 'ville', 'code postal', 'siret', 'tournee', 'tournée', 'type', 'contact', 'commercial', 'numéro client'];
      const rawArrays = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
      let headerRow = 0;
      for (let r = 0; r < Math.min(15, rawArrays.length); r++) {
        const rowVals = (rawArrays[r] as unknown[] || []).map(v => String(v ?? '').toLowerCase().trim()).filter(Boolean);
        if (rowVals.length < 2) continue;
        const recognizable = rowVals.filter(v => headerPatterns.some(p => v.includes(p)));
        if (recognizable.length >= 2) { headerRow = r; break; }
      }

      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { range: headerRow });
      if (rows.length === 0) {
        errors.push('Le fichier est vide');
        setParseErrors(errors);
        setClientImporting(false);
        return;
      }
      setParsedTotal(rows.length);

      const getVal = (row: Record<string, unknown>, ...keys: string[]): string => {
        for (const key of keys) {
          for (const rowKey of Object.keys(row)) {
            if (rowKey.toLowerCase().trim() === key.toLowerCase().trim()) {
              return String(row[rowKey] ?? '').trim();
            }
          }
        }
        return '';
      };

      // Build lookup structures for duplicate detection
      const existingByName = new Map<string, typeof state.clients[0]>();
      const existingBySiret = new Map<string, typeof state.clients[0]>();
      const existingByPhone = new Map<string, typeof state.clients[0]>();
      for (const c of state.clients) {
        existingByName.set(normalizeForMatch(c.nom), c);
        if (c.siret && c.siret.length >= 9) existingBySiret.set(c.siret.replace(/\s/g, ''), c);
        const ph = normalizePhoneForMatch(c.telephone || c.telephone_mobile || '');
        if (ph.length >= 8) existingByPhone.set(ph.slice(-8), c);
      }

      // Track unknown commercials
      const unknownComMap = new Map<string, UnknownCommercial>();
      const importedNamesInBatch = new Set<string>();

      const parsed: ParsedClient[] = [];
      const dupes: DuplicateMatch[] = [];

      rows.forEach((row, index) => {
        const denomination = getVal(row, 'Dénomination', 'Denomination', 'Client', 'Enseigne');
        const raisonSociale = getVal(row, 'Raison sociale', 'Raison Sociale', 'RaisonSociale');
        const nom = denomination || raisonSociale;
        if (!nom) { errors.push(`Ligne ${index + 2}: Nom manquant`); return; }

        // Type
        const typeStr = getVal(row, 'Type de client', 'Type client', 'Type', 'type');
        const type = typeStr ? detectClientType(typeStr) : ((clientImportType || 'BAR_RESTAURANT_GENERAL') as ClientType);

        // Tournée / Zone
        const tournee = getVal(row, 'Tournée / Zone', 'Tournee / Zone', 'Tournée/Zone', 'Tournée', 'Tournee', 'Secteur', 'Zone', 'tournee');

        // Contact: combine Nom + Prénom
        const contactNom = getVal(row, 'Nom');
        const contactPrenom = getVal(row, 'Prénom', 'Prenom');
        const contact = [contactPrenom, contactNom].filter(Boolean).join(' ') ||
          getVal(row, 'Contact', 'contact', 'Nom Contact', 'Nom/Prenom', 'Type contact');

        const telephone = getVal(row, 'Tél. fixe', 'Tel. fixe', 'Telephone', 'Tel', 'tel', 'Numero');
        const telMobile = getVal(row, 'Tél. mobile', 'Tel. mobile', 'Mobile', 'Portable');
        const email = getVal(row, 'E-mail', 'Email', 'email', 'Mail', 'mail');

        // Address: facturation then generic
        const adresseRaw = getVal(row, 'Adresse de facturation', 'Adresse facturation', 'Adresse', 'adresse', 'Rue');
        let cp = getVal(row, 'Code postal facturation', 'Code postal', 'CP', 'cp', 'Code_postal');
        let ville = getVal(row, 'Ville', 'ville', 'City');
        let adresse = adresseRaw;
        if (adresseRaw && (!cp || !ville)) {
          const extracted = extractVilleFromAdresse(adresseRaw);
          if (!cp) cp = extracted.cp;
          if (!ville) ville = extracted.ville;
          adresse = extracted.adresseClean;
        }

        // GPS
        const latLngStr = getVal(row, 'Lat/Lng', 'Lat/Lng ', 'lat/lng', 'Coordonnées', 'Coordonnees', 'GPS');
        const gps = parseLatLng(latLngStr);

        // Extra EasyBeer columns → append to notes
        const notesBase = getVal(row, 'Notes', 'notes', 'Commentaire', 'Remarque');
        const siret = getVal(row, 'SIRET', 'siret');
        const siren = getVal(row, 'SIREN', 'siren');
        const codeApe = getVal(row, 'Code APE', 'code ape', 'NAF');
        const tva = getVal(row, 'Numéro TVA intracom.', 'Numero TVA', 'TVA');
        const tags = getVal(row, 'Tags (mots-clés)', 'Tags', 'tags', 'Mots-cles');
        const delaiPaiement = getVal(row, 'Délai de paiement (en jours)', 'Delai paiement', 'Delai de paiement');
        const modesPaiement = getVal(row, 'Modes de paiement', 'Mode de paiement', 'Paiement');
        const remiseSpeciale = getVal(row, 'Remise spéciale', 'Remise speciale', 'Remise');
        const typeDistribution = getVal(row, 'Type de distribution', 'Distribution');
        const distributeur1 = getVal(row, 'Distributeur 1', 'distributeur1');
        const distributeur2 = getVal(row, 'Distributeur 2', 'distributeur2');
        const infosLivraison = getVal(row, 'Informations de livraison', 'Info livraison');
        const rappel = getVal(row, 'Rappel', 'rappel');
        const numeroClient = getVal(row, 'Numéro client', 'Numero client', 'N° client');

        // Build extended notes from extra columns
        const extraNotes: string[] = [];
        if (codeApe) extraNotes.push(`Code APE: ${codeApe}`);
        if (tva) extraNotes.push(`TVA: ${tva}`);
        if (delaiPaiement) extraNotes.push(`Delai paiement: ${delaiPaiement}j`);
        if (modesPaiement) extraNotes.push(`Paiement: ${modesPaiement}`);
        if (remiseSpeciale) extraNotes.push(`Remise: ${remiseSpeciale}`);
        if (typeDistribution) extraNotes.push(`Distribution: ${typeDistribution}`);
        if (distributeur1) extraNotes.push(`Distributeur 1: ${distributeur1}`);
        if (distributeur2) extraNotes.push(`Distributeur 2: ${distributeur2}`);
        if (infosLivraison) extraNotes.push(`Livraison: ${infosLivraison}`);
        if (rappel) extraNotes.push(`Rappel: ${rappel}`);
        if (numeroClient) extraNotes.push(`N° client EasyBeer: ${numeroClient}`);
        const fullNotes = [notesBase, ...extraNotes].filter(Boolean).join(' | ');

        // Date parsing helper
        const parseDate = (str: string): string | null => {
          if (!str) return null;
          const parts = str.split('/');
          if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
          if (str.match(/^\d{4}-\d{2}-\d{2}/)) return str.slice(0, 10);
          return null;
        };

        const lastVisitStr = getVal(row, 'Dernière commande', 'Derniere commande', 'Derniere livraison', 'Dernière livraison');
        const lastVisit = parseDate(lastVisitStr);

        // Commercial resolution
        const commercialEmail = getVal(row, 'Commercial rattaché (email)', 'Commercial rattache (email)', 'Commercial rattaché', 'Commercial rattache');
        const commercialPrincipal = getVal(row, 'Commercial principal', 'Commercial', 'commercial');
        const commercialSecondaire = getVal(row, 'Commercial secondaire');
        const emailOrName = commercialEmail || commercialPrincipal;

        let commercialId = clientImportCommercial || state.currentUser?.id || '';
        let commercialEmailRaw = emailOrName;

        if (emailOrName) {
          const val = emailOrName.toLowerCase().trim();
          const byEmail = state.commerciaux.find(c => c.email?.toLowerCase() === val);
          if (byEmail) {
            commercialId = byEmail.id;
          } else {
            const byName = state.commerciaux.find(c =>
              val.includes(c.prenom.toLowerCase()) || val.includes(c.nom?.toLowerCase() || '')
            );
            if (byName) {
              commercialId = byName.id;
            } else {
              // Unknown commercial - track for creation
              if (!unknownComMap.has(val)) {
                const parts = commercialPrincipal.split(' ');
                unknownComMap.set(val, {
                  email: commercialEmail || `${val.replace(/\s+/g, '.').toLowerCase()}@lbdp.fr`,
                  name: commercialPrincipal || commercialEmail,
                  create: true,
                  prenom: parts[0] || '',
                  nom: parts.slice(1).join(' ') || '',
                });
              }
              commercialId = '__unknown__' + val;
            }
          }
        }

        const clientId = `cli-${Date.now()}-${Math.random().toString(36).substring(2, 9)}-${index}`;
        const parsedClient: ParsedClient = {
          id: clientId, nom, ville, adresse, code_postal: cp,
          telephone: telephone || telMobile, telephone_mobile: telMobile, email, contact,
          type_client: type, commercial_id: commercialId,
          commercial_email_raw: commercialEmailRaw,
          notes: fullNotes, tournee, siret: siret || siren || '',
          latitude: gps?.lat ?? 0, longitude: gps?.lng ?? 0,
          last_visit: lastVisit, custom_recurrence: null,
          tags_raw: tags, numero_client: numeroClient, raison_sociale: raisonSociale,
        };

        // Duplicate detection: check SIRET, name, phone
        const normName = normalizeForMatch(nom);
        const normPhone = normalizePhoneForMatch(telephone || telMobile || '');
        const cleanSiret = (siret || siren || '').replace(/\s/g, '');

        let existingMatch: typeof state.clients[0] | null = null;
        let matchType = '';

        if (cleanSiret.length >= 9 && existingBySiret.has(cleanSiret)) {
          existingMatch = existingBySiret.get(cleanSiret)!;
          matchType = 'siret';
        }
        if (!existingMatch && existingByName.has(normName)) {
          existingMatch = existingByName.get(normName)!;
          matchType = 'nom';
        }
        if (!existingMatch && normPhone.length >= 8 && existingByPhone.has(normPhone.slice(-8))) {
          existingMatch = existingByPhone.get(normPhone.slice(-8))!;
          matchType = 'telephone';
        }
        // Also check within batch
        if (!existingMatch && importedNamesInBatch.has(normName)) {
          errors.push(`Ligne ${index + 2}: "${nom}" en double dans le fichier`);
          return;
        }

        if (existingMatch) {
          // Combine match types
          if (existingMatch && matchType === 'nom' && normPhone.length >= 8 && existingByPhone.has(normPhone.slice(-8))) {
            matchType = 'nom+tel';
          }
          dupes.push({ parsed: parsedClient, existing: existingMatch, matchType, action: 'skip' });
        } else {
          parsed.push(parsedClient);
          importedNamesInBatch.add(normName);
        }
      });

      setParsedClients(parsed);
      setDuplicates(dupes);
      setUnknownCommerciaux(Array.from(unknownComMap.values()));
      setParseErrors(errors);
      setClientImportStep('preview');
    } catch (err) {
      errors.push('Erreur de lecture du fichier. Verifiez le format.');
      setParseErrors(errors);
    }
    setClientImporting(false);
    if (clientFileRef.current) clientFileRef.current.value = '';
  };

  // Step 2: Admin validates → execute import
  const handleClientImportConfirm = async () => {
    setClientImporting(true);
    const errors: string[] = [];

    try {
      // Collect clients to import (new + duplicates marked as 'import' or 'overwrite')
      const clientsToImport: ParsedClient[] = [...parsedClients];
      const clientsToOverwrite: ParsedClient[] = [];
      for (const d of duplicates) {
        if (d.action === 'import') clientsToImport.push(d.parsed);
        if (d.action === 'overwrite') clientsToOverwrite.push(d.parsed);
      }

      // Build list of commercials to create
      const commerciauxToCreate = unknownCommerciaux.filter(uc => uc.create);

      // If there are new commercials, we need to create them first to get their IDs
      const newComPayload = commerciauxToCreate.map(uc => ({
        id: `com-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        prenom: uc.prenom || uc.name.split(' ')[0] || '',
        nom: uc.nom || uc.name.split(' ').slice(1).join(' ') || '',
        email: uc.email,
        role: 'commercial',
        password: 'Changeme1',
      }));

      // Build email → ID map for resolving unknown commercials
      const emailToId = new Map<string, string>();
      for (const nc of newComPayload) {
        emailToId.set(nc.email.toLowerCase(), nc.id);
      }
      // Also add existing commercials
      for (const c of state.commerciaux) {
        emailToId.set(c.email.toLowerCase(), c.id);
      }

      // Resolve __unknown__ commercial IDs
      const resolveId = (c: ParsedClient): string => {
        if (c.commercial_id.startsWith('__unknown__')) {
          const key = c.commercial_id.replace('__unknown__', '');
          // Try by email first
          if (emailToId.has(key)) return emailToId.get(key)!;
          // Try to find in new commercials by name
          for (const nc of newComPayload) {
            if (key.includes(nc.prenom.toLowerCase()) || key.includes(nc.nom.toLowerCase())) return nc.id;
          }
          return clientImportCommercial || state.currentUser?.id || '';
        }
        return c.commercial_id;
      };

      const finalClients = clientsToImport.map(c => ({
        ...c,
        commercial_id: resolveId(c),
      }));

      // Send import request
      if (finalClients.length > 0 || newComPayload.length > 0) {
        const token = localStorage.getItem('suivipro_token');
        const importRes = await fetch('/api/clients/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ clients: finalClients, newCommerciaux: newComPayload }),
        });
        if (!importRes.ok) {
          const err = await importRes.json().catch(() => ({}));
          errors.push(`Erreur serveur: ${err.error || importRes.statusText}`);
        } else {
          const result = await importRes.json();

          // Update local state - add new commercials
          if (result.commerciauxCreated) {
            for (const nc of result.commerciauxCreated) {
              dispatchLocal({ type: 'ADD_COMMERCIAL', payload: { ...nc, telephone: '', role: 'commercial' as const, password: '', objectifs: { appels_semaine: 0, rdv_mois: 0, prospects_mois: 0, taux_conversion: 0 } } });
            }
          }

          // Update local state - add new clients
          const now = new Date().toISOString();
          const importedClients = finalClients.map(c => ({
            ...c,
            statut: 'ACTIF' as const,
            next_visit: null,
            prospect_id: null,
            date_creation: now,
            date_modification: now,
          }));
          dispatchLocal({ type: 'IMPORT_CLIENTS', payload: importedClients as any });

          // Handle overwrites via individual PUT
          for (const oc of clientsToOverwrite) {
            const resolved = { ...oc, commercial_id: resolveId(oc) };
            const dupe = duplicates.find(d => d.parsed.id === oc.id);
            if (dupe) {
              try {
                await apiPut(`/clients/${dupe.existing.id}`, {
                  ...dupe.existing,
                  nom: resolved.nom,
                  ville: resolved.ville,
                  adresse: resolved.adresse,
                  code_postal: resolved.code_postal,
                  telephone: resolved.telephone,
                  telephone_mobile: resolved.telephone_mobile,
                  email: resolved.email,
                  contact: resolved.contact,
                  type_client: resolved.type_client,
                  commercial_id: resolved.commercial_id,
                  notes: resolved.notes,
                  tournee: resolved.tournee,
                  siret: resolved.siret,
                  latitude: resolved.latitude,
                  longitude: resolved.longitude,
                });
                dispatchLocal({ type: 'UPDATE_CLIENT', payload: { ...dupe.existing, ...resolved, id: dupe.existing.id, date_modification: now } as any });
              } catch {
                errors.push(`Erreur mise a jour: ${resolved.nom}`);
              }
            }
          }

          setClientImportResults({
            success: (result.imported || 0) + clientsToOverwrite.length,
            skipped: duplicates.filter(d => d.action === 'skip').length,
            errors: [...errors, ...(result.errors || [])],
            commerciauxCreated: result.commerciauxCreated?.length || 0,
          });
        }
      } else {
        setClientImportResults({ success: 0, skipped: duplicates.length, errors, commerciauxCreated: 0 });
      }
    } catch (err) {
      errors.push('Erreur lors de l\'import. Verifiez votre connexion.');
      setClientImportResults({ success: 0, skipped: 0, errors, commerciauxCreated: 0 });
    }
    setClientImporting(false);
    setClientImportStep('done');
  };

  const handleClientImportCancel = () => {
    setClientImportStep('upload');
    setParsedClients([]);
    setDuplicates([]);
    setUnknownCommerciaux([]);
    setParseErrors([]);
    setClientImportResults(null);
  };

  const setDuplicateAction = (index: number, action: 'skip' | 'overwrite' | 'import') => {
    setDuplicates(prev => prev.map((d, i) => i === index ? { ...d, action } : d));
  };

  const setAllDuplicateAction = (action: 'skip' | 'overwrite' | 'import') => {
    setDuplicates(prev => prev.map(d => ({ ...d, action })));
  };

  const toggleCommercialCreate = (index: number) => {
    setUnknownCommerciaux(prev => prev.map((uc, i) => i === index ? { ...uc, create: !uc.create } : uc));
  };

  const downloadClientTemplate = async () => {
    try {
      const XLSX = await import('xlsx');
      const template = [{
        'Date de création': '2025-01-15',
        'Dénomination': 'Bar Le Central',
        'Raison sociale': 'SARL Le Central',
        'Numéro client': 'CLI-001',
        'Type de client': 'Bar Restaurant',
        'Tournée / Zone': 'Zone Loire',
        'Type contact': 'Gerant',
        'Nom': 'Dupont',
        'Prénom': 'Jean',
        'E-mail': 'contact@lecentral.fr',
        'Tél. fixe': '04 71 00 00 00',
        'Tél. mobile': '06 12 34 56 78',
        'Adresse de facturation': '1 Place de la Mairie, 42000 Saint-Etienne',
        'Lat/Lng': '45.439/4.387',
        'Adresse de livraison': '',
        'SIRET': '12345678901234',
        'SIREN': '123456789',
        'Code APE': '5630Z',
        'Numéro TVA intracom.': 'FR12345678901',
        'Notes': 'Client fidele',
        'Délai de paiement (en jours)': '30',
        'Modes de paiement': 'Virement',
        'Commercial rattaché (email)': 'guillaume@lbdp.fr',
        'Tags (mots-clés)': 'bio, local',
        'Remise spéciale': '5%',
        'Code postal facturation': '42000',
        'Dernière commande': '15/01/2025',
        'Dernière livraison': '20/01/2025',
        'Type de distribution': 'Direct',
        'Distributeur 1': '',
        'Distributeur 2': '',
        'Informations de livraison': 'Livraison matin',
        'Rappel': '',
        'Commercial principal': 'Guillaume',
        'Commercial secondaire': '',
      }];
      const ws = XLSX.utils.json_to_sheet(template);
      ws['!cols'] = Array(Object.keys(template[0]).length).fill({ wch: 22 });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Template Clients EasyBeer');
      XLSX.writeFile(wb, 'template-import-clients-easybeer.xlsx');
    } catch {
      toast.error('Erreur lors de la creation du template');
    }
  };

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

      // Patterns for recognizable column names
      const headerPatterns = ['denom', 'raison', 'societe', 'société', 'enseigne', 'nom', 'client', 'tel', 'adresse', 'address', 'mobile', 'fixe', 'portable', 'mail', 'email', 'ville', 'code postal', 'siret', 'siren', 'activite', 'activité', 'ape', 'naf', 'ca ', 'chiffre'];

      // First pass: read as raw arrays to find the real header row
      const rawArrays = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
      let headerRowIndex = 0;
      for (let r = 0; r < Math.min(15, rawArrays.length); r++) {
        const rowVals = (rawArrays[r] || []).map(v => String(v ?? '').toLowerCase().trim()).filter(Boolean);
        if (rowVals.length < 2) continue;
        const recognizable = rowVals.filter(v => headerPatterns.some(p => v.includes(p)));
        if (recognizable.length >= 2) {
          headerRowIndex = r;
          break;
        }
      }

      // Re-parse with correct header row
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { range: headerRowIndex });
      setCrossTotalRows(rows.length);
      if (rows.length === 0) { setCrossSearching(false); setCrossDone(true); return; }

      // Auto-detect columns from headers (filter out __EMPTY columns)
      const headers = Object.keys(rows[0]).filter(h => !h.startsWith('__EMPTY'));
      const findCol = (patterns: string[]): string => {
        for (const pat of patterns) {
          const p = pat.toLowerCase();
          const found = headers.find(h => h.toLowerCase().includes(p));
          if (found) return found;
        }
        return '';
      };

      const colDenom = findCol(['dénomination', 'denomination', 'raison sociale', 'etablissement', 'société', 'societe', 'enseigne', 'nom du', 'nom_etablissement', 'client', 'nom']);
      // Fallback: use first non-__EMPTY string-looking column if nothing found
      const colDenomFinal = colDenom || headers.find(h => {
        const sample = String(rows[0][h] || '');
        return sample.length > 2 && !/^\d+$/.test(sample);
      }) || headers[0] || Object.keys(rows[0])[0];

      const colTelFixe = findCol(['tél. fixe', 'tel. fixe', 'tel fixe', 'telephone fixe', 'fixe', 'tel.', 'téléphone', 'telephone', 'tel']);
      const colTelMobile = findCol(['tél. mobile', 'tel. mobile', 'tel mobile', 'mobile', 'portable', 'gsm', 'cellulaire']);
      const colAdresse = findCol(['adresse', 'address', 'adresse postale', 'adresse complete', 'rue']);

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
      toast.error('Erreur de lecture du fichier. Verifiez le format.');
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

  const handleCrossAction = async (action: 'delete' | 'gagne') => {
    if (crossSelected.size === 0) return;
    const selectedIds = [...crossSelected];
    const label = action === 'delete' ? 'SUPPRIMER' : 'passer en "RDV / Gagne"';
    const count = selectedIds.length;
    if (!confirm(`${label} ${count} prospect(s) selectionne(s) ?`)) return;

    for (const id of selectedIds) {
      if (action === 'delete') {
        try {
          await apiDelete(`/prospects/${id}`);
          dispatchLocal({ type: 'DELETE_PROSPECT', payload: id });
        } catch (err) {
          toast.error('Erreur lors de la suppression du prospect');
        }
      } else {
        const prospect = state.prospects.find(p => p.id === id);
        if (prospect) {
          const updated = { ...prospect, etape_pipeline: 'gagne' as PipelineStage, date_modification: new Date().toISOString() };
          try {
            await apiPut(`/prospects/${id}`, updated);
            dispatchLocal({
              type: 'UPDATE_PROSPECT',
              payload: updated,
            });
          } catch (err) {
            toast.error('Erreur lors de la mise a jour du prospect');
          }
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
        <p className="text-xs sm:text-sm text-gray-500 mt-0.5">Gestion des donnees prospects et clients</p>
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

      {/* ========== Import Clients (EasyBeer) ========== */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
        <h3 className="font-semibold text-gray-900 text-sm sm:text-base mb-1 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-emerald-600" />
          Importer des clients (format EasyBeer)
        </h3>
        <p className="text-xs sm:text-sm text-gray-500 mb-4">
          Importez vos clients en masse depuis un export EasyBeer. L'import detecte automatiquement les doublons, les commerciaux et vous permet de tout verifier avant validation.
        </p>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-4 text-xs">
          <span className={`px-2 py-1 rounded-full font-medium ${clientImportStep === 'upload' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>1. Upload</span>
          <span className="text-gray-300">→</span>
          <span className={`px-2 py-1 rounded-full font-medium ${clientImportStep === 'preview' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>2. Verification</span>
          <span className="text-gray-300">→</span>
          <span className={`px-2 py-1 rounded-full font-medium ${clientImportStep === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>3. Resultats</span>
        </div>

        {/* ===== Step 1: Upload ===== */}
        {clientImportStep === 'upload' && (
          <>
            <div className="mb-4 flex items-start gap-2 px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
              <span className="font-semibold flex-shrink-0">Info :</span>
              <span>Le <strong>type</strong>, la <strong>tournee</strong> et le <strong>commercial</strong> sont lus depuis le fichier. Les champs ci-dessous ne s'appliquent que si la colonne est absente.</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Type par defaut <span className="ml-1 text-gray-400 font-normal">(si non detecte)</span>
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-400"
                  value={clientImportType}
                  onChange={e => setClientImportType(e.target.value as ClientType)}
                >
                  <option value="">Auto-detecte depuis le fichier</option>
                  {Object.entries(CLIENT_TYPE_FAMILIES).map(([key, family]) => (
                    <optgroup key={key} label={family.label}>
                      {family.types.map(t => (
                        <option key={t} value={t}>{CLIENT_TYPE_LABELS[t]}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Commercial par defaut <span className="ml-1 text-gray-400 font-normal">(si non detecte)</span></label>
                <select
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-400"
                  value={clientImportCommercial}
                  onChange={e => setClientImportCommercial(e.target.value)}
                >
                  <option value="">Moi ({state.currentUser?.prenom})</option>
                  {state.commerciaux.map(c => (
                    <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="border-2 border-dashed border-emerald-300 rounded-xl p-6 sm:p-8 text-center hover:border-emerald-500 transition-colors bg-emerald-50/30">
              {clientImporting ? (
                <div className="space-y-2">
                  <Loader2 className="w-8 h-8 text-emerald-500 mx-auto animate-spin" />
                  <p className="text-sm font-medium text-gray-700">Analyse du fichier en cours...</p>
                </div>
              ) : (
                <>
                  <Building2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                  <p className="text-xs sm:text-sm text-gray-600 mb-3">
                    Glissez votre fichier EasyBeer (.xlsx, .csv) ou cliquez pour selectionner
                  </p>
                  <input
                    ref={clientFileRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={handleClientFileParse}
                  />
                  <button
                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-xs sm:text-sm font-medium"
                    onClick={() => clientFileRef.current?.click()}
                  >
                    Choisir un fichier clients
                  </button>
                </>
              )}
            </div>

            <div className="mt-3 flex items-center gap-4">
              <button
                className="text-sm text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1"
                onClick={downloadClientTemplate}
              >
                <Download className="w-4 h-4" /> Template EasyBeer
              </button>
            </div>

            <div className="mt-3 bg-gray-50 rounded-lg p-3 text-xs text-gray-600">
              <p className="font-medium text-gray-700 mb-1">Colonnes EasyBeer reconnues :</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5">
                <p>Denomination *</p>
                <p>Raison sociale</p>
                <p>Numero client</p>
                <p>Type de client</p>
                <p>Tournee / Zone</p>
                <p>Nom / Prenom</p>
                <p>E-mail</p>
                <p>Tel. fixe / Tel. mobile</p>
                <p>Adresse de facturation</p>
                <p>Lat/Lng (GPS)</p>
                <p>SIRET / SIREN</p>
                <p>Code APE</p>
                <p>N° TVA intracom.</p>
                <p>Notes</p>
                <p>Delai de paiement</p>
                <p>Modes de paiement</p>
                <p><strong>Commercial rattache (email)</strong></p>
                <p>Tags (mots-cles)</p>
                <p>Remise speciale</p>
                <p>Code postal facturation</p>
                <p>Derniere commande/livraison</p>
                <p>Type de distribution</p>
                <p>Distributeurs 1 & 2</p>
                <p>Infos livraison</p>
                <p>Commercial principal/secondaire</p>
              </div>
              <p className="text-gray-500 mt-1">* Seule la denomination est obligatoire. Le commercial est resolu par email, puis par nom.</p>
            </div>
          </>
        )}

        {/* ===== Step 2: Preview / Verification ===== */}
        {clientImportStep === 'preview' && (
          <div className="space-y-4">
            {/* Summary banner */}
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
              <h4 className="font-semibold text-emerald-800 mb-2">Resume de l'analyse ({parsedTotal} lignes lues)</h4>
              <div className="flex flex-wrap gap-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span className="text-green-700 font-medium">{parsedClients.length} nouveaux clients</span>
                </div>
                {duplicates.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                    <span className="text-amber-700 font-medium">{duplicates.length} doublon(s) detecte(s)</span>
                  </div>
                )}
                {unknownCommerciaux.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-blue-600" />
                    <span className="text-blue-700 font-medium">{unknownCommerciaux.length} commercial(aux) inconnu(s)</span>
                  </div>
                )}
                {parseErrors.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-red-600" />
                    <span className="text-red-700 font-medium">{parseErrors.length} erreur(s)</span>
                  </div>
                )}
              </div>
            </div>

            {/* Unknown commercials section */}
            {unknownCommerciaux.length > 0 && (
              <div className="border border-blue-200 rounded-lg overflow-hidden">
                <div className="bg-blue-50 px-4 py-3">
                  <h4 className="font-semibold text-blue-800 text-sm">Commerciaux non trouves dans la base</h4>
                  <p className="text-xs text-blue-600 mt-0.5">Cochez ceux a creer automatiquement (mot de passe: Changeme1)</p>
                </div>
                <div className="divide-y divide-blue-100">
                  {unknownCommerciaux.map((uc, i) => (
                    <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={uc.create}
                        onChange={() => toggleCommercialCreate(i)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-800">{uc.email}</p>
                        {uc.name && uc.name !== uc.email && <p className="text-xs text-gray-500">Nom: {uc.name}</p>}
                      </div>
                      {uc.create ? (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Sera cree</span>
                      ) : (
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">Ignore → commercial par defaut</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Duplicates section */}
            {duplicates.length > 0 && (
              <div className="border border-amber-200 rounded-lg overflow-hidden">
                <div className="bg-amber-50 px-4 py-3 flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold text-amber-800 text-sm">Doublons detectes ({duplicates.length})</h4>
                    <p className="text-xs text-amber-600 mt-0.5">Choisissez l'action pour chaque doublon</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 font-medium"
                      onClick={() => setAllDuplicateAction('skip')}
                    >
                      Tout ignorer
                    </button>
                    <button
                      className="text-xs px-2 py-1 bg-amber-200 text-amber-800 rounded hover:bg-amber-300 font-medium"
                      onClick={() => setAllDuplicateAction('overwrite')}
                    >
                      Tout ecraser
                    </button>
                    <button
                      className="text-xs px-2 py-1 bg-emerald-200 text-emerald-800 rounded hover:bg-emerald-300 font-medium"
                      onClick={() => setAllDuplicateAction('import')}
                    >
                      Tout importer quand meme
                    </button>
                  </div>
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-amber-100">
                  {/* Header */}
                  <div className="px-4 py-2 bg-amber-50/50 grid grid-cols-12 gap-2 text-[10px] font-medium text-gray-500">
                    <span className="col-span-3">Fichier</span>
                    <span className="col-span-3">Existant en base</span>
                    <span className="col-span-1">Match</span>
                    <span className="col-span-5">Action</span>
                  </div>
                  {duplicates.map((d, i) => (
                    <div key={i} className="px-4 py-2 grid grid-cols-12 gap-2 items-center text-xs hover:bg-amber-50/30">
                      <div className="col-span-3 min-w-0">
                        <p className="font-medium text-gray-800 truncate">{d.parsed.nom}</p>
                        <p className="text-gray-400 truncate">{d.parsed.telephone || d.parsed.email}</p>
                      </div>
                      <div className="col-span-3 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{d.existing.nom}</p>
                        <p className="text-gray-400 truncate">{d.existing.telephone || d.existing.email}</p>
                      </div>
                      <div className="col-span-1">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-medium ${
                          d.matchType.includes('siret') ? 'bg-red-100 text-red-700' :
                          d.matchType.includes('+') ? 'bg-red-100 text-red-700' :
                          d.matchType === 'nom' ? 'bg-amber-100 text-amber-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {d.matchType === 'siret' ? 'SIRET' : d.matchType === 'nom' ? 'Nom' : d.matchType === 'telephone' ? 'Tel' : d.matchType}
                        </span>
                      </div>
                      <div className="col-span-5 flex gap-1">
                        <button
                          className={`px-2 py-1 rounded text-[10px] font-medium ${d.action === 'skip' ? 'bg-gray-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                          onClick={() => setDuplicateAction(i, 'skip')}
                        >
                          Ignorer
                        </button>
                        <button
                          className={`px-2 py-1 rounded text-[10px] font-medium ${d.action === 'overwrite' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}
                          onClick={() => setDuplicateAction(i, 'overwrite')}
                        >
                          Ecraser l'existant
                        </button>
                        <button
                          className={`px-2 py-1 rounded text-[10px] font-medium ${d.action === 'import' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
                          onClick={() => setDuplicateAction(i, 'import')}
                        >
                          Importer quand meme
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Parse errors */}
            {parseErrors.length > 0 && (
              <div className="border border-red-200 rounded-lg p-3">
                <h4 className="font-semibold text-red-800 text-sm mb-2">Erreurs de lecture ({parseErrors.length})</h4>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {parseErrors.map((err, i) => (
                    <p key={i} className="text-xs text-red-600 flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      {err}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* New clients preview (collapsed) */}
            {parsedClients.length > 0 && (
              <details className="border border-gray-200 rounded-lg">
                <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Apercu des {parsedClients.length} nouveaux clients a importer
                </summary>
                <div className="max-h-60 overflow-y-auto divide-y divide-gray-100 border-t">
                  {parsedClients.slice(0, 50).map((c, i) => {
                    const com = state.commerciaux.find(co => co.id === c.commercial_id);
                    const comLabel = com ? `${com.prenom} ${com.nom}` : (c.commercial_email_raw || 'Par defaut');
                    return (
                      <div key={i} className="px-4 py-2 grid grid-cols-12 gap-2 text-xs">
                        <div className="col-span-3 min-w-0">
                          <p className="font-medium text-gray-800 truncate">{c.nom}</p>
                          <p className="text-gray-400 truncate">{c.ville || c.code_postal}</p>
                        </div>
                        <div className="col-span-2 text-gray-600 truncate">{c.contact}</div>
                        <div className="col-span-2 text-gray-600 truncate">{c.telephone || c.telephone_mobile}</div>
                        <div className="col-span-2 text-gray-600 truncate">{c.tournee}</div>
                        <div className="col-span-3 text-gray-500 truncate">{comLabel}</div>
                      </div>
                    );
                  })}
                  {parsedClients.length > 50 && (
                    <p className="px-4 py-2 text-xs text-gray-500">... et {parsedClients.length - 50} autres</p>
                  )}
                </div>
              </details>
            )}

            {/* Import summary before validation */}
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <h4 className="font-semibold text-gray-800 text-sm mb-2">Resume de l'import a valider :</h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• <strong>{parsedClients.length}</strong> nouveaux clients seront crees</li>
                {duplicates.filter(d => d.action === 'overwrite').length > 0 && (
                  <li>• <strong>{duplicates.filter(d => d.action === 'overwrite').length}</strong> client(s) existant(s) seront ecrases</li>
                )}
                {duplicates.filter(d => d.action === 'import').length > 0 && (
                  <li>• <strong>{duplicates.filter(d => d.action === 'import').length}</strong> doublon(s) seront importes quand meme</li>
                )}
                {duplicates.filter(d => d.action === 'skip').length > 0 && (
                  <li>• <strong>{duplicates.filter(d => d.action === 'skip').length}</strong> doublon(s) seront ignores</li>
                )}
                {unknownCommerciaux.filter(uc => uc.create).length > 0 && (
                  <li>• <strong>{unknownCommerciaux.filter(uc => uc.create).length}</strong> commercial(aux) seront crees</li>
                )}
              </ul>
            </div>

            {/* Validation buttons */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                className="px-4 py-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm font-medium"
                onClick={handleClientImportCancel}
                disabled={clientImporting}
              >
                Annuler
              </button>
              <button
                className="px-6 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                onClick={handleClientImportConfirm}
                disabled={clientImporting || (parsedClients.length === 0 && duplicates.filter(d => d.action !== 'skip').length === 0)}
              >
                {clientImporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Import en cours...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Valider l'import
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ===== Step 3: Done / Results ===== */}
        {clientImportStep === 'done' && clientImportResults && (
          <div className="space-y-4">
            <div className={`p-4 rounded-lg border ${clientImportResults.success > 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <h4 className={`font-semibold text-sm mb-2 ${clientImportResults.success > 0 ? 'text-green-800' : 'text-red-800'}`}>
                Resultats de l'import
              </h4>
              <div className="space-y-1.5 text-sm">
                {clientImportResults.success > 0 && (
                  <div className="flex items-center gap-2 text-green-700">
                    <CheckCircle className="w-4 h-4" />
                    <span className="font-medium">{clientImportResults.success} client(s) importe(s) / mis a jour</span>
                  </div>
                )}
                {clientImportResults.skipped > 0 && (
                  <div className="flex items-center gap-2 text-amber-700">
                    <AlertCircle className="w-4 h-4" />
                    <span>{clientImportResults.skipped} doublon(s) ignore(s)</span>
                  </div>
                )}
                {clientImportResults.commerciauxCreated > 0 && (
                  <div className="flex items-center gap-2 text-blue-700">
                    <CheckCircle className="w-4 h-4" />
                    <span>{clientImportResults.commerciauxCreated} commercial(aux) cree(s)</span>
                  </div>
                )}
                {clientImportResults.errors.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {clientImportResults.errors.slice(0, 20).map((err, i) => (
                      <div key={i} className="flex items-start gap-2 text-red-600 text-xs">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        <span>{err}</span>
                      </div>
                    ))}
                    {clientImportResults.errors.length > 20 && (
                      <p className="text-xs text-gray-500">... et {clientImportResults.errors.length - 20} autres erreurs</p>
                    )}
                  </div>
                )}
              </div>
            </div>
            <button
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium"
              onClick={handleClientImportCancel}
            >
              Nouvel import
            </button>
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
