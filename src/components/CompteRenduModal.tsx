import { useEffect, useState } from 'react';
import { ClipboardCheck, X, Bell, UserCheck, Mail, ShoppingCart, RefreshCw, Ban, CalendarClock, Check } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from './Toast';
import { apiPost, apiPut, apiPatch } from '../api/client';
import { Appointment, AppointmentResult, APPOINTMENT_RESULT_LABELS, PipelineStage, Prospect } from '../types';
import { generateId, formatDate, toLocalDateStr } from '../utils/helpers';
import EmailTemplateModal from './EmailTemplateModal';

// LA fenêtre de compte rendu d'un rendez-vous, la même partout (Rendez-vous, Semaine à
// préparer, Bilan). Elle enregistre le résultat et les notes, déplace le prospect dans le
// pipeline selon le résultat, programme le rappel (obligatoire quand il faut relancer),
// propose le mail après « Mail envoyé », et replanifie après « RDV décalé ».

/** Règle unique : l'étape du prospect après un compte rendu, ou null s'il ne bouge pas. */
export function etapeApresCompteRendu(resultat: AppointmentResult, etapeActuelle: PipelineStage): PipelineStage | null {
  const terminales: PipelineStage[] = ['client_gagne', 'perdu', 'ne_pas_contacter'];
  if (resultat === 'client') return 'client_gagne';
  if (resultat === 'pas_interesse') return 'perdu';
  if (terminales.includes(etapeActuelle)) return null;
  if (resultat === 'mail_envoye') return 'negociation';
  if (resultat === 'commande_plus_tard' || resultat === 'a_relancer') return 'proposition';
  return null;
}

const RAPPEL_OBLIGATOIRE: AppointmentResult[] = ['a_relancer', 'commande_plus_tard', 'mail_envoye'];

const OPTIONS: { value: AppointmentResult; icon: typeof Check; couleur: string; effet: string }[] = [
  { value: 'client', icon: UserCheck, couleur: 'border-green-500 bg-green-50 text-green-700', effet: 'Le prospect passe en « Gagné ».' },
  { value: 'mail_envoye', icon: Mail, couleur: 'border-blue-500 bg-blue-50 text-blue-700', effet: 'Prospect en « Négociation », mail proposé, rappel programmé.' },
  { value: 'commande_plus_tard', icon: ShoppingCart, couleur: 'border-amber-500 bg-amber-50 text-amber-700', effet: 'Prospect en « Proposition », rappel programmé.' },
  { value: 'a_relancer', icon: RefreshCw, couleur: 'border-purple-500 bg-purple-50 text-purple-700', effet: 'Prospect en « Proposition », rappel programmé.' },
  { value: 'pas_interesse', icon: Ban, couleur: 'border-red-500 bg-red-50 text-red-700', effet: 'Le prospect passe en « Perdu ».' },
  { value: 'decale', icon: CalendarClock, couleur: 'border-violet-500 bg-violet-50 text-violet-700', effet: 'Le rendez-vous est marqué décalé, puis vous choisissez la nouvelle date.' },
];

function dansSeptJours() { const d = new Date(); d.setDate(d.getDate() + 7); return toLocalDateStr(d); }

