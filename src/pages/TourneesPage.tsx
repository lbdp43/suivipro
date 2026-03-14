import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  MapPin, Save, Edit2, RefreshCw, ChevronDown, ChevronRight,
  User, Loader2, Info, Calendar, ArrowLeft, ArrowRight, ChevronLeft,
  X, Plus,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';

interface TourneeConfig {
  commercial_id: string;
  config: Record<string, string[]>;
  notes: string;
  tournee_info: string;
  week_pattern: string; // 'every' | 'even' | 'odd'
  updated_at: string;
}

interface CommercialInfo {
  id: string;
  prenom: string;
  nom: string;
  role: string;
}

const DAY_LABELS: Record<string, string> = {
  '1': 'Lundi', '2': 'Mardi', '3': 'Mercredi',
  '4': 'Jeudi', '5': 'Vendredi', '6': 'Samedi', '0': 'Dimanche',
};
const DAY_KEYS = ['1', '2', '3', '4', '5', '6', '0'];
const DAY_SHORT: Record<string, string> = {
  '1': 'Lun', '2': 'Mar', '3': 'Mer',
  '4': 'Jeu', '5': 'Ven', '6': 'Sam', '0': 'Dim',
};

const WEEK_PATTERN_LABELS: Record<string, string> = {
  every: 'Chaque semaine',
  even: 'Semaines paires',
  odd: 'Semaines impaires',
};

