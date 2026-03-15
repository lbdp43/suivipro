import { useState, useEffect, useCallback } from 'react';
import {
  Database, Search, Download, RefreshCw, Check, AlertTriangle, X,
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
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);

  // Zone config
  const [zoneConfig, setZoneConfig] = useState<ZoneConfig | null>(null);
  const [showZoneConfig, setShowZoneConfig] = useState(false);
  const [zoneSyncing, setZoneSyncing] = useState(false);
  const [zoneSaving, setZoneSaving] = useState(false);
  const [zoneForm, setZoneForm] = useState({
    departements: '03,07,26,38,42,43,63',
    lookback_days: 7,
    auto_import: true,
    default_commercial_id: '',
    cron_enabled: true,
    insee_api_key: '',
  });

  const token = localStorage.getItem('suivipro_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

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

  const loadZoneConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/sirene/zone-config', { headers });
      if (res.ok) {
        const data = await res.json();
        setZoneConfig(data);
        setZoneForm({
          departements: data.departements || '03,07,26,38,42,43,63',
          lookback_days: data.lookback_days || 7,
          auto_import: data.auto_import ?? true,
          default_commercial_id: data.default_commercial_id || '',
          cron_enabled: data.cron_enabled ?? true,
          insee_api_key: data.insee_api_key || '',
        });
      }
    } catch (err) {
      console.error('Error loading zone config:', err);
    }
  }, []);

  const saveZoneConfig = async () => {
    setZoneSaving(true);
    try {
      const res = await fetch('/api/sirene/zone-config', {
        method: 'PUT', headers,
        body: JSON.stringify(zoneForm),
      });
      const data = await res.json();
      if (data.ok) {
        setZoneConfig(data.config);
        setShowZoneConfig(false);
      }
    } catch (err) {
      console.error('Error saving zone config:', err);
    } finally {
      setZoneSaving(false);
    }
  };

  const launchZoneSync = async () => {
    setZoneSyncing(true);
    try {
      const res = await fetch('/api/sirene/sync-zone', {
        method: 'POST', headers,
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
        setZoneSyncing(false);
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
            loadEtablissements();
            loadStats();
          }
        }, 5000);
      }
    } catch (err) {
      console.error('Zone sync error:', err);
      setZoneSyncing(false);
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

  useEffect(() => {
    Promise.all([loadConfig(), loadStats(), loadEtablissements(), loadSyncLogs(), loadZoneConfig()])
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
      const res = await fetch('/api/sirene/sync', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          naf_codes: Array.from(selectedNafCodes),
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
    if (selectedIds.size === etablissements.filter(e => !e.imported_as_prospect).length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(etablissements.filter(e => !e.imported_as_prospect).map(e => e.id)));
    }
  };

  const importSelected = async () => {
    if (!importCommercialId || selectedIds.size === 0) return;
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
    } catch (err) {
      console.error('Import error:', err);
    } finally {
      setImporting(false);
    }
  };

  const importAll = async () => {
    if (!importCommercialId) return;
    if (!confirm('Importer TOUS les etablissements non importes en prospects ?')) return;
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

      {/* Zone Config + Auto Sync */}
      <div className="bg-white rounded-xl border border-indigo-200 p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Globe className="w-4 h-4 text-indigo-500" />
            Zone de prospection & Sync automatique
            {zoneConfig?.cron_enabled && (
              <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-[10px] font-medium">CRON actif</span>
            )}
          </h2>
          <button
            onClick={() => setShowZoneConfig(!showZoneConfig)}
            className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
          >
            <Settings className="w-3 h-3" />
            {showZoneConfig ? 'Masquer config' : 'Configurer'}
          </button>
        </div>

        {/* Zone summary */}
        {zoneConfig && !showZoneConfig && (
          <div className="mb-4 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {zoneConfig.departements.split(',').map(d => d.trim()).filter(Boolean).map(dept => (
                <span key={dept} className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-medium">
                  {dept} {DEPT_LABELS[dept] ? `- ${DEPT_LABELS[dept]}` : ''}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span>Lookback: {zoneConfig.lookback_days}j</span>
              <span>Auto-import: {zoneConfig.auto_import ? 'Oui' : 'Non'}</span>
              <span>Cle INSEE: {zoneConfig.insee_api_key ? 'Configuree' : 'Non configuree'}</span>
              {zoneConfig.default_commercial_id && (
                <span>Commercial: {state.commerciaux.find(c => c.id === zoneConfig.default_commercial_id)?.prenom || zoneConfig.default_commercial_id}</span>
              )}
            </div>
          </div>
        )}

        {/* Zone config form */}
        {showZoneConfig && (
          <div className="space-y-4 mb-4 p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-indigo-700 mb-1">
                  Departements (separes par virgule)
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-indigo-200 rounded-lg text-sm"
                  placeholder="03,07,26,38,42,43,63"
                  value={zoneForm.departements}
                  onChange={e => setZoneForm(f => ({ ...f, departements: e.target.value }))}
                />
                <p className="text-[10px] text-indigo-400 mt-1">Corridor Rhone-Alpes / Auvergne</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-indigo-700 mb-1">
                  <Key className="w-3 h-3 inline mr-1" />
                  Cle API INSEE (portail-api.insee.fr)
                </label>
                <input
                  type="password"
                  className="w-full px-3 py-2 border border-indigo-200 rounded-lg text-sm"
                  placeholder={zoneForm.insee_api_key === '***configured***' ? 'Cle deja configuree' : 'X-INSEE-Api-Key-Integration'}
                  value={zoneForm.insee_api_key === '***configured***' ? '' : zoneForm.insee_api_key}
                  onChange={e => setZoneForm(f => ({ ...f, insee_api_key: e.target.value || (zoneConfig?.insee_api_key ? '***configured***' : '') }))}
                />
                <p className="text-[10px] text-indigo-400 mt-1">Gratuite sur portail-api.insee.fr - necessaire pour le filtre par date</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-indigo-700 mb-1">Lookback (jours)</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 border border-indigo-200 rounded-lg text-sm"
                  value={zoneForm.lookback_days}
                  onChange={e => setZoneForm(f => ({ ...f, lookback_days: parseInt(e.target.value) || 7 }))}
                  min={1} max={90}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-indigo-700 mb-1">Commercial par defaut</label>
                <select
                  className="w-full px-3 py-2 border border-indigo-200 rounded-lg text-sm"
                  value={zoneForm.default_commercial_id}
                  onChange={e => setZoneForm(f => ({ ...f, default_commercial_id: e.target.value }))}
                >
                  <option value="">-- Aucun --</option>
                  {state.commerciaux.map(c => (
                    <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={zoneForm.auto_import}
                    onChange={e => setZoneForm(f => ({ ...f, auto_import: e.target.checked }))}
                    className="rounded border-indigo-300"
                  />
                  <span className="text-xs text-indigo-700">Auto-import</span>
                </label>
              </div>
              <div className="flex items-end gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={zoneForm.cron_enabled}
                    onChange={e => setZoneForm(f => ({ ...f, cron_enabled: e.target.checked }))}
                    className="rounded border-indigo-300"
                  />
                  <span className="text-xs text-indigo-700">CRON lundi 6h</span>
                </label>
              </div>
            </div>
            <button
              onClick={saveZoneConfig}
              disabled={zoneSaving}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50 flex items-center gap-2"
            >
              {zoneSaving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Enregistrer la configuration
            </button>
          </div>
        )}

        {/* Zone sync button */}
        <div className="flex gap-3">
          <button
            onClick={launchZoneSync}
            disabled={zoneSyncing || syncing}
            className="px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {zoneSyncing ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> Sync zone en cours...</>
            ) : (
              <><Zap className="w-4 h-4" /> Sync ma zone (INSEE)</>
            )}
          </button>
          <p className="text-xs text-gray-400 self-center">
            Utilise l'API INSEE avec filtre date natif - ne ramene que les <strong>nouveaux</strong> etablissements
          </p>
        </div>
      </div>

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
              <label className="block text-xs font-medium text-gray-600 mb-2">Codes NAF a synchroniser (vide = tous)</label>
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
              {importResult.imported} prospect{importResult.imported > 1 ? 's' : ''} importe{importResult.imported > 1 ? 's' : ''}
              {importResult.skipped > 0 && `, ${importResult.skipped} ignore${importResult.skipped > 1 ? 's' : ''} (doublons)`}
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
            <select
              className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs"
              value={filterNaf}
              onChange={e => setFilterNaf(e.target.value)}
            >
              <option value="">Tous</option>
              {nafCodes.map(n => (
                <option key={n.code} value={n.code}>{n.code} - {n.label}</option>
              ))}
            </select>
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
            <label className="block text-[10px] text-gray-500 mb-0.5">Assigner a</label>
            <select
              className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs"
              value={importCommercialId}
              onChange={e => setImportCommercialId(e.target.value)}
            >
              <option value="">-- Commercial --</option>
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
            {selectedIds.size === etablissements.filter(e => !e.imported_as_prospect).length && selectedIds.size > 0
              ? 'Tout deselectionner'
              : 'Tout selectionner'}
          </button>
          {selectedIds.size > 0 && (
            <button
              onClick={importSelected}
              disabled={importing || !importCommercialId}
              className="px-3 py-1.5 text-xs bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1"
            >
              {importing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              Importer {selectedIds.size} selectionne{selectedIds.size > 1 ? 's' : ''}
            </button>
          )}
          <button
            onClick={importAll}
            disabled={importing || !importCommercialId}
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
