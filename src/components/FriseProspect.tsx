// La fiche « tunnel » d'un prospect : sa prochaine action (à terminer, reporter ou créer)
// et une seule frise chronologique de tout ce qui s'est passé : appels, mails, rendez-vous
// et comptes rendus, actions faites, changements d'étape.
import { useEffect, useMemo, useState } from 'react';
import { Phone, Mail, Calendar, Bell, CheckCircle2, ArrowRightLeft, AlertTriangle, Plus, CalendarClock, ClipboardCheck, Ban } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from './Toast';
import { useCallModal } from './CallModal';
import { apiGet, apiPost, apiPut } from '../api/client';
import { Appointment, Prospect, ProspectEtape, Reminder, TypeAction, CALL_RESULT_LABELS, APPOINTMENT_RESULT_LABELS, PIPELINE_LABELS } from '../types';
import { dateLocale } from '../../shared/regles';
import { TYPES_ACTION, prochaineActionDe, estTerminale } from '../../shared/tunnel';
import { formatDate, formatTimeAgo, generateId } from '../utils/helpers';
import QueSestIlPasse from './QueSestIlPasse';
import { libelleRaisonPerte } from './RaisonPerte';

interface Evenement { id: string; date: string; genre: 'appel' | 'mail' | 'rdv' | 'action_faite' | 'action' | 'etape'; texte: string; qui: string; rdv?: Appointment; enRetard?: boolean }

