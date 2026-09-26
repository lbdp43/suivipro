import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck, Copy, Building2, PencilLine, Inbox, History, Loader2, Check, X, ExternalLink,
  Phone, Mail, MapPin, Undo2, ChevronRight, SkipForward, Merge,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import { usePersistedState } from '../hooks/usePersistedState';
import { apiGet, apiPost } from '../api/client';
import { Prospect, ESTABLISHMENT_LABELS, PIPELINE_LABELS, EstablishmentType } from '../types';
import { aCompleter, manquesDeLaFiche, manquesBloquants, estQualifiable, ETAPES_A_TRIER, LIBELLES_MANQUE, Manque } from '../../shared/qualite';
import { candidatsDoublons } from '../../shared/rapprochement';
import { faitDeLaProspection } from '../utils/roles';

// « Qualité des fiches » : rendre le fichier prospects fiable. Quatre files de travail —
// doublons, prospects déjà clients, fiches à compléter, fiches partagées à trier — et le
// journal de ce qui a été fait. Chaque geste passe par /qualite/… et s'écrit au journal :
// l'administration voit tout et peut défaire.

type Onglet = 'doublons' | 'clients' | 'completer' | 'trier' | 'journal';

interface FicheVue {
  id: string; nom: string; ville: string; code_postal: string; adresse: string; email: string; telephone: string;
  siret: string; nom_contact: string; type_etablissement: string; etape_pipeline: string; notes: string;
  commercial: string; nb_appels: number; nb_rdv: number; nb_rappels: number;
}
interface PaireDoublon { score: number; motif: string; suggestion_garder: string; fiches: [FicheVue, FicheVue] }
interface PaireClient { score: number; motif: string; prospect: FicheVue; client: { id: string; nom: string; ville: string; telephone: string; email: string; statut: string; commercial: string } }
interface LigneJournal { id: number; user_id: string; qui: string; action: string; prospect_id: string; nom: string; ville: string; details: string; le: string; annule: boolean; annulable: boolean }
interface Journal { depuis: string; totaux: { user_id: string; qui: string; total: number; par_action: Record<string, number> }[]; lignes: LigneJournal[] }

const LIBELLE_ACTION: Record<string, string> = {
  fusion: 'Fusion', pas_doublon: 'Pas un doublon', completee: 'Complétée', deja_client: 'Déjà client',
  tri_qualifiee: 'Qualifiée', tri_pas_pour_nous: 'Pas pour nous', tri_ferme: 'Fermé',
};

