// EasyBeer : connexion, synchronisation, contrôle — onglet de la page Administration, extrait tel quel.
import { useState, useEffect, useCallback, useRef } from 'react';
import { Settings, Users, TrendingUp, Plus, X, Save, Trash2, Calendar, Building2, Link2, RefreshCw, Check, AlertCircle, Loader2, Search } from 'lucide-react';
import { apiDelete, apiPatch, apiFetch } from '../../api/client';
import {  CLIENT_TYPE_LABELS, CLIENT_TYPE_FAMILIES, ClientType } from '../../types';
import { PIPELINE_LABELS, PipelineStage } from '../../types';
import { useApp } from '../../store/AppContext';
import { useToast } from '../../components/Toast';

export default function OngletEasyBeer({ ebOnglet }: { ebOnglet: 'connexion' | 'synchronisation' | 'controle' }) {
  const { state, dispatchLocal } = useApp();
  const toast = useToast();
  const activeTab = 'easybeer' as const; // l'onglet n'est monté que lorsqu'il est actif

  // EasyBeer state
  const [ebConfig, setEbConfig] = useState({ username: '', password: '', api_url: 'https://api.easybeer.fr', webhook_secret: '' });

  const [ebAudit, setEbAudit] = useState<{ total: number; suspects: number; a_verifier: number; liens: any[] } | null>(null);

  const [ebAuditLoading, setEbAuditLoading] = useState(false);

  const [doublons, setDoublons] = useState<{ total_clients: number; total_paires: number; certains: number; affichees?: number; par_score?: Record<string, number>; identifiants_partages?: { emails: { valeur: string; clients: number }[]; telephones: { valeur: string; clients: number }[] }; paires: any[] } | null>(null);

  const [doublonsRecherche, setDoublonsRecherche] = useState('');

  const [doublonsFaibles, setDoublonsFaibles] = useState(false);

  // Doublons prospects <-> clients : un prospect qu'on appelle encore alors qu'il est déjà client.
  const [doublonsPC, setDoublonsPC] = useState<{ total_prospects: number; total_clients: number; total_paires: number; certains: number; paires: any[] } | null>(null);

  const [doublonsPCLoading, setDoublonsPCLoading] = useState(false);

  const chargerDoublonsPC = async () => {
    setDoublonsPCLoading(true);
    try {
      const res = await apiFetch('/prospects/doublons-clients');
      if (res.ok) {
        const data = await res.json();
        setDoublonsPC(data);
        setPcCoches(new Set((data.paires || []).filter((p: any) => p.score === 100).map((p: any) => p.prospect.id)));
      }
      else toast.error('Erreur lors de la détection des doublons prospects/clients');
    } catch { toast.error('Erreur réseau'); }
    setDoublonsPCLoading(false);
  };

  const [pcCoches, setPcCoches] = useState<Set<string>>(new Set());

  const [pcLotEnCours, setPcLotEnCours] = useState(false);

  const traiterPcCoches = async (action: 'gagne' | 'supprimer') => {
    if (!doublonsPC) return;
    const choisis = doublonsPC.paires.filter((p: any) => pcCoches.has(p.prospect.id));
    if (choisis.length === 0) return;
    const verbe = action === 'gagne' ? 'passé(s) en « Gagné »' : 'supprimé(s)';
    if (!confirm(`${action === 'gagne' ? 'Passer en « Gagné »' : 'Supprimer'} ${choisis.length} prospect(s) ?\n\n${choisis.slice(0, 15).map((p: any) => `• ${p.prospect.nom} (client : ${p.client.nom})`).join('\n')}${choisis.length > 15 ? `\n… et ${choisis.length - 15} autre(s)` : ''}\n\n${action === 'gagne' ? 'Ils sortent de la prospection ; les clients restent les fiches de référence.' : 'Leurs appels et rendez-vous seront supprimés avec eux.'}`)) return;
    setPcLotEnCours(true);
    let ok = 0, echecs = 0;
    const faits = new Set<string>();
    for (const p of choisis) {
      try {
        if (action === 'gagne') {
          await apiPatch(`/prospects/${p.prospect.id}/stage`, { etape_pipeline: 'client_gagne', date_modification: new Date().toISOString() });
          dispatchLocal({ type: 'MOVE_PROSPECT', payload: { id: p.prospect.id, stage: 'client_gagne' } });
        } else {
          await apiDelete(`/prospects/${p.prospect.id}`);
          dispatchLocal({ type: 'DELETE_PROSPECT', payload: p.prospect.id });
        }
        ok++; faits.add(p.prospect.id);
      } catch { echecs++; }
    }
    setDoublonsPC(prev => prev ? { ...prev, paires: prev.paires.filter((x: any) => !faits.has(x.prospect.id)), total_paires: prev.paires.filter((x: any) => !faits.has(x.prospect.id)).length } : prev);
    setPcCoches(new Set());
    setPcLotEnCours(false);
    toast[echecs ? 'warning' : 'success'](`${ok} prospect(s) ${verbe}${echecs ? ` · ${echecs} échec(s)` : ''}`);
  };

  const retirerPaireDoublonPC = (prospectId: string) => setDoublonsPC(prev => prev ? { ...prev, paires: prev.paires.filter((x: any) => x.prospect.id !== prospectId), total_paires: prev.paires.filter((x: any) => x.prospect.id !== prospectId).length } : prev);

  const prospectGagne = async (paire: any) => {
    if (!confirm(`Passer le prospect « ${paire.prospect.nom} » en « Gagné » ? Il sort de la prospection ; le client « ${paire.client.nom} » reste la fiche de référence.`)) return;
    try {
      await apiPatch(`/prospects/${paire.prospect.id}/stage`, { etape_pipeline: 'client_gagne', date_modification: new Date().toISOString() });
      dispatchLocal({ type: 'MOVE_PROSPECT', payload: { id: paire.prospect.id, stage: 'client_gagne' } });
      retirerPaireDoublonPC(paire.prospect.id);
      toast.success('Prospect passé en « Gagné »');
    } catch { toast.error('Impossible de modifier le prospect'); }
  };

  const prospectSupprime = async (paire: any) => {
    if (!confirm(`Supprimer le prospect « ${paire.prospect.nom} » (${paire.prospect.nb_appels} appel(s), ${paire.prospect.nb_rdv} RDV) ? Ses appels et rendez-vous seront supprimés avec lui.`)) return;
    try {
      await apiDelete(`/prospects/${paire.prospect.id}`);
      dispatchLocal({ type: 'DELETE_PROSPECT', payload: paire.prospect.id });
      retirerPaireDoublonPC(paire.prospect.id);
      toast.success('Prospect supprimé');
    } catch { toast.error('Impossible de supprimer le prospect'); }
  };

  const [doublonsLoading, setDoublonsLoading] = useState(false);

  const [fusionEnCours, setFusionEnCours] = useState<string | null>(null);

  const [ebRelierChoix, setEbRelierChoix] = useState<Record<string, string>>({});

  const [ebConfigLoaded, setEbConfigLoaded] = useState(false);
  // Verrou : l'ancien appel « pendant le rendu » relançait les cinq requêtes à chaque rendu

  // Verrou : l'ancien appel « pendant le rendu » relançait les cinq requêtes à chaque rendu
  // tant que la réponse n'était pas arrivée (25 requêtes inutiles par ouverture).
  const ebChargementRef = useRef(false);

  const [ebSaving, setEbSaving] = useState(false);

  const [ebTesting, setEbTesting] = useState(false);

  const [ebTestResult, setEbTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [ebPending, setEbPending] = useState<any[]>([]);

  const [assignmentRules, setAssignmentRules] = useState<{ id: string; email: string; commercial_id: string }[]>([]);

  const [newRuleEmail, setNewRuleEmail] = useState('');

  const [newRuleCommercial, setNewRuleCommercial] = useState('');

  const [ebImportType, setEbImportType] = useState<ClientType>('BAR_RESTAURANT_GENERAL');

  const [ebImportCommercial, setEbImportCommercial] = useState('');

  const [webhookLogs, setWebhookLogs] = useState<any[]>([]);

  const [orphanCommandes, setOrphanCommandes] = useState<any[]>([]);

  const [assigningCmd, setAssigningCmd] = useState<string | null>(null);

  const [assignCmdClientSearch, setAssignCmdClientSearch] = useState('');

  const [syncingAllCommandes, setSyncingAllCommandes] = useState(false);

  const [syncAllResult, setSyncAllResult] = useState<any>(null);

  const [syncCommandesProgress, setSyncCommandesProgress] = useState('');

  const commandesPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [exploringApi, setExploringApi] = useState(false);

  const [exploreResult, setExploreResult] = useState<any>(null);

  const [syncingClients, setSyncingClients] = useState(false);

  const [genVisites, setGenVisites] = useState(false);

  const [ebSyncLogs, setEbSyncLogs] = useState<Array<{ id: number; kind: string; status: string; created: number; updated: number; skipped: number; errors: number; message: string; started_at: string }>>([]);

  const chargerAuditLiens = async () => {
    setEbAuditLoading(true);
    try {
      const res = await apiFetch('/easybeer/audit-liens');
      if (res.ok) setEbAudit(await res.json());
    } catch { /* silencieux */ }
    setEbAuditLoading(false);
  };

  const chargerDoublons = async () => {
    setDoublonsLoading(true);
    try {
      const res = await apiFetch('/clients/doublons');
      if (res.ok) {
        const data = await res.json();
        setDoublons(data);
        // Les paires certaines (identifiant commun) sont cochées d'avance.
        setPairesCochees(new Set((data.paires || []).filter((p: any) => p.score === 100).map((p: any) => `${p.clients[0].id}|${p.clients[1].id}`)));
      } else toast.error('Erreur lors de la détection des doublons');
    } catch { toast.error('Erreur reseau'); }
    setDoublonsLoading(false);
  };

  // Sélection multiple des paires de doublons : clé = les deux identifiants.
  const clePaire = (p: any) => `${p.clients[0].id}|${p.clients[1].id}`;

  const [pairesCochees, setPairesCochees] = useState<Set<string>>(new Set());

  const [fusionLotEnCours, setFusionLotEnCours] = useState(false);

  const fusionnerPairesCochees = async () => {
    if (!doublons) return;
    const choisies = doublons.paires.filter((p: any) => pairesCochees.has(clePaire(p)));
    if (choisies.length === 0) return;
    const message = `Fusionner ${choisies.length} paire(s) ?\n\nPour chaque paire, la fiche suggérée (la plus riche en historique) est gardée, l'autre y est fusionnée puis supprimée :\n\n`
      + choisies.slice(0, 15).map((p: any) => { const g = p.clients.find((c: any) => c.id === p.suggestion_garder); const s = p.clients.find((c: any) => c.id !== p.suggestion_garder); return `• « ${s?.nom} » → « ${g?.nom} »`; }).join('\n')
      + (choisies.length > 15 ? `\n… et ${choisies.length - 15} autre(s)` : '')
      + '\n\nCette action est définitive.';
    if (!confirm(message)) return;
    setFusionLotEnCours(true);
    const supprimees = new Set<string>();
    let ok = 0, echecs = 0, ignorees = 0;
    for (const p of choisies) {
      const garder = p.clients.find((c: any) => c.id === p.suggestion_garder) || p.clients[0];
      const supprimer = p.clients.find((c: any) => c.id !== garder.id);
      // Une fiche déjà supprimée dans ce lot (elle était dans deux paires) : on passe.
      if (!supprimer || supprimees.has(garder.id) || supprimees.has(supprimer.id)) { ignorees++; continue; }
      try {
        const res = await apiFetch('/clients/fusionner', { method: 'POST', body: JSON.stringify({ garder_id: garder.id, supprimer_id: supprimer.id }) });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) { ok++; supprimees.add(supprimer.id); } else echecs++;
      } catch { echecs++; }
    }
    setDoublons(prev => {
      if (!prev) return prev;
      const paires = prev.paires.filter((p: any) => !p.clients.some((c: any) => supprimees.has(c.id)));
      return { ...prev, paires, total_paires: paires.length, certains: paires.filter((p: any) => p.score === 100).length, total_clients: prev.total_clients - supprimees.size };
    });
    setPairesCochees(new Set());
    setFusionLotEnCours(false);
    toast[echecs ? 'warning' : 'success'](`${ok} fusion(s) faite(s)${echecs ? ` · ${echecs} échec(s)` : ''}${ignorees ? ` · ${ignorees} ignorée(s) (fiche déjà fusionnée)` : ''}`);
  };

  const fusionnerClients = async (garder: any, supprimer: any) => {
    const message = `Fusionner « ${supprimer.nom} » dans « ${garder.nom} » ?\n\n`
      + `${supprimer.nb_commandes} commande(s), ${supprimer.nb_interactions} interaction(s) et l'historique de « ${supprimer.nom} » `
      + `seront transferes sur « ${garder.nom} », puis la fiche en double sera supprimée.\n\nCette action est definitive.`;
    if (!confirm(message)) return;
    setFusionEnCours(`${garder.id}|${supprimer.id}`);
    try {
      const res = await apiFetch('/clients/fusionner', { method: 'POST', body: JSON.stringify({ garder_id: garder.id, supprimer_id: supprimer.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        toast.success(data.message || 'Clients fusionnes');
        // On retire de la liste toutes les paires qui referencent la fiche supprimee.
        setDoublons(prev => {
          if (!prev) return prev;
          const paires = prev.paires.filter((p: any) => !p.clients.some((c: any) => c.id === supprimer.id));
          return { ...prev, paires, total_paires: paires.length, certains: paires.filter((p: any) => p.score === 100).length, total_clients: prev.total_clients - 1 };
        });
        // La liste clients de l'app se rafraichit toute seule (polling 30 s).
      } else {
        toast.error(data.error || data.message || 'Échec de la fusion');
      }
    } catch { toast.error('Erreur reseau'); }
    setFusionEnCours(null);
  };

  const delierLienEasybeer = async (easybeerId: string, nom: string) => {
    if (!confirm(`Délier « ${nom} » ? Ses futures commandes partiront en orphelines jusqu'à re-liaison.`)) return;
    const res = await apiFetch(`/easybeer/liens/${easybeerId}/delier`, { method: 'POST' });
    if (res.ok) { toast.success('Lien supprimé'); chargerAuditLiens(); }
    else toast.error('Échec de la suppression du lien');
  };

  const relierLienEasybeer = async (easybeerId: string) => {
    const clientId = ebRelierChoix[easybeerId];
    if (!clientId) { toast.error('Choisis d\'abord le bon client'); return; }
    const res = await apiFetch(`/easybeer/liens/${easybeerId}/relier`, { method: 'POST', body: JSON.stringify({ client_id: clientId }),
    });
    if (res.ok) {
      const data = await res.json();
      toast.success(`Relié — ${data.commandes_rattachees} commande(s) orpheline(s) rattachée(s)`);
      chargerAuditLiens();
    } else toast.error('Échec de la liaison');
  };

  useEffect(() => {
    if (activeTab !== 'easybeer' || ebConfigLoaded || ebChargementRef.current) return;
    ebChargementRef.current = true;
    loadEasyBeerData().finally(() => { ebChargementRef.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, ebConfigLoaded]);

  const loadEasyBeerData = async () => {
    try {

      const [configRes, pendingRes, rulesRes, logsRes, orphanRes] = await Promise.all([
        apiFetch('/easybeer/config'),
        apiFetch('/easybeer/pending-clients'),
        apiFetch('/assignment-rules'),
        apiFetch('/easybeer/webhook-logs'),
        apiFetch('/commandes/orphelines'),
      ]);
      if (configRes.ok) {
        const config = await configRes.json();
        setEbConfig({ username: config.username || '', password: config.password || '', api_url: config.api_url || 'https://api.easybeer.fr', webhook_secret: config.webhook_secret || '' });
      }
      if (pendingRes.ok) setEbPending(await pendingRes.json());
      if (rulesRes.ok) setAssignmentRules(await rulesRes.json());
      if (logsRes.ok) setWebhookLogs(await logsRes.json());
      if (orphanRes.ok) setOrphanCommandes(await orphanRes.json());
      setEbConfigLoaded(true);
    } catch { /* ignore */ }
  };

  const saveEbConfig = async () => {
    setEbSaving(true);
    try {
      await apiFetch('/easybeer/config', {
        method: 'POST',
        body: JSON.stringify(ebConfig),
      });
      toast.success('Configuration EasyBeer sauvegardee');
    } catch { toast.error('Erreur de sauvegarde'); }
    setEbSaving(false);
  };

  const testEbConnection = async () => {
    setEbTesting(true);
    setEbTestResult(null);
    try {
      const res = await apiFetch('/easybeer/test-connection', {
        method: 'POST',
        body: JSON.stringify(ebConfig),
      });
      const result = await res.json();
      setEbTestResult(result);
    } catch { setEbTestResult({ ok: false, message: 'Erreur reseau' }); }
    setEbTesting(false);
  };

  const importEbClient = async (ebId: number) => {
    try {
      const res = await apiFetch(`/easybeer/pending-clients/${ebId}/import`, {
        method: 'POST',
        body: JSON.stringify({ commercial_id: ebImportCommercial || state.currentUser?.id, type_client: ebImportType }),
      });
      if (res.ok) {
        setEbPending(prev => prev.filter(c => c.id !== ebId));
        toast.success('Client importé avec succes');
        // Reload to get new client in state
        window.location.reload();
      }
    } catch { toast.error('Erreur lors de l\'import'); }
  };

  const syncEbClient = async (ebId: number) => {
    try {
      const res = await apiFetch(`/easybeer/pending-clients/${ebId}/sync`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`Synchronisé: ${data.name || 'OK'}`);
        loadEasyBeerData();
      } else {
        toast.error(data.message || 'Échec de la synchronisation');
      }
    } catch { toast.error('Erreur de synchronisation'); }
  };

  // La synchro tourne cote serveur en arriere-plan (plusieurs minutes possibles) : on la
  // lance puis on interroge son etat, au lieu d'attendre une reponse HTTP qui finissait

  // La synchro tourne cote serveur en arriere-plan (plusieurs minutes possibles) : on la
  // lance puis on interroge son etat, au lieu d'attendre une reponse HTTP qui finissait
  // par etre coupee et affichait une fausse erreur.
  const pollCommandesStatus = useCallback(() => {
    if (commandesPollRef.current) clearInterval(commandesPollRef.current);
    const tick = async () => {
      try {
        const res = await apiFetch('/easybeer/sync-commandes-status', {
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.running) {
          setSyncingAllCommandes(true);
          setSyncCommandesProgress(data.log?.message || 'Synchronisation en cours...');
          return;
        }
        if (commandesPollRef.current) { clearInterval(commandesPollRef.current); commandesPollRef.current = null; }
        setSyncingAllCommandes(false);
        setSyncCommandesProgress('');
        if (data.resultat) {
          setSyncAllResult(data.resultat);
          if (data.resultat.ok && (data.resultat.total_imported || 0) > 0) {
            toast.success(`${data.resultat.total_imported} commandes importées pour ${data.resultat.details?.length || 0} clients`);
          } else if (data.resultat.ok) {
            toast.success(data.resultat.message || 'Aucune nouvelle commande');
          } else {
            toast.error(data.resultat.message || 'Erreur de synchronisation');
          }
        }
        loadEbSyncLogs();
        loadEasyBeerData(); // Refresh orphan list
      } catch { /* on retentera au prochain tick */ }
    };
    commandesPollRef.current = setInterval(tick, 4000);
    tick();
  }, []);

  useEffect(() => () => { if (commandesPollRef.current) clearInterval(commandesPollRef.current); }, []);

  // Au retour sur l'onglet EasyBeer, on reprend le suivi si une synchro tourne encore.
  useEffect(() => {
    if (activeTab !== 'easybeer' || commandesPollRef.current) return;
    (async () => {
      try {
        const res = await apiFetch('/easybeer/sync-commandes-status', {
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.running) pollCommandesStatus();
      } catch { /* ignore */ }
    })();
  }, [activeTab, pollCommandesStatus]);

  const syncAllCommandes = async (force = false) => {
    setSyncingAllCommandes(true);
    setSyncAllResult(null);
    setSyncCommandesProgress('Demarrage...');
    try {
      const res = await apiFetch('/easybeer/sync-all-commandes', {
        method: 'POST',
        body: JSON.stringify({ force }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok !== false) {
        toast.success(data.message || 'Synchronisation des commandes lancee');
        pollCommandesStatus();
      } else {
        toast.error(data.message || 'Erreur au lancement de la synchronisation');
        setSyncingAllCommandes(false);
        setSyncCommandesProgress('');
      }
    } catch {
      toast.error('Erreur au lancement de la synchronisation des commandes');
      setSyncingAllCommandes(false);
      setSyncCommandesProgress('');
    }
  };

  const loadEbSyncLogs = async () => {
    try {
      const res = await apiFetch('/easybeer/sync-logs');
      if (res.ok) setEbSyncLogs(await res.json());
    } catch { /* ignore */ }
  };

  const syncClients = async () => {
    setSyncingClients(true);
    try {
      const res = await apiFetch('/easybeer/sync-clients', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok !== false) {
        toast.success(data.message || 'Synchronisation des clients lancee');
        setTimeout(loadEbSyncLogs, 1500);
      } else { toast.error(data.message || data.error || 'Échec du lancement'); }
    } catch { toast.error('Erreur reseau'); }
    setSyncingClients(false);
  };

  const genererVisites = async () => {
    setGenVisites(true);
    try {
      const res = await apiFetch('/easybeer/generer-visites', { method: 'POST', body: JSON.stringify({ sinceDays: 365 }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok !== false) toast.success(`${data.created || 0} visites créées depuis les commandes`);
      else toast.error(data.message || 'Échec');
    } catch { toast.error('Erreur reseau'); }
    setGenVisites(false);
  };

  const exploreEasyBeerApi = async (round = 2) => {
    setExploringApi(true);
    try {
      const res = await apiFetch('/easybeer/explore-api', {
        method: 'POST',
        body: JSON.stringify({ round }),
      });
      const data = await res.json();
      setExploreResult((prev: any) => {
        if (!prev) return data;
        return { ...data, results: [...(prev.results || []), ...(data.results || [])] };
      });
    } catch { toast.error('Erreur exploration API'); }
    setExploringApi(false);
  };

  const dismissEbClient = async (ebId: number) => {
    try {
      await apiFetch(`/easybeer/pending-clients/${ebId}`, {
        method: 'DELETE',
      });
      setEbPending(prev => prev.filter(c => c.id !== ebId));
    } catch { /* ignore */ }
  };

  const addAssignmentRule = async () => {
    if (!newRuleEmail || !newRuleCommercial) return;
    try {
      const res = await apiFetch('/assignment-rules', {
        method: 'POST',
        body: JSON.stringify({ email: newRuleEmail, commercial_id: newRuleCommercial }),
      });
      if (res.ok) {
        const data = await res.json();
        setAssignmentRules(prev => [...prev, { id: data.id, email: newRuleEmail.toLowerCase(), commercial_id: newRuleCommercial }]);
        setNewRuleEmail('');
        setNewRuleCommercial('');
      }
    } catch { toast.error('Erreur'); }
  };

  const deleteAssignmentRule = async (ruleId: string) => {
    try {
      await apiFetch(`/assignment-rules/${ruleId}`, {
        method: 'DELETE',
      });
      setAssignmentRules(prev => prev.filter(r => r.id !== ruleId));
    } catch { /* ignore */ }
  };

  return (
    <>
        <div className="space-y-6">
          {/* Chargement des données EasyBeer : dans un effet (voir ebChargementRef), plus au rendu. */}

          {ebOnglet === 'connexion' && (<>
          {/* Configuration */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Settings className="w-4 h-4" /> Configuration EasyBeer
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nom d'utilisateur API</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={ebConfig.username}
                  onChange={e => setEbConfig(prev => ({ ...prev, username: e.target.value }))}
                  placeholder="votre_username"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Mot de passe API</label>
                <input
                  type="password"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={ebConfig.password}
                  onChange={e => setEbConfig(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">URL API</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={ebConfig.api_url}
                  onChange={e => setEbConfig(prev => ({ ...prev, api_url: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Webhook Secret</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={ebConfig.webhook_secret}
                  onChange={e => setEbConfig(prev => ({ ...prev, webhook_secret: e.target.value }))}
                  placeholder="secret-pour-verifier-les-webhooks"
                />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              <button
                className="px-4 py-2 bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                onClick={saveEbConfig}
                disabled={ebSaving}
              >
                {ebSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Sauvegarder
              </button>
              <button
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                onClick={testEbConnection}
                disabled={ebTesting || !ebConfig.username}
              >
                {ebTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Tester la connexion
              </button>
              {ebTestResult && (
                <span className={`text-sm flex items-center gap-1 ${ebTestResult.ok ? 'text-green-600' : 'text-red-600'}`}>
                  {ebTestResult.ok ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  {ebTestResult.message}
                </span>
              )}
            </div>
            <div className="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-600">
              <p className="font-medium text-gray-700 mb-1">URL du webhook a configurer dans EasyBeer :</p>
              <code className="bg-gray-200 px-2 py-1 rounded text-gray-800 break-all">
                {window.location.origin}/api/webhook/easybeer/{ebConfig.webhook_secret || 'VOTRE_SECRET'}
              </code>
              <p className="mt-2 text-gray-500">EasyBeer envoie le secret dans l'URL. Le format supporte aussi le header <code className="bg-gray-200 px-1 rounded">X-Webhook-Secret</code>.</p>
            </div>
          </div>

          </>)}
          {ebOnglet === 'synchronisation' && (<>
          {/* Audit des liens Easybeer <-> clients */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
              <Link2 className="w-4 h-4" /> Audit des liens Easybeer → clients
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              Vérifie que chaque client Easybeer est relié au bon client SuiviPro. Les liens « suspects »
              viennent de l'ancien rapprochement par nom — délie puis relie au bon client (ses commandes
              orphelines suivront automatiquement).
            </p>
            <button
              className="px-3 py-2 bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 text-sm disabled:opacity-50 mb-3"
              onClick={chargerAuditLiens}
              disabled={ebAuditLoading}
            >
              {ebAuditLoading ? 'Analyse…' : ebAudit ? 'Relancer l\'audit' : 'Lancer l\'audit'}
            </button>

            {ebAudit && (
              <div>
                <div className="flex gap-3 mb-3 text-sm">
                  <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">{ebAudit.total} lien(s)</span>
                  <span className={`px-2 py-1 rounded ${ebAudit.suspects ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{ebAudit.suspects} suspect(s)</span>
                  <span className={`px-2 py-1 rounded ${ebAudit.a_verifier ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{ebAudit.a_verifier} à vérifier</span>
                </div>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {ebAudit.liens.filter(l => l.verdict !== 'ok').map(l => (
                    <div key={l.easybeer_id} className={`p-3 rounded-lg border text-sm ${l.verdict === 'suspect' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900">{l.eb_name || `Easybeer #${l.easybeer_id}`}</span>
                        <span className="text-gray-400">→</span>
                        <span className="text-gray-800">{l.client_nom}</span>
                        <span className="text-xs text-gray-500">({l.nb_commandes} commande(s) · preuves : {l.preuves.join(', ') || 'aucune'})</span>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <select
                          className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs"
                          value={ebRelierChoix[l.easybeer_id] || ''}
                          onChange={e => setEbRelierChoix(prev => ({ ...prev, [l.easybeer_id]: e.target.value }))}
                        >
                          <option value="">Relier au bon client…</option>
                          {[...state.clients].sort((a, b) => a.nom.localeCompare(b.nom)).map(c => (
                            <option key={c.id} value={c.id}>{c.nom}{c.ville ? ` (${c.ville})` : ''}</option>
                          ))}
                        </select>
                        <button
                          className="px-2 py-1.5 bg-brewery-600 text-white rounded-lg text-xs hover:bg-brewery-700"
                          onClick={() => relierLienEasybeer(l.easybeer_id)}
                        >Relier</button>
                        <button
                          className="px-2 py-1.5 bg-white border border-red-300 text-red-600 rounded-lg text-xs hover:bg-red-50"
                          onClick={() => delierLienEasybeer(l.easybeer_id, l.eb_name || l.client_nom)}
                        >Délier</button>
                      </div>
                    </div>
                  ))}
                  {ebAudit.liens.filter(l => l.verdict !== 'ok').length === 0 && (
                    <p className="text-sm text-green-700">Tous les liens sont cohérents ✓</p>
                  )}
                </div>
              </div>
            )}
          </div>

          </>)}
          {ebOnglet === 'controle' && (<>
          {/* Doublons de clients */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
              <Users className="w-4 h-4" /> Doublons de clients
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              Repère les fiches qui désignent probablement le même etablissement (SIRET, email ou téléphone
              partage, nom identique ou très proche). La fusion transfère commandes, visites et rendez-vous
              sur la fiche gardée, complète ses champs vides, puis supprimé le doublon.
            </p>
            <button
              className="px-3 py-2 bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 text-sm disabled:opacity-50 mb-3"
              onClick={chargerDoublons}
              disabled={doublonsLoading}
            >
              {doublonsLoading ? 'Analyse…' : doublons ? 'Relancer la détection' : 'Détecter les doublons'}
            </button>

            {doublons && (
              <div>
                <div className="flex gap-3 mb-3 text-sm flex-wrap">
                  <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">{doublons.total_clients} client(s) analyses</span>
                  <span className={`px-2 py-1 rounded ${doublons.total_paires ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                    {doublons.total_paires} paire(s) suspecte(s)
                  </span>
                  {doublons.certains > 0 && (
                    <span className="px-2 py-1 rounded bg-red-100 text-red-700">{doublons.certains} certaine(s)</span>
                  )}
                  {(doublons.par_score?.nom_identique || 0) > 0 && (
                    <span className="px-2 py-1 rounded bg-amber-100 text-amber-700">{doublons.par_score?.nom_identique} nom identique</span>
                  )}
                  {(doublons.par_score?.nom_inclus || 0) > 0 && (
                    <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">{doublons.par_score?.nom_inclus} nom inclus</span>
                  )}
                </div>
                {((doublons.identifiants_partages?.emails.length || 0) + (doublons.identifiants_partages?.telephones.length || 0)) > 0 && (
                  <div className="mb-3 p-2.5 rounded-lg bg-blue-50 border border-blue-100 text-xs text-blue-900">
                    <p className="font-medium mb-1">Contacts ignores comme preuve d'identite</p>
                    <p className="text-blue-800 mb-1">
                      Portes par 3 fiches ou plus, ce sont des contacts partagés (boite mail de la brasserie,
                      standard téléphonique) : deux clients qui les partagent ne sont pas pour autant un doublon.
                      Ils restent comparés sur leur nom.
                    </p>
                    <p className="text-blue-700">
                      {[...(doublons.identifiants_partages?.emails || []), ...(doublons.identifiants_partages?.telephones || [])]
                        .slice(0, 6)
                        .map(x => `${x.valeur} (${x.clients} fiches)`)
                        .join(' · ')}
                    </p>
                  </div>
                )}
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <input
                    type="text"
                    className="flex-1 min-w-[12rem] px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
                    placeholder="Chercher un client dans la liste…"
                    value={doublonsRecherche}
                    onChange={e => setDoublonsRecherche(e.target.value)}
                  />
                  <label className="flex items-center gap-2 text-xs text-gray-600">
                    <input type="checkbox" checked={doublonsFaibles} onChange={e => setDoublonsFaibles(e.target.checked)} />
                    Afficher aussi les rapprochements faibles ({doublons.par_score?.mots_communs || 0})
                  </label>
                </div>
                {(() => {
                  const q = doublonsRecherche.trim().toLowerCase();
                  const visibles = doublons.paires.filter((p: any) =>
                    (doublonsFaibles || p.score > 40) &&
                    (!q || p.clients.some((c: any) => (c.nom || '').toLowerCase().includes(q) || (c.ville || '').toLowerCase().includes(q)))
                  );
                  return visibles.length === 0 ? (
                  <p className="text-sm text-gray-600">
                    {doublons.paires.length === 0 ? 'Aucun doublon détecté ✓' : 'Aucune paire ne correspond a ce filtre.'}
                  </p>
                ) : (
                  <div className="space-y-3 max-h-[32rem] overflow-y-auto">
                    <div className="flex items-center gap-2 flex-wrap sticky top-0 bg-white py-1">
                      <p className="text-xs text-gray-500">{visibles.length} paire(s) affichée(s) · {visibles.filter((p: any) => pairesCochees.has(clePaire(p))).length} cochée(s)</p>
                      <button className="text-[11px] text-brewery-600 hover:underline" onClick={() => setPairesCochees(new Set(visibles.filter((p: any) => p.score === 100).map(clePaire)))}>cocher les certaines</button>
                      <button className="text-[11px] text-brewery-600 hover:underline" onClick={() => setPairesCochees(new Set(visibles.map(clePaire)))}>tout cocher</button>
                      <button className="text-[11px] text-gray-500 hover:underline" onClick={() => setPairesCochees(new Set())}>tout décocher</button>
                      <button
                        className="ml-auto px-3 py-1.5 text-xs font-medium text-white bg-brewery-600 hover:bg-brewery-700 rounded-lg disabled:opacity-50"
                        disabled={fusionLotEnCours || visibles.filter((p: any) => pairesCochees.has(clePaire(p))).length === 0}
                        onClick={fusionnerPairesCochees}
                      >
                        {fusionLotEnCours ? 'Fusion en cours…' : `Fusionner les paires cochées (${visibles.filter((p: any) => pairesCochees.has(clePaire(p))).length}), fiche suggérée gardée`}
                      </button>
                    </div>
                    {visibles.map((paire: any, i: number) => (
                      <div key={`${paire.clients[0].id}-${paire.clients[1].id}-${i}`}
                        className={`p-3 rounded-lg border ${paire.score === 100 ? 'border-red-200 bg-red-50' : paire.score >= 80 ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
                        <label className="flex items-center gap-2 text-xs font-medium text-gray-600 mb-2 cursor-pointer">
                          <input type="checkbox" checked={pairesCochees.has(clePaire(paire))} onChange={e => setPairesCochees(prev => { const n = new Set(prev); if (e.target.checked) n.add(clePaire(paire)); else n.delete(clePaire(paire)); return n; })} />
                          {paire.motif}
                        </label>
                        <div className="grid md:grid-cols-2 gap-2">
                          {paire.clients.map((c: any) => {
                            const autre = paire.clients.find((x: any) => x.id !== c.id);
                            const suggere = paire.suggestion_garder === c.id;
                            return (
                              <div key={c.id} className={`p-2 rounded-lg bg-white border text-xs ${suggere ? 'border-brewery-300' : 'border-gray-200'}`}>
                                <div className="flex items-start justify-between gap-2">
                                  <span className="font-medium text-gray-900">{c.nom}</span>
                                  {suggere && <span className="px-1.5 py-0.5 rounded bg-brewery-100 text-brewery-700 whitespace-nowrap">suggere</span>}
                                </div>
                                <p className="text-gray-500 mt-1">
                                  {[c.ville, c.code_postal].filter(Boolean).join(' ') || 'Sans ville'}
                                  {c.commercial ? ` · ${c.commercial}` : ' · sans commercial'}
                                </p>
                                <p className="text-gray-500">
                                  {c.nb_commandes} commande(s) · {c.ca_ttc.toFixed(2)}€ TTC · {c.nb_interactions} interaction(s)
                                </p>
                                <p className="text-gray-400">
                                  {c.easybeer_id ? `EasyBeer #${c.easybeer_id}` : 'sans lien EasyBeer'}
                                  {c.siret ? ` · SIRET ${c.siret}` : ''}
                                </p>
                                <button
                                  className="mt-2 w-full px-2 py-1.5 bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 disabled:opacity-50"
                                  disabled={fusionEnCours !== null}
                                  onClick={() => fusionnerClients(c, autre)}
                                >
                                  {fusionEnCours === `${c.id}|${autre.id}` ? 'Fusion…' : 'Garder cette fiche'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ); })()}
              </div>
            )}
          </div>

          </>)}
          {ebOnglet === 'controle' && (<>
          {/* Doublons prospects <-> clients */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
              <Users className="w-4 h-4" /> Doublons entre prospects et clients
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              Repère les prospects encore en prospection qui sont déjà clients (même SIRET, email ou téléphone,
              nom identique ou très proche). Pour chaque paire : passer le prospect en « Gagné », ou le supprimer.
            </p>
            <button
              className="px-3 py-2 bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 text-sm disabled:opacity-50 mb-3"
              onClick={chargerDoublonsPC}
              disabled={doublonsPCLoading}
            >
              {doublonsPCLoading ? 'Analyse…' : doublonsPC ? 'Relancer la détection' : 'Détecter les doublons prospects / clients'}
            </button>
            {doublonsPC && (
              <div>
                <div className="flex gap-3 mb-3 text-sm flex-wrap">
                  <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">{doublonsPC.total_prospects} prospect(s) · {doublonsPC.total_clients} client(s)</span>
                  <span className={`px-2 py-1 rounded ${doublonsPC.total_paires ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{doublonsPC.total_paires} paire(s) suspecte(s)</span>
                  {doublonsPC.certains > 0 && <span className="px-2 py-1 rounded bg-red-100 text-red-700">{doublonsPC.certains} certaine(s)</span>}
                </div>
                {doublonsPC.paires.length === 0 ? (
                  <p className="text-sm text-gray-500">Aucun prospect ne ressemble à un client ✓</p>
                ) : (
                  <div className="space-y-2 max-h-[32rem] overflow-y-auto">
                    <div className="flex items-center gap-2 flex-wrap sticky top-0 bg-white py-1">
                      <p className="text-xs text-gray-500">{pcCoches.size} coché(s)</p>
                      <button className="text-[11px] text-brewery-600 hover:underline" onClick={() => setPcCoches(new Set(doublonsPC.paires.filter((p: any) => p.score === 100).map((p: any) => p.prospect.id)))}>cocher les certains</button>
                      <button className="text-[11px] text-brewery-600 hover:underline" onClick={() => setPcCoches(new Set(doublonsPC.paires.map((p: any) => p.prospect.id)))}>tout cocher</button>
                      <button className="text-[11px] text-gray-500 hover:underline" onClick={() => setPcCoches(new Set())}>tout décocher</button>
                      <div className="ml-auto flex gap-2">
                        <button onClick={() => traiterPcCoches('gagne')} disabled={pcLotEnCours || pcCoches.size === 0} className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50">Passer en « Gagné » ({pcCoches.size})</button>
                        <button onClick={() => traiterPcCoches('supprimer')} disabled={pcLotEnCours || pcCoches.size === 0} className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg border border-red-200 disabled:opacity-50">Supprimer ({pcCoches.size})</button>
                      </div>
                    </div>
                    {doublonsPC.paires.map((paire: any) => (
                      <div key={paire.prospect.id + paire.client.id}
                        className={`p-3 rounded-lg border ${paire.score === 100 ? 'border-red-200 bg-red-50' : paire.score >= 80 ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
                        <label className="flex items-center gap-2 text-xs font-medium text-gray-600 mb-2 cursor-pointer">
                          <input type="checkbox" checked={pcCoches.has(paire.prospect.id)} onChange={e => setPcCoches(prev => { const n = new Set(prev); if (e.target.checked) n.add(paire.prospect.id); else n.delete(paire.prospect.id); return n; })} />
                          {paire.motif}
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                          <div className="bg-white rounded-lg border border-gray-200 p-2.5">
                            <p className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold mb-1">Prospect</p>
                            <a href={`/prospects?id=${paire.prospect.id}`} className="font-semibold text-gray-900 hover:underline">{paire.prospect.nom}</a>
                            <p className="text-gray-500">{[paire.prospect.ville, paire.prospect.telephone, paire.prospect.email].filter(Boolean).join(' · ')}</p>
                            <p className="text-gray-400 mt-1">{PIPELINE_LABELS[paire.prospect.etape_pipeline as PipelineStage] || paire.prospect.etape_pipeline} · {paire.prospect.nb_appels} appel(s) · {paire.prospect.nb_rdv} RDV{paire.prospect.commercial ? ` · ${paire.prospect.commercial}` : ''}</p>
                          </div>
                          <div className="bg-white rounded-lg border border-gray-200 p-2.5">
                            <p className="text-[10px] uppercase tracking-wide text-blue-700 font-semibold mb-1">Client</p>
                            <a href={`/clients?id=${paire.client.id}`} className="font-semibold text-gray-900 hover:underline">{paire.client.nom}</a>
                            <p className="text-gray-500">{[paire.client.ville, paire.client.telephone, paire.client.email].filter(Boolean).join(' · ')}</p>
                            <p className="text-gray-400 mt-1">{paire.client.statut} · {paire.client.nb_commandes} commande(s){paire.client.easybeer_id ? ' · EasyBeer' : ''}{paire.client.commercial ? ` · ${paire.client.commercial}` : ''}</p>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-2 justify-end">
                          <button onClick={() => prospectGagne(paire)} className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg">Passer le prospect en « Gagné »</button>
                          <button onClick={() => prospectSupprime(paire)} className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg border border-red-200">Supprimer le prospect</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          </>)}
          {ebOnglet === 'connexion' && (<>
          {/* Regles d'affectation */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Users className="w-4 h-4" /> Règles d'affectation automatique
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Quand un client arrive d'EasyBeer avec un email commercial, il est automatiquement assigné au bon commercial.
            </p>

            {assignmentRules.length > 0 && (
              <div className="space-y-2 mb-4">
                {assignmentRules.map(rule => {
                  const com = state.commerciaux.find(c => c.id === rule.commercial_id);
                  return (
                    <div key={rule.id} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg text-sm">
                      <span className="text-gray-600 flex-1">{rule.email}</span>
                      <span className="text-gray-400">→</span>
                      <span className="font-medium text-gray-900">{com ? `${com.prenom} ${com.nom}` : rule.commercial_id}</span>
                      <button className="p-1 rounded hover:bg-red-50" onClick={() => deleteAssignmentRule(rule.id)}>
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">Email commercial EasyBeer</label>
                <input
                  type="email"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={newRuleEmail}
                  onChange={e => setNewRuleEmail(e.target.value)}
                  placeholder="commercial@easybeer.fr"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">Commercial SuiviPro</label>
                <select
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={newRuleCommercial}
                  onChange={e => setNewRuleCommercial(e.target.value)}
                >
                  <option value="">Choisir...</option>
                  {state.commerciaux.map(c => (
                    <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
                  ))}
                </select>
              </div>
              <button
                className="px-3 py-2 bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 text-sm disabled:opacity-50"
                onClick={addAssignmentRule}
                disabled={!newRuleEmail || !newRuleCommercial}
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          </>)}
          {ebOnglet === 'synchronisation' && (<>
          {/* Clients en attente */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Building2 className="w-4 h-4" /> Clients en attente d'import ({ebPending.length})
              </h3>
              <button
                className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg flex items-center gap-1"
                onClick={loadEasyBeerData}
              >
                <RefreshCw className="w-3.5 h-3.5" /> Rafraichir
              </button>
            </div>

            {ebPending.length > 0 && (
              <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type client pour l'import</label>
                  <select
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    value={ebImportType}
                    onChange={e => setEbImportType(e.target.value as ClientType)}
                  >
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
                  <label className="block text-xs font-medium text-gray-600 mb-1">Commercial assigné</label>
                  <select
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    value={ebImportCommercial}
                    onChange={e => setEbImportCommercial(e.target.value)}
                  >
                    <option value="">Par defaut</option>
                    {state.commerciaux.map(c => (
                      <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {ebPending.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">Aucun client en attente</p>
            ) : (
              <div className="space-y-2">
                {ebPending.map(client => (
                  <div key={client.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {client.name || `Client EasyBeer #${client.easybeer_id}`}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {[client.city, client.phone, client.email].filter(Boolean).join(' - ') || `ID: ${client.easybeer_id} — En attente de synchronisation`}
                      </p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        {client.type && (
                          <p className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded-full font-medium">
                            Type: {client.type}
                          </p>
                        )}
                        {client.commercial_email && (() => {
                          const matchedRule = assignmentRules.find(r => r.email.toLowerCase() === client.commercial_email?.toLowerCase());
                          const matchedCom = matchedRule ? state.commerciaux.find(c => c.id === matchedRule.commercial_id) : null;
                          return (
                            <p className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium">
                              Commercial: {matchedCom ? `${matchedCom.prenom} ${matchedCom.nom}` : client.commercial_email}
                              {matchedCom && <span className="text-green-600 ml-1">(auto)</span>}
                            </p>
                          );
                        })()}
                        {client.contact_name && (
                          <p className="text-[10px] text-gray-400">Contact: {client.contact_name}</p>
                        )}
                        {client.tournee && (
                          <p className="text-[10px] text-indigo-500">Tournée : {client.tournee}</p>
                        )}
                        {client.phone_mobile && (
                          <p className="text-[10px] text-gray-400">Mobile: {client.phone_mobile}</p>
                        )}
                        {(client.latitude > 0 || client.longitude > 0) && (
                          <p className="text-[10px] text-green-500">GPS OK</p>
                        )}
                        {client.siret && (
                          <p className="text-[10px] text-gray-400">SIRET: {client.siret}</p>
                        )}
                      </div>
                    </div>
                    {!client.name && (
                      <button
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-xs font-medium"
                        onClick={() => syncEbClient(client.id)}
                        title="Récupérer les infos depuis EasyBeer"
                      >
                        Sync
                      </button>
                    )}
                    <button
                      className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-xs font-medium"
                      onClick={() => importEbClient(client.id)}
                    >
                      Importer
                    </button>
                    <button
                      className="p-1.5 rounded-lg hover:bg-red-50"
                      onClick={() => dismissEbClient(client.id)}
                      title="Ignorer"
                    >
                      <X className="w-4 h-4 text-red-500" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          </>)}
          {ebOnglet === 'synchronisation' && (<>
          {/* Synchronisation des clients EasyBeer */}
          <div className="bg-white rounded-xl border border-emerald-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-emerald-800 flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> Synchroniser les clients EasyBeer
              </h3>
              <div className="flex gap-2">
                <button
                  className={`px-4 py-2 text-sm font-medium text-white rounded-lg flex items-center gap-2 ${syncingClients ? 'bg-emerald-400 cursor-wait' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                  onClick={syncClients}
                  disabled={syncingClients}
                >
                  <RefreshCw className={`w-4 h-4 ${syncingClients ? 'animate-spin' : ''}`} />
                  {syncingClients ? 'Lancement...' : 'Synchroniser les clients'}
                </button>
                <button
                  className="px-3 py-2 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1"
                  onClick={loadEbSyncLogs}
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Logs
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Importé tous les clients EasyBeer (rattachés au bon commercial par leur identifiant natif). Lance ensuite « Synchroniser les commandes » : chaque commande créé une visite avec son commentaire.
            </p>
            <div className="flex items-center gap-2 mb-3">
              <button
                className={`px-3 py-1.5 text-xs font-medium text-white rounded-lg ${genVisites ? 'bg-purple-300 cursor-wait' : 'bg-purple-500 hover:bg-purple-600'}`}
                onClick={genererVisites}
                disabled={genVisites}
              >
                {genVisites ? 'Generation...' : 'Générer les visites depuis les commandes'}
              </button>
            </div>
            {ebSyncLogs.length > 0 && (
              <div className="space-y-1">
                {ebSyncLogs.slice(0, 6).map(log => (
                  <div key={log.id} className="flex items-center gap-2 text-xs p-2 bg-gray-50 rounded">
                    <span className={`px-1.5 py-0.5 rounded font-medium ${log.status === 'done' ? 'bg-green-100 text-green-700' : log.status === 'running' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>{log.kind}</span>
                    <span className="text-gray-600 flex-1">{log.message || log.status}</span>
                    <span className="text-gray-400">{log.started_at ? new Date(log.started_at).toLocaleString('fr-FR') : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          </>)}
          {ebOnglet === 'synchronisation' && (<>
          {/* Synchronisation des commandes EasyBeer */}
          <div className="bg-white rounded-xl border border-blue-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-blue-800 flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> Synchroniser les commandes EasyBeer
              </h3>
              <div className="flex gap-2">
                <button
                  className={`px-4 py-2 text-sm font-medium text-white rounded-lg flex items-center gap-2 ${syncingAllCommandes ? 'bg-blue-400 cursor-wait' : 'bg-blue-600 hover:bg-blue-700'}`}
                  onClick={() => syncAllCommandes(false)}
                  disabled={syncingAllCommandes}
                >
                  <RefreshCw className={`w-4 h-4 ${syncingAllCommandes ? 'animate-spin' : ''}`} />
                  {syncingAllCommandes ? 'Sync en cours...' : 'Synchroniser'}
                </button>
                <button
                  className={`px-3 py-2 text-xs font-medium text-white rounded-lg ${syncingAllCommandes ? 'bg-orange-300 cursor-wait' : 'bg-orange-500 hover:bg-orange-600'}`}
                  onClick={() => { if (confirm('Supprimer et re-importer toutes les commandes EasyBeer ?')) syncAllCommandes(true); }}
                  disabled={syncingAllCommandes}
                >
                  Re-sync total
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Récupéré la liste des clients depuis l'API EasyBeer, les matche par SIRET/nom/email, puis récupéré toutes leurs commandes (en cours + livrees).
            </p>
            {syncingAllCommandes && (
              <div className="p-3 rounded-lg text-sm bg-blue-50 text-blue-800">
                <p className="font-medium">Synchronisation des commandes en cours...</p>
                <p className="text-xs mt-1">{syncCommandesProgress || 'Recuperation des commandes EasyBeer'}</p>
                <p className="text-xs mt-1 opacity-75">Elle continue cote serveur même si vous quittez cette page.</p>
              </div>
            )}
            {syncAllResult && (
              <div className={`p-3 rounded-lg text-sm ${syncAllResult.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                <p className="font-medium">{syncAllResult.message}</p>
                {syncAllResult.ok && (
                  <div className="mt-2 text-xs space-y-1">
                    <p>Clients API EasyBeer: <strong>{syncAllResult.api_clients || 0}</strong> — matches: <strong>{syncAllResult.clients_matched || 0}</strong>, non matches: {syncAllResult.clients_unmatched || 0}</p>
                    <p>Commandes trouvees: <strong>{syncAllResult.total_orders_found || 0}</strong></p>
                    <p>Nouvelles importées: <strong>{syncAllResult.total_imported || 0}</strong></p>
                    <p>Déjà existantes (ignorees): <strong>{syncAllResult.total_skipped || 0}</strong></p>
                    {(syncAllResult.clients_importes_commande || 0) > 0 && (
                      <p>Clients créés depuis leurs commandes: <strong>{syncAllResult.clients_importes_commande}</strong></p>
                    )}
                    {(syncAllResult.total_echecs || 0) > 0 && (
                      <p>Non recuperees (API surchargee): <strong>{syncAllResult.total_echecs}</strong> — relancez la synchro pour les rattraper</p>
                    )}
                    {(syncAllResult.total_orphans || 0) > 0 && <p>Orphelines (client non importé): <strong>{syncAllResult.total_orphans}</strong></p>}
                    {syncAllResult.details && syncAllResult.details.length > 0 && (
                      <div className="mt-2 border-t pt-2">
                        <p className="font-medium mb-1">Détail par client:</p>
                        {syncAllResult.details.map((d: any, i: number) => (
                          <p key={i}>{d.nom}: {d.commandes_importees} commande{d.commandes_importees > 1 ? 's' : ''} ({d.total_ttc}€ TTC)</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {syncAllResult.debug && syncAllResult.debug.length > 0 && (
                  <div className="mt-2 border-t pt-2 text-xs">
                    <p className="font-medium mb-1">Debug API EasyBeer:</p>
                    {syncAllResult.debug.map((d: any, i: number) => (
                      <div key={i} className="mb-1">
                        <p><strong>{d.endpoint}</strong>: HTTP {d.status}{d.error ? ` - ${d.error}` : ''}{d.succes === false ? ` (succes: false)` : ''}</p>
                        {d.message && <p className="text-red-500 text-sm">{d.message}</p>}
                        {d.params && <p className="text-gray-500 text-sm">Params: {typeof d.params === 'string' ? d.params : JSON.stringify(d.params)}</p>}
                        {d.response_keys && d.response_keys.length > 0 && <p className="text-gray-500">Cles: {d.response_keys.join(', ')}</p>}
                        {d.keys && d.keys.length > 0 && <p className="text-gray-500">Cles: {d.keys.join(', ')}</p>}
                        {d.sample && <p className="text-gray-400 text-xs truncate max-w-full">{d.sample.substring(0, 300)}</p>}
                        {d.body && <p className="text-gray-400 text-xs truncate max-w-full">{d.body.substring(0, 300)}</p>}
                        {d.shape && <p className="text-gray-500">Shape: {d.shape}</p>}
                      </div>
                    ))}
                    {(syncAllResult.api_url || syncAllResult.apiBase) && <p className="mt-1">URL API: {syncAllResult.api_url || syncAllResult.apiBase}</p>}
                    {syncAllResult.discovery && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <p className="font-medium mb-1 text-blue-700">Decouverte API (tous les endpoints testes):</p>
                        {syncAllResult.discovery.filter((d: any) => d.status !== 404).map((d: any, i: number) => (
                          <div key={i} className="mb-1">
                            <p><strong>{d.method} {d.path}</strong>: HTTP {d.status}{d.error ? ` - ${d.error}` : ''}{d.hasListe !== null ? ` (liste: ${d.hasListe})` : ''}</p>
                            {d.keys && d.keys.length > 0 && <p className="text-gray-500 text-xs">Cles: {d.keys.join(', ')}</p>}
                            {d.sample && <p className="text-gray-400 text-xs truncate max-w-full">{d.sample.substring(0, 300)}</p>}
                          </div>
                        ))}
                        <p className="text-gray-400 text-xs mt-1">
                          (Endpoints 404 masques. {syncAllResult.discovery.filter((d: any) => d.status === 404).length} endpoints retournent 404.)
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          </>)}
          {ebOnglet === 'connexion' && (<>
          {/* Explorer API EasyBeer */}
          <div className="bg-white rounded-xl border border-purple-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-purple-800 flex items-center gap-2">
                <Search className="w-4 h-4" /> Explorer l'API EasyBeer
              </h3>
              <div className="flex flex-wrap gap-1">
                {[
                  { round: 7, label: 'document + commande détail' },
                  { round: 6, label: 'Swagger (documents/commandes)' },
                  { round: 4, label: 'commande/document/facture' },
                  { round: 5, label: 'bl/tournee/commercial' },
                  { round: 3, label: 'paramètres POST' },
                ].map(({ round, label }) => (
                  <button
                    key={round}
                    className={`px-2 py-1.5 text-xs font-medium text-white rounded-lg flex items-center gap-1 ${exploringApi ? 'bg-purple-400 cursor-wait' : 'bg-purple-600 hover:bg-purple-700'}`}
                    onClick={() => exploreEasyBeerApi(round)}
                    disabled={exploringApi}
                  >
                    <Search className={`w-3 h-3 ${exploringApi ? 'animate-pulse' : ''}`} />
                    {exploringApi ? '...' : label}
                  </button>
                ))}
                <button
                  className="px-2 py-1.5 text-xs text-purple-600 hover:bg-purple-50 rounded-lg"
                  onClick={() => setExploreResult(null)}
                >
                  Reset
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Teste différentes approches pour trouver les commandes: détail client, formats alternatifs, endpoints racine. Maximum 5 appels API avec delai de 500ms.
            </p>
            {exploreResult && (
              <div className="p-3 rounded-lg text-sm bg-purple-50 text-purple-900">
                <p className="font-medium mb-2">Resultats de l'exploration ({exploreResult.results?.length || 0} endpoints testes):</p>
                {exploreResult.api_url && <p className="text-xs text-gray-500 mb-2">API: {exploreResult.api_url} | Client teste: {exploreResult.client_id_tested}</p>}
                {exploreResult.results?.map((r: any, i: number) => (
                  <div key={i} className="mb-2 p-2 bg-white rounded border">
                    <p className="font-medium">
                      <span className={r.status === 200 ? 'text-green-600' : r.status === 404 ? 'text-gray-400' : 'text-red-500'}>
                        {r.method} {r.path} → HTTP {r.status}
                      </span>
                      {r.succes === false && <span className="text-red-500 ml-2">(succes: false)</span>}
                      {r.hasData && <span className="text-green-600 ml-2 font-bold">✓ CONTIENT DES DONNEES!</span>}
                    </p>
                    {r.label && <p className="text-xs text-gray-500">Test: {r.label}</p>}
                    {r.message && <p className="text-xs text-red-500">{r.message}</p>}
                    {r.keys && r.keys.length > 0 && <p className="text-xs text-gray-500">Cles: {r.keys.join(', ')}</p>}
                    {r.sample && <p className="text-xs text-gray-400 break-all">{r.sample.substring(0, 400)}</p>}
                    {r.error && <p className="text-xs text-red-400">{r.error}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          </>)}
          {ebOnglet === 'controle' && (<>
          {/* Commandes orphelines (sans client) */}
          {orphanCommandes.length > 0 && (
          <div className="bg-white rounded-xl border border-orange-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-orange-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> Commandes a assigner ({orphanCommandes.length})
              </h3>
              <button
                className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg flex items-center gap-1"
                onClick={loadEasyBeerData}
              >
                <RefreshCw className="w-3.5 h-3.5" /> Rafraichir
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">Ces commandes ont ete recues par webhook EasyBeer mais n'ont pas pu être associees automatiquement a un client.</p>
            <div className="space-y-3">
              {orphanCommandes.map(cmd => {
                const lignes = cmd.lignes || [];
                const isAssigning = assigningCmd === cmd.id;

                // Filter clients for search
                const searchResults = assignCmdClientSearch.length >= 2 && isAssigning
                  ? state.clients.filter(c =>
                      c.nom.toLowerCase().includes(assignCmdClientSearch.toLowerCase()) ||
                      c.ville?.toLowerCase().includes(assignCmdClientSearch.toLowerCase()) ||
                      c.email?.toLowerCase().includes(assignCmdClientSearch.toLowerCase())
                    ).slice(0, 8)
                  : [];

                return (
                  <div key={cmd.id} className="p-4 bg-orange-50 rounded-lg border border-orange-100">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold text-gray-900">#{cmd.numero || cmd.easybeer_id}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                            cmd.statut === 'livree' ? 'bg-green-100 text-green-700' :
                            cmd.statut === 'annulee' ? 'bg-red-100 text-red-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                            {cmd.statut === 'livree' ? 'Livrée' : cmd.statut === 'annulee' ? 'Annulée' : 'En cours'}
                          </span>
                        </div>
                        {cmd.client_name && (
                          <p className="text-xs text-gray-600 mb-1">Client EasyBeer : <strong>{cmd.client_name}</strong></p>
                        )}
                      </div>
                      <button
                        onClick={async () => {
                          await apiFetch(`/commandes/${cmd.id}`, {
                            method: 'DELETE',
                          });
                          setOrphanCommandes(prev => prev.filter(c => c.id !== cmd.id));
                          toast.success('Commande supprimée');
                        }}
                        className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-500"
                        title="Supprimer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Details de la commande */}
                    <div className="mb-3 p-3 bg-white rounded-lg border border-orange-100 space-y-2">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3 h-3 text-gray-400" />
                          <span className="text-gray-500">Commande :</span>
                          <span className="font-medium text-gray-800">{cmd.date_commande ? new Date(cmd.date_commande).toLocaleDateString('fr-FR') : '—'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3 h-3 text-gray-400" />
                          <span className="text-gray-500">Livraison :</span>
                          <span className="font-medium text-gray-800">{cmd.date_livraison ? new Date(cmd.date_livraison).toLocaleDateString('fr-FR') : '—'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <TrendingUp className="w-3 h-3 text-gray-400" />
                          <span className="text-gray-500">Montant HT :</span>
                          <span className="font-medium text-gray-800">{cmd.montant_ht > 0 ? `${cmd.montant_ht.toFixed(2)} €` : '—'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <TrendingUp className="w-3 h-3 text-blue-500" />
                          <span className="text-gray-500">Montant TTC :</span>
                          <span className="font-semibold text-gray-900">{cmd.montant_ttc > 0 ? `${cmd.montant_ttc.toFixed(2)} €` : '—'}</span>
                        </div>
                        {cmd.notes && (
                          <div className="col-span-2 flex items-start gap-1.5">
                            <span className="text-gray-500">Notes :</span>
                            <span className="text-gray-700">{cmd.notes}</span>
                          </div>
                        )}
                      </div>

                      {/* Lignes produits */}
                      {lignes.length > 0 && (
                        <div className="pt-2 border-t border-gray-100">
                          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1.5">Produits ({lignes.length})</p>
                          <div className="space-y-1">
                            {lignes.map((l: any, i: number) => (
                              <div key={i} className="flex items-center justify-between text-xs py-1 px-2 bg-gray-50 rounded">
                                <span className="truncate flex-1 text-gray-700">{l.produit || '—'}</span>
                                <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                                  <span className="text-gray-500">x{l.quantite}</span>
                                  {l.prix_unitaire > 0 && <span className="text-gray-400">{l.prix_unitaire.toFixed(2)} €/u</span>}
                                  {l.montant > 0 && <span className="font-medium text-gray-700">{l.montant.toFixed(2)} €</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Raw data toggle */}
                      {cmd.raw_data && cmd.raw_data !== '{}' && (() => {
                        let rawObj: Record<string, unknown> = {};
                        try { rawObj = JSON.parse(cmd.raw_data); } catch { /* */ }
                        if (Object.keys(rawObj).length === 0) return null;
                        return (
                          <details className="pt-2 border-t border-gray-100">
                            <summary className="cursor-pointer text-[10px] text-gray-400 hover:text-gray-600 font-medium">
                              Voir les données brutes EasyBeer
                            </summary>
                            <pre className="mt-1.5 p-2 bg-gray-100 rounded text-[10px] overflow-x-auto whitespace-pre-wrap text-gray-600 max-h-60 overflow-y-auto">
                              {JSON.stringify(rawObj, null, 2)}
                            </pre>
                          </details>
                        );
                      })()}
                    </div>

                    {/* Assignment UI */}
                    {isAssigning ? (
                      <div className="mt-2">
                        <input
                          type="text"
                          value={assignCmdClientSearch}
                          onChange={e => setAssignCmdClientSearch(e.target.value)}
                          placeholder="Rechercher un client par nom, ville, email..."
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
                          autoFocus
                        />
                        {searchResults.length > 0 && (
                          <div className="mt-1 border border-gray-200 rounded-lg max-h-48 overflow-y-auto bg-white shadow-lg">
                            {searchResults.map(client => (
                              <button
                                key={client.id}
                                onClick={async () => {
                                  try {
                                    const resp = await apiFetch(`/commandes/${cmd.id}/assign`, {
                                      method: 'POST',
                                      body: JSON.stringify({ client_id: client.id }),
                                    });
                                    const data = await resp.json();
                                    if (data.ok) {
                                      setOrphanCommandes(prev => prev.filter(c => c.id !== cmd.id));
                                      toast.success(`Commande #${cmd.numero || ''} assignée a ${client.nom}`);
                                    } else {
                                      toast.error(data.error || 'Erreur');
                                    }
                                  } catch { toast.error('Erreur reseau'); }
                                  setAssigningCmd(null);
                                  setAssignCmdClientSearch('');
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-brewery-50 border-b border-gray-100 last:border-0"
                              >
                                <span className="text-sm font-medium text-gray-900">{client.nom}</span>
                                <span className="text-xs text-gray-500 ml-2">
                                  {[client.ville, client.email].filter(Boolean).join(' - ')}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        {assignCmdClientSearch.length >= 2 && searchResults.length === 0 && (
                          <p className="text-xs text-gray-400 text-center py-2">Aucun client trouve</p>
                        )}
                        <button
                          onClick={() => { setAssigningCmd(null); setAssignCmdClientSearch(''); }}
                          className="mt-2 text-xs text-gray-500 hover:text-gray-700"
                        >
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setAssigningCmd(cmd.id); setAssignCmdClientSearch(cmd.client_name || ''); }}
                        className="mt-2 px-3 py-1.5 text-xs font-medium text-white bg-brewery-600 hover:bg-brewery-700 rounded-lg flex items-center gap-1"
                      >
                        <Link2 className="w-3 h-3" /> Assigner a un client
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          )}

          </>)}
          {ebOnglet === 'controle' && (<>
          {/* Journal des webhooks */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> Journal des webhooks ({webhookLogs.length})
              </h3>
              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-1.5 text-xs text-green-700 bg-green-50 hover:bg-green-100 rounded-lg flex items-center gap-1 border border-green-200"
                  onClick={async () => {
                    try {
                      const resp = await apiFetch('/easybeer/test-webhook', {
                        method: 'POST',
                        body: JSON.stringify({ type: 'commande' })
                      });
                      if (!resp.ok) { alert(`Erreur serveur ${resp.status}: ${resp.statusText}`); return; }
                      const result = await resp.json();
                      alert(result.ok ? result.message : `Erreur: ${result.message || 'inconnue'}`);
                      setTimeout(() => loadEasyBeerData(), 6000);
                    } catch (err: unknown) { alert('Erreur réseau: ' + (err instanceof Error ? err.message : String(err))); }
                  }}
                >
                  Test Commande
                </button>
                <button
                  className="px-3 py-1.5 text-xs text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg flex items-center gap-1 border border-purple-200"
                  onClick={async () => {
                    try {
                      const resp = await apiFetch('/easybeer/test-webhook', {
                        method: 'POST',
                        body: JSON.stringify({ type: 'client' })
                      });
                      if (!resp.ok) { alert(`Erreur serveur ${resp.status}: ${resp.statusText}`); return; }
                      const result = await resp.json();
                      alert(result.ok ? result.message : `Erreur: ${result.message || 'inconnue'}`);
                      setTimeout(() => loadEasyBeerData(), 6000);
                    } catch (err: unknown) { alert('Erreur réseau: ' + (err instanceof Error ? err.message : String(err))); }
                  }}
                >
                  Test Client
                </button>
                <button
                  className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg flex items-center gap-1"
                  onClick={loadEasyBeerData}
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Rafraichir
                </button>
              </div>
            </div>
            {webhookLogs.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">Aucun webhook reçu</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {webhookLogs.map(log => {
                  let payload: Record<string, unknown> = {};
                  try { payload = JSON.parse(log.payload || '{}'); } catch { /* ignore */ }
                  const date = log.received_at ? new Date(log.received_at) : null;
                  return (
                    <div key={log.id} className="p-3 bg-gray-50 rounded-lg text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded font-mono">{log.type || 'N/A'}</span>
                          {log.external_id && <span className="text-gray-500">ID: {log.external_id}</span>}
                        </div>
                        <span className="text-gray-400">
                          {date ? date.toLocaleDateString('fr-FR') + ' ' + date.toLocaleTimeString('fr-FR') : ''}
                        </span>
                      </div>
                      {log.processing_result && (
                        <div className={`mt-1 px-2 py-1 rounded text-[11px] ${
                          log.processing_result.startsWith('OK') ? 'bg-green-50 text-green-700' :
                          log.processing_result.startsWith('ERREUR') ? 'bg-red-50 text-red-700' :
                          log.processing_result.startsWith('ORPHELINE') ? 'bg-orange-50 text-orange-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {log.processing_result}
                        </div>
                      )}
                      <details className="mt-1">
                        <summary className="cursor-pointer text-gray-500 hover:text-gray-700">Voir le payload</summary>
                        <pre className="mt-1 p-2 bg-gray-100 rounded text-[10px] overflow-x-auto whitespace-pre-wrap text-gray-600">
                          {JSON.stringify(payload, null, 2)}
                        </pre>
                      </details>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          </>)}
        </div>
    </>
  );
}
