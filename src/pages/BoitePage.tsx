import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Inbox, Share2, ExternalLink, MapPin, Phone, Building2, Landmark, AlertTriangle, Check, X, Link2, RotateCcw, Search, MessageSquare, UserPlus, Loader2, Trash2,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import { apiPatch, apiDelete } from '../api/client';
import { Client, EstablishmentType, ESTABLISHMENT_LABELS, Prospect, Signalement } from '../types';
import { LIBELLES_SOURCE, aQualifier, concerne, estLienGoogle, grouper, lienMapsDepuisAdresse, titreDuSignalement } from '../utils/signalements';
import { faitDeLaProspection } from '../utils/roles';
import { formatDate } from '../utils/helpers';
import { formaterSiren, formaterSiret, tvaIntracom } from '../../shared/siret';
import { sansAccents } from '../../shared/normalisation';
import { GaleriePhotos } from '../components/PhotosSignalement';

// La boîte de prospection : ce que l'équipe a partagé attend ici. Chaque signalement (ou
// groupe de signalements sur le même établissement) se qualifie en un geste : créer le
// prospect, rattacher à une fiche existante, ou ignorer.
type Onglet = 'a_qualifier' | 'traites';

const COULEUR_SOURCE: Record<Signalement['source'], string> = {
  google: 'bg-blue-50 text-blue-700 border-blue-200',
  instagram: 'bg-pink-50 text-pink-700 border-pink-200',
  facebook: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  tiktok: 'bg-gray-900 text-white border-gray-900',
  linkedin: 'bg-sky-50 text-sky-700 border-sky-200',
  site: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  texte: 'bg-gray-50 text-gray-600 border-gray-200',
  photo: 'bg-amber-50 text-amber-700 border-amber-200',
  // Ce que Claude a déposé se repère au premier coup d'œil, comme n'importe quelle source.
  claude: 'bg-violet-50 text-violet-700 border-violet-200',
};

function hier(iso: string): string {
  const d = new Date(iso);
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `il y a ${h} h`;
  return `le ${formatDate(iso)}`;
}