function ZoneDayPicker({ label, selected, allZones, onAdd, onRemove }: {
  label: string;
  selected: string[];
  allZones: string[];
  onAdd: (zone: string) => void;
  onRemove: (zone: string) => void;
}) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = allZones.filter(z =>
    !selected.includes(z) && z.toLowerCase().includes(input.toLowerCase())
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleAdd = (zone: string) => {
    onAdd(zone);
    setInput('');
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && input.trim()) {
      handleAdd(input.trim());
    }
  };

  return (
    <div ref={ref}>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {/* Selected zones as chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {selected.map(z => (
            <span key={z} className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs font-medium">
              {z}
              <button
                type="button"
                onClick={() => onRemove(z)}
                className="hover:text-indigo-900 ml-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {/* Input + dropdown */}
      <div className="relative">
        <input
          type="text"
          className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
          placeholder="Ajouter une zone..."
          value={input}
          onChange={e => { setInput(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
        {open && (filtered.length > 0 || input.trim()) && (
          <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {filtered.map(zone => (
              <button
                key={zone}
                type="button"
                onMouseDown={() => handleAdd(zone)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-50 text-gray-700 flex items-center gap-1.5"
              >
                <Plus className="w-3 h-3 text-indigo-500 flex-shrink-0" />
                {zone}
              </button>
            ))}
            {input.trim() && !allZones.includes(input.trim()) && !selected.includes(input.trim()) && (
              <button
                type="button"
                onMouseDown={() => handleAdd(input.trim())}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-green-50 text-green-700 flex items-center gap-1.5 border-t border-gray-100"
              >
                <Plus className="w-3 h-3 flex-shrink-0" />
                Créer "{input.trim()}"
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TourneesPage() {
  const { state } = useApp();
  const toast = useToast();
  const [configs, setConfigs] = useState<TourneeConfig[]>([]);
  const [commerciaux, setCommerciaux] = useState<CommercialInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editConfig, setEditConfig] = useState<Record<string, string[]>>({});
  const [editNotes, setEditNotes] = useState('');
  const [editInfo, setEditInfo] = useState('');
  const [editWeekPattern, setEditWeekPattern] = useState('every');
  const [saving, setSaving] = useState(false);
  const [expandedCommercials, setExpandedCommercials] = useState<Set<string>>(new Set());
  const [weekOffset, setWeekOffset] = useState(0);

  // Unique zones from clients
  const allZones = useMemo(() => {
    const set = new Set<string>();
    state.clients.forEach(c => { if (c.tournee) set.add(c.tournee); });
    return Array.from(set).sort();
  }, [state.clients]);

  const token = localStorage.getItem('suivipro_token');
  const isAdmin = state.currentUser?.role === 'admin';
  const currentUserId = state.currentUser?.id;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [configsRes, commerciauxRes] = await Promise.all([
        fetch('/api/tournee-config', { headers }),
        fetch('/api/data', { headers }),
      ]);
      if (configsRes.ok) {
        const rows = await configsRes.json();
        const parsed = rows.map((r: any) => ({
          ...r,
          config: typeof r.config === 'string' ? JSON.parse(r.config) : r.config,
        }));
        setConfigs(parsed);
        // Auto-expand all commercials
        setExpandedCommercials(new Set(parsed.map((c: TourneeConfig) => c.commercial_id)));
      }
      if (commerciauxRes.ok) {
        const data = await commerciauxRes.json();
        setCommerciaux(data.commerciaux || []);
      }
    } catch (err) {
      console.error('Erreur chargement tournees:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const startEdit = () => {
    const myConfig = configs.find(c => c.commercial_id === currentUserId);
    setEditConfig(myConfig?.config || {});
    setEditNotes(myConfig?.notes || '');
    setEditInfo(myConfig?.tournee_info || '');
    setEditWeekPattern(myConfig?.week_pattern || 'every');
    setEditing(true);
  };

  const saveMyConfig = async () => {
    if (!currentUserId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tournee-config/${currentUserId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          config: editConfig,
          notes: editNotes,
          tournee_info: editInfo,
          week_pattern: editWeekPattern,
        }),
      });
      if (res.ok) {
        toast.success('Tournees sauvegardees');
        setEditing(false);
        loadData();
      }
    } catch {
      toast.error('Erreur sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const updateDayTournees = (day: string, value: string) => {
    const tournees = value.split(',').map(s => s.trim()).filter(Boolean);
    setEditConfig(prev => ({ ...prev, [day]: tournees }));
  };

  const addZoneToDay = (day: string, zone: string) => {
    const trimmed = zone.trim();
    if (!trimmed) return;
    setEditConfig(prev => {
      const current = prev[day] || [];
      if (current.includes(trimmed)) return prev;
      return { ...prev, [day]: [...current, trimmed] };
    });
  };

  const removeZoneFromDay = (day: string, zone: string) => {
    setEditConfig(prev => ({
      ...prev,
      [day]: (prev[day] || []).filter(z => z !== zone),
    }));
  };

  const toggleCommercial = (id: string) => {
    setExpandedCommercials(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Get week number for target week (current + offset)
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + weekOffset * 7);
  const dayOfWeekT = targetDate.getDay() || 7;
  const targetMonday = new Date(targetDate);
  targetMonday.setDate(targetDate.getDate() - dayOfWeekT + 1);
  const currentWeekNum = Math.ceil(
    (Math.floor((targetMonday.getTime() - new Date(targetMonday.getFullYear(), 0, 1).getTime()) / 86400000) + 1) / 7
  );
  const isEvenWeek = currentWeekNum % 2 === 0;
  const isCurrentWeek = weekOffset === 0;

  const formatWeekRange = () => {
    const end = new Date(targetMonday);
    end.setDate(targetMonday.getDate() + 6);
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    return `${targetMonday.toLocaleDateString('fr-FR', opts)} - ${end.toLocaleDateString('fr-FR', opts)}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Chargement...</span>
      </div>
    );
  }

  const commercials = commerciaux.filter(c => c.role === 'commercial' || c.role === 'admin');
  const prospecteurs = commerciaux.filter(c => c.role === 'prospection');
  const isProspection = state.currentUser?.role === 'prospection';

  const renderCommercialCard = (commercial: CommercialInfo, readOnly = false) => {
    const config = configs.find(c => c.commercial_id === commercial.id);
    const hasConfig = config && Object.keys(config.config).some(k => (config.config[k] || []).length > 0);
    const isExpanded = expandedCommercials.has(commercial.id);
    const isMe = commercial.id === currentUserId;
    const weekPattern = config?.week_pattern || 'every';
    const isActiveThisWeek = weekPattern === 'every' ||
      (weekPattern === 'even' && isEvenWeek) ||
      (weekPattern === 'odd' && !isEvenWeek);

    return (
      <div key={commercial.id} className={`bg-white rounded-xl border transition-shadow ${
        isMe ? 'border-brewery-300 shadow-sm' : 'border-gray-200'
      } ${!isActiveThisWeek ? 'opacity-60' : ''}`}>
        <button
          onClick={() => toggleCommercial(commercial.id)}
          className="w-full flex items-center justify-between px-3 sm:px-4 py-3 text-left hover:bg-gray-50 rounded-xl"
        >
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
              commercial.role === 'prospection' ? 'bg-emerald-100' : 'bg-indigo-100'
            }`}>
              <User className={`w-4 h-4 ${commercial.role === 'prospection' ? 'text-emerald-700' : 'text-indigo-700'}`} />
            </div>
            <div className="min-w-0">
              <p className="font-medium text-gray-900 text-sm truncate">
                {commercial.prenom} {commercial.nom}
                {isMe && <span className="text-brewery-600 ml-1">(moi)</span>}
                {readOnly && !isMe && <span className="text-gray-400 ml-1 text-xs">(lecture seule)</span>}
              </p>
              <p className="text-[10px] text-gray-500">
                {WEEK_PATTERN_LABELS[weekPattern]}
                {!isActiveThisWeek && ' — pas cette semaine'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {hasConfig ? (
              <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-medium hidden sm:inline">
                Configure
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full font-medium hidden sm:inline">
                Non configure
              </span>
            )}
          </div>
        </button>

        {isExpanded && (
          <div className="px-3 sm:px-4 pb-3 sm:pb-4">
            {config?.tournee_info && (
              <div className="flex items-start gap-2 p-2 sm:p-3 bg-blue-50 border border-blue-100 rounded-lg mb-3 text-xs sm:text-sm text-blue-800">
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <p>{config.tournee_info}</p>
              </div>
            )}

            {hasConfig ? (
              <>
                {/* Mobile: vertical list */}
                <div className="sm:hidden space-y-1.5">
                  {DAY_KEYS.map(day => {
                    const zones = config?.config[day] || [];
                    if (zones.length === 0) return null;
                    return (
                      <div key={day} className="flex items-center gap-2 py-1.5 px-2 bg-indigo-50 rounded-lg">
                        <span className="text-xs font-semibold text-gray-600 w-8">{DAY_SHORT[day]}</span>
                        <div className="flex flex-wrap gap-1">
                          {zones.map((z, i) => (
                            <span key={i} className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded font-medium">{z}</span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop: grid */}
                <div className="hidden sm:grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2">
                  {DAY_KEYS.map(day => {
                    const zones = config?.config[day] || [];
                    return (
                      <div key={day} className={`p-2 rounded-lg text-center ${zones.length > 0 ? 'bg-indigo-50 border border-indigo-100' : 'bg-gray-50 border border-gray-100'}`}>
                        <p className="text-[10px] font-medium text-gray-500 mb-1">{DAY_LABELS[day]}</p>
                        {zones.length > 0 ? (
                          <div className="space-y-0.5">
                            {zones.map((z, i) => (
                              <span key={i} className="block text-xs font-medium text-indigo-700">{z}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-400 italic py-2">Aucune tournee configuree</p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 fade-in max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <MapPin className="w-5 h-5 sm:w-6 sm:h-6" />
            Tournees
          </h1>
        </div>
        <div className="flex gap-2">
          <button onClick={loadData} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            <RefreshCw className="w-4 h-4" />
          </button>
          {!editing && (
            <button
              onClick={startEdit}
              className="px-3 py-2 sm:px-4 bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2 text-sm font-medium"
            >
              <Edit2 className="w-4 h-4" /> Mes tournees
            </button>
          )}
        </div>
      </div>

      {/* Week navigator */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 flex items-center justify-between gap-2">
        <button
          onClick={() => setWeekOffset(prev => prev - 1)}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
          title="Semaine precedente"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex-1 text-center">
          <div className="flex items-center justify-center gap-2">
            <p className="font-semibold text-gray-900 text-sm sm:text-base">
              Semaine {currentWeekNum}
            </p>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
              {isEvenWeek ? 'paire' : 'impaire'}
            </span>
            {isCurrentWeek && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brewery-100 text-brewery-700 font-medium">
                Cette semaine
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {formatWeekRange()}
          </p>
        </div>

        <button
          onClick={() => setWeekOffset(prev => prev + 1)}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
          title="Semaine suivante"
        >
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>

      {!isCurrentWeek && (
        <button
          onClick={() => setWeekOffset(0)}
          className="w-full py-2 text-sm font-medium text-brewery-600 bg-brewery-50 hover:bg-brewery-100 rounded-lg border border-brewery-200 transition-colors flex items-center justify-center gap-2"
        >
          <ChevronLeft className="w-4 h-4" />
          Revenir a la semaine en cours
        </button>
      )}

      {/* My tournée edit form */}
      {editing && (
        <div className="bg-white rounded-xl border-2 border-brewery-300 p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Configurer mes tournees</h3>
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">
                Annuler
              </button>
              <button
                onClick={saveMyConfig}
                disabled={saving}
                className="px-3 py-1.5 text-sm font-medium text-white bg-brewery-600 hover:bg-brewery-700 rounded-lg flex items-center gap-1 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Sauvegarder
              </button>
            </div>
          </div>

          {/* Week pattern */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Frequence</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(WEEK_PATTERN_LABELS).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setEditWeekPattern(key)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    editWeekPattern === key
                      ? 'bg-brewery-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Day config */}
          {allZones.length > 0 && (
            <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
              <p className="text-xs font-medium text-blue-700 mb-2">Zones existantes dans vos clients :</p>
              <div className="flex flex-wrap gap-1.5">
                {allZones.map(zone => (
                  <span key={zone} className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full border border-blue-200 font-medium">
                    {zone}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {DAY_KEYS.map(day => (
              <ZoneDayPicker
                key={day}
                label={DAY_LABELS[day]}
                selected={editConfig[day] || []}
                allZones={allZones}
                onAdd={zone => addZoneToDay(day, zone)}
                onRemove={zone => removeZoneFromDay(day, zone)}
              />
            ))}
          </div>

          {/* Info tournée (visible par les prospecteurs) */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Info tournee <span className="text-gray-400 font-normal">(visible par toute l'equipe)</span>
            </label>
            <textarea
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              rows={2}
              value={editInfo}
              onChange={e => setEditInfo(e.target.value)}
              placeholder="Ex: Je passe en priorite sur Lyon centre le mardi matin..."
            />
          </div>

          {/* Notes privées */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Notes personnelles <span className="text-gray-400 font-normal">(privees)</span>
            </label>
            <textarea
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              rows={2}
              value={editNotes}
              onChange={e => setEditNotes(e.target.value)}
              placeholder="Notes personnelles..."
            />
          </div>
        </div>
      )}

      {/* Commerciaux section */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-indigo-500" />
          Commerciaux
        </h2>
        {commercials.map(c => renderCommercialCard(c, isProspection))}
        {commercials.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
            <p className="text-sm text-gray-500">Aucun commercial</p>
          </div>
        )}
      </div>

      {/* Prospection section */}
      {prospecteurs.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            Prospection
          </h2>
          {prospecteurs.map(c => renderCommercialCard(c, !isProspection && !isAdmin))}
        </div>
      )}
    </div>
  );
}
