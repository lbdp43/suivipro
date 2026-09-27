import { useApp } from '../store/AppContext';
import FicheClient from './FicheClient';
import Fenetre from './ui/Fenetre';

// La fiche client en fenêtre (ouverte depuis Semaine) : la même fiche que le panneau de la page Clients.
export default function ClientDetailModal({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const { state } = useApp();
  const client = state.clients.find(c => c.id === clientId);
  if (!client) return null;
  return (
    <Fenetre ouvert brut auPremierPlan onFermer={onClose} titre={client.nom} largeur="normale">
      <div className="flex max-h-[85dvh] flex-col">
        <FicheClient client={client} variante="fenetre" onFermer={onClose} />
      </div>
    </Fenetre>
  );
}
