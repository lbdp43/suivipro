// Tournées, secteurs, fréquence de visite — onglet de la page Administration, extrait tel quel.
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { sansAccents } from '../../../shared/normalisation';
import { lireConfigTournee } from '../../../shared/tournee';
import { Plus, X, Save, Edit2, Trash2, User, RefreshCw, Loader2, MapPin, Globe, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CLIENT_TYPE_LABELS, CLIENT_TYPE_FAMILIES, CLIENT_VISIT_FREQUENCIES } from '../../types';
import { useApp } from '../../store/AppContext';
import { useToast } from '../../components/Toast';
import { apiFetch } from '../../api/client';

function AdminZonePicker({ label, selected, allZones, onAdd, onRemove }: {
  label: string;
  selected: string[];
  allZones: string[];
  onAdd: (zone: string) => void;
  onRemove: (zone: string) => void;
}) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const filtered = allZones.filter(z => !selected.includes(z) && z.toLowerCase().includes(input.toLowerCase()));

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleAdd = (zone: string) => { onAdd(zone); setInput(''); setOpen(false); };

  return (
    <div ref={ref}>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {selected.map(z => (
            <span key={z} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-[10px] font-medium">
              {z}
              <button type="button" onClick={() => onRemove(z)} className="hover:text-indigo-900"><X className="w-2.5 h-2.5" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          type="text"
          className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-brewery-500"
          placeholder="Ajouter une zone..."
          value={input}
          onChange={e => { setInput(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => { if (e.key === 'Enter' && input.trim()) handleAdd(input.trim()); }}
        />
        {open && (filtered.length > 0 || input.trim()) && (
          <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
            {filtered.map(zone => (
              <button key={zone} type="button" onMouseDown={() => handleAdd(zone)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-50 text-gray-700 flex items-center gap-1.5">
                <Plus className="w-3 h-3 text-indigo-500 flex-shrink-0" />{zone}
              </button>
            ))}
            {input.trim() && !allZones.includes(input.trim()) && !selected.includes(input.trim()) && (
              <button type="button" onMouseDown={() => handleAdd(input.trim())}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-green-50 text-green-700 flex items-center gap-1.5 border-t border-gray-100">
                <Plus className="w-3 h-3 flex-shrink-0" />Créer "{input.trim()}"
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function OngletTournees() {
  const { state, stateComplet, dispatchLocal } = useApp();
  const toast = useToast();
  const activeTab = 'tournees' as const; // l'onglet n'est monté que lorsqu'il est actif

  // Tournee config state
  const [tourneeConfigs, setTourneeConfigs] = useState<Record<string, { config: Record<string, string[]>; notes: string; tournee_info: string; week_pattern: string }>>({});

  const [tourneeEditing, setTourneeEditing] = useState<string | null>(null);

  const [tourneeEditConfig, setTourneeEditConfig] = useState<Record<string, string[]>>({});

  const [tourneeEditNotes, setTourneeEditNotes] = useState('');

  const [tourneeEditInfo, setTourneeEditInfo] = useState('');

  const [tourneeEditWeekPattern, setTourneeEditWeekPattern] = useState('every');

  const [tourneeSaving, setTourneeSaving] = useState(false);

  // Recurrence config state
  const [frequencyConfig, setFrequencyConfig] = useState<Record<string, number | null>>({});

  const [frequencyEditing, setFrequencyEditing] = useState(false);

  const [frequencyEditValues, setFrequencyEditValues] = useState<Record<string, string>>({});

  const [frequencySaving, setFrequencySaving] = useState(false);

  const DAY_LABELS: Record<string, string> = { '1': 'Lundi', '2': 'Mardi', '3': 'Mercredi', '4': 'Jeudi', '5': 'Vendredi', '6': 'Samedi', '0': 'Dimanche' };

  const DAY_KEYS = ['1', '2', '3', '4', '5', '6', '0'];

  const WEEK_PATTERN_LABELS: Record<string, string> = { every: 'Chaque semaine', even: 'Semaines paires', odd: 'Semaines impaires' };

  // Placement des fiches : sans coordonnées, hors zone. Géocodage des manquantes à la demande.
  interface CompteGeo { total: number; sans_coordonnees: number; hors_zone: number; sans_adresse: number }
  interface EtatGeo { prospects: CompteGeo; clients: CompteGeo; zones: { n: number; prioritaires: number } }
  const [etatGeo, setEtatGeo] = useState<EtatGeo | null>(null);
  const [geoEnCours, setGeoEnCours] = useState<'' | 'geocoder' | 'rattacher'>('');
  const [geoBilan, setGeoBilan] = useState<string>('');
  const chargerEtatGeo = useCallback(async () => {
    try { const r = await apiFetch('/geo/etat'); if (r.ok) setEtatGeo(await r.json()); } catch { /* silencieux */ }
  }, []);
  useEffect(() => { chargerEtatGeo(); }, [chargerEtatGeo]);
  const geocoderManquants = async () => {
    setGeoEnCours('geocoder'); setGeoBilan('');
    try {
      const r = await apiFetch('/geo/geocoder-manquants', { method: 'POST', body: JSON.stringify({ limite: 150 }) });
      if (!r.ok) { toast.error('Erreur pendant le géocodage'); return; }
      const b = await r.json();
      setEtatGeo(b.etat);
      setGeoBilan(`${b.geocodes} fiche(s) placée(s), ${b.echecs} adresse(s) introuvable(s)${b.restants ? `, ${b.restants} restante(s) : relancez` : ''}.`);
      toast.success(`${b.geocodes} fiche(s) placée(s)`);
    } catch { toast.error('Erreur réseau'); }
    finally { setGeoEnCours(''); }
  };
  const rattacherZones = async () => {
    setGeoEnCours('rattacher'); setGeoBilan('');
    try {
      const r = await apiFetch('/geo/rattacher', { method: 'POST' });
      if (!r.ok) { toast.error('Erreur pendant le rattachement'); return; }
      const b = await r.json();
      setEtatGeo(b.etat);
      setGeoBilan(`${b.prospects_modifies} prospect(s) et ${b.clients_modifies} client(s) mis à jour.`);
      toast.success('Zones recalculées');
    } catch { toast.error('Erreur réseau'); }
    finally { setGeoEnCours(''); }
  };

  // Secteurs et tournées vides : analyse puis suppression (recomptée côté serveur).
  interface SecteurAnalyse { cle: string; nom: string; clients: number; prospects: number; meme_ville: number; dans_polygone: number; vide: boolean; configs: { commercial: string; jour: string }[]; zones: { id: string; commercial: string; points: number }[] }

  const [secteursAnalyse, setSecteursAnalyse] = useState<{ secteurs: SecteurAnalyse[]; vides: number; total: number } | null>(null);

  const [secteursLoading, setSecteursLoading] = useState(false);

  const [secteursCoches, setSecteursCoches] = useState<Set<string>>(new Set());

  const analyserSecteurs = async () => {
    setSecteursLoading(true);
    try {
      const res = await apiFetch('/tournees/vides');
      if (!res.ok) { toast.error('Erreur lors de l\'analyse des secteurs'); return; }
      const data = await res.json();
      setSecteursAnalyse(data);
      setSecteursCoches(new Set(data.secteurs.filter((s: SecteurAnalyse) => s.vide).map((s: SecteurAnalyse) => s.cle)));
    } catch { toast.error('Erreur réseau'); }
    finally { setSecteursLoading(false); }
  };

  const [fusionCible, setFusionCible] = useState('');

  const fusionnerSecteurs = async () => {
    if (!secteursAnalyse) return;
    const cible = fusionCible.trim();
    const sources = secteursAnalyse.secteurs.filter(s => secteursCoches.has(s.cle) && s.cle !== cible.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    if (!cible || sources.length === 0) { toast.error('Cochez au moins un secteur à fusionner et choisissez le secteur cible'); return; }
    const total = sources.reduce((n, s) => n + s.clients + s.prospects, 0);
    if (!confirm(`Fusionner ${sources.map(s => `« ${s.nom} »`).join(', ')} dans « ${cible} » ?\n\n${total} fiche(s) (clients et prospects) changeront de secteur ; les jours de tournée et les zones dessinées seront renommés. Rien n'est supprimé.`)) return;
    try {
      const res = await apiFetch('/tournees/fusionner', {
        method: 'POST',
        body: JSON.stringify({ sources: sources.map(s => s.cle), cible }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(r.error || 'Fusion impossible'); return; }
      // Mise à jour immédiate de l'état local (le polling confirmera).
      const normaliser = sansAccents;
      const cles = new Set(sources.map(s => s.cle));
      const maintenant = new Date().toISOString();
      for (const c of stateComplet.clients) if (cles.has(normaliser(c.tournee))) dispatchLocal({ type: 'UPDATE_CLIENT', payload: { ...c, tournee: cible, date_modification: maintenant } });
      for (const p of stateComplet.prospects) if (cles.has(normaliser(p.secteur))) dispatchLocal({ type: 'UPDATE_PROSPECT', payload: { ...p, secteur: cible, date_modification: maintenant } });
      toast.success(`Fusion faite : ${r.clients} client(s), ${r.prospects} prospect(s), ${r.configs} tournée(s), ${r.zones} zone(s) renommée(s)`);
      setFusionCible('');
      await loadTourneeConfigs();
      await analyserSecteurs();
    } catch { toast.error('Erreur réseau'); }
  };

  const supprimerSecteursVides = async () => {
    if (!secteursAnalyse) return;
    const choisis = secteursAnalyse.secteurs.filter(s => s.vide && secteursCoches.has(s.cle));
    if (choisis.length === 0) return;
    if (!confirm(`Supprimer ${choisis.length} secteur(s) vide(s) ?\n\n${choisis.map(s => `• ${s.nom}`).join('\n')}\n\nIls seront retirés des tournées et les zones dessinées correspondantes effacées. Aucun client ni prospect n'est touché (il n'y en a aucun dedans, c'est revérifié au moment de supprimer).`)) return;
    try {
      const res = await apiFetch('/tournees/vides/supprimer', {
        method: 'POST',
        body: JSON.stringify({ cles: choisis.map(s => s.cle) }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(r.error || 'Suppression impossible'); return; }
      toast.success(`${r.supprimes.length} secteur(s) supprimé(s)${r.refuses?.length ? ` · ${r.refuses.length} refusé(s) (plus vide)` : ''}`);
      await loadTourneeConfigs();
      await analyserSecteurs();
    } catch { toast.error('Erreur réseau'); }
  };

  const loadTourneeConfigs = useCallback(async () => {
    try {
      const res = await apiFetch('/tournee-config');
      if (res.ok) {
        const rows = await res.json();
        const configs: Record<string, { config: Record<string, string[]>; notes: string; tournee_info: string; week_pattern: string }> = {};
        for (const row of rows) {
          let parsed = {};
          parsed = lireConfigTournee(row.config);
          configs[row.commercial_id] = {
            config: parsed as Record<string, string[]>,
            notes: row.notes || '',
            tournee_info: row.tournee_info || '',
            week_pattern: row.week_pattern || 'every',
          };
        }
        setTourneeConfigs(configs);
      }
    } catch (err) {
      console.error('Erreur chargement tournées:', err);
    }
  }, []);

  const loadFrequencyConfig = useCallback(async () => {
    try {
      const res = await apiFetch('/visit-frequency-config');
      if (res.ok) {
        const rows = await res.json();
        const config: Record<string, number | null> = {};
        for (const row of rows) {
          config[row.type_client] = row.frequency_days;
        }
        setFrequencyConfig(config);
      }
    } catch (err) {
      console.error('Erreur chargement fréquences:', err);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'tournees') {
      loadTourneeConfigs();
      loadFrequencyConfig();
    }
  }, [activeTab, loadTourneeConfigs, loadFrequencyConfig]);

  const startEditTournee = (commercialId: string) => {
    const existing = tourneeConfigs[commercialId];
    setTourneeEditing(commercialId);
    setTourneeEditConfig(existing?.config ? { ...existing.config } : {});
    setTourneeEditNotes(existing?.notes || '');
    setTourneeEditInfo(existing?.tournee_info || '');
    setTourneeEditWeekPattern(existing?.week_pattern || 'every');
  };

  const saveTourneeConfig = async (commercialId: string) => {
    setTourneeSaving(true);
    try {
      await apiFetch(`/tournee-config/${commercialId}`, { method: 'POST', body: JSON.stringify({
          config: tourneeEditConfig,
          notes: tourneeEditNotes,
          tournee_info: tourneeEditInfo,
          week_pattern: tourneeEditWeekPattern,
        }),
      });
      setTourneeConfigs(prev => ({
        ...prev,
        [commercialId]: {
          config: { ...tourneeEditConfig },
          notes: tourneeEditNotes,
          tournee_info: tourneeEditInfo,
          week_pattern: tourneeEditWeekPattern,
        },
      }));
      setTourneeEditing(null);
      toast.success('Tournées sauvegardees');
    } catch (err) {
      toast.error('Erreur sauvegarde tournées');
    } finally {
      setTourneeSaving(false);
    }
  };

  const addZoneToDay = (day: string, zone: string) => {
    const trimmed = zone.trim();
    if (!trimmed) return;
    setTourneeEditConfig(prev => {
      const current = prev[day] || [];
      if (current.includes(trimmed)) return prev;
      return { ...prev, [day]: [...current, trimmed] };
    });
  };

  const removeZoneFromDay = (day: string, zone: string) => {
    setTourneeEditConfig(prev => ({
      ...prev,
      [day]: (prev[day] || []).filter(z => z !== zone),
    }));
  };

  const allZones = useMemo(() => {
    const set = new Set<string>();
    state.clients.forEach(c => { if (c.tournee) set.add(c.tournee); });
    return Array.from(set).sort();
  }, [state.clients]);

  const startEditFrequency = () => {
    const values: Record<string, string> = {};
    for (const type of Object.keys(CLIENT_TYPE_LABELS)) {
      const dbVal = frequencyConfig[type];
      const defaultVal = (CLIENT_VISIT_FREQUENCIES as Record<string, number | null>)[type];
      values[type] = String(dbVal ?? defaultVal ?? '');
    }
    setFrequencyEditValues(values);
    setFrequencyEditing(true);
  };

  const saveFrequencyConfig = async (applyToExisting = false) => {
    setFrequencySaving(true);
    try {
      const frequencies: Record<string, number | null> = {};
      for (const [type, val] of Object.entries(frequencyEditValues)) {
        frequencies[type] = val === '' ? null : parseInt(val, 10);
      }
      await apiFetch('/visit-frequency-config', { method: 'PUT', body: JSON.stringify({ frequencies, apply_to_existing: applyToExisting }),
      });
      setFrequencyConfig(frequencies);
      setFrequencyEditing(false);
      toast.success(applyToExisting ? 'Récurrences sauvegardees et appliquees aux clients existants' : 'Récurrences sauvegardees');
    } catch {
      toast.error('Erreur sauvegarde récurrences');
    } finally {
      setFrequencySaving(false);
    }
  };

  return (
    <>
        <div className="space-y-4 sm:space-y-6">
          {/* Géocodage et zones */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
              <Globe className="w-4 h-4" /> Placement des fiches et zones
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              Une fiche sans coordonnées n'apparaît pas sur la carte et ne peut pas être rattachée à une zone. Le géocodage place les
              fiches qui ont une adresse (150 par passage, service public api-adresse). Les zones se dessinent sur la <Link to="/carte" className="underline">Carte</Link> ;
              chaque fiche géolocalisée est rattachée à la zone qui la contient, et le secteur d'un prospect prend le nom de sa zone s'il était vide.
            </p>
            {etatGeo ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                {(['prospects', 'clients'] as const).map(k => { const c = etatGeo[k]; return (
                  <div key={k} className="rounded-lg border border-gray-100 p-3">
                    <p className="text-xs font-semibold text-gray-700 capitalize mb-1">{k} · {c.total}</p>
                    <p className={`text-sm ${c.sans_coordonnees ? 'text-amber-700' : 'text-green-700'}`}>{c.sans_coordonnees} sans coordonnées{c.sans_adresse ? <span className="text-[11px] text-gray-400"> (dont {c.sans_adresse} sans adresse)</span> : null}</p>
                    <p className={`text-sm ${c.hors_zone ? 'text-amber-700' : 'text-gray-500'}`}>{c.hors_zone} hors zone</p>
                  </div>); })}
                <div className="rounded-lg border border-gray-100 p-3">
                  <p className="text-xs font-semibold text-gray-700 mb-1">Zones dessinées · {etatGeo.zones.n}</p>
                  <p className="text-sm text-red-700 flex items-center gap-1"><Star className="w-3.5 h-3.5 fill-current" /> {etatGeo.zones.prioritaires} prioritaire(s)</p>
                </div>
              </div>
            ) : <p className="text-sm text-gray-400 mb-3">Chargement…</p>}
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={geocoderManquants} disabled={!!geoEnCours || !etatGeo || (etatGeo.prospects.sans_coordonnees - etatGeo.prospects.sans_adresse + etatGeo.clients.sans_coordonnees - etatGeo.clients.sans_adresse) === 0} className="px-3 py-2 bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 text-sm disabled:opacity-50 flex items-center gap-1.5">
                {geoEnCours === 'geocoder' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />} Géocoder les manquants
              </button>
              <button onClick={rattacherZones} disabled={!!geoEnCours} className="px-3 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 text-sm disabled:opacity-50 flex items-center gap-1.5">
                {geoEnCours === 'rattacher' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Recalculer les zones
              </button>
              {geoBilan && <span className="text-xs text-gray-600">{geoBilan}</span>}
            </div>
          </div>

          {/* Secteurs vides */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
              <MapPin className="w-4 h-4" /> Secteurs et tournées vides
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              Passe en revue tous les secteurs connus (jours de tournée, zones de prospection, zones dessinées sur la carte)
              et compte pour chacun les clients (champ tournée), les prospects (champ secteur), les fiches dont la ville porte
              ce nom, et les fiches géolocalisées dans la zone. Un secteur sans rien peut être supprimé : il est retiré des tournées et sa zone effacée,
              sans toucher aux fiches. Cochez plusieurs secteurs et choisissez une cible pour les <b>fusionner</b> : toutes leurs fiches, jours de
              tournée et zones dessinées prennent le nom de la cible.
            </p>
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <button onClick={analyserSecteurs} disabled={secteursLoading} className="px-3 py-2 bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 text-sm disabled:opacity-50">
                {secteursLoading ? 'Analyse…' : secteursAnalyse ? 'Relancer l\'analyse' : 'Analyser les secteurs'}
              </button>
              {secteursAnalyse && secteursAnalyse.vides > 0 && (
                <button onClick={supprimerSecteursVides} disabled={secteursAnalyse.secteurs.filter(s => s.vide && secteursCoches.has(s.cle)).length === 0} className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm disabled:opacity-50 flex items-center gap-1">
                  <Trash2 className="w-3.5 h-3.5" /> Supprimer les secteurs vides cochés ({secteursAnalyse.secteurs.filter(s => s.vide && secteursCoches.has(s.cle)).length})
                </button>
              )}
            </div>
            {secteursAnalyse && secteursAnalyse.total > 1 && (
              <div className="flex items-center gap-2 flex-wrap mb-3 p-3 rounded-lg bg-gray-50 border border-gray-200">
                <span className="text-xs font-medium text-gray-700">Fusionner les secteurs cochés ({secteursCoches.size}) dans :</span>
                <input list="secteurs-cibles" value={fusionCible} onChange={e => setFusionCible(e.target.value)} placeholder="Nom du secteur cible…" className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white min-w-[200px]" />
                <datalist id="secteurs-cibles">{secteursAnalyse.secteurs.map(s => <option key={s.cle} value={s.nom} />)}</datalist>
                <button onClick={fusionnerSecteurs} disabled={secteursCoches.size === 0 || !fusionCible.trim()} className="px-3 py-1.5 bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 text-sm disabled:opacity-50">Fusionner</button>
                <span className="text-[11px] text-gray-400">La cible peut être un secteur existant ou un nouveau nom.</span>
              </div>
            )}
            {secteursAnalyse && (
              <div>
                <div className="flex gap-3 mb-3 text-sm flex-wrap">
                  <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">{secteursAnalyse.total} secteur(s) connu(s)</span>
                  <span className={`px-2 py-1 rounded ${secteursAnalyse.vides ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{secteursAnalyse.vides} vide(s)</span>
                </div>
                {secteursAnalyse.total === 0 ? <p className="text-sm text-gray-500">Aucun secteur configuré.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[640px]">
                      <thead><tr className="text-left text-gray-500 border-b border-gray-100">
                        <th className="py-2 pr-2 w-6"></th><th className="py-2 pr-2 font-medium">Secteur</th><th className="py-2 px-2 font-medium text-center">Clients</th><th className="py-2 px-2 font-medium text-center">Prospects</th><th className="py-2 px-2 font-medium text-center">Même ville</th><th className="py-2 px-2 font-medium text-center">Dans la zone</th><th className="py-2 px-2 font-medium">Où il est utilisé</th>
                      </tr></thead>
                      <tbody>
                        {secteursAnalyse.secteurs.map(s => (
                          <tr key={s.cle} className={`border-b border-gray-50 last:border-0 ${s.vide ? 'bg-amber-50/50' : ''}`}>
                            <td className="py-2 pr-2"><input type="checkbox" checked={secteursCoches.has(s.cle)} onChange={e => setSecteursCoches(prev => { const n = new Set(prev); if (e.target.checked) n.add(s.cle); else n.delete(s.cle); return n; })} title={s.vide ? 'Cocher pour supprimer ou fusionner' : 'Cocher pour fusionner'} /></td>
                            <td className="py-2 pr-2 font-semibold text-gray-800">{s.nom}{s.vide && <span className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">vide</span>}</td>
                            <td className={`py-2 px-2 text-center tabular-nums ${s.clients ? 'text-gray-800' : 'text-gray-400'}`}>{s.clients}</td>
                            <td className={`py-2 px-2 text-center tabular-nums ${s.prospects ? 'text-gray-800' : 'text-gray-400'}`}>{s.prospects}</td>
                            <td className={`py-2 px-2 text-center tabular-nums ${s.meme_ville ? 'text-gray-800' : 'text-gray-400'}`} title="Fiches dont la ville porte ce nom : par prudence, le secteur n'est pas considéré vide">{s.meme_ville}</td>
                            <td className={`py-2 px-2 text-center tabular-nums ${s.dans_polygone ? 'text-gray-800' : 'text-gray-400'}`}>{s.zones.length ? s.dans_polygone : '—'}</td>
                            <td className="py-2 px-2 text-gray-500">
                              {s.configs.map((c, i) => <span key={i} className="inline-block mr-1.5">{c.commercial} · {c.jour}</span>)}
                              {s.zones.map(z => <span key={z.id} className="inline-block mr-1.5">zone carte de {z.commercial}</span>)}
                              {s.configs.length === 0 && s.zones.length === 0 && <span className="italic">nulle part (seulement sur des fiches)</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Recurrence config */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
              <div>
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4" /> Récurrence des visites par type de client
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">Nombre de jours entre chaque visite (vide = pas de recurrence)</p>
              </div>
              {!frequencyEditing ? (
                <button
                  onClick={startEditFrequency}
                  className="px-3 py-1.5 text-xs font-medium text-brewery-600 hover:bg-brewery-50 rounded-lg flex items-center gap-1 self-start"
                >
                  <Edit2 className="w-3.5 h-3.5" /> Modifier
                </button>
              ) : (
                <div className="flex gap-2 self-start">
                  <button onClick={() => setFrequencyEditing(false)} className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 rounded-lg">
                    Annuler
                  </button>
                  <button
                    onClick={() => saveFrequencyConfig(false)}
                    disabled={frequencySaving}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-brewery-600 hover:bg-brewery-700 rounded-lg flex items-center gap-1 disabled:opacity-50"
                  >
                    {frequencySaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Sauvegarder
                  </button>
                  <button
                    onClick={() => saveFrequencyConfig(true)}
                    disabled={frequencySaving}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg flex items-center gap-1 disabled:opacity-50"
                    title="Recalculer next_visit pour tous les clients existants"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Appliquer aux clients
                  </button>
                </div>
              )}
            </div>

            {frequencyEditing ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {Object.entries(CLIENT_TYPE_FAMILIES).map(([key, family]) => (
                  <div key={key} className="space-y-2">
                    <p className="text-xs font-semibold text-gray-700">{family.label}</p>
                    {family.types.map(type => (
                      <div key={type} className="flex items-center gap-2">
                        <label className="text-xs text-gray-600 flex-1 truncate">{CLIENT_TYPE_LABELS[type]}</label>
                        <input
                          type="number"
                          min="0"
                          className="w-16 px-2 py-1 border border-gray-200 rounded text-sm text-center"
                          value={frequencyEditValues[type] ?? ''}
                          onChange={e => setFrequencyEditValues(prev => ({ ...prev, [type]: e.target.value }))}
                          placeholder="-"
                        />
                        <span className="text-[10px] text-gray-400">jours</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                {Object.entries(CLIENT_TYPE_FAMILIES).map(([key, family]) => (
                  <div key={key} className="space-y-1">
                    <p className="text-xs font-semibold text-gray-700">{family.label}</p>
                    {family.types.map(type => {
                      const dbVal = frequencyConfig[type];
                      const defaultVal = (CLIENT_VISIT_FREQUENCIES as Record<string, number | null>)[type];
                      const val = dbVal ?? defaultVal;
                      const isCustom = dbVal != null && dbVal !== defaultVal;
                      return (
                        <div key={type} className="flex items-center justify-between text-xs py-0.5">
                          <span className="text-gray-600 truncate">{CLIENT_TYPE_LABELS[type]}</span>
                          <span className={`font-medium ${isCustom ? 'text-brewery-600' : val == null ? 'text-gray-400' : 'text-gray-700'}`}>
                            {val != null ? `${val}j` : '-'}
                            {isCustom && <span className="text-[10px] ml-0.5">*</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tournées par commercial */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">Tournées par commercial</h3>
          </div>

          {state.commerciaux.filter(c => c.role !== 'prospection').map(commercial => {
            const isEditing = tourneeEditing === commercial.id;
            const config = tourneeConfigs[commercial.id];
            const hasConfig = config && Object.keys(config.config).some(k => (config.config[k] || []).length > 0);

            return (
              <div key={commercial.id} className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="w-8 h-8 bg-brewery-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-brewery-700" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-medium text-gray-900 text-sm">{commercial.prenom} {commercial.nom}</h4>
                      <p className="text-[10px] text-gray-500 truncate">{commercial.email}</p>
                      {config && (
                        <p className="text-[10px] text-gray-400">{WEEK_PATTERN_LABELS[config.week_pattern || 'every']}</p>
                      )}
                    </div>
                  </div>
                  {!isEditing ? (
                    <button
                      onClick={() => startEditTournee(commercial.id)}
                      className="px-3 py-1.5 text-xs font-medium text-brewery-600 hover:bg-brewery-50 rounded-lg flex items-center gap-1 self-start"
                    >
                      <Edit2 className="w-3.5 h-3.5" /> Modifier
                    </button>
                  ) : (
                    <div className="flex gap-2 self-start">
                      <button onClick={() => setTourneeEditing(null)} className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 rounded-lg">
                        Annuler
                      </button>
                      <button
                        onClick={() => saveTourneeConfig(commercial.id)}
                        disabled={tourneeSaving}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-brewery-600 hover:bg-brewery-700 rounded-lg flex items-center gap-1 disabled:opacity-50"
                      >
                        {tourneeSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        Sauvegarder
                      </button>
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="space-y-3">
                    {/* Week pattern */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Fréquence</label>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(WEEK_PATTERN_LABELS).map(([key, label]) => (
                          <button
                            key={key}
                            onClick={() => setTourneeEditWeekPattern(key)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              tourneeEditWeekPattern === key
                                ? 'bg-brewery-600 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {allZones.length > 0 && (
                      <div className="p-2.5 bg-blue-50 border border-blue-100 rounded-lg">
                        <p className="text-[10px] font-medium text-blue-700 mb-1.5">Zones existantes :</p>
                        <div className="flex flex-wrap gap-1">
                          {allZones.map(zone => (
                            <span key={zone} className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full border border-blue-200 font-medium">{zone}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {DAY_KEYS.map(day => (
                        <AdminZonePicker
                          key={day}
                          label={DAY_LABELS[day]}
                          selected={tourneeEditConfig[day] || []}
                          allZones={allZones}
                          onAdd={zone => addZoneToDay(day, zone)}
                          onRemove={zone => removeZoneFromDay(day, zone)}
                        />
                      ))}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Info tournée (visible par l'equipe)</label>
                      <textarea
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                        rows={2}
                        value={tourneeEditInfo}
                        onChange={e => setTourneeEditInfo(e.target.value)}
                        placeholder="Infos visibles par les prospecteurs..."
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Notes (privees)</label>
                      <textarea
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                        rows={2}
                        value={tourneeEditNotes}
                        onChange={e => setTourneeEditNotes(e.target.value)}
                        placeholder="Notes personnelles..."
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    {config?.tournee_info && (
                      <div className="flex items-start gap-2 p-2 bg-blue-50 border border-blue-100 rounded-lg mb-3 text-xs text-blue-800 leading-relaxed">
                        <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        <p className="whitespace-pre-wrap break-words">{config.tournee_info}</p>
                      </div>
                    )}
                    {hasConfig ? (
                      <>
                        {/* Mobile */}
                        <div className="sm:hidden space-y-1.5">
                          {DAY_KEYS.map(day => {
                            const zones = config?.config[day] || [];
                            if (zones.length === 0) return null;
                            return (
                              <div key={day} className="flex items-center gap-2 py-1.5 px-2 bg-indigo-50 rounded-lg">
                                <span className="text-xs font-semibold text-gray-600 w-8">{DAY_LABELS[day].substring(0, 3)}</span>
                                <div className="flex flex-wrap gap-1">
                                  {zones.map((z, i) => (
                                    <span key={i} className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded font-medium">{z}</span>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {/* Desktop */}
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
                      <p className="text-sm text-gray-400 italic">Aucune tournée configurée</p>
                    )}
                    {config?.notes && (
                      <p className="mt-2 text-xs text-gray-500 italic">{config.notes}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {state.commerciaux.filter(c => c.role !== 'prospection').length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-sm text-gray-500">Aucun commercial dans l'equipe</p>
              <p className="text-xs text-gray-400 mt-1">Ajoutez des membres dans l'onglet Équipe</p>
            </div>
          )}
        </div>
    </>
  );
}
