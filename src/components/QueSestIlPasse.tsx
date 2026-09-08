// « Que s'est-il passé ? » : on termine une action (relancer par mail, attendre une réponse,
// à faire) en disant son issue. Le serveur clôt le rappel, déplace l'étape et crée la
// prochaine action ; on affiche ce qui a changé.
import { useState } from 'react';
import { ClipboardCheck, X, ArrowRight } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from './Toast';
import { apiPost } from '../api/client';
import { Prospect, Reminder, PIPELINE_LABELS } from '../types';
import { TYPES_ACTION, issuesPourAction, issueEstUnePerte } from '../../shared/tunnel';
import { SelectRaisonPerte } from './RaisonPerte';
import { formatDate } from '../utils/helpers';

interface Reponse { prospect: Prospect; rappel: Reminder | null; prochaine: Reminder | null; etape: string | null }

export default function QueSestIlPasse({ prospect, rappel, onClose }: { prospect: Prospect; rappel: Reminder; onClose: () => void }) {
  const { state, dispatchLocal } = useApp();
  const toast = useToast();
  const type = rappel.type || 'autre';
  const issues = issuesPourAction(type);
  const [issue, setIssue] = useState('');
  const [raison, setRaison] = useState('');
  const [note, setNote] = useState('');
  const [enCours, setEnCours] = useState(false);
  const perte = issueEstUnePerte(issue);
  const valide = !!issue && (!perte || !!raison);
  const libelleEtape = (id: string) => state.pipelineColumns.find(c => c.id === id)?.label || (PIPELINE_LABELS as Record<string, string>)[id] || id;

  const enregistrer = async () => {
    if (!valide || enCours) return;
    setEnCours(true);
    try {
      const r = await apiPost(`/prospects/${prospect.id}/action`, { rappel_id: rappel.id, type, issue, raison_perte: raison, note: note.trim() }) as Reponse;
      dispatchLocal({ type: 'UPDATE_PROSPECT', payload: r.prospect });
      if (r.rappel) dispatchLocal({ type: 'UPDATE_REMINDER', payload: r.rappel });
      if (r.prochaine) dispatchLocal({ type: 'ADD_REMINDER', payload: r.prochaine });
      const morceaux = ['Action terminée'];
      if (r.etape) morceaux.push(`prospect en « ${libelleEtape(r.etape)} »`);
      if (r.prochaine) morceaux.push(`prochaine action : ${TYPES_ACTION[r.prochaine.type || 'autre']} le ${formatDate(r.prochaine.date)}`);
      toast.success(morceaux.join(' · '));
      onClose();
    } catch (err) {
      toast.error(`Impossible d'enregistrer : ${err instanceof Error ? err.message : 'erreur'}`);
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><ClipboardCheck className="w-5 h-5 text-brewery-600" /> Que s'est-il passé ?</h3>
            <p className="text-xs text-gray-500 mt-0.5">{prospect.nom_etablissement} · {TYPES_ACTION[type]}{rappel.message ? ` — ${rappel.message}` : ''}</p>
          </div>
          <button className="p-1 rounded hover:bg-gray-100" onClick={onClose}><X className="w-5 h-5 text-gray-500" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="space-y-1.5">
            {issues.map(i => (
              <button
                key={i.value}
                type="button"
                onClick={() => setIssue(issue === i.value ? '' : i.value)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border-2 transition-colors ${issue === i.value ? (issueEstUnePerte(i.value) ? 'border-red-500 bg-red-50' : 'border-brewery-500 bg-brewery-50') : 'border-gray-200 hover:bg-gray-50'}`}
              >
                <p className="text-sm font-medium text-gray-900 flex items-center gap-1.5">{i.label}</p>
                <p className="text-[11px] text-gray-500 flex items-center gap-1"><ArrowRight className="w-3 h-3" /> {i.effet}</p>
              </button>
            ))}
          </div>
          {perte && <SelectRaisonPerte value={raison} onChange={setRaison} />}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Note (facultatif)</label>
            <textarea className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm h-16 resize-none" value={note} onChange={e => setNote(e.target.value)} placeholder="Ce qu'il faut retenir…" />
          </div>
        </div>
        <div className="p-4 border-t border-gray-200 flex justify-end gap-2">
          <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={onClose}>Annuler</button>
          <button className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 disabled:opacity-50" disabled={!valide || enCours} onClick={enregistrer}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}
