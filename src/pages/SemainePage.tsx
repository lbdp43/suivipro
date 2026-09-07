import { useState, useEffect, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CalendarDays, ClipboardCheck } from 'lucide-react';
// Chaque volet est lourd (1 500 lignes chacun) : on ne charge que celui qu'on ouvre.
const ClientsPlanningPage = lazy(() => import('./ClientsPlanningPage'));
const CompteRenduPage = lazy(() => import('./CompteRenduPage'));

// Une seule page pour la semaine, deux volets :
//  - « À préparer » : ce qui est prévu (rendez-vous, clients à visiter par jour et par secteur, retards) ;
//  - « Bilan » : ce qui a été fait et ce qui manque (comptes rendus, visites, résultats).
// Les anciens écrans Planning semaine, Visites et CR et Visites clients arrivent ici.
type Volet = 'preparer' | 'bilan';

export default function SemainePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const voletUrl: Volet = location.pathname.endsWith('/bilan') ? 'bilan' : 'preparer';
  const [volet, setVolet] = useState<Volet>(voletUrl);
  useEffect(() => { setVolet(voletUrl); }, [voletUrl]);

  const choisir = (v: Volet) => {
    setVolet(v);
    navigate(v === 'bilan' ? '/semaine/bilan' : '/semaine', { replace: true });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 sm:px-6 sm:pt-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Semaine</h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
              {volet === 'preparer' ? 'Ce qui est prévu : rendez-vous, clients à visiter, retards.' : 'Ce qui a été fait, et les comptes rendus qui manquent.'}
            </p>
          </div>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-full sm:w-auto" role="tablist" aria-label="Volet de la semaine">
            <button
              role="tab"
              aria-selected={volet === 'preparer'}
              onClick={() => choisir('preparer')}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all ${volet === 'preparer' ? 'bg-white text-brewery-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <CalendarDays className="w-4 h-4" /> À préparer
            </button>
            <button
              role="tab"
              aria-selected={volet === 'bilan'}
              onClick={() => choisir('bilan')}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all ${volet === 'bilan' ? 'bg-white text-brewery-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <ClipboardCheck className="w-4 h-4" /> Bilan
            </button>
          </div>
        </div>
      </div>
      <Suspense fallback={<div className="p-6 text-sm text-gray-400">Chargement…</div>}>
        {volet === 'preparer' ? <ClientsPlanningPage embarque /> : <CompteRenduPage embarque />}
      </Suspense>
    </div>
  );
}
