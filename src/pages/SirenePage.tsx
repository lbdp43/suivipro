import { useState, useEffect, useCallback } from 'react';
import {
  Database, Search, Download, RefreshCw, Check, AlertTriangle, X, Trash2,
  ChevronDown, ChevronRight, Filter, Building2, MapPin, Clock,
  Settings, Zap, Globe, Key, Save,
} from 'lucide-react';
import { useApp } from '../store/AppContext';

interface NafCode {
  code: string;
  label: string;
  type: string;
}

interface SireneEtablissement {
  id: number;
  siret: string;
  siren: string;
  nom: string;
  enseigne: string;
  code_naf: string;
  libelle_naf: string;
  date_creation_etab: string;
  adresse_numero: string;
  adresse_voie: string;
  code_postal: string;
  commune: string;
  departement: string;
  etat_admin: string;
  imported_as_prospect: string | null;
  created_at: string;
}

interface SyncLog {
  id: number;
  started_at: string;
  finished_at: string;
  status: string;
  records_fetched: number;
  records_inserted: number;
  records_updated: number;
  records_auto_imported: number;
  error_message: string;
  naf_codes: string;
  departements: string;
  source: string;
  is_cron: boolean;
}

interface ZoneConfig {
  id: number;
  name: string;
  entity_type: string;
  departements: string;
  naf_codes: string;
  lookback_days: number;
  auto_import: boolean;
  default_commercial_id: string;
  cron_enabled: boolean;
  cron_schedule: string;
  insee_api_key: string;
  updated_at: string;
}

const DEPT_LABELS: Record<string, string> = {
  '03': 'Allier', '07': 'Ardeche', '26': 'Drome', '38': 'Isere',
  '42': 'Loire', '43': 'Haute-Loire', '63': 'Puy-de-Dome',
  '01': 'Ain', '15': 'Cantal', '69': 'Rhone', '73': 'Savoie', '74': 'Haute-Savoie',
};

interface SireneStats {
  total: number;
  not_imported: number;
  imported: number;
  by_naf: { code_naf: string; libelle_naf: string; count: string }[];
  by_departement: { departement: string; count: string }[];
  last_sync: SyncLog | null;
}

