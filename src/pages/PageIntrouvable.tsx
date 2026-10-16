// Une adresse qui ne mène nulle part : on le dit, avec le menu autour, au lieu d'un écran blanc.
import { Link, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import EtatVide from '../components/ui/EtatVide';

export default function PageIntrouvable() {
  const { pathname } = useLocation();
  return (
    <div className="p-6 sm:p-10 max-w-xl mx-auto">
      <EtatVide icone={Compass} titre="Cette page n'existe pas" texte={<>Rien ne répond à l'adresse <code className="rounded bg-gray-100 px-1 text-xs">{pathname}</code>. Le lien est peut-être ancien, ou mal recopié.</>}>
        <Link to="/" className="inline-flex items-center rounded-lg bg-brewery-600 px-4 py-2 text-sm font-medium text-white hover:bg-brewery-700">Retour à l'accueil</Link>
      </EtatVide>
    </div>
  );
}
