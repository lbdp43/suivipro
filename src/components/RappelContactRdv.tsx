// « Pensez au nom et prénom » : le rappel qui s'affiche avant un appel, tant que des
// rendez-vous pris par la personne partent sans contact nommé.
//
// Le commercial qui se déplace a besoin de savoir qui demander en arrivant. Le rappel
// n'apparaît donc que s'il y a vraiment quelque chose à corriger, et il disparaît de
// lui-même dès que les fiches sont complétées : personne ne le désactive, il s'éteint.
import { AlertTriangle, X } from 'lucide-react';
import { Appointment, Client, Prospect } from '../types';
import { dateLocale, jourDe, rdvAnnule } from '../../shared/regles';

/** Au-delà, le rendez-vous est passé depuis trop longtemps pour qu'on y revienne. */
const FENETRE_JOURS = 7;

/**
 * Les rendez-vous pris par cette personne qui arrivent (ou viennent d'avoir lieu) sans
 * nom de contact sur la fiche. C'est ce qui manque au commercial une fois sur place.
 */
export function rdvSansContact(
  appointments: Appointment[],
  prospects: Prospect[],
  clients: Client[],
  commercialId: string | undefined,
  maintenant = new Date(),
): Appointment[] {
  if (!commercialId) return [];
  const debut = new Date(maintenant);
  debut.setDate(debut.getDate() - FENETRE_JOURS);
  const depuis = dateLocale(debut);
  const parProspect = new Map(prospects.map(p => [p.id, p]));
  const parClient = new Map(clients.map(c => [c.id, c]));

  return appointments
    .filter(a => {
      if (a.prospecteur_id !== commercialId) return false;
      if (rdvAnnule(a)) return false;
      if (jourDe(a.date) < depuis) return false;
      if (a.client_id) return !(parClient.get(a.client_id)?.contact || '').trim();
      if (a.prospect_id) {
        const p = parProspect.get(a.prospect_id);
        return !!p && !(p.nom_contact || '').trim();
      }
      return false;
    })
    .sort((x, y) => x.date.localeCompare(y.date));
}

const MOIS = ['janv.', 'févr.', 'mars', 'avril', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function dateCourte(valeur: string): string {
  const d = new Date(`${jourDe(valeur)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? jourDe(valeur) : `${d.getDate()} ${MOIS[d.getMonth()]}`;
}

export default function RappelContactRdv({
  rdvs, nomDe, onContinuer, onFermer,
}: {
  rdvs: Appointment[];
  nomDe: (rdv: Appointment) => string;
  onContinuer: () => void;
  onFermer: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onFermer}>
      <div className="bg-white w-full sm:max-w-md rounded-t-xl sm:rounded-xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 p-4 border-b border-amber-200 bg-amber-50 rounded-t-xl">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-amber-900">Le nom du contact, avant tout</h3>
            <p className="text-sm text-amber-800 mt-1">
              Pensez à prendre le <strong>nom et le prénom</strong> de la personne, et le plus de détails
              possible sur le rendez-vous : c'est ce qui manque au commercial quand il arrive sur place.
            </p>
          </div>
          <button type="button" onClick={onFermer} className="p-1 rounded-lg hover:bg-amber-100 flex-shrink-0" aria-label="Fermer">
            <X className="w-4 h-4 text-amber-700" />
          </button>
        </div>

        <div className="p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            {rdvs.length === 1 ? 'Un rendez-vous sans contact nommé' : `${rdvs.length} rendez-vous sans contact nommé`}
          </p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {rdvs.slice(0, 6).map(r => (
              <p key={r.id} className="text-sm text-gray-700 flex items-baseline gap-2">
                <span className="text-xs text-gray-400 tabular-nums flex-shrink-0 w-14">{dateCourte(r.date)}</span>
                <span className="truncate">{nomDe(r)}</span>
              </p>
            ))}
            {rdvs.length > 6 && <p className="text-xs text-gray-400">et {rdvs.length - 6} autre(s)…</p>}
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Ce rappel disparaîtra tout seul dès que ces fiches auront un contact.
          </p>
        </div>

        <div className="flex justify-end gap-2 px-4 pb-4">
          <button type="button" onClick={onContinuer} className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700">
            J'ai compris, j'appelle
          </button>
        </div>
      </div>
    </div>
  );
}
