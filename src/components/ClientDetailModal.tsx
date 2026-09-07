import { useApp } from '../store/AppContext';
import FicheClient from './FicheClient';

// La fiche client en fenêtre (ouverte depuis Semaine) : la même fiche que le panneau de la page Clients.
export default function ClientDetailModal({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const { state } = useApp();
  const client = state.clients.find(c => c.id === clientId);
  if (!client) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg sm:rounded-xl rounded-t-xl shadow-2xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <FicheClient client={client} variante="fenetre" onFermer={onClose} />
      </div>
    </div>
  );
}
