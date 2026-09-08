import { useState } from 'react';
import { Link } from 'react-router-dom';
import { X, ExternalLink, Phone, History } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { Appointment } from '../types';
import FicheProspect from './FicheProspect';
import FriseProspect from './FriseProspect';
import CompteRenduModal from './CompteRenduModal';
import ClientDetailModal from './ClientDetailModal';
import { useCallModal } from './CallModal';

// La fiche d'un prospect en fenêtre, sans quitter la page : qui c'est, et tout ce qui s'est
// passé avec lui (appels, mails envoyés, rendez-vous, actions, changements d'étape).
// Ouverte depuis un rendez-vous à venir, le planning, le bilan ou le suivi des rendez-vous.
export default function FicheProspectModal({ prospectId, onClose }: { prospectId: string; onClose: () => void }) {
  const { getProspect } = useApp();
  const { startCall } = useCallModal();
  const [crRdv, setCrRdv] = useState<Appointment | null>(null);
  const prospect = getProspect(prospectId);
  if (!prospect) return null;
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
        <div className="bg-white w-full sm:max-w-2xl sm:rounded-xl rounded-t-xl shadow-2xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-200">
            <h3 className="font-bold text-gray-900 flex items-center gap-2 min-w-0"><History className="w-4 h-4 text-brewery-600 flex-shrink-0" /> <span className="truncate">Fiche et historique</span></h3>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {prospect.telephone && (
                <button type="button" onClick={() => { onClose(); startCall(prospect.id); }} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-50 text-green-700 text-xs font-medium hover:bg-green-100" title="Appeler">
                  <Phone className="w-3.5 h-3.5" /> Appeler
                </button>
              )}
              <Link to={`/prospects?id=${prospect.id}`} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-xs font-medium hover:bg-gray-200" title="Ouvrir la fiche complète dans Prospects">
                <ExternalLink className="w-3.5 h-3.5" /> Fiche complète
              </Link>
              <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="Fermer"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
          </div>
          <div className="overflow-y-auto p-4 space-y-4">
            <FicheProspect prospect={prospect} />
            <FriseProspect prospect={prospect} onCompteRendu={rdv => setCrRdv(rdv)} />
          </div>
        </div>
      </div>
      {crRdv && <div className="relative z-[70]"><CompteRenduModal rdv={crRdv} onClose={() => setCrRdv(null)} /></div>}
    </>
  );
}

/** Un nom cliquable : la fiche du prospect ou du client s'ouvre en fenêtre. */
export function NomFiche({ prospectId, clientId, children, className = '' }: { prospectId?: string; clientId?: string; children: React.ReactNode; className?: string }) {
  const [ouvert, setOuvert] = useState(false);
  if (!prospectId && !clientId) return <span className={className}>{children}</span>;
  return (
    <>
      <button type="button" onClick={e => { e.stopPropagation(); setOuvert(true); }} className={`text-left hover:text-brewery-700 hover:underline ${className}`} title="Voir la fiche et l'historique">{children}</button>
      {ouvert && clientId && <ClientDetailModal clientId={clientId} onClose={() => setOuvert(false)} />}
      {ouvert && !clientId && prospectId && <FicheProspectModal prospectId={prospectId} onClose={() => setOuvert(false)} />}
    </>
  );
}
