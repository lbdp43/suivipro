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
import Fenetre from './ui/Fenetre';
import Bouton from './ui/Bouton';

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
      <Fenetre
        ouvert
        onFermer={onClose}
        titre="Décaler le rendez-vous"
        icone={<CalendarClock className="w-5 h-5" />}
        pied={(
          <>
            <Bouton variante="secondaire" onClick={onClose}>Plus tard</Bouton>
            <Bouton variante="principal" icone={<CalendarClock className="w-4 h-4" />} onClick={confirmerDecalage} disabled={!decalage.date}>Confirmer le report</Bouton>
          </>
        )}
      >
        <div className="space-y-4">
          <div className="bg-surface-2 rounded-lg p-3">
            <p className="text-xs text-encre-douce">Rendez-vous actuel</p>
            <p className="font-semibold text-sm text-encre">{nom}</p>
            <p className="text-xs text-encre-douce mt-1">{formatDate(rdv.date)}{rdv.heure_debut && ` · ${rdv.heure_debut}`}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-encre mb-1">Nouvelle date *</label>
            <input type="date" className="w-full border border-trait rounded-lg px-3 py-2 text-sm" value={decalage.date} onChange={e => setDecalage({ ...decalage, date: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-encre mb-1">Heure de début</label>
              <input type="time" className="w-full border border-trait rounded-lg px-3 py-2 text-sm" value={decalage.debut} onChange={e => setDecalage({ ...decalage, debut: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-encre mb-1">Heure de fin</label>
              <input type="time" className="w-full border border-trait rounded-lg px-3 py-2 text-sm" value={decalage.fin} onChange={e => setDecalage({ ...decalage, fin: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-encre mb-1">Raison</label>
            <textarea className="w-full border border-trait rounded-lg px-3 py-2 text-sm resize-none" rows={2} placeholder="Pourquoi ce report ?" value={decalage.notes} onChange={e => setDecalage({ ...decalage, notes: e.target.value })} />
          </div>
        </div>
      </Fenetre>
    );
  }

  return (
    <Fenetre
      ouvert
      onFermer={onClose}
      titre="Compte rendu du rendez-vous"
      sousTitre={`${nom} · ${formatDate(rdv.date)}`}
      icone={<ClipboardCheck className="w-5 h-5" />}
      pied={(
        <>
          <Bouton variante="secondaire" onClick={onClose}>Annuler</Bouton>
          <Bouton variante="principal" icone={<ClipboardCheck className="w-4 h-4" />} onClick={enregistrer} disabled={!valide} occupe={enregistrement}>
            {enregistrement ? 'Enregistrement…' : resultat === 'mail_envoye' ? 'Valider et envoyer un mail' : resultat === 'decale' ? 'Valider et replanifier' : 'Valider le compte rendu'}
          </Bouton>
        </>
      )}
    >
      <div className="space-y-4">
        <div>
          <p className="block text-sm font-medium text-encre mb-2">Résultat du rendez-vous</p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Résultat du rendez-vous">
            {OPTIONS.map(opt => (
              <button
                key={opt.value}
                role="radio"
                aria-checked={resultat === opt.value}
                className={`flex min-h-11 items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border-2 transition-colors text-left ${resultat === opt.value ? opt.couleur : 'border-trait text-encre-douce hover:bg-surface-2'}`}
                onClick={() => choisir(opt.value)}
              >
                <opt.icon className="w-4 h-4 flex-shrink-0" /> {APPOINTMENT_RESULT_LABELS[opt.value]}
              </button>
            ))}
          </div>
          {resultat && <p className="text-xs text-encre-douce mt-2">{client ? EFFET_CLIENT[resultat as Exclude<AppointmentResult, ''>] : OPTIONS.find(o => o.value === resultat)?.effet}</p>}
          {resultat === 'pas_interesse' && prospect && <SelectRaisonPerte value={raisonPerte} onChange={setRaisonPerte} />}
        </div>

        <div>
          <label htmlFor="notes-cr" className="block text-sm font-medium text-encre mb-1">Notes du compte rendu <span className="text-danger">*</span></label>
          <textarea
            id="notes-cr"
            className={`w-full px-3 py-2 border rounded-lg text-sm h-24 resize-none focus:ring-2 focus:ring-primaire ${notes.trim() === '' ? 'border-red-300' : 'border-trait'}`}
            placeholder="Comment s'est passé le rendez-vous ?"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
          {notes.trim() === '' && <p className="text-xs text-danger mt-1">Les notes sont obligatoires pour valider le compte rendu.</p>}
        </div>

        {!rappel && !rappelObligatoire ? (
          <button
            className="w-full flex min-h-11 items-center justify-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-amber-300 text-amber-700 hover:border-amber-500 hover:bg-amber-50 text-sm font-medium transition-colors"
            onClick={() => setRappel(true)}
          >
            <Bell className="w-4 h-4" /> {client ? 'Programmer une tâche de suivi' : 'Programmer un rappel'}
          </button>
        ) : (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-amber-800 flex items-center gap-1.5"><Bell className="w-4 h-4" /> {client ? 'Tâche de suivi (client)' : 'Rappel de relance'} {rappelObligatoire && <span className="text-danger">*</span>}</p>
              {!rappelObligatoire && <button className="p-2 -m-2 text-encre-douce hover:text-encre" onClick={() => setRappel(false)} aria-label="Retirer le rappel"><X className="w-4 h-4" /></button>}
            </div>
            <div>
              <label htmlFor="date-rappel-cr" className="block text-xs font-medium text-amber-800 mb-1">{client ? 'Échéance' : 'Date du rappel'} {rappelObligatoire && <span className="text-danger">*</span>}</label>
              <input id="date-rappel-cr" type="date" className={`w-full px-3 py-2 border rounded-lg text-sm bg-white ${rappelObligatoire && !rappelDate ? 'border-red-300' : 'border-amber-200'}`} value={rappelDate} onChange={e => setRappelDate(e.target.value)} />
            </div>
            <div>
              <label htmlFor="message-rappel-cr" className="block text-xs font-medium text-amber-800 mb-1">Message (facultatif)</label>
              <input id="message-rappel-cr" type="text" className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm bg-white" placeholder="Ex : relancer pour le devis…" value={rappelMessage} onChange={e => setRappelMessage(e.target.value)} />
            </div>
          </div>
        )}
      </div>
    </Fenetre>
  );
}

