import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Share2, MapPin, Phone, User, ExternalLink, AlertTriangle, CheckCircle, Building2, Loader2 } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import { apiPost } from '../api/client';
import { Prospect, ESTABLISHMENT_LABELS } from '../types';

// Une fiche Google Maps (ou Google Business) reçue sur WhatsApp devient un prospect en
// étape « Partagé ». On colle le message tel quel — ou, depuis le téléphone, on choisit
// SuiviPro dans le menu « Partager » et le texte arrive déjà rempli.
interface Doublon { genre: 'prospect' | 'client'; id: string; nom: string; ville: string; etape?: string }
interface Reponse {
  ok: boolean;
  prospect?: Prospect;
  doublons: Doublon[];
  fiche: { nom_etablissement: string; adresse: string; ville: string; code_postal: string; telephone: string; type_etablissement: Prospect['type_etablissement'] };
  sources: string[];
}

export default function PartagePage() {
  const [searchParams] = useSearchParams();
  const { state, dispatchLocal } = useApp();
  const toast = useToast();
  const partage = [searchParams.get('title'), searchParams.get('text'), searchParams.get('url')].filter(Boolean).join('\n').trim();
  const [texte, setTexte] = useState(partage);
  const [enCours, setEnCours] = useState(false);
  const [reponse, setReponse] = useState<Reponse | null>(null);

  const envoyer = async (forcer = false) => {
    if (!texte.trim()) { toast.error('Collez d\'abord le message ou le lien.'); return; }
    setEnCours(true);
    try {
      const r = await apiPost('/prospects/partage', { texte, forcer }) as Reponse;
      setReponse(r);
      if (r.ok && r.prospect) {
        dispatchLocal({ type: 'ADD_PROSPECT', payload: r.prospect });
        toast.success(`« ${r.prospect.nom_etablissement} » ajouté en « Partagé »`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Impossible de créer la fiche');
    } finally {
      setEnCours(false);
    }
  };

  const recommencer = () => { setTexte(''); setReponse(null); };
  const cree = reponse?.ok ? reponse.prospect : undefined;
  const manquants = cree ? [
    !cree.telephone && 'le téléphone',
    !cree.nom_contact && 'le nom du contact',
    cree.type_etablissement === 'autre' && 'le type d\'établissement',
    !cree.ville && 'la commune',
  ].filter(Boolean) as string[] : [];
  const dansPartage = state.prospects.filter(p => p.etape_pipeline === 'partage').length;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Share2 className="w-5 h-5 text-brewery-600" /> Partager une fiche</h1>
        <p className="text-sm text-gray-500 mt-1">
          Collez le message WhatsApp (nom, adresse et lien Google Maps) ou juste le lien. La fiche est créée dans l'étape
          <span className="font-medium text-purple-700"> « Partagé »</span> : il ne reste qu'à la compléter.
        </p>
      </div>

      {!cree && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
          <textarea
            className="w-full min-h-[120px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
            placeholder={'Le Bistrot du Marché\n12 rue Chaussade, 43000 Le Puy-en-Velay\nhttps://maps.app.goo.gl/…'}
            value={texte}
            onChange={e => setTexte(e.target.value)}
            autoFocus={!partage}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button className="px-4 py-2 rounded-lg bg-brewery-600 text-white text-sm font-semibold hover:bg-brewery-700 disabled:opacity-50 flex items-center gap-2" onClick={() => envoyer(false)} disabled={enCours || !texte.trim()}>
              {enCours ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
              {enCours ? 'Lecture de la fiche…' : 'Créer la fiche prospect'}
            </button>
            {texte && <button className="text-sm text-gray-500 hover:text-gray-700" onClick={recommencer}>Effacer</button>}
          </div>
        </div>
      )}

      {reponse && !reponse.ok && reponse.doublons.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
          <p className="text-sm font-medium text-amber-900 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Une fiche ressemble déjà à « {reponse.fiche.nom_etablissement} »</p>
          <ul className="space-y-1">
            {reponse.doublons.map(d => (
              <li key={`${d.genre}-${d.id}`} className="flex items-center gap-2 text-sm">
                <Building2 className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                <Link to={d.genre === 'client' ? `/clients?id=${d.id}` : `/prospects?id=${d.id}`} className="text-brewery-700 hover:underline">
                  {d.nom}{d.ville ? ` · ${d.ville}` : ''}
                </Link>
                <span className="text-[11px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">{d.genre === 'client' ? 'client' : `prospect · ${state.pipelineColumns.find(c => c.id === d.etape)?.label || d.etape}`}</span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button className="px-3 py-1.5 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700" onClick={() => envoyer(true)} disabled={enCours}>Créer quand même</button>
            <button className="px-3 py-1.5 text-sm rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-50" onClick={recommencer}>Annuler</button>
          </div>
        </div>
      )}

      {cree && (
        <div className="bg-white rounded-xl border border-green-200 shadow-sm p-4 space-y-3">
          <p className="text-sm font-medium text-green-800 flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Fiche créée en « Partagé »</p>
          <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
            <div className="px-3 py-2 font-semibold text-gray-900">{cree.nom_etablissement} <span className="font-normal text-gray-500">· {ESTABLISHMENT_LABELS[cree.type_etablissement]}</span></div>
            <div className="px-3 py-2 flex items-center gap-2"><MapPin className="w-3.5 h-3.5 text-gray-400" /><span className={cree.adresse || cree.ville ? 'text-gray-800' : 'text-gray-400 italic'}>{[cree.adresse, [cree.code_postal, cree.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Adresse à compléter'}</span></div>
            <div className="px-3 py-2 flex items-center gap-2"><Phone className="w-3.5 h-3.5 text-gray-400" /><span className={cree.telephone ? 'text-gray-800' : 'text-gray-400 italic'}>{cree.telephone || 'Téléphone à compléter'}</span></div>
            <div className="px-3 py-2 flex items-center gap-2"><User className="w-3.5 h-3.5 text-gray-400" /><span className="text-gray-400 italic">Contact à compléter</span></div>
            {cree.source_url && (
              <a href={cree.source_url} target="_blank" rel="noopener noreferrer" className="px-3 py-2 flex items-center gap-2 text-blue-600 hover:underline"><ExternalLink className="w-3.5 h-3.5" /> Ouvrir la fiche Google Maps</a>
            )}
          </div>
          {reponse?.sources.length ? <p className="text-[11px] text-gray-400">Lu depuis : {reponse.sources.join(' · ')}</p> : null}
          {manquants.length > 0 && <p className="text-xs text-amber-700">Il manque {manquants.join(', ')}.</p>}
          <div className="flex flex-wrap gap-2">
            <Link to={`/prospects?id=${cree.id}`} className="px-4 py-2 rounded-lg bg-brewery-600 text-white text-sm font-semibold hover:bg-brewery-700 disabled:opacity-50">Compléter la fiche</Link>
            <button className="px-3 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200" onClick={recommencer}>Partager une autre fiche</button>
          </div>
        </div>
      )}

      <div className="text-xs text-gray-500 space-y-1">
        <p>{dansPartage > 0 ? <Link to="/pipeline" className="text-brewery-700 hover:underline">{dansPartage} fiche(s) attendent d'être complétées dans « Partagé »</Link> : 'Aucune fiche en attente dans « Partagé ».'}</p>
        <p>Sur Android, installez SuiviPro sur l'écran d'accueil (menu du navigateur → « Ajouter à l'écran d'accueil ») : SuiviPro apparaît alors dans le menu « Partager » de Google Maps et de WhatsApp.</p>
      </div>
    </div>
  );
}
