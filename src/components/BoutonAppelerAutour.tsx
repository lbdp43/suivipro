// « Appeler autour » : partir d'un point de la carte ou d'un rendez-vous, et enchaîner les
// appels des prospects du secteur.
//
// Le geste que ça remplace : quelqu'un voit qu'Alban monte à Riom jeudi, ouvre la page
// Prospects, cherche à tâtons qui est dans le coin, coche des cases. Ici, un bouton.
//
// La question « qui appeler autour d'ici » n'est pas tranchée ici mais dans
// utils/voisinage : il n'y a qu'une seule définition dans le logiciel, et le bloc des
// tournées à garnir de l'accueil s'en sert aussi. Le rayon, lui, est celui que chacun
// se règle (3, 5, 10, 15 ou 20 km), juste à côté du bouton, gardé sur le profil.
import { useMemo } from 'react';
import { Phone } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useLancerSession } from '../hooks/useSessionAppel';
import { useRayonAppels } from '../hooks/useRayonAppels';
import { sessionDuJour } from '../utils/sessionAppel';
import { prospectsAAppelerAutourDe, SESSION_MAX } from '../utils/voisinage';
import { ETAPES_A_APPELER } from '../utils/zones';
import { dateLocale } from '../../shared/regles';
import type { OrigineSession } from '../types';

interface Props {
  /** Le ou les points autour desquels chercher. Un rendez-vous en a un, une journée plusieurs. */
  points: { lat: number; lon: number }[];
  /** Le rendez-vous d'où l'on part : l'écran d'appel le montre, avec la distance jusqu'à chaque prospect. */
  origine?: OrigineSession;
  /** En version compacte, le bouton se réduit à une icône et un nombre. */
  compact?: boolean;
  /** Empêche le clic de remonter — indispensable dans une ligne ou une carte cliquable. */
  stopPropagation?: boolean;
  className?: string;
}

export default function BoutonAppelerAutour({ points, origine, compact = false, stopPropagation = true, className = '' }: Props) {
  const { state } = useApp();
  const lancer = useLancerSession();
  const { rayon, rayons, choisir } = useRayonAppels();
  const moiId = state.currentUser?.id;

  const aAppeler = useMemo(() => {
    const aujourdhui = dateLocale(new Date());
    const { appeles } = sessionDuJour(state, moiId);
    return prospectsAAppelerAutourDe(
      points,
      { prospects: state.prospects, appointments: state.appointments, aujourdhui, etapesAAppeler: ETAPES_A_APPELER },
      appeles,
      rayon,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, moiId, rayon, JSON.stringify(points)]);

  // Pas de point : rien à chercher. Sinon le bouton reste, même à zéro, pour pouvoir élargir
  // le rayon — un bouton qui disparaît ne dit pas qu'il suffirait d'aller un peu plus loin.
  if (points.length === 0) return null;

  // Ce qu'on decroche, et ce qu'il y a. Les deux sont dits : le plafond ne doit pas donner
  // l'impression qu'il n'y a que cinquante prospects dans le secteur.
  const pourLaSession = aAppeler.slice(0, SESSION_MAX);
  const plafonne = aAppeler.length > SESSION_MAX;
  const personne = aAppeler.length === 0;

  const cliquer = (e: React.MouseEvent) => {
    if (stopPropagation) { e.stopPropagation(); e.preventDefault(); }
    if (personne) return;
    lancer.prospects(pourLaSession.map(p => p.id), origine);
  };

  const titre = personne
    ? `Personne à appeler à moins de ${rayon} km. Élargissez le rayon à côté.`
    : plafonne
      ? `${aAppeler.length} prospects à moins de ${rayon} km. La session prend les ${SESSION_MAX} meilleurs scores ; les suivants viendront au prochain appel, une fois ceux-là faits.`
      : `Lancer une session d'appel avec les ${aAppeler.length} prospects à moins de ${rayon} km`;

  const classeBouton = className || (compact
    ? 'flex items-center gap-1 px-1.5 py-1 bg-purple-100 text-purple-700 text-xs font-semibold hover:bg-purple-200 whitespace-nowrap disabled:opacity-50 disabled:hover:bg-purple-100'
    : 'flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700 whitespace-nowrap disabled:opacity-50 disabled:hover:bg-purple-600');
  // Le rayon se choisit sur place : même teinte que le bouton, collé à lui.
  const classeRayon = compact
    ? 'bg-purple-50 text-purple-700 hover:bg-purple-100 text-xs'
    : 'bg-purple-700 text-white hover:bg-purple-800 text-xs';

  return (
    <span className="inline-flex items-stretch rounded-lg overflow-hidden" onClick={e => { if (stopPropagation) e.stopPropagation(); }}>
      <button onClick={cliquer} title={titre} disabled={personne} className={`${classeBouton} rounded-l-lg`}>
        <Phone className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
        {compact
          ? (plafonne ? `${SESSION_MAX}/${aAppeler.length}` : aAppeler.length)
          : (plafonne
            ? `Appeler autour (${SESSION_MAX} sur ${aAppeler.length})`
            : `Appeler autour (${aAppeler.length})`)}
      </button>
      <select
        aria-label="Rayon d'appel autour"
        title="Jusqu'à quelle distance chercher qui appeler"
        value={rayon}
        onChange={e => { void choisir(Number(e.target.value)); }}
        onClick={e => { if (stopPropagation) e.stopPropagation(); }}
        className={`${classeRayon} border-0 border-l border-white/30 px-1 py-0 font-semibold cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-purple-400 rounded-r-lg`}
      >
        {rayons.map(km => <option key={km} value={km}>{km} km</option>)}
      </select>
    </span>
  );
}