export default function BoitePage() {
  const { state, dispatchLocal } = useApp();
  const toast = useToast();
  const moi = state.currentUser;
  const [onglet, setOnglet] = useState<Onglet>('a_qualifier');
  const [perimetre, setPerimetre] = useState<'moi' | 'tous'>(moi?.role === 'admin' ? 'tous' : 'moi');
  const [creation, setCreation] = useState<Signalement[] | null>(null);
  const [rattachement, setRattachement] = useState<Signalement[] | null>(null);
  const [occupe, setOccupe] = useState<string>('');
  const prospection = faitDeLaProspection(moi);

  const nomDe = (id: string) => { const c = state.commerciaux.find(x => x.id === id); return c ? c.prenom : id || '—'; };
  const enAttente = useMemo(() => aQualifier(state), [state]);
  const visibles = useMemo(() => {
    const liste = onglet === 'a_qualifier' ? enAttente : state.signalements.filter(s => s.statut !== 'a_qualifier');
    return moi && perimetre === 'moi' ? liste.filter(s => concerne(s, moi, prospection)) : liste;
  }, [onglet, enAttente, state.signalements, perimetre, moi, prospection]);
  const groupes = useMemo(() => grouper(visibles), [visibles]);

  const appliquer = async (groupe: Signalement[], action: 'ignorer' | 'rouvrir') => {
    setOccupe(groupe[0].id);
    try {
      for (const s of groupe) {
        const r = await apiPatch(`/signalements/${s.id}`, { action }) as { signalement: Signalement };
        dispatchLocal({ type: 'UPSERT_SIGNALEMENT', payload: r.signalement });
      }
      toast.success(action === 'ignorer' ? 'Signalement ignoré' : 'Signalement rouvert');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action impossible');
    } finally { setOccupe(''); }
  };

  const supprimer = async (s: Signalement) => {
    if (!window.confirm('Supprimer ce signalement ?')) return;
    try {
      await apiDelete(`/signalements/${s.id}`);
      dispatchLocal({ type: 'DELETE_SIGNALEMENT', payload: s.id });
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Suppression impossible'); }
  };

  if (!moi) return null;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4 fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Inbox className="w-5 h-5 text-brewery-600" /> Boîte de prospection</h1>
          <p className="text-sm text-gray-500 mt-1">Ce que l'équipe a partagé, à qualifier avant d'entrer dans le pipeline.</p>
        </div>
        <Link to="/partage" className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brewery-600 text-white text-sm font-semibold hover:bg-brewery-700 self-start">
          <Share2 className="w-4 h-4" /> Signaler un prospect
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5 font-medium" role="group" aria-label="Statut">
          <button type="button" onClick={() => setOnglet('a_qualifier')} className={`px-2.5 py-1 rounded-md ${onglet === 'a_qualifier' ? 'bg-white text-brewery-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>À qualifier{enAttente.length ? ` (${enAttente.length})` : ''}</button>
          <button type="button" onClick={() => setOnglet('traites')} className={`px-2.5 py-1 rounded-md ${onglet === 'traites' ? 'bg-white text-brewery-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Traités</button>
        </div>
        <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5 font-medium" role="group" aria-label="Périmètre">
          <button type="button" onClick={() => setPerimetre('moi')} className={`px-2.5 py-1 rounded-md ${perimetre === 'moi' ? 'bg-white text-brewery-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Pour moi</button>
          <button type="button" onClick={() => setPerimetre('tous')} className={`px-2.5 py-1 rounded-md ${perimetre === 'tous' ? 'bg-white text-brewery-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Tous</button>
        </div>
      </div>

      {groupes.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500">
          {onglet === 'a_qualifier' ? 'Rien à qualifier. Ce qui est partagé depuis le téléphone ou collé dans « Signaler un prospect » arrive ici.' : 'Aucun signalement traité ce mois-ci.'}
        </div>
      )}

      <div className="space-y-3">
        {groupes.map(groupe => {
          const s = groupe[0];
          const autres = groupe.slice(1);
          const fiche = s.fiche;
          const doublons = fiche.doublons || [];
          const adresse = [fiche.adresse, [fiche.code_postal, fiche.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
          const prospectLie = s.prospect_id ? state.prospects.find(p => p.id === s.prospect_id) : undefined;
          const clientLie = s.client_id ? state.clients.find(c => c.id === s.client_id) : undefined;
          const enCours = occupe === s.id;
          return (
            <div key={s.id} className={`bg-white rounded-xl border p-4 space-y-3 ${s.statut === 'ignore' ? 'border-gray-200 opacity-70' : s.statut === 'traite' ? 'border-green-200' : 'border-gray-200'}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[11px] px-1.5 py-0.5 rounded-full border ${COULEUR_SOURCE[s.source]}`}>{LIBELLES_SOURCE[s.source]}</span>
                    <h2 className="font-semibold text-gray-900 truncate">{titreDuSignalement(s)}</h2>
                    {fiche.compte && fiche.compte !== titreDuSignalement(s) && <span className="text-xs text-gray-500">{fiche.compte}</span>}
                    {groupe.length > 1 && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-brewery-50 text-brewery-700 border border-brewery-200">{groupe.length} partages</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Partagé par <span className="font-medium text-gray-700">{nomDe(s.partage_par)}</span> {hier(s.created_at)} · pour <span className="font-medium text-gray-700">{s.commercial_id ? nomDe(s.commercial_id) : 'la prospection'}</span>
                  </p>
                </div>
                {s.lien && (
                  <a href={s.lien} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-600 hover:underline whitespace-nowrap"><ExternalLink className="w-3.5 h-3.5" /> {estLienGoogle(s.lien) ? 'Fiche Google' : 'Ouvrir'}</a>
                )}
              </div>

              <GaleriePhotos signalements={groupe} taille="grande" />

              {(adresse || fiche.telephone || fiche.categorie_google) && (
                <div className="text-sm text-gray-700 space-y-0.5">
                  {/* L'adresse s'ouvre dans Google Maps, comme le téléphone appelle : une
                      recherche par nom et adresse tombe sur la bonne fiche à tous les coups. */}
                  {adresse && (
                    <p className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <a
                        href={lienMapsDepuisAdresse(titreDuSignalement(s), adresse)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {adresse}
                      </a>
                    </p>
                  )}
                  {/* Le téléphone appelle, comme partout ailleurs dans l'application : ici il
                      avait l'icône sans le lien. */}
                  {fiche.telephone && (
                    <p className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <a href={`tel:${String(fiche.telephone).replace(/\s/g, '')}`} className="text-blue-600 hover:underline">
                        {fiche.telephone}
                      </a>
                    </p>
                  )}
                  {fiche.categorie_google && <p className="flex items-center gap-2"><Building2 className="w-3.5 h-3.5 text-gray-400" /> {fiche.categorie_google}</p>}
                </div>
              )}

              {/* L'identité légale quand elle a été trouvée. Le numéro de TVA n'est pas
                  stocké : il se calcule depuis le SIREN, donc il ne peut pas être faux. */}
              {(fiche.raison_sociale || fiche.siret || fiche.siren) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                  <Landmark className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  {fiche.raison_sociale && <span className="text-gray-700 font-medium">{fiche.raison_sociale}</span>}
                  {fiche.siret
                    ? <span>SIRET {formaterSiret(fiche.siret)}</span>
                    : fiche.siren ? <span>SIREN {formaterSiren(fiche.siren)}</span> : null}
                  {tvaIntracom(fiche.siren || fiche.siret || '') && <span>TVA {tvaIntracom(fiche.siren || fiche.siret || '')}</span>}
                </div>
              )}

              {/* Un dépôt de Claude est déjà structuré : son texte n'est que la mise bout à bout
                  des champs affichés au-dessus, le répéter n'apprend rien. */}
              {(s.commentaire || autres.some(a => a.commentaire) || (!s.lien && s.source !== 'claude')) && (
                <div className="space-y-1">
                  {!s.lien && s.source !== 'claude' && s.texte && s.texte !== titreDuSignalement(s) && <p className="text-sm text-gray-600 whitespace-pre-wrap">{s.texte}</p>}
                  {[s, ...autres].filter(a => a.commentaire).map(a => (
                    <p key={a.id} className="text-sm text-gray-700 flex items-start gap-2"><MessageSquare className="w-3.5 h-3.5 text-gray-400 mt-1 flex-shrink-0" /><span>« {a.commentaire} » <span className="text-xs text-gray-500">— {nomDe(a.partage_par)}</span></span></p>
                  ))}
                </div>
              )}
              {autres.length > 0 && (
                <p className="text-xs text-gray-500">Aussi partagé par {autres.map(a => `${nomDe(a.partage_par)} ${hier(a.created_at)}`).join(', ')}.</p>
              )}

              {s.statut === 'a_qualifier' && doublons.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">
                  <p className="font-medium flex items-center gap-2 text-xs"><AlertTriangle className="w-3.5 h-3.5" /> Ressemble à une fiche existante</p>
                  <ul className="mt-1 space-y-0.5">
                    {doublons.map(d => (
                      <li key={`${d.genre}-${d.id}`} className="flex items-center gap-2">
                        <Link to={d.genre === 'client' ? `/clients?id=${d.id}` : `/prospects?id=${d.id}`} className="text-brewery-700 hover:underline">{d.nom}{d.ville ? ` · ${d.ville}` : ''}</Link>
                        <span className="text-[11px] bg-amber-100 px-1.5 py-0.5 rounded-full">{d.genre === 'client' ? 'client' : `prospect · ${state.pipelineColumns.find(c => c.id === d.etape)?.label || d.etape}`}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {s.statut === 'a_qualifier' ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" disabled={enCours} onClick={() => setCreation(groupe)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brewery-600 text-white text-xs font-semibold hover:bg-brewery-700 disabled:opacity-50"><UserPlus className="w-3.5 h-3.5" /> Créer le prospect</button>
                  <button type="button" disabled={enCours} onClick={() => setRattachement(groupe)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-700 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"><Link2 className="w-3.5 h-3.5" /> Rattacher à une fiche</button>
                  <button type="button" disabled={enCours} onClick={() => appliquer(groupe, 'ignorer')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-500 text-xs font-medium hover:bg-gray-50 disabled:opacity-50">{enCours ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />} Ignorer</button>
                  {(s.partage_par === moi.id || moi.role === 'admin') && groupe.length === 1 && (
                    <button type="button" onClick={() => supprimer(s)} className="ml-auto flex items-center gap-1 px-2 py-1.5 rounded-lg text-gray-400 hover:text-red-600 text-xs" title="Supprimer ce signalement"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                  {s.statut === 'ignore' && <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600">Ignoré par {nomDe(s.traite_par)}</span>}
                  {s.statut === 'traite' && prospectLie && <Link to={`/prospects?id=${prospectLie.id}`} className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 hover:underline"><Check className="w-3 h-3" /> {s.client_id ? 'Rattaché au prospect' : 'Prospect créé'} : {prospectLie.nom_etablissement}</Link>}
                  {s.statut === 'traite' && clientLie && <Link to={`/clients?id=${clientLie.id}`} className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 hover:underline"><Check className="w-3 h-3" /> Rattaché au client : {clientLie.nom}</Link>}
                  {s.statut === 'traite' && !prospectLie && !clientLie && <span className="px-2 py-1 rounded-full bg-green-50 text-green-700">Traité par {nomDe(s.traite_par)}</span>}
                  {s.statut === 'ignore' && <button type="button" disabled={enCours} onClick={() => appliquer(groupe, 'rouvrir')} className="flex items-center gap-1 text-brewery-700 hover:underline"><RotateCcw className="w-3 h-3" /> Rouvrir</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {creation && <CreationModal groupe={creation} onClose={() => setCreation(null)} />}
      {rattachement && <RattachementModal groupe={rattachement} onClose={() => setRattachement(null)} />}
    </div>
  );
}

// « Créer le prospect » : la fiche lue, corrigeable, et à qui elle est confiée. Les autres
// partages du même établissement sont rattachés au prospect créé.
function CreationModal({ groupe, onClose }: { groupe: Signalement[]; onClose: () => void }) {
  const { state, dispatchLocal } = useApp();
  const toast = useToast();
  const s = groupe[0];
  const moi = state.currentUser;
  const [form, setForm] = useState({
    nom_etablissement: titreDuSignalement(s) === s.lien ? '' : (s.fiche.nom_etablissement || titreDuSignalement(s)),
    type_etablissement: (s.fiche.type_etablissement || 'autre') as EstablishmentType,
    telephone: s.fiche.telephone || '',
    adresse: s.fiche.adresse || '',
    code_postal: s.fiche.code_postal || '',
    ville: s.fiche.ville || '',
    nom_contact: s.fiche.nom_contact || '',
    email: s.fiche.email || '',
    raison_sociale: s.fiche.raison_sociale || '',
    siret: s.fiche.siret || '',
    commercial_id: s.commercial_id || moi?.id || '',
  });
  const [enCours, setEnCours] = useState(false);
  const maj = (champ: keyof typeof form, valeur: string) => setForm(f => ({ ...f, [champ]: valeur }));

  const creer = async () => {
    if (!form.nom_etablissement.trim()) { toast.error("Le nom de l'établissement est requis"); return; }
    setEnCours(true);
    try {
      const r = await apiPatch(`/signalements/${s.id}`, { action: 'creer', prospect: form }) as { signalement: Signalement; prospect: Prospect };
      dispatchLocal({ type: 'ADD_PROSPECT', payload: r.prospect });
      dispatchLocal({ type: 'UPSERT_SIGNALEMENT', payload: r.signalement });
      for (const autre of groupe.slice(1)) {
        const ra = await apiPatch(`/signalements/${autre.id}`, { action: 'rattacher', prospect_id: r.prospect.id }) as { signalement: Signalement; prospect?: Prospect };
        dispatchLocal({ type: 'UPSERT_SIGNALEMENT', payload: ra.signalement });
        if (ra.prospect) dispatchLocal({ type: 'UPDATE_PROSPECT', payload: ra.prospect });
      }
      toast.success(`« ${r.prospect.nom_etablissement} » créé en « Nouveau partagé »`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Création impossible');
    } finally { setEnCours(false); }
  };

  const champ = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm';
  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900 flex items-center gap-2"><UserPlus className="w-4 h-4 text-brewery-600" /> Créer le prospect</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nom de l'établissement</label>
            <input className={champ} value={form.nom_etablissement} onChange={e => maj('nom_etablissement', e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
              <select className={`${champ} bg-white`} value={form.type_etablissement} onChange={e => maj('type_etablissement', e.target.value)}>
                {(Object.keys(ESTABLISHMENT_LABELS) as EstablishmentType[]).map(t => <option key={t} value={t}>{ESTABLISHMENT_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Téléphone</label>
              <input className={champ} value={form.telephone} onChange={e => maj('telephone', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
            <input className={champ} type="email" value={form.email} onChange={e => maj('email', e.target.value)} placeholder="Optionnel" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Raison sociale</label>
              <input className={champ} value={form.raison_sociale} onChange={e => maj('raison_sociale', e.target.value)} placeholder="Optionnel" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">SIRET</label>
              <input className={champ} value={form.siret} onChange={e => maj('siret', e.target.value)} placeholder="Optionnel" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Adresse</label>
            <input className={champ} value={form.adresse} onChange={e => maj('adresse', e.target.value)} />
          </div>
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Code postal</label>
              <input className={champ} value={form.code_postal} onChange={e => maj('code_postal', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Commune</label>
              <input className={champ} value={form.ville} onChange={e => maj('ville', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Contact</label>
              <input className={champ} value={form.nom_contact} onChange={e => maj('nom_contact', e.target.value)} placeholder="Optionnel" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Confié à</label>
              <select className={`${champ} bg-white`} value={form.commercial_id} onChange={e => maj('commercial_id', e.target.value)}>
                {state.commerciaux.map(c => <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>)}
              </select>
            </div>
          </div>
          {s.lien && <p className="text-xs text-gray-500 flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Le lien et le commentaire seront gardés dans les notes du prospect.</p>}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200">Annuler</button>
          <button type="button" disabled={enCours} onClick={creer} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brewery-600 text-white text-sm font-semibold hover:bg-brewery-700 disabled:opacity-50">{enCours && <Loader2 className="w-4 h-4 animate-spin" />} Créer</button>
        </div>
      </div>
    </div>
  );
}

// « Rattacher à une fiche » : les fiches qui ressemblent d'abord, puis une recherche dans
// les prospects et les clients. Le lien et le commentaire vont dans les notes de la fiche.
function RattachementModal({ groupe, onClose }: { groupe: Signalement[]; onClose: () => void }) {
  const { state, dispatchLocal } = useApp();
  const toast = useToast();
  const s = groupe[0];
  const [recherche, setRecherche] = useState('');
  const [enCours, setEnCours] = useState('');
  const doublons = s.fiche.doublons || [];

  const resultats = useMemo(() => {
    const q = sansAccents(recherche.trim());
    if (q.length < 2) return [] as { genre: 'prospect' | 'client'; id: string; nom: string; ville: string }[];
    const p = state.prospects.filter(x => sansAccents(x.nom_etablissement).includes(q) || sansAccents(x.ville).includes(q)).slice(0, 8)
      .map(x => ({ genre: 'prospect' as const, id: x.id, nom: x.nom_etablissement, ville: x.ville }));
    const c = state.clients.filter(x => sansAccents(x.nom).includes(q) || sansAccents(x.ville).includes(q)).slice(0, 8)
      .map(x => ({ genre: 'client' as const, id: x.id, nom: x.nom, ville: x.ville }));
    return [...p, ...c];
  }, [recherche, state.prospects, state.clients]);

  const rattacher = async (cible: { genre: 'prospect' | 'client'; id: string; nom: string }) => {
    setEnCours(cible.id);
    try {
      for (const sig of groupe) {
        const r = await apiPatch(`/signalements/${sig.id}`, { action: 'rattacher', [cible.genre === 'client' ? 'client_id' : 'prospect_id']: cible.id }) as { signalement: Signalement; prospect?: Prospect; client?: Client };
        dispatchLocal({ type: 'UPSERT_SIGNALEMENT', payload: r.signalement });
        if (r.prospect) dispatchLocal({ type: 'UPDATE_PROSPECT', payload: r.prospect });
        if (r.client) dispatchLocal({ type: 'UPDATE_CLIENT', payload: r.client });
      }
      toast.success(`Rattaché à « ${cible.nom} »`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rattachement impossible');
    } finally { setEnCours(''); }
  };

  const Ligne = ({ f }: { f: { genre: 'prospect' | 'client'; id: string; nom: string; ville: string; etape?: string } }) => (
    <button type="button" disabled={!!enCours} onClick={() => rattacher(f)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 text-left text-sm disabled:opacity-50">
      <Building2 className="w-4 h-4 text-gray-400 flex-shrink-0" />
      <span className="flex-1 min-w-0 truncate text-gray-800">{f.nom}{f.ville ? <span className="text-gray-500"> · {f.ville}</span> : null}</span>
      <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${f.genre === 'client' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>{f.genre === 'client' ? 'client' : 'prospect'}</span>
      {enCours === f.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Link2 className="w-4 h-4 text-brewery-600" /> Rattacher « {titreDuSignalement(s)} »</h3>
        {doublons.length > 0 && (
          <div>
            <p className="text-xs font-medium text-amber-800 mb-1 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Fiches qui ressemblent</p>
            <div className="rounded-lg border border-amber-200 divide-y divide-amber-100">{doublons.map(d => <Ligne key={`${d.genre}-${d.id}`} f={d} />)}</div>
          </div>
        )}
        <div>
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
            <input className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Chercher un prospect ou un client" value={recherche} onChange={e => setRecherche(e.target.value)} autoFocus />
          </div>
          {resultats.length > 0 && <div className="mt-2 rounded-lg border border-gray-200 divide-y divide-gray-100">{resultats.map(f => <Ligne key={`${f.genre}-${f.id}`} f={f} />)}</div>}
          {recherche.trim().length >= 2 && resultats.length === 0 && <p className="mt-2 text-sm text-gray-500">Aucune fiche ne correspond.</p>}
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200">Fermer</button>
        </div>
      </div>
    </div>
  );
}
