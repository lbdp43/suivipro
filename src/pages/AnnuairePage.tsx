import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen, Search, RefreshCw, MapPin, Building2, Users, Shield, Truck,
  Handshake, ChevronDown, ChevronRight, Plus, Trash2, Save, Settings, X, Tag, Package,
} from 'lucide-react';
import { useApp } from '../store/AppContext';

interface AnnuaireEntry {
  id: string;
  nom: string;
  type_etablissement: string;
  ville: string;
  code_postal: string;
  departement: string;
  telephone: string;
  email: string;
  adresse: string;
  latitude: number;
  longitude: number;
  etape_pipeline: string;
  commercial_id: string;
  notes: string;
  siret: string;
  entity_type: string;
  source: string;
  date_creation: string;
  date_modification: string;
}

interface ImportRule {
  id: number;
  naf_code: string;
  naf_label: string;
  entity_type: string;
  pipeline_stage: string;
  auto_import: boolean;
  commercial_id: string;
  sort_order: number;
}

const DEFAULT_ENTITY_TYPES = [
  { value: 'prospect', label: 'Prospect', icon: Users, color: 'text-sky-600 bg-sky-50 border-sky-200' },
  { value: 'client', label: 'Client', icon: Building2, color: 'text-green-600 bg-green-50 border-green-200' },
  { value: 'concurrent', label: 'Concurrent', icon: Shield, color: 'text-red-600 bg-red-50 border-red-200' },
  { value: 'distributeur', label: 'Distributeur', icon: Truck, color: 'text-amber-600 bg-amber-50 border-amber-200' },
  { value: 'partenaire', label: 'Partenaire', icon: Handshake, color: 'text-purple-600 bg-purple-50 border-purple-200' },
  { value: 'fournisseur', label: 'Fournisseur', icon: Package, color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
];

const CUSTOM_TYPE_COLORS = [
  'text-teal-600 bg-teal-50 border-teal-200',
  'text-pink-600 bg-pink-50 border-pink-200',
  'text-cyan-600 bg-cyan-50 border-cyan-200',
  'text-orange-600 bg-orange-50 border-orange-200',
  'text-lime-600 bg-lime-50 border-lime-200',
  'text-rose-600 bg-rose-50 border-rose-200',
  'text-violet-600 bg-violet-50 border-violet-200',
  'text-fuchsia-600 bg-fuchsia-50 border-fuchsia-200',
];

function getEntityConfig(type: string, allTypes: typeof DEFAULT_ENTITY_TYPES = DEFAULT_ENTITY_TYPES) {
  return allTypes.find(e => e.value === type) || { value: type, label: type, icon: Tag, color: 'text-gray-600 bg-gray-50 border-gray-200' };
}

export default function AnnuairePage() {
  const { state } = useApp();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<AnnuaireEntry[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDept, setFilterDept] = useState('');

  // Import rules
  const [rules, setRules] = useState<ImportRule[]>([]);
  const [showRules, setShowRules] = useState(false);
  const [editingRule, setEditingRule] = useState<Partial<ImportRule> | null>(null);
  const [savingRule, setSavingRule] = useState(false);

  const token = localStorage.getItem('suivipro_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const isAdmin = state.currentUser?.role === 'admin';

  const loadEntries = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterType) params.set('entity_type', filterType);
      if (searchQuery) params.set('search', searchQuery);
      if (filterDept) params.set('departement', filterDept);
      params.set('limit', '300');

      const res = await fetch(`/api/annuaire?${params}`, { headers });
      const data = await res.json();
      setEntries(data.entries || []);
      setStats(data.stats || {});
    } catch (err) {
      console.error('Error loading annuaire:', err);
    }
  }, [filterType, searchQuery, filterDept]);

  const loadRules = useCallback(async () => {
    try {
      const res = await fetch('/api/import-rules', { headers });
      const data = await res.json();
      setRules(data);
    } catch (err) {
      console.error('Error loading rules:', err);
    }
  }, []);

  useEffect(() => {
    Promise.all([loadEntries(), loadRules()]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!loading) loadEntries();
  }, [filterType, searchQuery, filterDept]);

  const saveRule = async (rule: Partial<ImportRule>) => {
    setSavingRule(true);
    try {
      if (rule.id) {
        await fetch(`/api/import-rules/${rule.id}`, {
          method: 'PUT', headers, body: JSON.stringify(rule),
        });
      } else {
        await fetch('/api/import-rules', {
          method: 'POST', headers, body: JSON.stringify(rule),
        });
      }
      await loadRules();
      setEditingRule(null);
    } catch (err) {
      console.error('Error saving rule:', err);
    } finally {
      setSavingRule(false);
    }
  };

  const deleteRule = async (id: number) => {
    if (!confirm('Supprimer cette regle ?')) return;
    try {
      await fetch(`/api/import-rules/${id}`, { method: 'DELETE', headers });
      await loadRules();
    } catch (err) {
      console.error('Error deleting rule:', err);
    }
  };

  // Build dynamic entity types from rules (custom types beyond defaults)
  const allEntityTypes = [...DEFAULT_ENTITY_TYPES];
  const defaultValues = new Set(DEFAULT_ENTITY_TYPES.map(e => e.value));
  const customTypesFromRules = [...new Set(rules.map(r => r.entity_type).filter(t => !defaultValues.has(t)))];
  // Also include custom types from stats (in case data exists but no rule)
  Object.keys(stats).forEach(t => {
    if (!defaultValues.has(t) && !customTypesFromRules.includes(t)) customTypesFromRules.push(t);
  });
  customTypesFromRules.forEach((t, i) => {
    allEntityTypes.push({
      value: t,
      label: t.charAt(0).toUpperCase() + t.slice(1),
      icon: Tag,
      color: CUSTOM_TYPE_COLORS[i % CUSTOM_TYPE_COLORS.length],
    });
  });

  const totalEntries = Object.values(stats).reduce((a, b) => a + b, 0);

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
          <BookOpen className="w-6 h-6 text-indigo-500" />
          Annuaire
        </h1>
        <span className="text-xs text-gray-400">{totalEntries} entites</span>
      </div>

      {/* Entity type tabs */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilterType('')}
          className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
            !filterType ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
          }`}
        >
          Tous ({totalEntries})
        </button>
        {allEntityTypes.map(et => {
          const count = stats[et.value] || 0;
          const Icon = et.icon;
          return (
            <button
              key={et.value}
              onClick={() => setFilterType(filterType === et.value ? '' : et.value)}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 ${
                filterType === et.value ? et.color + ' border-current' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {et.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm"
              placeholder="Rechercher par nom, ville, SIRET..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <div>
          <input
            type="text"
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-24"
            placeholder="Dept"
            value={filterDept}
            onChange={e => setFilterDept(e.target.value)}
          />
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowRules(!showRules)}
            className="px-3 py-2 border border-indigo-200 text-indigo-600 rounded-lg text-sm hover:bg-indigo-50 flex items-center gap-1.5"
          >
            <Settings className="w-4 h-4" />
            Regles d'import ({rules.length})
          </button>
        )}
      </div>

      {/* Import Rules panel */}
      {showRules && isAdmin && (
        <div className="bg-white rounded-xl border border-indigo-200 p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Settings className="w-4 h-4 text-indigo-500" />
              Regles d'importation SIRENE
            </h2>
            <button
              onClick={() => setEditingRule({ naf_code: '', naf_label: '', entity_type: 'prospect', pipeline_stage: 'nouveau_datagouv', auto_import: true, commercial_id: '' })}
              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs hover:bg-indigo-700 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Ajouter
            </button>
          </div>

          <p className="text-xs text-gray-500 mb-3">
            Ces regles determinent automatiquement le type (prospect, concurrent, distributeur...) lors de l'import SIRENE selon le code NAF.
          </p>

          {/* Edit form */}
          {editingRule && (
            <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
                <div>
                  <label className="block text-[10px] text-indigo-600 mb-0.5">Code NAF</label>
                  <input
                    type="text"
                    className="w-full px-2 py-1.5 border border-indigo-200 rounded text-xs"
                    placeholder="56.10A"
                    value={editingRule.naf_code || ''}
                    onChange={e => setEditingRule(r => r ? { ...r, naf_code: e.target.value } : r)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-indigo-600 mb-0.5">Libelle</label>
                  <input
                    type="text"
                    className="w-full px-2 py-1.5 border border-indigo-200 rounded text-xs"
                    placeholder="Restauration trad."
                    value={editingRule.naf_label || ''}
                    onChange={e => setEditingRule(r => r ? { ...r, naf_label: e.target.value } : r)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-indigo-600 mb-0.5">Type entite</label>
                  <input
                    type="text"
                    list="entity-type-options"
                    className="w-full px-2 py-1.5 border border-indigo-200 rounded text-xs"
                    placeholder="prospect, concurrent..."
                    value={editingRule.entity_type || 'prospect'}
                    onChange={e => setEditingRule(r => r ? { ...r, entity_type: e.target.value.toLowerCase().trim() } : r)}
                  />
                  <datalist id="entity-type-options">
                    {allEntityTypes.filter(e => e.value !== 'client').map(et => (
                      <option key={et.value} value={et.value}>{et.label}</option>
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-[10px] text-indigo-600 mb-0.5">Assigner a (optionnel)</label>
                  <select
                    className="w-full px-2 py-1.5 border border-indigo-200 rounded text-xs"
                    value={editingRule.commercial_id || ''}
                    onChange={e => setEditingRule(r => r ? { ...r, commercial_id: e.target.value } : r)}
                  >
                    <option value="">Non assigne</option>
                    {state.commerciaux.map(c => (
                      <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end gap-2">
                  <label className="flex items-center gap-1 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={editingRule.auto_import ?? true}
                      onChange={e => setEditingRule(r => r ? { ...r, auto_import: e.target.checked } : r)}
                      className="rounded border-indigo-300"
                    />
                    Auto
                  </label>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => saveRule(editingRule)}
                  disabled={savingRule || !editingRule.naf_code}
                  className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1"
                >
                  {savingRule ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  Enregistrer
                </button>
                <button onClick={() => setEditingRule(null)} className="px-3 py-1.5 border border-gray-200 rounded text-xs hover:bg-gray-50">
                  Annuler
                </button>
              </div>
            </div>
          )}

          {/* Rules table */}
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-2 py-2 text-left">Code NAF</th>
                  <th className="px-2 py-2 text-left">Libelle</th>
                  <th className="px-2 py-2 text-left">Type</th>
                  <th className="px-2 py-2 text-left">Auto</th>
                  <th className="px-2 py-2 text-left w-16"></th>
                </tr>
              </thead>
              <tbody>
                {rules.map(rule => {
                  const config = getEntityConfig(rule.entity_type, allEntityTypes);
                  return (
                    <tr key={rule.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-2 py-2 font-mono font-medium">{rule.naf_code}</td>
                      <td className="px-2 py-2 text-gray-600">{rule.naf_label}</td>
                      <td className="px-2 py-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${config.color}`}>
                          {config.label}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        {rule.auto_import ? <span className="text-green-600">Oui</span> : <span className="text-gray-400">Non</span>}
                      </td>
                      <td className="px-2 py-2 flex gap-1">
                        <button
                          onClick={() => setEditingRule({ ...rule })}
                          className="text-indigo-500 hover:text-indigo-700 text-[10px]"
                        >
                          Modifier
                        </button>
                        <button
                          onClick={() => deleteRule(rule.id)}
                          className="text-red-400 hover:text-red-600"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Entries table */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
          <Building2 className="w-4 h-4 text-gray-500" />
          Resultats ({entries.length})
        </h2>

        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-2 py-2 text-left">Type</th>
                <th className="px-2 py-2 text-left">Nom</th>
                <th className="px-2 py-2 text-left">Ville</th>
                <th className="px-2 py-2 text-left">Dept</th>
                <th className="px-2 py-2 text-left">Telephone</th>
                <th className="px-2 py-2 text-left">SIRET</th>
                <th className="px-2 py-2 text-left">Pipeline</th>
                <th className="px-2 py-2 text-left">Source</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                    Aucune entite trouvee.
                  </td>
                </tr>
              ) : entries.map(entry => {
                const config = getEntityConfig(entry.entity_type, allEntityTypes);
                const Icon = config.icon;
                const handleClick = () => {
                  if (entry.source === 'client') {
                    navigate(`/clients?id=${entry.id}`);
                  } else {
                    navigate(`/prospects?id=${entry.id}`);
                  }
                };
                return (
                  <tr key={`${entry.source}-${entry.id}`} className="border-b border-gray-50 hover:bg-indigo-50 cursor-pointer transition-colors" onClick={handleClick}>
                    <td className="px-2 py-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium border inline-flex items-center gap-1 ${config.color}`}>
                        <Icon className="w-3 h-3" />
                        {config.label}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <p className="font-medium text-indigo-700 hover:text-indigo-900">{entry.nom}</p>
                      <p className="text-[10px] text-gray-400">{entry.type_etablissement}</p>
                    </td>
                    <td className="px-2 py-2 text-gray-600">
                      {entry.ville}
                      {entry.code_postal && <span className="text-gray-400 ml-1">({entry.code_postal})</span>}
                    </td>
                    <td className="px-2 py-2 text-gray-600">{entry.departement}</td>
                    <td className="px-2 py-2 text-gray-600">{entry.telephone}</td>
                    <td className="px-2 py-2 text-gray-400 font-mono text-[10px]">{entry.siret}</td>
                    <td className="px-2 py-2">
                      {entry.etape_pipeline && (
                        <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px]">
                          {entry.etape_pipeline}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                        entry.source === 'client' ? 'bg-green-100 text-green-700' : 'bg-sky-100 text-sky-700'
                      }`}>
                        {entry.source === 'client' ? 'Client' : 'Prospect'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