export default function FriseProspect({ prospect, onCompteRendu }: { prospect: Prospect; onCompteRendu?: (rdv: Appointment) => void }) {
  const { state, dispatchLocal, getCommercial } = useApp();
  const toast = useToast();
  const { startCall } = useCallModal();
  const aujourdhui = dateLocale(new Date());
  const [etapes, setEtapes] = useState<ProspectEtape[]>([]);
  const [aTerminer, setATerminer] = useState<Reminder | null>(null);
  const [nouvelle, setNouvelle] = useState<{ type: TypeAction; date: string; message: string } | null>(null);
  const qui = (id: string | null | undefined) => { const c = id ? getCommercial(id) : undefined; return c ? c.prenom : ''; };
  const libelleEtape = (id: string) => state.pipelineColumns.find(c => c.id === id)?.label || (PIPELINE_LABELS as Record<string, string>)[id] || id;

  useEffect(() => {
    let vivant = true;
    apiGet<ProspectEtape[]>(`/prospects/${prospect.id}/etapes`).then(l => { if (vivant) setEtapes(l); }).catch(() => { /* frise sans les étapes */ });
    return () => { vivant = false; };
  }, [prospect.id, prospect.etape_pipeline]);

  const prochaine = useMemo(() => prochaineActionDe(prospect, state.reminders, state.appointments, aujourdhui), [prospect, state.reminders, state.appointments, aujourdhui]);
  const terminale = estTerminale(prospect.etape_pipeline);

  const evenements = useMemo<Evenement[]>(() => {
    const l: Evenement[] = [];
    for (const c of state.calls) {
      if (c.prospect_id !== prospect.id) continue;
      const mail = c.resultat === 'email_envoye';
      l.push({ id: c.id, date: c.date, genre: mail ? 'mail' : 'appel', texte: mail ? (c.notes || 'Email envoyé') : `${CALL_RESULT_LABELS[c.resultat] || c.resultat}${c.notes ? ` · ${c.notes}` : ''}`, qui: qui(c.commercial_id) });
    }
    for (const a of state.appointments) {
      if (a.prospect_id !== prospect.id) continue;
      const passe = a.date < aujourdhui || a.statut === 'termine';
      const cr = a.compte_rendu ? APPOINTMENT_RESULT_LABELS[a.compte_rendu] || a.compte_rendu : '';
      l.push({ id: a.id, date: `${a.date}T${a.heure_debut || '00:00'}`, genre: 'rdv', rdv: a,
        texte: `${a.statut === 'annule' ? 'RDV annulé' : passe ? 'RDV' : 'RDV à venir'} ${a.heure_debut || ''}${a.lieu ? ` · ${a.lieu}` : ''}${cr ? ` → ${cr}` : ''}${a.notes_compte_rendu ? ` · ${a.notes_compte_rendu}` : ''}`,
        qui: qui(a.commercial_id) });
    }
    for (const r of state.reminders) {
      if (r.prospect_id !== prospect.id) continue;
      const type = TYPES_ACTION[r.type || 'appeler'] || 'À faire';
      if (r.statut === 'termine') l.push({ id: r.id, date: `${r.date}T${r.heure || '23:59'}`, genre: 'action_faite', texte: `${type} · ${r.message || ''}`, qui: qui(r.commercial_id) });
      else l.push({ id: r.id, date: `${r.date}T${r.heure || '09:00'}`, genre: 'action', texte: `${type} · ${r.message || ''}`, qui: qui(r.commercial_id), enRetard: r.date < aujourdhui });
    }
    for (const e of etapes) {
      l.push({ id: e.id, date: e.date, genre: 'etape', texte: `${e.de ? `${libelleEtape(e.de)} → ` : ''}${libelleEtape(e.vers)}${e.raison ? ` (${libelleRaisonPerte(e.raison)})` : ''}`, qui: qui(e.commercial_id) });
    }
    return l.sort((a, b) => b.date.localeCompare(a.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.calls, state.appointments, state.reminders, etapes, prospect.id, aujourdhui]);

  const reporter = async (r: Reminder, jours: number) => {
    const d = new Date(); d.setDate(d.getDate() + jours);
    const payload = { ...r, date: dateLocale(d) };
    try { await apiPut(`/reminders/${r.id}`, payload); dispatchLocal({ type: 'UPDATE_REMINDER', payload }); toast.success(`Reporté au ${formatDate(payload.date)}`); }
    catch { toast.error('Impossible de reporter'); }
  };
  const creer = async () => {
    if (!nouvelle || !nouvelle.date) return;
    const payload: Reminder = { id: generateId('rem'), prospect_id: prospect.id, commercial_id: state.currentUser?.id || '', date: nouvelle.date, heure: '09:00', message: nouvelle.message.trim() || TYPES_ACTION[nouvelle.type], statut: 'actif', type: nouvelle.type };
    try { await apiPost('/reminders', payload); dispatchLocal({ type: 'ADD_REMINDER', payload }); setNouvelle(null); toast.success('Prochaine action programmée'); }
    catch { toast.error('Impossible de créer l\'action'); }
  };
  const dansJours = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return dateLocale(d); };
  const terminer = (r: Reminder) => { if ((r.type || 'appeler') === 'appeler') startCall(prospect.id); else setATerminer(r); };

  const icone = (g: Evenement['genre']) => g === 'appel' ? <Phone className="w-3.5 h-3.5 text-gray-500" /> : g === 'mail' ? <Mail className="w-3.5 h-3.5 text-blue-500" /> : g === 'rdv' ? <Calendar className="w-3.5 h-3.5 text-green-600" /> : g === 'action_faite' ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : g === 'action' ? <Bell className="w-3.5 h-3.5 text-amber-500" /> : <ArrowRightLeft className="w-3.5 h-3.5 text-indigo-500" />;

  return (
    <div className="space-y-4">
      {/* Prochaine action */}
      <div className={`bg-white rounded-xl border p-4 ${terminale ? 'border-gray-200' : prochaine ? (prochaine.enRetard ? 'border-red-300' : 'border-gray-200') : 'border-amber-300'}`}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 text-sm"><Bell className="w-4 h-4 text-amber-500" /> Prochaine action</h3>
          {!terminale && !nouvelle && (
            <button onClick={() => setNouvelle({ type: 'appeler', date: dansJours(2), message: '' })} className="text-xs text-brewery-600 hover:underline flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Nouvelle action</button>
          )}
        </div>
        {terminale ? (
          <p className="text-sm text-gray-500 flex items-center gap-1.5">
            {prospect.etape_pipeline === 'perdu' ? <><Ban className="w-4 h-4 text-red-500" /> Perdu{prospect.raison_perte ? ` : ${libelleRaisonPerte(prospect.raison_perte)}` : ''}</> : `Tunnel terminé : ${libelleEtape(prospect.etape_pipeline)}.`}
          </p>
        ) : prochaine ? (
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${prochaine.enRetard ? 'text-red-700' : 'text-gray-900'}`}>
                {prochaine.libelle} · {formatDate(prochaine.date)}{prochaine.heure ? ` ${prochaine.heure}` : ''}{prochaine.enRetard ? ' · en retard' : ''}
              </p>
              <p className="text-xs text-gray-500 truncate">{prochaine.genre === 'rdv' ? (prochaine.rdv?.lieu || 'Rendez-vous planifié') : prochaine.rappel?.message}{prochaine.genre === 'rappel' && prochaine.rappel ? ` · ${qui(prochaine.rappel.commercial_id)}` : ''}</p>
            </div>
            {prochaine.genre === 'rappel' && prochaine.rappel && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => terminer(prochaine.rappel!)} className="px-2.5 py-1.5 rounded-lg bg-green-600 text-white text-xs font-semibold hover:bg-green-700 flex items-center gap-1">
                  {(prochaine.rappel.type || 'appeler') === 'appeler' ? <><Phone className="w-3.5 h-3.5" /> Appeler</> : <><ClipboardCheck className="w-3.5 h-3.5" /> Terminer</>}
                </button>
                <button onClick={() => reporter(prochaine.rappel!, 2)} className="px-2 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-xs hover:bg-gray-200 flex items-center gap-1" title="Reporter de 2 jours"><CalendarClock className="w-3.5 h-3.5" /> +2 j</button>
              </div>
            )}
            {prochaine.genre === 'rdv' && prochaine.rdv && onCompteRendu && prochaine.rdv.date <= aujourdhui && (
              <button onClick={() => onCompteRendu(prochaine.rdv!)} className="px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-xs font-medium hover:bg-amber-100 flex items-center gap-1"><ClipboardCheck className="w-3.5 h-3.5" /> Compte-rendu</button>
            )}
          </div>
        ) : (
          <p className="text-sm text-amber-800 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-amber-500" /> Aucune prochaine action : ce prospect n'avancera pas tout seul.</p>
        )}
        {nouvelle && (
          <div className="mt-3 p-3 rounded-lg bg-gray-50 border border-gray-200 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <select className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white" value={nouvelle.type} onChange={e => setNouvelle({ ...nouvelle, type: e.target.value as TypeAction })}>
                {(Object.keys(TYPES_ACTION) as TypeAction[]).map(t => <option key={t} value={t}>{TYPES_ACTION[t]}</option>)}
              </select>
              <input type="date" className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white" value={nouvelle.date} onChange={e => setNouvelle({ ...nouvelle, date: e.target.value })} />
            </div>
            <input className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white" placeholder="Quoi exactement ? (facultatif)" value={nouvelle.message} onChange={e => setNouvelle({ ...nouvelle, message: e.target.value })} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setNouvelle(null)} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg">Annuler</button>
              <button onClick={creer} className="px-3 py-1.5 text-xs bg-brewery-600 text-white rounded-lg hover:bg-brewery-700">Programmer</button>
            </div>
          </div>
        )}
      </div>

      {/* Frise */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 text-sm"><ArrowRightLeft className="w-4 h-4 text-indigo-500" /> Ce qui s'est passé ({evenements.length})</h3>
        {evenements.length === 0 ? <p className="text-sm text-gray-400">Rien encore : ni appel, ni mail, ni rendez-vous.</p> : (
          <div className="relative pl-5 space-y-2.5">
            <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gray-200" />
            {evenements.map(e => (
              <div key={`${e.genre}-${e.id}`} className="relative flex items-start gap-2 text-xs">
                <span className="absolute -left-5 top-0.5 bg-white">{icone(e.genre)}</span>
                <span className={`tabular-nums w-[74px] flex-shrink-0 ${e.enRetard ? 'text-red-600 font-medium' : 'text-gray-500'}`} title={formatTimeAgo(e.date)}>{formatDate(e.date)}</span>
                <span className={`flex-1 min-w-0 ${e.genre === 'action' ? (e.enRetard ? 'text-red-700' : 'text-amber-800') : e.genre === 'etape' ? 'text-indigo-700' : 'text-gray-800'}`}>
                  {e.texte}{e.qui ? <span className="text-gray-400"> · {e.qui}</span> : null}
                </span>
                {e.genre === 'rdv' && e.rdv && onCompteRendu && e.rdv.statut !== 'annule' && (
                  <button onClick={() => onCompteRendu(e.rdv!)} className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${e.rdv.compte_rendu ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>
                    {e.rdv.compte_rendu ? 'Modifier CR' : 'Compte-rendu'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {aTerminer && <QueSestIlPasse prospect={prospect} rappel={aTerminer} onClose={() => setATerminer(null)} />}
    </div>
  );
}