export default function SirenePage() {
  const { state } = useApp();
  const [nafCodes, setNafCodes] = useState<NafCode[]>([]);
  const [apiConfigured, setApiConfigured] = useState(false);
  const [stats, setStats] = useState<SireneStats | null>(null);
  const [etablissements, setEtablissements] = useState<SireneEtablissement[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);

  // Sync form
  const [selectedNafCodes, setSelectedNafCodes] = useState<Set<string>>(new Set());
  const [customNafInput, setCustomNafInput] = useState('');
  const [deptInput, setDeptInput] = useState('');
  const [lookbackDays, setLookbackDays] = useState(30);
  const [showSyncForm, setShowSyncForm] = useState(false);

  // Filter for etablissements
  const [filterDept, setFilterDept] = useState('');
  const [filterNaf, setFilterNaf] = useState('');
  const [filterImported, setFilterImported] = useState('false');

  // Import
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [importCommercialId, setImportCommercialId] = useState('');

  // Geo search
  const [geoLat, setGeoLat] = useState('');
  const [geoLng, setGeoLng] = useState('');
  const [geoRadius, setGeoRadius] = useState(10);
  const [showGeoForm, setShowGeoForm] = useState(false);

  // Import result
  const [importResult, setImportResult] = useState<{ imported: number; duplicates?: number; skipped: number } | null>(null);

  // Duplicate queue
  const [duplicateQueue, setDuplicateQueue] = useState<any[]>([]);
  const [resolvingDupId, setResolvingDupId] = useState<number | null>(null);

  // Zone configs (multi)
  const [zoneConfigs, setZoneConfigs] = useState<ZoneConfig[]>([]);
  const [editingConfigId, setEditingConfigId] = useState<number | null>(null);
  const [syncingConfigId, setSyncingConfigId] = useState<number | null>(null);
  const [zoneSyncing, setZoneSyncing] = useState(false);
  const [zoneSaving, setZoneSaving] = useState(false);
  const [zoneForm, setZoneForm] = useState({
    name: '',
    entity_type: 'prospect',
    departements: '03,07,26,38,42,43,63',
    naf_codes: '',
    lookback_days: 7,
    auto_import: true,
    default_commercial_id: '',
    cron_enabled: true,
    insee_api_key: '',
  });
  const [showNewConfigForm, setShowNewConfigForm] = useState(false);

  // Entity types from DB
  const [entityTypes, setEntityTypes] = useState<{ id: string; label: string }[]>([]);

  const token = localStorage.getItem('suivipro_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const loadEntityTypes = useCallback(async () => {
    try {
      const res = await fetch('/api/entity-types', { headers });
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data)) return;
      setEntityTypes(data.map((et: any) => ({ id: et.id, label: et.label })));
    } catch (err) { console.error('Error loading entity types:', err); }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/sirene/config', { headers });
      const data = await res.json();
      setNafCodes(data.naf_codes || []);
      setApiConfigured(data.api_configured);
    } catch (err) {
      console.error('Error loading config:', err);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/sirene/stats', { headers });
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error('Error loading stats:', err);
    }
  }, []);

  const loadEtablissements = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterDept) params.set('departement', filterDept);
      if (filterNaf) params.set('code_naf', filterNaf);
      if (filterImported) params.set('imported', filterImported);
      params.set('limit', '200');

      const res = await fetch(`/api/sirene/etablissements?${params}`, { headers });
      const data = await res.json();
      setEtablissements(data);
    } catch (err) {
      console.error('Error loading etablissements:', err);
    }
  }, [filterDept, filterNaf, filterImported]);

  const loadZoneConfigs = useCallback(async () => {
    try {
      const res = await fetch('/api/sirene/zone-configs', { headers });
      if (res.ok) {
        const data = await res.json();
        setZoneConfigs(data);
      }
    } catch (err) {
      console.error('Error loading zone configs:', err);
    }
  }, []);

  const saveZoneConfig = async () => {
    setZoneSaving(true);
    try {
      if (editingConfigId) {
        // Update existing
        const res = await fetch(`/api/sirene/zone-configs/${editingConfigId}`, {
          method: 'PUT', headers, body: JSON.stringify(zoneForm),
        });
        const data = await res.json();
        if (data.ok) {
          setZoneConfigs(prev => prev.map(c => c.id === editingConfigId ? data.config : c));
          setEditingConfigId(null);
        }
      } else {
        // Create new
        const res = await fetch('/api/sirene/zone-configs', {
          method: 'POST', headers, body: JSON.stringify(zoneForm),
        });
        const data = await res.json();
        if (data.ok) {
          setZoneConfigs(prev => [...prev, data.config]);
          setShowNewConfigForm(false);
        }
      }
    } catch (err) {
      console.error('Error saving zone config:', err);
    } finally {
      setZoneSaving(false);
    }
  };

  const deleteZoneConfig = async (id: number) => {
    if (!confirm('Supprimer cette configuration de sync ?')) return;
    try {
      await fetch(`/api/sirene/zone-configs/${id}`, { method: 'DELETE', headers });
      setZoneConfigs(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      console.error('Error deleting config:', err);
    }
  };

  const launchZoneSync = async (configId?: number) => {
    setZoneSyncing(true);
    setSyncingConfigId(configId || null);
    try {
      const res = await fetch('/api/sirene/sync-zone', {
        method: 'POST', headers,
        body: JSON.stringify({ config_id: configId }),
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
        setZoneSyncing(false);
        setSyncingConfigId(null);
        return;
      }
      if (data.ok) {
        const pollInterval = setInterval(async () => {
          await loadSyncLogs();
          const logsRes = await fetch('/api/sirene/sync-logs', { headers });
          const logs = await logsRes.json();
          if (logs[0]?.status !== 'running') {
            clearInterval(pollInterval);
            setZoneSyncing(false);
            setSyncingConfigId(null);
            loadEtablissements();
            loadStats();
          }
        }, 5000);
      }
    } catch (err) {
      console.error('Zone sync error:', err);
      setZoneSyncing(false);
      setSyncingConfigId(null);
    }
  };

  const loadSyncLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/sirene/sync-logs', { headers });
      const data = await res.json();
      setSyncLogs(data);
    } catch (err) {
      console.error('Error loading sync logs:', err);
    }
  }, []);

  const loadDuplicates = useCallback(async () => {
    try {
      const res = await fetch('/api/sirene/duplicates', { headers });
      const data = await res.json();
      setDuplicateQueue(data);
    } catch (err) {
      console.error('Error loading duplicates:', err);
    }
  }, []);

  const resolveDuplicate = async (dupId: number, action: 'merge' | 'skip' | 'import') => {
    setResolvingDupId(dupId);
    try {
      await fetch(`/api/sirene/duplicates/${dupId}/${action}`, { method: 'POST', headers });
      setDuplicateQueue(prev => prev.filter(d => d.id !== dupId));
    } catch (err) {
      console.error('Error resolving duplicate:', err);
    } finally {
      setResolvingDupId(null);
    }
  };

  useEffect(() => {
    Promise.all([loadConfig(), loadStats(), loadEtablissements(), loadSyncLogs(), loadZoneConfigs(), loadDuplicates(), loadEntityTypes()])
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadEtablissements();
  }, [filterDept, filterNaf, filterImported]);

  const launchSync = async () => {
    setSyncing(true);
    setImportResult(null);
    try {
      const departements = deptInput.split(',').map(d => d.trim()).filter(Boolean);
      // Merge predefined selected + custom NAF codes
      const customCodes = customNafInput.split(',').map(c => c.trim()).filter(Boolean);
      const allNafCodes = [...Array.from(selectedNafCodes), ...customCodes];
      const res = await fetch('/api/sirene/sync', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          naf_codes: allNafCodes,
          departements,
          lookback_days: lookbackDays,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        // Poll for completion
        const pollInterval = setInterval(async () => {
          await loadSyncLogs();
          await loadStats();
          const logsRes = await fetch('/api/sirene/sync-logs', { headers });
          const logs = await logsRes.json();
          const latest = logs[0];
          if (latest && latest.status !== 'running') {
            clearInterval(pollInterval);
            setSyncing(false);
            loadEtablissements();
            loadStats();
          }
        }, 5000);
      }
    } catch (err) {
      console.error('Sync error:', err);
      setSyncing(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === etablissements.length && selectedIds.size > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(etablissements.map(e => e.id)));
    }
  };

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Supprimer ${selectedIds.size} etablissement(s) selectionne(s) ?`)) return;
    try {
      await fetch('/api/sirene/delete-etablissements', {
        method: 'POST', headers,
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      setSelectedIds(new Set());
      loadEtablissements();
      loadStats();
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const importSelected = async () => {
    if (selectedIds.size === 0) return;
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch('/api/sirene/import-prospects', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          etablissement_ids: Array.from(selectedIds),
          commercial_id: importCommercialId,
        }),
      });
      const data = await res.json();
      setImportResult(data);
      setSelectedIds(new Set());
      loadEtablissements();
      loadStats();
      loadDuplicates();
    } catch (err) {
      console.error('Import error:', err);
    } finally {
      setImporting(false);
    }
  };

  const importAll = async () => {
    if (!confirm('Importer TOUS les etablissements non importes ?')) return;
    setImporting(true);
    setImportResult(null);
    try {
      const departements = filterDept ? [filterDept] : [];
      const naf = filterNaf ? [filterNaf] : [];
      const res = await fetch('/api/sirene/import-all', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          commercial_id: importCommercialId,
          departements,
          naf_codes: naf,
        }),
      });
      const data = await res.json();
      setImportResult(data);
      loadEtablissements();
      loadStats();
      loadDuplicates();
    } catch (err) {
      console.error('Import all error:', err);
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Chargement...</span>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Database className="w-6 h-6 text-sky-500" />
          Import Datagouv
        </h1>
        <span className="text-xs text-gray-400">API recherche-entreprises.api.gouv.fr (aucune cle requise)</span>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-sky-600">{stats.total}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">Etablissements en base</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{stats.not_imported}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">A importer</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{stats.imported}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">Deja importes</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-gray-600">
              {stats.last_sync ? (stats.last_sync.status === 'success' ? 'OK' : stats.last_sync.status === 'running' ? '...' : 'Err') : 'N/A'}
            </p>
            <p className="text-[10px] text-gray-500 mt-0.5">Derniere sync</p>
          </div>
        </div>
      )}

      {/* Zone Configs + Auto Sync */}
      <div className="bg-white rounded-xl border border-indigo-200 p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Globe className="w-4 h-4 text-indigo-500" />
            Configurations de sync automatique
            {zoneConfigs.filter(c => c.cron_enabled).length > 0 && (
              <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-[10px] font-medium">
                {zoneConfigs.filter(c => c.cron_enabled).length} CRON actif{zoneConfigs.filter(c => c.cron_enabled).length > 1 ? 's' : ''}
              </span>
            )}
          </h2>
          <button
            onClick={() => {
              setZoneForm({ name: '', entity_type: 'prospect', departements: '03,07,26,38,42,43,63', naf_codes: '', lookback_days: 7, auto_import: true, default_commercial_id: '', cron_enabled: true, insee_api_key: '' });
              setEditingConfigId(null);
              setShowNewConfigForm(!showNewConfigForm);
            }}
            className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs hover:bg-indigo-700 flex items-center gap-1"
          >
            <Building2 className="w-3 h-3" /> Nouvelle config
          </button>
        </div>

        {/* List of configs */}
        {zoneConfigs.length === 0 && !showNewConfigForm && (
          <p className="text-sm text-gray-400 text-center py-4">Aucune configuration. Creez-en une pour lancer la sync automatique INSEE.</p>
        )}

        <div className="space-y-3">
          {zoneConfigs.map(config => {
            const isEditing = editingConfigId === config.id;
            const isSyncing = syncingConfigId === config.id;
            const entityColors: Record<string, string> = {
              prospect: 'bg-sky-100 text-sky-700 border-sky-200',
              client: 'bg-green-100 text-green-700 border-green-200',
              concurrent: 'bg-red-100 text-red-700 border-red-200',
              distributeur: 'bg-amber-100 text-amber-700 border-amber-200',
              partenaire: 'bg-purple-100 text-purple-700 border-purple-200',
            };
            const entityColor = entityColors[config.entity_type] || 'bg-gray-100 text-gray-700 border-gray-200';

            if (isEditing) {
              return (
                <div key={config.id} className="p-4 bg-indigo-50 border border-indigo-200 rounded-lg space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] text-indigo-600 mb-0.5">Nom</label>
                      <input type="text" className="w-full px-2 py-1.5 border border-indigo-200 rounded text-xs" value={zoneForm.name} onChange={e => setZoneForm(f => ({ ...f, name: e.target.value }))} />
                    </div>
                    <div>
                      <label className="block text-[10px] text-indigo-600 mb-0.5">Type d'entite</label>
                      <select className="w-full px-2 py-1.5 border border-indigo-200 rounded text-xs" value={zoneForm.entity_type} onChange={e => setZoneForm(f => ({ ...f, entity_type: e.target.value }))}>
                        {entityTypes.length > 0 ? entityTypes.map(et => (
                          <option key={et.id} value={et.id}>{et.label}</option>
                        )) : (
                          <>
                            <option value="prospect">Prospect</option>
                            <option value="client">Client</option>
                            <option value="concurrent">Concurrent</option>
                            <option value="distributeur">Distributeur</option>
                            <option value="partenaire">Partenaire</option>
                            <option value="fournisseur">Fournisseur</option>
                          </>
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-indigo-600 mb-0.5">Departements</label>
                      <input type="text" className="w-full px-2 py-1.5 border border-indigo-200 rounded text-xs" value={zoneForm.departements} onChange={e => setZoneForm(f => ({ ...f, departements: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center justify-between mb-0.5">
                        <label className="text-[10px] text-indigo-600">Codes NAF ({zoneForm.naf_codes ? zoneForm.naf_codes.split(',').filter(Boolean).length : 0}/{nafCodes.length})</label>
                        <button type="button" className="text-[9px] text-indigo-500 hover:text-indigo-700" onClick={() => {
                          const allCodes = nafCodes.map(n => n.code);
                          const currentCodes = zoneForm.naf_codes.split(',').map(s => s.trim()).filter(Boolean);
                          setZoneForm(f => ({ ...f, naf_codes: currentCodes.length === allCodes.length ? '' : allCodes.join(',') }));
                        }}>{zoneForm.naf_codes.split(',').filter(Boolean).length === nafCodes.length ? 'Tout decocher' : 'Tout cocher'}</button>
                      </div>
                      <div className="border border-indigo-200 rounded bg-white max-h-32 overflow-y-auto p-1">
                        {nafCodes.map(naf => {
                          const selected = zoneForm.naf_codes.split(',').map(s => s.trim()).filter(Boolean);
                          const isChecked = selected.includes(naf.code);
                          return (
                            <label key={naf.code} className="flex items-center gap-1.5 px-1 py-0.5 hover:bg-indigo-50 rounded cursor-pointer">
                              <input type="checkbox" checked={isChecked} className="rounded border-indigo-300" onChange={() => {
                                const codes = zoneForm.naf_codes.split(',').map(s => s.trim()).filter(Boolean);
                                const next = isChecked ? codes.filter(c => c !== naf.code) : [...codes, naf.code];
                                setZoneForm(f => ({ ...f, naf_codes: next.join(',') }));
                              }} />
                              <span className="text-[10px] text-gray-700">{naf.code} - {naf.label}</span>
                            </label>
                          );
                        })}
                      </div>
                      {(() => {
                        const predefinedCodes = nafCodes.map(n => n.code);
                        const customCodes = zoneForm.naf_codes.split(',').map(s => s.trim()).filter(c => c && !predefinedCodes.includes(c));
                        return customCodes.length > 0 ? (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {customCodes.map(code => (
                              <span key={code} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[9px] font-medium">
                                {code}
                                <button type="button" className="hover:text-red-600" onClick={() => {
                                  const codes = zoneForm.naf_codes.split(',').map(s => s.trim()).filter(c => c && c !== code);
                                  setZoneForm(f => ({ ...f, naf_codes: codes.join(',') }));
                                }}><X className="w-2.5 h-2.5" /></button>
                              </span>
                            ))}
                          </div>
                        ) : null;
                      })()}
                      <input type="text" className="w-full mt-1 px-2 py-1 border border-indigo-200 rounded text-[10px] text-gray-600" placeholder="+ codes NAF perso (ex: 55.10Z, 93.29Z)" onBlur={e => {
                        const custom = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                        if (custom.length > 0) {
                          const existing = zoneForm.naf_codes.split(',').map(s => s.trim()).filter(Boolean);
                          const merged = [...new Set([...existing, ...custom])];
                          setZoneForm(f => ({ ...f, naf_codes: merged.join(',') }));
                          e.target.value = '';
                        }
                      }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }} />
                    </div>
                    <div>
                      <label className="block text-[10px] text-indigo-600 mb-0.5">Cle API INSEE</label>
                      <input type="password" className="w-full px-2 py-1.5 border border-indigo-200 rounded text-xs" placeholder={zoneForm.insee_api_key === '***configured***' ? 'Deja configuree' : 'X-INSEE-Api-Key...'} value={zoneForm.insee_api_key === '***configured***' ? '' : zoneForm.insee_api_key} onChange={e => setZoneForm(f => ({ ...f, insee_api_key: e.target.value || (config.insee_api_key ? '***configured***' : '') }))} />
                    </div>
                  </div>
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-1">
                      <label className="text-[10px] text-indigo-600">Lookback:</label>
                      <input type="number" className="w-14 px-1 py-1 border border-indigo-200 rounded text-xs" value={zoneForm.lookback_days} onChange={e => setZoneForm(f => ({ ...f, lookback_days: parseInt(e.target.value) || 7 }))} min={1} max={90} />
                      <span className="text-[10px] text-indigo-400">jours</span>
                    </div>
                    <label className="flex items-center gap-1 cursor-pointer text-xs text-indigo-700">
                      <input type="checkbox" checked={zoneForm.auto_import} onChange={e => setZoneForm(f => ({ ...f, auto_import: e.target.checked }))} className="rounded border-indigo-300" />
                      Auto-import
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer text-xs text-indigo-700">
                      <input type="checkbox" checked={zoneForm.cron_enabled} onChange={e => setZoneForm(f => ({ ...f, cron_enabled: e.target.checked }))} className="rounded border-indigo-300" />
                      CRON lundi 6h
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveZoneConfig} disabled={zoneSaving || !zoneForm.name} className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1">
                      {zoneSaving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Enregistrer
                    </button>
                    <button onClick={() => setEditingConfigId(null)} className="px-3 py-1.5 border border-gray-200 rounded text-xs hover:bg-gray-50">Annuler</button>
                  </div>
                </div>
              );
            }

            return (
              <div key={config.id} className="p-3 border border-gray-200 rounded-lg hover:border-indigo-200 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-sm text-gray-900">{config.name}</h3>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${entityColor}`}>
                      {config.entity_type}
                    </span>
                    {config.cron_enabled && (
                      <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[9px] font-medium">CRON</span>
                    )}
                    {config.auto_import && (
                      <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px] font-medium">Auto-import</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => launchZoneSync(config.id)}
                      disabled={zoneSyncing || syncing}
                      className="px-2 py-1 bg-indigo-600 text-white rounded text-[10px] hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1"
                    >
                      {isSyncing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                      Sync
                    </button>
                    <button
                      onClick={() => {
                        setEditingConfigId(config.id);
                        setShowNewConfigForm(false);
                        setZoneForm({
                          name: config.name, entity_type: config.entity_type,
                          departements: config.departements, naf_codes: config.naf_codes || '',
                          lookback_days: config.lookback_days, auto_import: config.auto_import,
                          default_commercial_id: config.default_commercial_id || '',
                          cron_enabled: config.cron_enabled, insee_api_key: config.insee_api_key || '',
                        });
                      }}
                      className="px-2 py-1 border border-gray-200 rounded text-[10px] hover:bg-gray-50"
                    >
                      <Settings className="w-3 h-3" />
                    </button>
                    <button onClick={() => deleteZoneConfig(config.id)} className="px-2 py-1 text-red-400 hover:text-red-600">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 mb-1">
                  {config.departements.split(',').map(d => d.trim()).filter(Boolean).map(dept => (
                    <span key={dept} className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[9px]">
                      {dept} {DEPT_LABELS[dept] ? `- ${DEPT_LABELS[dept]}` : ''}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-3 text-[10px] text-gray-500">
                  <span>Lookback: {config.lookback_days}j</span>
                  {config.naf_codes && <span>NAF: {config.naf_codes.split(',').length} codes</span>}
                  <span>INSEE: {config.insee_api_key ? 'OK' : 'Non config.'}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* New config form */}
        {showNewConfigForm && (
          <div className="mt-3 p-4 bg-indigo-50 border border-indigo-200 rounded-lg space-y-3">
            <h3 className="font-medium text-sm text-indigo-800">Nouvelle configuration</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] text-indigo-600 mb-0.5">Nom</label>
                <input type="text" className="w-full px-2 py-1.5 border border-indigo-200 rounded text-xs" placeholder="Ex: Concurrents brasseries" value={zoneForm.name} onChange={e => setZoneForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-[10px] text-indigo-600 mb-0.5">Type d'entite</label>
                <select className="w-full px-2 py-1.5 border border-indigo-200 rounded text-xs" value={zoneForm.entity_type} onChange={e => setZoneForm(f => ({ ...f, entity_type: e.target.value }))}>
                  <option value="prospect">Prospect</option>
                  <option value="client">Client</option>
                  <option value="concurrent">Concurrent</option>
                  <option value="distributeur">Distributeur</option>
                  <option value="partenaire">Partenaire</option>
                  <option value="fournisseur">Fournisseur</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-indigo-600 mb-0.5">Departements</label>
                <input type="text" className="w-full px-2 py-1.5 border border-indigo-200 rounded text-xs" value={zoneForm.departements} onChange={e => setZoneForm(f => ({ ...f, departements: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="text-[10px] text-indigo-600">Codes NAF ({zoneForm.naf_codes ? zoneForm.naf_codes.split(',').filter(Boolean).length : 0}/{nafCodes.length})</label>
                  <button type="button" className="text-[9px] text-indigo-500 hover:text-indigo-700" onClick={() => {
                    const allCodes = nafCodes.map(n => n.code);
                    const currentCodes = zoneForm.naf_codes.split(',').map(s => s.trim()).filter(Boolean);
                    setZoneForm(f => ({ ...f, naf_codes: currentCodes.length === allCodes.length ? '' : allCodes.join(',') }));
                  }}>{zoneForm.naf_codes.split(',').filter(Boolean).length === nafCodes.length ? 'Tout decocher' : 'Tout cocher'}</button>
                </div>
                <div className="border border-indigo-200 rounded bg-white max-h-32 overflow-y-auto p-1">
                  {nafCodes.map(naf => {
                    const selected = zoneForm.naf_codes.split(',').map(s => s.trim()).filter(Boolean);
                    const isChecked = selected.includes(naf.code);
                    return (
                      <label key={naf.code} className="flex items-center gap-1.5 px-1 py-0.5 hover:bg-indigo-50 rounded cursor-pointer">
                        <input type="checkbox" checked={isChecked} className="rounded border-indigo-300" onChange={() => {
                          const codes = zoneForm.naf_codes.split(',').map(s => s.trim()).filter(Boolean);
                          const next = isChecked ? codes.filter(c => c !== naf.code) : [...codes, naf.code];
                          setZoneForm(f => ({ ...f, naf_codes: next.join(',') }));
                        }} />
                        <span className="text-[10px] text-gray-700">{naf.code} - {naf.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-indigo-600 mb-0.5">Cle API INSEE</label>
                <input type="password" className="w-full px-2 py-1.5 border border-indigo-200 rounded text-xs" placeholder="X-INSEE-Api-Key-Integration" value={zoneForm.insee_api_key} onChange={e => setZoneForm(f => ({ ...f, insee_api_key: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1">
                <label className="text-[10px] text-indigo-600">Lookback:</label>
                <input type="number" className="w-14 px-1 py-1 border border-indigo-200 rounded text-xs" value={zoneForm.lookback_days} onChange={e => setZoneForm(f => ({ ...f, lookback_days: parseInt(e.target.value) || 7 }))} min={1} max={90} />
                <span className="text-[10px] text-indigo-400">jours</span>
              </div>
              <label className="flex items-center gap-1 cursor-pointer text-xs text-indigo-700">
                <input type="checkbox" checked={zoneForm.auto_import} onChange={e => setZoneForm(f => ({ ...f, auto_import: e.target.checked }))} className="rounded border-indigo-300" />
                Auto-import
              </label>
              <label className="flex items-center gap-1 cursor-pointer text-xs text-indigo-700">
                <input type="checkbox" checked={zoneForm.cron_enabled} onChange={e => setZoneForm(f => ({ ...f, cron_enabled: e.target.checked }))} className="rounded border-indigo-300" />
                CRON lundi 6h
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={saveZoneConfig} disabled={zoneSaving || !zoneForm.name} className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1">
                {zoneSaving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Creer
              </button>
              <button onClick={() => setShowNewConfigForm(false)} className="px-3 py-1.5 border border-gray-200 rounded text-xs hover:bg-gray-50">Annuler</button>
            </div>
          </div>
        )}
      </div>

      {/* Duplicate queue */}
      {duplicateQueue.length > 0 && (
        <div className="bg-white rounded-xl border border-orange-200 p-4 sm:p-5">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-orange-500" />
            Doublons a valider ({duplicateQueue.length})
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            Ces etablissements SIRENE correspondent a des prospects existants. Choisissez l'action pour chacun.
          </p>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {duplicateQueue.map(dup => (
              <div key={dup.id} className="p-3 border border-orange-100 rounded-lg bg-orange-50/50">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded text-[9px] font-medium uppercase">{dup.match_type}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-[10px] text-gray-400 mb-0.5">Nouveau (SIRENE)</p>
                        <p className="font-medium text-gray-900">{dup.sirene_nom}</p>
                        <p className="text-gray-500">{dup.sirene_ville} - SIRET: {dup.sirene_siret}</p>
                        <p className="text-gray-400 text-[10px]">NAF: {dup.sirene_naf}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 mb-0.5">Existant (prospect)</p>
                        <p className="font-medium text-gray-900">{dup.existing_nom}</p>
                        <p className="text-gray-500">{dup.existing_ville}{dup.existing_siret ? ` - SIRET: ${dup.existing_siret}` : ''}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => resolveDuplicate(dup.id, 'merge')}
                      disabled={resolvingDupId === dup.id}
                      className="px-2 py-1 bg-green-600 text-white rounded text-[10px] hover:bg-green-700 disabled:opacity-50"
                      title="Fusionner: enrichir le prospect existant"
                    >
                      Fusionner
                    </button>
                    <button
                      onClick={() => resolveDuplicate(dup.id, 'import')}
                      disabled={resolvingDupId === dup.id}
                      className="px-2 py-1 bg-blue-600 text-white rounded text-[10px] hover:bg-blue-700 disabled:opacity-50"
                      title="Importer comme nouvelle fiche"
                    >
                      Creer
                    </button>
                    <button
                      onClick={() => resolveDuplicate(dup.id, 'skip')}
                      disabled={resolvingDupId === dup.id}
                      className="px-2 py-1 border border-gray-200 rounded text-[10px] hover:bg-gray-50 disabled:opacity-50 text-gray-500"
                      title="Ignorer ce doublon"
                    >
                      Ignorer
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sync section */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Search className="w-4 h-4 text-sky-500" />
            Synchronisation manuelle (data.gouv.fr)
          </h2>
          <button
            onClick={() => setShowSyncForm(!showSyncForm)}
            className="text-xs text-sky-600 hover:text-sky-800 flex items-center gap-1"
          >
            {showSyncForm ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {showSyncForm ? 'Masquer' : 'Configurer'}
          </button>
        </div>

        {showSyncForm && (
          <div className="space-y-4 mb-4">
            {/* NAF codes selection */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Codes NAF a synchroniser (vide = tous les predefinis)</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5 max-h-48 overflow-y-auto">
                {nafCodes.map(naf => (
                  <label key={naf.code} className="flex items-center gap-1.5 text-xs p-1.5 rounded hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedNafCodes.has(naf.code)}
                      onChange={() => {
                        const next = new Set(selectedNafCodes);
                        if (next.has(naf.code)) next.delete(naf.code);
                        else next.add(naf.code);
                        setSelectedNafCodes(next);
                      }}
                      className="rounded border-gray-300"
                    />
                    <span className="text-gray-700">{naf.code}</span>
                    <span className="text-gray-400 truncate">{naf.label}</span>
                  </label>
                ))}
              </div>
              <div className="mt-2">
                <label className="block text-[10px] text-gray-500 mb-0.5">Codes NAF supplementaires (separes par virgule)</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs"
                  placeholder="Ex: 93.29Z, 47.19Z, 55.10Z... (n'importe quel code NAF)"
                  value={customNafInput}
                  onChange={e => setCustomNafInput(e.target.value)}
                />
                <p className="text-[10px] text-gray-400 mt-0.5">Ajoutez des codes NAF hors liste (hotellerie, loisirs, epiceries, etc.)</p>
              </div>
            </div>

            {/* Departements */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Departements (separees par virgule, vide = tous)
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  placeholder="43, 42, 63, 69..."
                  value={deptInput}
                  onChange={e => setDeptInput(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Periode (jours en arriere)
                </label>
                <input
                  type="number"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={lookbackDays}
                  onChange={e => setLookbackDays(parseInt(e.target.value) || 30)}
                  min={1}
                  max={365}
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={launchSync}
            disabled={syncing}
            className="px-4 py-2.5 bg-sky-600 text-white rounded-lg hover:bg-sky-700 flex items-center gap-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {syncing ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> Synchronisation en cours...</>
            ) : (
              <><Download className="w-4 h-4" /> Sync par departement / NAF</>
            )}
          </button>
          <button
            onClick={() => setShowGeoForm(!showGeoForm)}
            disabled={syncing}
            className="px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2 text-sm font-medium disabled:opacity-50"
          >
            <MapPin className="w-4 h-4" /> Recherche geographique
          </button>
        </div>

        {showGeoForm && (
          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg space-y-3">
            <h4 className="text-xs font-semibold text-green-800">Recherche par proximite geographique</h4>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] text-green-700 mb-0.5">Latitude</label>
                <input type="text" className="w-full px-2 py-1.5 border border-green-200 rounded-lg text-xs"
                  placeholder="45.0428" value={geoLat} onChange={e => setGeoLat(e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] text-green-700 mb-0.5">Longitude</label>
                <input type="text" className="w-full px-2 py-1.5 border border-green-200 rounded-lg text-xs"
                  placeholder="3.8847" value={geoLng} onChange={e => setGeoLng(e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] text-green-700 mb-0.5">Rayon (km)</label>
                <input type="number" className="w-full px-2 py-1.5 border border-green-200 rounded-lg text-xs"
                  value={geoRadius} onChange={e => setGeoRadius(parseInt(e.target.value) || 10)} min={1} max={100} />
              </div>
            </div>
            <button
              onClick={async () => {
                if (!geoLat || !geoLng) return;
                setSyncing(true);
                try {
                  const nafCodesToUse = selectedNafCodes.size > 0 ? Array.from(selectedNafCodes) : [];
                  const res = await fetch('/api/sirene/sync-near', {
                    method: 'POST', headers,
                    body: JSON.stringify({ latitude: parseFloat(geoLat), longitude: parseFloat(geoLng), radius: geoRadius, naf_codes: nafCodesToUse }),
                  });
                  const data = await res.json();
                  if (data.ok) {
                    const pollInterval = setInterval(async () => {
                      const logsRes = await fetch('/api/sirene/sync-logs', { headers });
                      const logs = await logsRes.json();
                      if (logs[0]?.status !== 'running') {
                        clearInterval(pollInterval);
                        setSyncing(false);
                        loadEtablissements();
                        loadStats();
                        loadSyncLogs();
                      }
                    }, 5000);
                  }
                } catch (err) { console.error(err); setSyncing(false); }
              }}
              disabled={syncing || !geoLat || !geoLng}
              className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-xs font-medium disabled:opacity-50 flex items-center gap-1"
            >
              <Search className="w-3 h-3" /> Lancer la recherche geographique
            </button>
          </div>
        )}
      </div>

      {/* Import result */}
      {importResult && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Check className="w-5 h-5 text-green-600" />
            <span className="text-sm text-green-800 font-medium">
              {importResult.imported} importe{importResult.imported > 1 ? 's' : ''}
              {(importResult.duplicates || 0) > 0 && `, ${importResult.duplicates} doublon${(importResult.duplicates || 0) > 1 ? 's' : ''} a valider`}
              {importResult.skipped > 0 && `, ${importResult.skipped} ignore${importResult.skipped > 1 ? 's' : ''}`}
            </span>
          </div>
          <button onClick={() => setImportResult(null)} className="text-green-400 hover:text-green-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Etablissements list + import */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-sky-500" />
            Etablissements ({etablissements.length})
          </h2>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <div>
            <label className="block text-[10px] text-gray-500 mb-0.5">Departement</label>
            <input
              type="text"
              className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs w-20"
              placeholder="43"
              value={filterDept}
              onChange={e => setFilterDept(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 mb-0.5">Code NAF</label>
            <input
              type="text"
              list="naf-codes-list"
              className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs w-56"
              placeholder="Tous - tapez un code NAF..."
              value={filterNaf}
              onChange={e => setFilterNaf(e.target.value)}
            />
            <datalist id="naf-codes-list">
              <option value="">Tous</option>
              {nafCodes.map(n => (
                <option key={n.code} value={n.code}>{n.code} - {n.label}</option>
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 mb-0.5">Statut</label>
            <select
              className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs"
              value={filterImported}
              onChange={e => setFilterImported(e.target.value)}
            >
              <option value="">Tous</option>
              <option value="false">A importer</option>
              <option value="true">Deja importes</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 mb-0.5">Assigner a (optionnel)</label>
            <select
              className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs"
              value={importCommercialId}
              onChange={e => setImportCommercialId(e.target.value)}
            >
              <option value="">-- Non assigne --</option>
              {state.commerciaux.map(c => (
                <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={toggleSelectAll}
            className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            {selectedIds.size === etablissements.length && selectedIds.size > 0
              ? 'Tout deselectionner'
              : 'Tout selectionner'}
          </button>
          {selectedIds.size > 0 && (
            <>
              <button
                onClick={importSelected}
                disabled={importing}
                className="px-3 py-1.5 text-xs bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1"
              >
                {importing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                Importer {selectedIds.size} selectionne{selectedIds.size > 1 ? 's' : ''}
              </button>
              <button
                onClick={deleteSelected}
                className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                Supprimer ({selectedIds.size})
              </button>
            </>
          )}
          <button
            onClick={importAll}
            disabled={importing}
            className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
          >
            <Download className="w-3 h-3" />
            Tout importer ({stats?.not_imported || 0})
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-2 py-2 text-left w-8"></th>
                <th className="px-2 py-2 text-left">Nom / Enseigne</th>
                <th className="px-2 py-2 text-left">SIRET</th>
                <th className="px-2 py-2 text-left">NAF</th>
                <th className="px-2 py-2 text-left">Commune</th>
                <th className="px-2 py-2 text-left">Dept</th>
                <th className="px-2 py-2 text-left">Creation</th>
                <th className="px-2 py-2 text-left">Statut</th>
              </tr>
            </thead>
            <tbody>
              {etablissements.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                    Aucun etablissement. Lancez une synchronisation pour recuperer les donnees SIRENE.
                  </td>
                </tr>
              ) : etablissements.map(etab => (
                <tr key={etab.id} className={`border-b border-gray-50 hover:bg-gray-50 ${etab.imported_as_prospect ? 'opacity-50' : ''}`}>
                  <td className="px-2 py-2">
                    {!etab.imported_as_prospect && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(etab.id)}
                        onChange={() => {
                          const next = new Set(selectedIds);
                          if (next.has(etab.id)) next.delete(etab.id);
                          else next.add(etab.id);
                          setSelectedIds(next);
                        }}
                        className="rounded border-gray-300"
                      />
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <p className="font-medium text-gray-800">{etab.enseigne || etab.nom}</p>
                    {etab.enseigne && etab.nom !== etab.enseigne && (
                      <p className="text-[10px] text-gray-400">{etab.nom}</p>
                    )}
                  </td>
                  <td className="px-2 py-2 text-gray-500 font-mono">{etab.siret}</td>
                  <td className="px-2 py-2">
                    <span className="px-1.5 py-0.5 bg-sky-50 text-sky-700 rounded text-[10px]">
                      {etab.code_naf}
                    </span>
                    <p className="text-[10px] text-gray-400 mt-0.5">{etab.libelle_naf}</p>
                  </td>
                  <td className="px-2 py-2 text-gray-600">{etab.commune}</td>
                  <td className="px-2 py-2 text-gray-600">{etab.departement}</td>
                  <td className="px-2 py-2 text-gray-500">{etab.date_creation_etab}</td>
                  <td className="px-2 py-2">
                    {etab.imported_as_prospect ? (
                      <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium">
                        Importe
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-medium">
                        A importer
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sync logs */}
      {syncLogs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-gray-500" />
            Historique des synchronisations
          </h2>
          <div className="space-y-2">
            {syncLogs.map(log => (
              <div key={log.id} className={`p-3 rounded-lg border ${
                log.status === 'success' ? 'border-green-200 bg-green-50' :
                log.status === 'error' ? 'border-red-200 bg-red-50' :
                'border-amber-200 bg-amber-50'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                      log.status === 'success' ? 'bg-green-100 text-green-700' :
                      log.status === 'error' ? 'bg-red-100 text-red-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {log.status === 'success' ? 'Succes' : log.status === 'error' ? 'Erreur' : 'En cours'}
                    </span>
                    <span className="text-xs text-gray-600">
                      {new Date(log.started_at).toLocaleString('fr-FR')}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 flex items-center gap-2">
                    {log.source === 'insee' && <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-[10px]">INSEE</span>}
                    {log.is_cron && <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px]">CRON</span>}
                    {log.records_fetched} recup, {log.records_inserted} nouveaux, {log.records_updated} maj
                    {(log.records_auto_imported || 0) > 0 && (
                      <span className="text-green-600 font-medium">, {log.records_auto_imported} auto-importes</span>
                    )}
                  </div>
                </div>
                {log.error_message && (
                  <p className="text-xs text-red-600 mt-1">{log.error_message}</p>
                )}
                {log.naf_codes && (
                  <p className="text-[10px] text-gray-400 mt-1">NAF: {log.naf_codes} | Depts: {log.departements}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Repartition by NAF */}
      {stats && stats.by_naf.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <Filter className="w-4 h-4 text-gray-500" />
              Repartition par code NAF
            </h2>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {stats.by_naf.map(item => (
                <div key={item.code_naf} className="flex items-center justify-between text-xs py-1.5 px-2 bg-gray-50 rounded">
                  <div>
                    <span className="font-medium text-gray-800">{item.code_naf}</span>
                    <span className="text-gray-400 ml-1.5">{item.libelle_naf}</span>
                  </div>
                  <span className="font-bold text-sky-600">{item.count}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <MapPin className="w-4 h-4 text-gray-500" />
              Repartition par departement
            </h2>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {stats.by_departement.map(item => (
                <div key={item.departement} className="flex items-center justify-between text-xs py-1.5 px-2 bg-gray-50 rounded">
                  <span className="font-medium text-gray-800">Dept. {item.departement}</span>
                  <span className="font-bold text-sky-600">{item.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
