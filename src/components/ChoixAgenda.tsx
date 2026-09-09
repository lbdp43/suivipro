// « Ajouter à l'agenda » : sur quel agenda ?
//
// Les agendas de l'équipe sont partagés en écriture : depuis un seul compte connecté, on
// peut poser le rendez-vous sur celui de Guillaume, d'Alban ou de Loïc. La fenêtre montre
// donc les agendas où l'on a le droit d'écrire, celui du commercial du rendez-vous déjà
// choisi — un clic suffit, et on peut changer.
import { useEffect, useState } from 'react';
import { CalendarPlus, Check, X, Download, Loader2 } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { downloadICS } from '../utils/helpers';
import { Appointment, Prospect } from '../types';
import { useApp } from '../store/AppContext';

interface Agenda { id: string; nom: string; principal: boolean }

/** L'agenda qui correspond à une personne : son adresse est l'identifiant de son agenda. */
export function agendaDe(agendas: Agenda[], email?: string, prenom?: string): string {
  if (email) {
    const parEmail = agendas.find(a => a.id.toLowerCase() === email.toLowerCase());
    if (parEmail) return parEmail.id;
  }
  if (prenom) {
    const parNom = agendas.find(a => a.nom.toLowerCase().includes(prenom.toLowerCase()));
    if (parNom) return parNom.id;
  }
  return agendas.find(a => a.principal)?.id || agendas[0]?.id || '';
}

export default function ChoixAgenda({
  rdv, prospect, onFini, onFermer,
}: {
  rdv: Appointment;
  prospect?: Prospect;
  onFini: (message: string, bon: boolean) => void;
  onFermer: () => void;
}) {
  const { getCommercial } = useApp();
  const [agendas, setAgendas] = useState<Agenda[] | null>(null);
  const [erreur, setErreur] = useState('');
  const [choisi, setChoisi] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const commercial = getCommercial(rdv.commercial_id);

  useEffect(() => {
    let vivant = true;
    apiGet<{ connecte: boolean; agendas: Agenda[]; raison?: string }>('/google-calendar/agendas')
      .then(r => {
        if (!vivant) return;
        if (!r.connecte) { setErreur(r.raison === 'acces_revoque' ? 'revoque' : 'non_connecte'); setAgendas([]); return; }
        setAgendas(r.agendas);
        setChoisi(agendaDe(r.agendas, commercial?.email, commercial?.prenom));
      })
      .catch(() => { if (vivant) { setErreur('erreur'); setAgendas([]); } });
    return () => { vivant = false; };
  }, [rdv.id]);

  const envoyer = async () => {
    setEnvoi(true);
    try {
      const r = await apiPost(`/appointments/${rdv.id}/agenda`, { calendar_id: choisi }) as { pose: boolean; raison?: string };
      const nom = agendas?.find(a => a.id === choisi)?.nom || 'l\'agenda';
      if (r.pose) onFini(`Ajouté à ${nom}`, true);
      else if (r.raison === 'agenda_refuse') onFini(`Écriture refusée sur ${nom} — demandez le partage en modification`, false);
      else onFini('Google Agenda n\'a pas pu être joint', false);
    } catch {
      onFini('Google Agenda n\'a pas pu être joint', false);
    }
    onFermer();
  };

  const telecharger = () => {
    if (prospect) downloadICS(rdv, prospect);
    onFini('Fichier téléchargé — ouvrez-le pour l\'ajouter à la main', false);
    onFermer();
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center" onClick={onFermer}>
      <div className="bg-white w-full sm:max-w-sm rounded-t-xl sm:rounded-xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <CalendarPlus className="w-4 h-4 text-blue-600" /> Ajouter à l'agenda
          </h3>
          <button type="button" onClick={onFermer} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="Fermer">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="p-4">
          {agendas === null && <p className="text-sm text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Recherche de vos agendas…</p>}

          {agendas && agendas.length > 0 && (
            <>
              <p className="text-xs text-gray-500 mb-2">Sur quel agenda ?</p>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {agendas.map(a => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setChoisi(a.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left text-sm ${choisi === a.id ? 'border-blue-500 bg-blue-50 text-blue-800 font-medium' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                  >
                    <span className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${choisi === a.id ? 'border-blue-600 bg-blue-600' : 'border-gray-300'}`}>
                      {choisi === a.id && <Check className="w-3 h-3 text-white" />}
                    </span>
                    <span className="truncate">{a.nom}</span>
                    {a.principal && <span className="ml-auto text-[10px] text-gray-400 flex-shrink-0">le mien</span>}
                  </button>
                ))}
              </div>
            </>
          )}

          {agendas && agendas.length === 0 && (
            <p className="text-sm text-gray-600">
              {erreur === 'non_connecte' && 'Votre Google Agenda n\'est pas connecté. Administration → Google Agenda.'}
              {erreur === 'revoque' && 'L\'accès à Google Agenda a expiré : reconnectez-le dans Administration.'}
              {erreur === 'erreur' && 'Google Agenda n\'a pas répondu.'}
              {!erreur && 'Aucun agenda où vous pouvez écrire.'}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 pb-4">
          <button type="button" onClick={telecharger} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-gray-600 text-xs hover:bg-gray-100">
            <Download className="w-3.5 h-3.5" /> Télécharger le fichier
          </button>
          <button
            type="button"
            onClick={envoyer}
            disabled={!choisi || envoi}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
          >
            {envoi ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />} Ajouter
          </button>
        </div>
      </div>
    </div>
  );
}