export default function CompteRenduModal({ rdv, onClose }: { rdv: Appointment | null; onClose: () => void }) {
  const { state, dispatchLocal } = useApp();
  const toast = useToast();
  const [resultat, setResultat] = useState<AppointmentResult>('');
  const [notes, setNotes] = useState('');
  const [rappel, setRappel] = useState(false);
  const [rappelDate, setRappelDate] = useState('');
  const [rappelMessage, setRappelMessage] = useState('');
  const [enregistrement, setEnregistrement] = useState(false);
  const [emailProspect, setEmailProspect] = useState<Prospect | null>(null);
  const [decalage, setDecalage] = useState<{ date: string; debut: string; fin: string; notes: string } | null>(null);

  useEffect(() => {
    if (!rdv) return;
    setResultat((rdv.compte_rendu as AppointmentResult) || '');
    setNotes(rdv.notes_compte_rendu || '');
    setRappel(false);
    setRappelDate(dansSeptJours());
    setRappelMessage('');
    setEmailProspect(null);
    setDecalage(null);
    setEnregistrement(false);
  }, [rdv]);

  if (!rdv) return null;

  const prospect = rdv.prospect_id ? state.prospects.find(p => p.id === rdv.prospect_id) : undefined;
  const client = rdv.client_id ? state.clients.find(c => c.id === rdv.client_id) : undefined;
  const nom = client?.nom || prospect?.nom_etablissement || 'Prospect';
  const rappelObligatoire = RAPPEL_OBLIGATOIRE.includes(resultat);
  const valide = resultat !== '' && notes.trim() !== '' && (!rappelObligatoire || !!rappelDate);

  const choisir = (v: AppointmentResult) => {
    const nouveau = resultat === v ? '' : v;
    setResultat(nouveau);
    if (RAPPEL_OBLIGATOIRE.includes(nouveau)) setRappel(true);
  };

  const enregistrer = async () => {
    if (!valide || enregistrement) return;
    setEnregistrement(true);
    try {
      const misAJour = { ...rdv, statut: 'termine' as const, compte_rendu: resultat, notes_compte_rendu: notes };
      await apiPut(`/appointments/${rdv.id}`, misAJour);
      dispatchLocal({ type: 'UPDATE_APPOINTMENT', payload: misAJour });

      if (prospect) {
        const etape = etapeApresCompteRendu(resultat, prospect.etape_pipeline);
        if (etape) {
          try {
            await apiPatch(`/prospects/${prospect.id}/stage`, { etape_pipeline: etape, date_modification: new Date().toISOString() });
            dispatchLocal({ type: 'MOVE_PROSPECT', payload: { id: prospect.id, stage: etape } });
          } catch (err) {
            toast.error(`Déplacement du prospect impossible : ${err instanceof Error ? err.message : 'erreur'}`);
          }
        }
      }

      if (rappel && rappelDate) {
        const rappelPayload = {
          id: generateId('rem'),
          prospect_id: rdv.prospect_id,
          commercial_id: rdv.commercial_id,
          date: rappelDate,
          heure: '09:00',
          message: rappelMessage.trim() || `Relance suite RDV ${nom} - ${APPOINTMENT_RESULT_LABELS[resultat] || 'RDV terminé'}`,
          statut: 'actif' as const,
        };
        try {
          await apiPost('/reminders', rappelPayload);
          dispatchLocal({ type: 'ADD_REMINDER', payload: rappelPayload });
        } catch (err) {
          toast.error(`Rappel non créé : ${err instanceof Error ? err.message : 'erreur'}`);
        }
      }

      toast.success('Compte rendu enregistré');
      if (resultat === 'mail_envoye' && prospect) { setEmailProspect(prospect); return; }
      if (resultat === 'decale') { setDecalage({ date: dansSeptJours(), debut: rdv.heure_debut || '09:00', fin: rdv.heure_fin || '10:00', notes: '' }); return; }
      onClose();
    } catch (err) {
      toast.error(`Erreur compte rendu : ${err instanceof Error ? err.message : 'erreur inconnue'}`);
    } finally {
      setEnregistrement(false);
    }
  };

  const confirmerDecalage = async () => {
    if (!decalage?.date) return;
    try {
      const ancien = { ...rdv, statut: 'termine' as const, compte_rendu: 'decale' as AppointmentResult, notes_compte_rendu: (notes || '') + (decalage.notes ? `\nDécalé : ${decalage.notes}` : '') };
      await apiPut(`/appointments/${rdv.id}`, ancien);
      dispatchLocal({ type: 'UPDATE_APPOINTMENT', payload: ancien });
      const nouveau: Appointment = {
        id: generateId('apt'),
        prospect_id: rdv.prospect_id,
        client_id: rdv.client_id,
        commercial_id: rdv.commercial_id,
        prospecteur_id: rdv.prospecteur_id,
        date: decalage.date,
        heure_debut: decalage.debut,
        heure_fin: decalage.fin,
        lieu: rdv.lieu,
        notes: decalage.notes || rdv.notes,
        statut: 'planifie',
        event_type: 'rdv',
      };
      await apiPost('/appointments', nouveau);
      dispatchLocal({ type: 'ADD_APPOINTMENT', payload: nouveau });
      toast.success(`Nouveau rendez-vous le ${formatDate(decalage.date)}`);
      onClose();
    } catch (err) {
      toast.error(`Erreur : ${err instanceof Error ? err.message : 'erreur inconnue'}`);
    }
  };

  if (emailProspect) return <EmailTemplateModal prospect={emailProspect} onClose={onClose} />;

  if (decalage) {
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><CalendarClock className="w-5 h-5 text-violet-500" /> Décaler le rendez-vous</h3>
            <button className="p-1 rounded hover:bg-gray-100" onClick={onClose}><X className="w-5 h-5 text-gray-500" /></button>
          </div>
          <div className="p-4 space-y-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500">Rendez-vous actuel</p>
              <p className="font-semibold text-sm text-gray-900">{nom}</p>
              <p className="text-xs text-gray-500 mt-1">{formatDate(rdv.date)}{rdv.heure_debut && ` · ${rdv.heure_debut}`}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Nouvelle date *</label>
              <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={decalage.date} onChange={e => setDecalage({ ...decalage, date: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Heure de début</label>
                <input type="time" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={decalage.debut} onChange={e => setDecalage({ ...decalage, debut: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Heure de fin</label>
                <input type="time" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={decalage.fin} onChange={e => setDecalage({ ...decalage, fin: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Raison</label>
              <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" rows={2} placeholder="Pourquoi ce report ?" value={decalage.notes} onChange={e => setDecalage({ ...decalage, notes: e.target.value })} />
            </div>
          </div>
          <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
            <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={onClose}>Plus tard</button>
            <button className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50" onClick={confirmerDecalage} disabled={!decalage.date}>
              <CalendarClock className="w-4 h-4" /> Confirmer le report
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><ClipboardCheck className="w-5 h-5 text-indigo-600" /> Compte rendu du rendez-vous</h3>
            <p className="text-sm text-gray-500 mt-0.5">{nom} · {formatDate(rdv.date)}</p>
          </div>
          <button className="p-1 rounded hover:bg-gray-100" onClick={onClose}><X className="w-5 h-5 text-gray-500" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Résultat du rendez-vous</label>
            <div className="grid grid-cols-2 gap-2">
              {OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium border-2 transition-colors ${resultat === opt.value ? opt.couleur : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  onClick={() => choisir(opt.value)}
                >
                  <opt.icon className="w-4 h-4" /> {APPOINTMENT_RESULT_LABELS[opt.value]}
                </button>
              ))}
            </div>
            {resultat && <p className="text-[11px] text-gray-500 mt-1.5 italic">{OPTIONS.find(o => o.value === resultat)?.effet}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes du compte rendu <span className="text-red-500">*</span></label>
            <textarea
              className={`w-full px-3 py-2 border rounded-lg text-sm h-20 resize-none focus:ring-2 focus:ring-indigo-500 ${notes.trim() === '' ? 'border-red-300 bg-red-50/30' : 'border-gray-200'}`}
              placeholder="Comment s'est passé le rendez-vous ? (obligatoire)"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              autoFocus
            />
            {notes.trim() === '' && <p className="text-[10px] text-red-500 mt-0.5">Les notes sont obligatoires pour valider le compte rendu.</p>}
          </div>

          {!rappel && !rappelObligatoire ? (
            <button
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-amber-300 text-amber-500 hover:border-amber-500 hover:text-amber-700 hover:bg-amber-50 text-sm font-medium transition-colors"
              onClick={() => setRappel(true)}
            >
              <Bell className="w-4 h-4" /> Programmer un rappel
            </button>
          ) : (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-amber-700 flex items-center gap-1"><Bell className="w-3 h-3" /> Rappel de relance {rappelObligatoire && <span className="text-red-500">*</span>}</label>
                {!rappelObligatoire && <button className="text-gray-400 hover:text-gray-600" onClick={() => setRappel(false)}><X className="w-4 h-4" /></button>}
              </div>
              <div>
                <label className="block text-[10px] text-amber-600 mb-0.5">Date du rappel {rappelObligatoire && <span className="text-red-500">*</span>}</label>
                <input type="date" className={`w-full px-2 py-1.5 border rounded-lg text-xs bg-white ${rappelObligatoire && !rappelDate ? 'border-red-300' : 'border-amber-200'}`} value={rappelDate} onChange={e => setRappelDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] text-amber-600 mb-0.5">Message (facultatif)</label>
                <input type="text" className="w-full px-2 py-1.5 border border-amber-200 rounded-lg text-xs bg-white" placeholder="Ex : relancer pour le devis…" value={rappelMessage} onChange={e => setRappelMessage(e.target.value)} />
              </div>
            </div>
          )}
        </div>
        <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
          <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={onClose}>Annuler</button>
          <button
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={enregistrer}
            disabled={!valide || enregistrement}
          >
            <ClipboardCheck className="w-4 h-4" />
            {enregistrement ? 'Enregistrement…' : resultat === 'mail_envoye' ? 'Valider et envoyer un mail' : resultat === 'decale' ? 'Valider et replanifier' : 'Valider le compte rendu'}
          </button>
        </div>
      </div>
    </div>
  );
}
