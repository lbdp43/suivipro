import { useEffect, useState } from 'react';
import { dateLocale } from '../../shared/regles';
import { ClipboardCheck, X, Bell, UserCheck, Mail, ShoppingCart, RefreshCw, Ban, CalendarClock, Check } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from './Toast';
import { apiPost } from '../api/client';
import { Appointment, AppointmentResult, APPOINTMENT_RESULT_LABELS, Prospect, Reminder, TaskClient } from '../types';
import { formatDate } from '../utils/helpers';
import EmailTemplateModal from './EmailTemplateModal';
import { SelectRaisonPerte } from './RaisonPerte';

// LA fenêtre de compte rendu d'un rendez-vous, la même partout (Rendez-vous, Semaine à
// préparer, Bilan, fiche Prospect). Elle enregistre le résultat et les notes, déplace le
// prospect dans le pipeline selon la règle du tunnel (shared/tunnel.js), programme la
// prochaine action (obligatoire quand il faut relancer), propose le mail après
// « Mail envoyé », et replanifie après « RDV décalé ».

const RAPPEL_OBLIGATOIRE: AppointmentResult[] = ['a_relancer', 'commande_plus_tard', 'mail_envoye'];

const OPTIONS: { value: AppointmentResult; icon: typeof Check; couleur: string; effet: string }[] = [
  { value: 'client', icon: UserCheck, couleur: 'border-green-500 bg-green-50 text-green-700', effet: 'Le prospect passe en « Gagné ».' },
  { value: 'mail_envoye', icon: Mail, couleur: 'border-blue-500 bg-blue-50 text-blue-700', effet: 'Prospect en « Négociation », mail proposé, rappel programmé.' },
  { value: 'commande_plus_tard', icon: ShoppingCart, couleur: 'border-amber-500 bg-amber-50 text-amber-700', effet: 'Prospect en « Proposition », rappel programmé.' },
  { value: 'a_relancer', icon: RefreshCw, couleur: 'border-purple-500 bg-purple-50 text-purple-700', effet: 'Prospect en « Proposition », rappel programmé.' },
  { value: 'pas_interesse', icon: Ban, couleur: 'border-red-500 bg-red-50 text-red-700', effet: 'Le prospect passe en « Perdu ».' },
  { value: 'decale', icon: CalendarClock, couleur: 'border-violet-500 bg-violet-50 text-violet-700', effet: 'Le rendez-vous est marqué décalé, puis vous choisissez la nouvelle date.' },
];

// Chez un client, pas de tunnel : le compte rendu se garde, et la suite devient une tâche.
const EFFET_CLIENT: Record<Exclude<AppointmentResult, ''>, string> = {
  client: 'Compte rendu enregistré sur la fiche client.',
  mail_envoye: 'Tâche de suivi créée à la date choisie.',
  commande_plus_tard: 'Tâche de suivi créée à la date choisie.',
  a_relancer: 'Tâche de suivi créée à la date choisie.',
  pas_interesse: 'Compte rendu enregistré sur la fiche client.',
  decale: 'Le rendez-vous est marqué décalé, puis vous choisissez la nouvelle date.',
};

function dansSeptJours() { const d = new Date(); d.setDate(d.getDate() + 7); return dateLocale(d); }

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
  const [raisonPerte, setRaisonPerte] = useState('pas_interesse');

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

  // Tout part au serveur d'un seul envoi (lib/compteRendu.js) : le rendez-vous, l'étape du
  // prospect, la suite (rappel pour un prospect, tâche pour un client), le nouveau
  // rendez-vous si c'est décalé. Soit tout passe, soit rien — la même règle que Claude.
  type Retour = { rdv: Appointment; prospect: Prospect | null; rappel: Reminder | null; tache: TaskClient | null; nouveau_rdv: Appointment | null };
  const appliquerRetour = (r: Retour) => {
    dispatchLocal({ type: 'UPDATE_APPOINTMENT', payload: { ...rdv, ...r.rdv } });
    if (r.prospect) dispatchLocal({ type: 'UPDATE_PROSPECT', payload: r.prospect });
    if (r.rappel) dispatchLocal({ type: 'ADD_REMINDER', payload: r.rappel });
    if (r.tache) dispatchLocal({ type: 'ADD_TASK_CLIENT', payload: r.tache });
    if (r.nouveau_rdv) dispatchLocal({ type: 'ADD_APPOINTMENT', payload: { ...r.nouveau_rdv, event_type: 'rdv' } as Appointment });
  };

  const enregistrer = async () => {
    if (!valide || enregistrement) return;
    // Décalé : on demande d'abord la nouvelle date, puis on enregistre le tout ensemble.
    if (resultat === 'decale') {
      setDecalage({ date: dansSeptJours(), debut: rdv.heure_debut || '09:00', fin: rdv.heure_fin || '10:00', notes: '' });
      return;
    }
    setEnregistrement(true);
    try {
      const r = await apiPost(`/appointments/${rdv.id}/compte-rendu`, {
        resultat,
        notes,
        suite: rappel && rappelDate ? { date: rappelDate, message: rappelMessage.trim() } : undefined,
        raison_perte: raisonPerte,
      }) as Retour;
      appliquerRetour(r);
      toast.success(r.tache ? 'Compte rendu enregistré, tâche client créée' : 'Compte rendu enregistré');
      if (resultat === 'mail_envoye' && (r.prospect || prospect)) { setEmailProspect((r.prospect || prospect)!); return; }
      onClose();
    } catch (err) {
      toast.error(`Compte rendu non enregistré : ${err instanceof Error ? err.message : 'erreur inconnue'}`);
    } finally {
      setEnregistrement(false);
    }
  };

  const confirmerDecalage = async () => {
    if (!decalage?.date || enregistrement) return;
    setEnregistrement(true);
    try {
      const r = await apiPost(`/appointments/${rdv.id}/compte-rendu`, {
        resultat: 'decale',
        notes,
        nouveau_rdv: { date: decalage.date, heure_debut: decalage.debut, heure_fin: decalage.fin, notes: decalage.notes },
      }) as Retour;
      appliquerRetour(r);
      toast.success(`Nouveau rendez-vous le ${formatDate(decalage.date)}`);
      onClose();
    } catch (err) {
      toast.error(`Erreur : ${err instanceof Error ? err.message : 'erreur inconnue'}`);
    } finally {
      setEnregistrement(false);
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
            {resultat && <p className="text-[11px] text-gray-500 mt-1.5 italic">{client ? EFFET_CLIENT[resultat as Exclude<AppointmentResult, ''>] : OPTIONS.find(o => o.value === resultat)?.effet}</p>}
            {resultat === 'pas_interesse' && prospect && <SelectRaisonPerte value={raisonPerte} onChange={setRaisonPerte} />}
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
              <Bell className="w-4 h-4" /> {client ? 'Programmer une tâche de suivi' : 'Programmer un rappel'}
            </button>
          ) : (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-amber-700 flex items-center gap-1"><Bell className="w-3 h-3" /> {client ? 'Tâche de suivi (client)' : 'Rappel de relance'} {rappelObligatoire && <span className="text-red-500">*</span>}</label>
                {!rappelObligatoire && <button className="text-gray-400 hover:text-gray-600" onClick={() => setRappel(false)}><X className="w-4 h-4" /></button>}
              </div>
              <div>
                <label className="block text-[10px] text-amber-600 mb-0.5">{client ? 'Échéance' : 'Date du rappel'} {rappelObligatoire && <span className="text-red-500">*</span>}</label>
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