const lienMaps = (nom: string, ville: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${nom} ${ville}`.trim())}`;
const lienAnnuaire = (nom: string, ville: string) => `https://annuaire-entreprises.data.gouv.fr/rechercher?terme=${encodeURIComponent(`${nom} ${ville}`.trim())}`;

function messageDe(e: unknown, parDefaut: string) {
  return e instanceof Error && e.message ? e.message : parDefaut;
}

export default function QualitePage() {
  const { state } = useApp();
  const moi = state.currentUser;
  const estAdmin = moi?.role === 'admin';
  const [onglet, setOnglet] = usePersistedState<Onglet>('qualite_onglet', 'doublons');

  const aCompleterListe = useMemo(() => state.prospects.filter(p => aCompleter(p)), [state.prospects]);
  const aTrierListe = useMemo(
    () => state.prospects.filter(p => ETAPES_A_TRIER.includes(p.etape_pipeline))
      .sort((a, b) => String(a.date_creation).localeCompare(String(b.date_creation))),
    [state.prospects],
  );

  // Les deux listes calculées par le serveur, gardées ici pour afficher les compteurs.
  const [doublons, setDoublons] = useState<{ total: number; certains: number; paires: PaireDoublon[] } | null>(null);
  const [dejaClients, setDejaClients] = useState<{ total: number; certains: number; paires: PaireClient[] } | null>(null);
  const chargerDoublons = useCallback(() => apiGet('/qualite/doublons').then(setDoublons).catch(() => setDoublons({ total: 0, certains: 0, paires: [] })), []);
  const chargerClients = useCallback(() => apiGet('/qualite/deja-clients').then(setDejaClients).catch(() => setDejaClients({ total: 0, certains: 0, paires: [] })), []);
  useEffect(() => { chargerDoublons(); chargerClients(); }, [chargerDoublons, chargerClients]);

  if (moi && !estAdmin && !faitDeLaProspection(moi)) {
    return <div className="p-6 text-sm text-gray-600">Cette page est réservée à la prospection.</div>;
  }

  const onglets: { id: Onglet; label: string; icone: typeof Copy; n?: number | null }[] = [
    { id: 'doublons', label: 'Doublons', icone: Copy, n: doublons?.total ?? null },
    { id: 'clients', label: 'Déjà clients', icone: Building2, n: dejaClients?.total ?? null },
    { id: 'completer', label: 'À compléter', icone: PencilLine, n: aCompleterListe.length },
    { id: 'trier', label: 'À trier', icone: Inbox, n: aTrierListe.length },
    { id: 'journal', label: 'Journal', icone: History },
  ];

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-brewery-600" /> Qualité des fiches
        </h1>
        <p className="text-sm text-gray-500 mt-1">Un fichier fiable : pas de doublon, pas de client démarché comme un inconnu, des fiches qu'on peut appeler sans chercher.</p>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {onglets.map(o => (
          <button
            key={o.id}
            onClick={() => setOnglet(o.id)}
            className={`flex-shrink-0 px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors ${onglet === o.id ? 'bg-brewery-600 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'}`}
          >
            <o.icone className="w-4 h-4" /> {o.label}
            {o.n !== undefined && (
              <span className={`text-xs tabular-nums px-1.5 rounded-full ${onglet === o.id ? 'bg-white/20' : 'bg-gray-100 text-gray-600'}`}>
                {o.n === null ? '…' : o.n}
              </span>
            )}
          </button>
        ))}
      </div>

      {onglet === 'doublons' && <OngletDoublons donnees={doublons} recharger={chargerDoublons} />}
      {onglet === 'clients' && <OngletDejaClients donnees={dejaClients} recharger={chargerClients} />}
      {onglet === 'completer' && <OngletACompleter liste={aCompleterListe} />}
      {onglet === 'trier' && <OngletATrier liste={aTrierListe} apresFusion={chargerDoublons} />}
      {onglet === 'journal' && <OngletJournal />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Doublons
// ---------------------------------------------------------------------------------------
function BadgeScore({ score, motif }: { score: number; motif: string }) {
  const certain = score === 100;
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${certain ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
      {certain ? 'Certain' : 'À vérifier'} · {motif}
    </span>
  );
}

function CarteFiche({ f, choisie, onChoisir, lienFiche = true }: { f: FicheVue; choisie?: boolean; onChoisir?: () => void; lienFiche?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 text-sm space-y-1 min-w-0 ${choisie ? 'border-brewery-500 ring-2 ring-brewery-100 bg-brewery-50/40' : 'border-gray-200'}`}>
      {onChoisir && (
        <label className="flex items-center gap-2 text-xs font-semibold text-brewery-800 cursor-pointer">
          <input type="radio" checked={!!choisie} onChange={onChoisir} /> Garder celle-ci
        </label>
      )}
      <p className="font-semibold text-gray-900 break-words">{f.nom}</p>
      <p className="text-xs text-gray-500">{[f.ville, PIPELINE_LABELS[f.etape_pipeline as keyof typeof PIPELINE_LABELS] || f.etape_pipeline, f.commercial].filter(Boolean).join(' · ')}</p>
      {f.telephone && <p className="text-xs text-gray-700 flex items-center gap-1"><Phone className="w-3 h-3" /> {f.telephone}</p>}
      {f.email && <p className="text-xs text-gray-700 flex items-center gap-1 break-all"><Mail className="w-3 h-3 flex-shrink-0" /> {f.email}</p>}
      {f.adresse && <p className="text-xs text-gray-700 flex items-center gap-1"><MapPin className="w-3 h-3 flex-shrink-0" /> {f.adresse}</p>}
      {f.siret && <p className="text-xs text-gray-500">SIRET {f.siret}</p>}
      <p className="text-xs text-gray-500 tabular-nums">{f.nb_appels} appel(s) · {f.nb_rdv} RDV · {f.nb_rappels} rappel(s)</p>
      {f.notes && <p className="text-xs text-gray-500 italic line-clamp-2">{f.notes}</p>}
      {lienFiche && <Link to={`/prospects?id=${encodeURIComponent(f.id)}`} className="text-xs text-brewery-700 hover:underline inline-flex items-center gap-0.5">Ouvrir la fiche <ChevronRight className="w-3 h-3" /></Link>}
    </div>
  );
}

function OngletDoublons({ donnees, recharger }: { donnees: { total: number; certains: number; paires: PaireDoublon[] } | null; recharger: () => void }) {
  const { dispatchLocal } = useApp();
  const toast = useToast();
  const [filtre, setFiltre] = useState<'tous' | 'certains' | 'verifier'>('tous');
  const [choix, setChoix] = useState<Record<string, string>>({});
  const [enCours, setEnCours] = useState('');
  const [retires, setRetires] = useState<Set<string>>(new Set());

  if (!donnees) return <Chargement />;
  const cle = (p: PaireDoublon) => p.fiches.map(f => f.id).sort().join('|');
  const paires = donnees.paires
    .filter(p => !retires.has(cle(p)) && !p.fiches.some(f => retires.has(f.id)))
    .filter(p => filtre === 'tous' || (filtre === 'certains' ? p.score === 100 : p.score < 100));

  const fusionner = async (p: PaireDoublon) => {
    const garderId = choix[cle(p)] || p.suggestion_garder;
    const garder = p.fiches.find(f => f.id === garderId)!;
    const absorbe = p.fiches.find(f => f.id !== garderId)!;
    if (!confirm(`« ${absorbe.nom} » sera fusionnée dans « ${garder.nom} ».\n\nSes appels, rendez-vous, rappels, étiquettes et notes passent sur la fiche gardée ; ses informations complètent les champs vides. La fiche « ${absorbe.nom} » part à la corbeille.`)) return;
    setEnCours(cle(p));
    try {
      const r = await apiPost('/qualite/fusionner', { garder_id: garder.id, absorber_id: absorbe.id }) as { prospect: Prospect; absorbe_id: string };
      dispatchLocal({ type: 'UPDATE_PROSPECT', payload: r.prospect });
      dispatchLocal({ type: 'DELETE_PROSPECT', payload: r.absorbe_id });
      setRetires(prev => new Set([...prev, cle(p), absorbe.id]));
      toast.success(`Fusionnée dans « ${garder.nom} »`);
      recharger();
    } catch (e) {
      toast.error(messageDe(e, 'La fusion a échoué'));
    } finally { setEnCours(''); }
  };

  const pasDoublon = async (p: PaireDoublon) => {
    setEnCours(cle(p));
    try {
      await apiPost('/qualite/pas-doublons', { a: p.fiches[0].id, b: p.fiches[1].id });
      setRetires(prev => new Set([...prev, cle(p)]));
    } catch (e) {
      toast.error(messageDe(e, 'Échec'));
    } finally { setEnCours(''); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-600"><strong className="tabular-nums">{donnees.total}</strong> paire(s), dont <strong className="tabular-nums">{donnees.certains}</strong> certaine(s)</span>
        <div className="flex gap-1 ml-auto">
          {(['tous', 'certains', 'verifier'] as const).map(f => (
            <button key={f} onClick={() => setFiltre(f)} className={`px-2.5 py-1 rounded-full text-xs font-medium ${filtre === f ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
              {f === 'tous' ? 'Toutes' : f === 'certains' ? 'Certaines' : 'À vérifier'}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-gray-500">Certaine : même SIRET, mail ou téléphone. À vérifier : même nom ou nom proche, dans la même commune. Dans le doute, ne fusionnez pas.</p>
      {paires.length === 0 && <Vide texte="Aucun doublon à traiter." />}
      {paires.map(p => {
        const garderId = choix[cle(p)] || p.suggestion_garder;
        return (
          <div key={cle(p)} className="bg-white rounded-xl border border-gray-200 p-3 space-y-3">
            <BadgeScore score={p.score} motif={p.motif} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {p.fiches.map(f => <CarteFiche key={f.id} f={f} choisie={f.id === garderId} onChoisir={() => setChoix(c => ({ ...c, [cle(p)]: f.id }))} />)}
            </div>
            <div className="flex flex-wrap gap-2">
              <button disabled={!!enCours} onClick={() => fusionner(p)} className="px-3 py-2 rounded-lg bg-brewery-600 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">
                {enCours === cle(p) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Merge className="w-4 h-4" />} Fusionner
              </button>
              <button disabled={!!enCours} onClick={() => pasDoublon(p)} className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
                <X className="w-4 h-4" /> Ce ne sont pas des doublons
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Déjà clients
// ---------------------------------------------------------------------------------------
function OngletDejaClients({ donnees, recharger }: { donnees: { total: number; certains: number; paires: PaireClient[] } | null; recharger: () => void }) {
  const { dispatchLocal } = useApp();
  const toast = useToast();
  const [retires, setRetires] = useState<Set<string>>(new Set());
  const [enCours, setEnCours] = useState('');
  if (!donnees) return <Chargement />;
  const cle = (p: PaireClient) => `${p.prospect.id}|${p.client.id}`;
  const paires = donnees.paires.filter(p => !retires.has(cle(p)) && !retires.has(p.prospect.id));

  const confirmer = async (p: PaireClient) => {
    setEnCours(cle(p));
    try {
      const r = await apiPost('/qualite/deja-client', { prospect_id: p.prospect.id, client_id: p.client.id }) as { prospect: Prospect };
      dispatchLocal({ type: 'UPDATE_PROSPECT', payload: r.prospect });
      setRetires(prev => new Set([...prev, p.prospect.id]));
      toast.success(`« ${p.prospect.nom} » passé en Gagné`);
      recharger();
    } catch (e) { toast.error(messageDe(e, 'Échec')); } finally { setEnCours(''); }
  };
  const pasLeMeme = async (p: PaireClient) => {
    setEnCours(cle(p));
    try {
      await apiPost('/qualite/pas-doublons', { a: p.prospect.id, b: p.client.id });
      setRetires(prev => new Set([...prev, cle(p)]));
    } catch (e) { toast.error(messageDe(e, 'Échec')); } finally { setEnCours(''); }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600"><strong className="tabular-nums">{donnees.total}</strong> prospect(s) en cours qui ressemblent à un client. On ne démarche pas un client comme un inconnu.</p>
      {paires.length === 0 && <Vide texte="Aucun prospect ne ressemble à un client." />}
      {paires.map(p => (
        <div key={cle(p)} className="bg-white rounded-xl border border-gray-200 p-3 space-y-3">
          <BadgeScore score={p.score} motif={p.motif} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <CarteFiche f={p.prospect} />
            <div className="rounded-lg border border-green-200 bg-green-50/50 p-3 text-sm space-y-1 min-w-0">
              <p className="text-[11px] font-semibold text-green-800 uppercase tracking-wide">Client</p>
              <p className="font-semibold text-gray-900 break-words">{p.client.nom}</p>
              <p className="text-xs text-gray-500">{[p.client.ville, p.client.statut, p.client.commercial].filter(Boolean).join(' · ')}</p>
              {p.client.telephone && <p className="text-xs text-gray-700 flex items-center gap-1"><Phone className="w-3 h-3" /> {p.client.telephone}</p>}
              {p.client.email && <p className="text-xs text-gray-700 break-all">{p.client.email}</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={!!enCours} onClick={() => confirmer(p)} className="px-3 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">
              {enCours === cle(p) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} C'est ce client → Gagné
            </button>
            <button disabled={!!enCours} onClick={() => pasLeMeme(p)} className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
              <X className="w-4 h-4" /> Pas le même
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Compléter une fiche : le petit formulaire commun à « À compléter » et « À trier »
// ---------------------------------------------------------------------------------------
type Saisie = { nom_etablissement: string; type_etablissement: string; telephone: string; email: string; nom_contact: string; adresse: string; code_postal: string; ville: string; siret: string };
const nomProvisoire = (nom: string) => /^Établissement partagé/i.test(nom || '');
// Un nom provisoire (« Établissement partagé 3 ») arrive vide : on tape le vrai, on n'efface pas l'autre.
const saisieDe = (p: Prospect): Saisie => ({
  nom_etablissement: nomProvisoire(p.nom_etablissement) ? '' : (p.nom_etablissement || ''), type_etablissement: p.type_etablissement || 'autre', telephone: p.telephone || '',
  email: p.email || '', nom_contact: p.nom_contact || '', adresse: p.adresse || '', code_postal: p.code_postal || '', ville: p.ville || '', siret: p.siret || '',
});

function LiensVerif({ nom, ville }: { nom: string; ville: string }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <a href={lienMaps(nom, ville)} target="_blank" rel="noopener noreferrer" className="px-2 py-1 rounded-md bg-blue-50 text-blue-700 inline-flex items-center gap-1 hover:bg-blue-100"><ExternalLink className="w-3 h-3" /> Google Maps</a>
      <a href={lienAnnuaire(nom, ville)} target="_blank" rel="noopener noreferrer" className="px-2 py-1 rounded-md bg-blue-50 text-blue-700 inline-flex items-center gap-1 hover:bg-blue-100"><ExternalLink className="w-3 h-3" /> Annuaire des entreprises</a>
    </div>
  );
}

function FormulaireFiche({ p, saisie, setSaisie }: { p: Prospect; saisie: Saisie; setSaisie: (s: Saisie) => void }) {
  const champ = (k: keyof Saisie, label: string, props: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <label className="block">
      <span className="block text-[11px] font-medium text-gray-500 mb-0.5">{label}</span>
      <input
        className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
        value={saisie[k]}
        onChange={e => setSaisie({ ...saisie, [k]: e.target.value })}
        {...props}
      />
    </label>
  );
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {nomProvisoire(p.nom_etablissement) && champ('nom_etablissement', 'Vrai nom de l\'établissement', { placeholder: 'À trouver sur Google Maps ou le lien partagé' })}
      <label className="block">
        <span className="block text-[11px] font-medium text-gray-500 mb-0.5">Type</span>
        <select className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white" value={saisie.type_etablissement} onChange={e => setSaisie({ ...saisie, type_etablissement: e.target.value })}>
          {(Object.keys(ESTABLISHMENT_LABELS) as EstablishmentType[]).map(t => <option key={t} value={t}>{ESTABLISHMENT_LABELS[t]}</option>)}
        </select>
      </label>
      {champ('telephone', 'Téléphone', { type: 'tel', inputMode: 'tel' })}
      {champ('adresse', 'Adresse')}
      <div className="grid grid-cols-[6rem_1fr] gap-2">
        {champ('code_postal', 'Code postal', { inputMode: 'numeric' })}
        {champ('ville', 'Commune')}
      </div>
      {champ('nom_contact', 'Contact (gérant)')}
      {champ('email', 'Mail', { type: 'email', inputMode: 'email' })}
      {champ('siret', 'SIRET', { inputMode: 'numeric' })}
    </div>
  );
}

/** Enregistre ce qui a changé dans la saisie. Renvoie la fiche à jour (ou celle d'avant si rien n'a bougé). */
async function enregistrerSaisie(p: Prospect, saisie: Saisie): Promise<Prospect> {
  const avant = saisieDe(p);
  const changes: Partial<Saisie> = {};
  (Object.keys(saisie) as (keyof Saisie)[]).forEach(k => { if (saisie[k].trim() !== avant[k].trim()) changes[k] = saisie[k].trim(); });
  if (!changes.nom_etablissement) delete changes.nom_etablissement; // un nom vide ne remplace rien
  if (Object.keys(changes).length === 0) return p;
  const r = await apiPost(`/qualite/completer/${encodeURIComponent(p.id)}`, changes) as { prospect: Prospect };
  return r.prospect;
}

function Manques({ p }: { p: Prospect }) {
  const bloquants = manquesBloquants(p);
  const m = manquesDeLaFiche(p);
  return (
    <div className="flex flex-wrap gap-1">
      {m.map(x => (
        <span key={x} className={`text-[11px] px-1.5 py-0.5 rounded-full ${bloquants.includes(x) ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
          sans {LIBELLES_MANQUE[x]}
        </span>
      ))}
    </div>
  );
}

function OngletACompleter({ liste }: { liste: Prospect[] }) {
  const { dispatchLocal } = useApp();
  const toast = useToast();
  // Plusieurs manques cochés = les fiches qui les cumulent tous (sans téléphone ET sans commune).
  const [filtresChoisis, setFiltresChoisis] = usePersistedState<Manque[]>('qualite_filtres_manques', []);
  const choisis = Array.isArray(filtresChoisis) ? filtresChoisis : [];
  const basculer = (f: Manque) => setFiltresChoisis(choisis.includes(f) ? choisis.filter(x => x !== f) : [...choisis, f]);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [saisie, setSaisie] = useState<Saisie | null>(null);
  const [nb, setNb] = useState(30);
  const [enCours, setEnCours] = useState(false);

  const filtres: Manque[] = ['telephone', 'commune', 'type', 'nom', 'carte'];
  const correspond = (p: Prospect, filtres: Manque[]) => { const m = manquesDeLaFiche(p); return filtres.every(f => m.includes(f)); };
  // Le chiffre d'un filtre = ce qu'on obtiendrait en l'ajoutant à ceux déjà cochés.
  const comptes = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of filtres) {
      const avec = choisis.includes(f) ? choisis : [...choisis, f];
      c[f] = liste.filter(p => correspond(p, avec)).length;
    }
    return c;
  }, [liste, choisis.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const visibles = useMemo(
    () => liste.filter(p => correspond(p, choisis))
      .sort((a, b) => manquesBloquants(b).length - manquesBloquants(a).length || a.nom_etablissement.localeCompare(b.nom_etablissement)),
    [liste, choisis.join(',')], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const ouvrir = (p: Prospect) => { setOuvert(p.id); setSaisie(saisieDe(p)); };
  const enregistrer = async (p: Prospect) => {
    if (!saisie) return;
    setEnCours(true);
    try {
      const maj = await enregistrerSaisie(p, saisie);
      dispatchLocal({ type: 'UPDATE_PROSPECT', payload: maj });
      toast.success(aCompleter(maj) ? 'Enregistré — il manque encore des choses' : 'Fiche complète');
      setOuvert(null);
    } catch (e) { toast.error(messageDe(e, 'Échec de l\'enregistrement')); } finally { setEnCours(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600"><strong className="tabular-nums">{liste.length}</strong> fiche(s) en cours à compléter. Une fiche est qualifiable avec un téléphone, une commune et un type.</p>
      <div className="flex gap-1.5 flex-wrap">
        <button onClick={() => setFiltresChoisis([])} className={`px-2.5 py-1 rounded-full text-xs font-medium ${choisis.length === 0 ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>Toutes</button>
        {filtres.map(f => (
          <button key={f} aria-pressed={choisis.includes(f)} onClick={() => basculer(f)} className={`px-2.5 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1 ${choisis.includes(f) ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {choisis.includes(f) && <Check className="w-3 h-3" />}
            Sans {LIBELLES_MANQUE[f]} <span className="tabular-nums opacity-70">{comptes[f] || 0}</span>
          </button>
        ))}
      </div>
      {choisis.length > 1 && (
        <p className="text-xs text-gray-600"><strong className="tabular-nums">{visibles.length}</strong> fiche(s) sans {choisis.map(f => LIBELLES_MANQUE[f]).join(' ni ')}.</p>
      )}
      {visibles.length === 0 && <Vide texte="Rien à compléter ici." />}
      <div className="space-y-2">
        {visibles.slice(0, nb).map(p => (
          <div key={p.id} className="bg-white rounded-xl border border-gray-200">
            <button className="w-full text-left p-3 flex items-start gap-2" onClick={() => (ouvert === p.id ? setOuvert(null) : ouvrir(p))}>
              <div className="flex-1 min-w-0 space-y-1">
                <p className="font-medium text-gray-900 truncate">{p.nom_etablissement}</p>
                <p className="text-xs text-gray-500 truncate">{[p.ville, PIPELINE_LABELS[p.etape_pipeline]].filter(Boolean).join(' · ')}</p>
                <Manques p={p} />
              </div>
              <ChevronRight className={`w-4 h-4 text-gray-400 flex-shrink-0 mt-1 transition-transform ${ouvert === p.id ? 'rotate-90' : ''}`} />
            </button>
            {ouvert === p.id && saisie && (
              <div className="px-3 pb-3 space-y-3 border-t border-gray-100 pt-3">
                <LiensVerif nom={nomProvisoire(p.nom_etablissement) ? (p.adresse || '') : p.nom_etablissement} ville={p.ville} />
                <FormulaireFiche p={p} saisie={saisie} setSaisie={setSaisie} />
                <div className="flex gap-2">
                  <button disabled={enCours} onClick={() => enregistrer(p)} className="px-3 py-2 rounded-lg bg-brewery-600 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">
                    {enCours ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Enregistrer
                  </button>
                  <Link to={`/prospects?id=${encodeURIComponent(p.id)}`} className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium">Fiche complète</Link>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {visibles.length > nb && (
        <button onClick={() => setNb(n => n + 30)} className="w-full py-2 text-sm text-brewery-700 font-medium bg-white border border-gray-200 rounded-lg">
          Voir 30 de plus ({visibles.length - nb} restantes)
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// À trier : une fiche partagée à la fois
// ---------------------------------------------------------------------------------------
function OngletATrier({ liste, apresFusion }: { liste: Prospect[]; apresFusion: () => void }) {
  const { state, dispatchLocal } = useApp();
  const toast = useToast();
  const [passees, setPassees] = useState<Set<string>>(new Set());
  const file = liste.filter(p => !passees.has(p.id));
  const p = file[0];
  const [saisie, setSaisie] = useState<Saisie | null>(null);
  const [note, setNote] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [voirDoublons, setVoirDoublons] = useState(false);

  useEffect(() => { setSaisie(p ? saisieDe(p) : null); setNote(''); setVoirDoublons(false); }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const candidats = useMemo(() => {
    if (!p || !saisie) return [];
    return candidatsDoublons({ nom: p.nom_etablissement, telephone: saisie.telephone, email: saisie.email }, state.prospects)
      .filter(x => x.id !== p.id).slice(0, 5);
  }, [p, saisie, state.prospects]);

  if (liste.length === 0) return <Vide texte="Rien à trier : toutes les fiches partagées ont été traitées." />;
  if (!p || !saisie) return <Vide texte={`Vous avez passé les ${passees.size} fiche(s) restantes.`} />;

  // Ce que donnerait la fiche avec la saisie en cours : « Qualifiée » s'allume dès qu'elle suffit.
  const apercu = { ...p, ...saisie, nom_etablissement: saisie.nom_etablissement.trim() || p.nom_etablissement };
  const qualifiable = estQualifiable(apercu);

  const decider = async (decision: 'qualifiee' | 'pas_pour_nous' | 'ferme') => {
    setEnCours(true);
    try {
      const maj = await enregistrerSaisie(p, saisie);
      if (maj !== p) dispatchLocal({ type: 'UPDATE_PROSPECT', payload: maj });
      const r = await apiPost(`/qualite/trier/${encodeURIComponent(p.id)}`, { decision, note }) as { prospect: Prospect };
      dispatchLocal({ type: 'UPDATE_PROSPECT', payload: r.prospect });
      toast.success(decision === 'qualifiee' ? 'Qualifiée → À contacter' : decision === 'ferme' ? 'Fermé → Perdu' : 'Pas pour nous → Ne pas contacter');
    } catch (e) { toast.error(messageDe(e, 'Échec')); } finally { setEnCours(false); }
  };

  const fusionnerDans = async (garder: Prospect) => {
    if (!confirm(`Fusionner « ${p.nom_etablissement} » dans « ${garder.nom_etablissement} » ?\n\nLa fiche partagée part à la corbeille ; ses informations complètent l'autre.`)) return;
    setEnCours(true);
    try {
      const r = await apiPost('/qualite/fusionner', { garder_id: garder.id, absorber_id: p.id }) as { prospect: Prospect; absorbe_id: string };
      dispatchLocal({ type: 'UPDATE_PROSPECT', payload: r.prospect });
      dispatchLocal({ type: 'DELETE_PROSPECT', payload: r.absorbe_id });
      toast.success(`Fusionnée dans « ${garder.nom_etablissement} »`);
      apresFusion();
    } catch (e) { toast.error(messageDe(e, 'La fusion a échoué')); } finally { setEnCours(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Fiche <strong className="tabular-nums">1</strong> sur <strong className="tabular-nums">{file.length}</strong> à trier — les plus anciennes d'abord.</p>
      <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-3">
        <div>
          <p className="font-semibold text-gray-900 text-base break-words">{p.nom_etablissement}</p>
          <p className="text-xs text-gray-500">{[p.ville, p.commercial_id && state.commerciaux.find(c => c.id === p.commercial_id)?.prenom, p.date_creation && `partagée le ${new Date(p.date_creation).toLocaleDateString('fr-FR')}`].filter(Boolean).join(' · ')}</p>
          {p.source_url && <a href={p.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-brewery-700 hover:underline break-all inline-flex items-center gap-1 mt-1"><ExternalLink className="w-3 h-3 flex-shrink-0" /> Lien partagé</a>}
          {p.notes && <p className="text-xs text-gray-600 mt-1 whitespace-pre-line line-clamp-4">{p.notes}</p>}
        </div>
        <Manques p={apercu as Prospect} />
        <LiensVerif nom={saisie.nom_etablissement || (nomProvisoire(p.nom_etablissement) ? '' : p.nom_etablissement)} ville={saisie.ville} />
        <FormulaireFiche p={p} saisie={saisie} setSaisie={setSaisie} />
        <label className="block">
          <span className="block text-[11px] font-medium text-gray-500 mb-0.5">Note (ce que vous avez vérifié, et où)</span>
          <input className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Ex. : tél. vérifié sur Google Maps" value={note} onChange={e => setNote(e.target.value)} />
        </label>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button disabled={enCours || !qualifiable} onClick={() => decider('qualifiee')} title={qualifiable ? '' : `Il manque : ${manquesBloquants(apercu).map(m => LIBELLES_MANQUE[m]).join(', ')}`} className="col-span-2 sm:col-span-1 px-3 py-2.5 rounded-lg bg-green-600 text-white text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40">
            <Check className="w-4 h-4" /> Qualifiée
          </button>
          <button disabled={enCours} onClick={() => decider('pas_pour_nous')} className="px-3 py-2.5 rounded-lg bg-gray-100 text-gray-800 text-sm font-medium">Pas pour nous</button>
          <button disabled={enCours} onClick={() => decider('ferme')} className="px-3 py-2.5 rounded-lg bg-gray-100 text-gray-800 text-sm font-medium">Fermé</button>
          <button disabled={enCours} onClick={() => setVoirDoublons(v => !v)} className="px-3 py-2.5 rounded-lg bg-amber-50 text-amber-800 text-sm font-medium flex items-center justify-center gap-1"><Copy className="w-4 h-4" /> Doublon ?</button>
        </div>
        {!qualifiable && <p className="text-xs text-red-700">Pour « Qualifiée », il manque : {manquesBloquants(apercu).map(m => LIBELLES_MANQUE[m]).join(', ')}.</p>}

        {voirDoublons && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-2 space-y-2">
            {candidats.length === 0 && <p className="text-xs text-gray-600">Aucune fiche ne ressemble à celle-ci (nom, téléphone ou mail).</p>}
            {candidats.map(c => (
              <div key={c.id} className="flex items-center gap-2 text-sm">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{c.nom_etablissement}</p>
                  <p className="text-xs text-gray-500 truncate">{[c.ville, c.telephone, PIPELINE_LABELS[c.etape_pipeline]].filter(Boolean).join(' · ')}</p>
                </div>
                <button disabled={enCours} onClick={() => fusionnerDans(c)} className="px-2 py-1.5 rounded-md bg-brewery-600 text-white text-xs font-semibold flex-shrink-0">Fusionner dedans</button>
              </div>
            ))}
          </div>
        )}

        <button disabled={enCours} onClick={() => setPassees(prev => new Set([...prev, p.id]))} className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1">
          <SkipForward className="w-3.5 h-3.5" /> Passer pour l'instant
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------------------
function OngletJournal() {
  const { state, dispatchLocal } = useApp();
  const toast = useToast();
  const estAdmin = state.currentUser?.role === 'admin';
  const [jours, setJours] = useState(7);
  const [qui, setQui] = useState('');
  const [journal, setJournal] = useState<Journal | null>(null);
  const [enCours, setEnCours] = useState<number | null>(null);

  const charger = useCallback(() => {
    const depuis = new Date(Date.now() - jours * 86400000);
    const d = `${depuis.getFullYear()}-${String(depuis.getMonth() + 1).padStart(2, '0')}-${String(depuis.getDate()).padStart(2, '0')}`;
    apiGet(`/qualite/journal?depuis=${d}${qui ? `&qui=${encodeURIComponent(qui)}` : ''}`).then(setJournal).catch(() => setJournal({ depuis: d, totaux: [], lignes: [] }));
  }, [jours, qui]);
  useEffect(() => { charger(); }, [charger]);

  const annuler = async (l: LigneJournal) => {
    if (!confirm(`Défaire : ${l.details} ?`)) return;
    setEnCours(l.id);
    try {
      const r = await apiPost(`/qualite/journal/${l.id}/annuler`, {}) as { message: string; prospects: Prospect[] };
      for (const p of r.prospects || []) {
        dispatchLocal({ type: state.prospects.some(x => x.id === p.id) ? 'UPDATE_PROSPECT' : 'ADD_PROSPECT', payload: p });
      }
      toast.success(r.message);
      charger();
    } catch (e) { toast.error(messageDe(e, 'Impossible de défaire')); } finally { setEnCours(null); }
  };

  if (!journal) return <Chargement />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <select className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white" value={jours} onChange={e => setJours(Number(e.target.value))}>
          <option value={1}>Aujourd'hui</option>
          <option value={7}>7 derniers jours</option>
          <option value={30}>30 derniers jours</option>
        </select>
        {estAdmin && (
          <select className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white" value={qui} onChange={e => setQui(e.target.value)}>
            <option value="">Toute l'équipe</option>
            {state.commerciaux.map(c => <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>)}
          </select>
        )}
      </div>

      {journal.totaux.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {journal.totaux.map(t => (
            <div key={t.user_id} className="bg-white rounded-xl border border-gray-200 p-3">
              <p className="font-semibold text-gray-900">{t.qui} · <span className="tabular-nums">{t.total}</span> geste(s)</p>
              <p className="text-xs text-gray-600 mt-1">
                {Object.entries(t.par_action).map(([a, n]) => `${n} ${LIBELLE_ACTION[a]?.toLowerCase() || a}`).join(' · ')}
              </p>
            </div>
          ))}
        </div>
      )}

      {journal.lignes.length === 0 && <Vide texte="Rien sur cette période." />}
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {journal.lignes.map(l => (
          <div key={l.id} className={`p-3 flex items-start gap-2 text-sm ${l.annule ? 'opacity-50' : ''}`}>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500">
                {new Date(l.le).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {l.qui} ·{' '}
                <span className="font-medium text-gray-700">{LIBELLE_ACTION[l.action] || l.action}</span>
                {l.annule && <span className="ml-1 text-red-600">(défait)</span>}
              </p>
              <p className="text-gray-800 break-words">{l.details}</p>
            </div>
            {estAdmin && l.annulable && (
              <button disabled={enCours === l.id} onClick={() => annuler(l)} className="px-2 py-1 rounded-md bg-gray-100 text-gray-700 text-xs font-medium flex items-center gap-1 flex-shrink-0">
                {enCours === l.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />} Annuler
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Chargement() {
  return <div className="flex items-center gap-2 text-sm text-gray-500 py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Recherche en cours…</div>;
}
function Vide({ texte }: { texte: string }) {
  return <div className="text-center text-sm text-gray-500 py-10 bg-white rounded-xl border border-dashed border-gray-200">{texte}</div>;
}
