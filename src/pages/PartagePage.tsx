import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Share2, MapPin, Phone, User, ExternalLink, AlertTriangle, CheckCircle, Building2, Loader2, Smartphone } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import { apiPost } from '../api/client';
import { Prospect, ESTABLISHMENT_LABELS } from '../types';

// Point d'arrivée du bouton « Partager » du téléphone : depuis Google Maps ou une fiche
// Google, on choisit SuiviPro, le texte partagé arrive ici et la fiche prospect est créée
// tout de suite dans l'étape « Nouveau partagé ». Pas d'entrée de menu : sans texte partagé,
// la page explique seulement comment s'en servir.
interface Doublon { genre: 'prospect' | 'client'; id: string; nom: string; ville: string; etape?: string }
interface Reponse {
  ok: boolean;
  prospect?: Prospect;
  doublons: Doublon[];
  fiche: { nom_etablissement: string };
  sources: string[];
  provenance?: 'maps' | 'recherche' | 'autre';
}

export default function PartagePage() {
  const [searchParams] = useSearchParams();
  const { state, dispatchLocal } = useApp();
  const toast = useToast();
  const partage = [searchParams.get('title'), searchParams.get('text'), searchParams.get('url')].filter(Boolean).join('\n').trim();
  const [texte, setTexte] = useState(partage);
  const [enCours, setEnCours] = useState(!!partage);
  const [erreur, setErreur] = useState('');
  const [reponse, setReponse] = useState<Reponse | null>(null);
  const lance = useRef(false);

  const envoyer = async (forcer = false, contenu = texte) => {
    if (!contenu.trim()) return;
    setEnCours(true); setErreur('');
    try {
      const r = await apiPost('/prospects/partage', { texte: contenu, forcer }) as Reponse;
      setReponse(r);
      if (r.ok && r.prospect) {
        dispatchLocal({ type: 'ADD_PROSPECT', payload: r.prospect });
        toast.success(`« ${r.prospect.nom_etablissement} » ajouté en « Nouveau partagé »`);
      }
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Impossible de créer la fiche');
    } finally {
      setEnCours(false);
    }
  };

  // Arrivée avec un texte partagé : on crée sans attendre un clic.
  useEffect(() => {
    if (partage && !lance.current && state.currentUser) { lance.current = true; envoyer(false, partage); }
  }, [partage, state.currentUser]); // eslint-disable-line react-hooks/exhaustive-deps

  const cree = reponse?.ok ? reponse.prospect : undefined;
  const manquants = cree ? [
    cree.nom_etablissement.startsWith('Établissement partagé') && 'le nom (la fiche Google n\'a pas pu être lue, ouvrez le lien)',
    !cree.telephone && 'le téléphone',
    !cree.nom_contact && 'le nom du contact',
    cree.type_etablissement === 'autre' && 'le type d\'établissement',
    !cree.ville && 'la commune',
  ].filter(Boolean) as string[] : [];
  const enAttente = state.prospects.filter(p => p.etape_pipeline === 'partage').length;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Share2 className="w-5 h-5 text-brewery-600" /> Fiche partagée</h1>
        <p className="text-sm text-gray-500 mt-1">Une fiche partagée depuis <span className="font-medium">Google Maps</span> devient un prospect dans l'étape <span className="font-medium text-purple-700">« Nouveau partagé »</span>, avec son nom, sa position et son adresse. Reste à ajouter le téléphone et le contact.</p>
      </div>

      {!partage && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3 text-sm text-gray-700">
          <p className="font-medium text-gray-900 flex items-center gap-2"><Smartphone className="w-4 h-4 text-brewery-600" /> Comment partager une fiche</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Sur Android, installez SuiviPro une fois : menu du navigateur → « Ajouter à l'écran d'accueil ».</li>
            <li>Dans l'application <span className="font-medium">Google Maps</span>, ouvrez l'établissement, touchez « Partager » puis choisissez SuiviPro.</li>
            <li>La fiche est créée dans « Nouveau partagé » avec le nom, la position et l'adresse ; il reste le téléphone et le contact.</li>
            <li>Partagez bien depuis Google Maps, pas depuis la recherche Google : celle-ci ne donne que le nom.</li>
          </ol>
          <p className="text-xs text-gray-500">Sur iPhone, le partage vers une application web n'existe pas : envoyez la fiche sur WhatsApp à quelqu'un sur Android, ou créez le prospect dans Prospects.</p>
          <Link to="/pipeline" className="inline-block text-brewery-700 hover:underline">{enAttente > 0 ? `${enAttente} fiche(s) attendent dans « Nouveau partagé »` : 'Ouvrir le pipeline'}</Link>
        </div>
      )}

      {partage && enCours && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex items-center gap-3 text-sm text-gray-700">
          <Loader2 className="w-5 h-5 animate-spin text-brewery-600" /> Lecture de la fiche Google…
        </div>
      )}

      {erreur && !enCours && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
          <p className="text-sm font-medium text-red-800 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {erreur}</p>
          <textarea className="w-full min-h-[100px] px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" value={texte} onChange={e => setTexte(e.target.value)} />
          <button className="px-4 py-2 rounded-lg bg-brewery-600 text-white text-sm font-semibold hover:bg-brewery-700" onClick={() => envoyer(false)}>Réessayer</button>
        </div>
      )}

      {reponse && !reponse.ok && reponse.doublons.length > 0 && !enCours && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
          <p className="text-sm font-medium text-amber-900 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Une fiche ressemble déjà à « {reponse.fiche.nom_etablissement} »</p>
          <ul className="space-y-1">
            {reponse.doublons.map(d => (
              <li key={`${d.genre}-${d.id}`} className="flex items-center gap-2 text-sm">
                <Building2 className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                <Link to={d.genre === 'client' ? `/clients?id=${d.id}` : `/prospects?id=${d.id}`} className="text-brewery-700 hover:underline">{d.nom}{d.ville ? ` · ${d.ville}` : ''}</Link>
                <span className="text-[11px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">{d.genre === 'client' ? 'client' : `prospect · ${state.pipelineColumns.find(c => c.id === d.etape)?.label || d.etape}`}</span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button className="px-3 py-1.5 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700" onClick={() => envoyer(true)}>Créer quand même</button>
            <Link to="/pipeline" className="px-3 py-1.5 text-sm rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-50">Ne rien créer</Link>
          </div>
        </div>
      )}

      {cree && (
        <div className="bg-white rounded-xl border border-green-200 shadow-sm p-4 space-y-3">
          <p className="text-sm font-medium text-green-800 flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Fiche créée en « Nouveau partagé »</p>
          <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
            <div className="px-3 py-2 font-semibold text-gray-900">{cree.nom_etablissement} <span className="font-normal text-gray-500">· {ESTABLISHMENT_LABELS[cree.type_etablissement]}</span></div>
            <div className="px-3 py-2 flex items-center gap-2"><MapPin className="w-3.5 h-3.5 text-gray-400" /><span className={cree.adresse || cree.ville ? 'text-gray-800' : 'text-gray-400 italic'}>{[cree.adresse, [cree.code_postal, cree.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Adresse à compléter'}</span></div>
            <div className="px-3 py-2 flex items-center gap-2"><Phone className="w-3.5 h-3.5 text-gray-400" /><span className={cree.telephone ? 'text-gray-800' : 'text-gray-400 italic'}>{cree.telephone || 'Téléphone à compléter'}</span></div>
            <div className="px-3 py-2 flex items-center gap-2"><User className="w-3.5 h-3.5 text-gray-400" /><span className="text-gray-400 italic">Contact à compléter</span></div>
            {cree.source_url && (
              <a href={cree.source_url} target="_blank" rel="noopener noreferrer" className="px-3 py-2 flex items-center gap-2 text-blue-600 hover:underline"><ExternalLink className="w-3.5 h-3.5" /> Ouvrir la fiche Google</a>
            )}
          </div>
          {manquants.length > 0 && <p className="text-xs text-amber-700">Il manque {manquants.join(', ')}.</p>}
          {reponse?.provenance === 'recherche' && !cree.ville && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">Partagé depuis la recherche Google : seul le nom a pu être lu. Pour avoir la position et l'adresse, partagez la fiche depuis l'application Google Maps.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Link to={`/prospects?id=${cree.id}`} className="px-4 py-2 rounded-lg bg-brewery-600 text-white text-sm font-semibold hover:bg-brewery-700">Compléter la fiche</Link>
            <Link to="/pipeline" className="px-3 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200">Voir le pipeline</Link>
          </div>
        </div>
      )}
    </div>
  );
}
