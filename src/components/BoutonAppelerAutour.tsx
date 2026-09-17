// « Appeler autour » : partir d'un point de la carte ou d'un rendez-vous, et enchaîner les
// appels des prospects du secteur.
//
// Le geste que ça remplace : quelqu'un voit qu'Alban monte à Riom jeudi, ouvre la page
// Prospects, cherche à tâtons qui est dans le coin, coche des cases. Ici, un bouton.
//
// La question « qui appeler autour d'ici » n'est pas tranchée ici mais dans
// utils/voisinage : il n'y a qu'une seule définition dans le logiciel, et le bloc des
// tournées à garnir de l'accueil s'en sert aussi.
import { useMemo } from 'react';
import { Phone } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useLancerSession } from '../hooks/useSessionAppel';
import { sessionDuJour } from '../utils/sessionAppel';
import { prospectsAAppelerAutourDe, RAYON_APPELS_KM, SESSION_MAX } from '../utils/voisinage';
import { ETAPES_A_APPELER } from '../utils/zones';
import { dateLocale } from '../../shared/regles';

interface Props {
  /** Le ou les points autour desquels chercher. Un rendez-vous en a un, une journée plusieurs. */
  points: { lat: number; lon: number }[];
  /** En version compacte, le bouton se réduit à une icône et un nombre. */
  compact?: boolean;
  /** Empêche le clic de remonter — indispensable dans une ligne ou une carte cliquable. */
  stopPropagation?: boolean;
  className?: string;
}

export default function BoutonAppelerAutour({ points, compact = false, stopPropagation = true, className = '' }: Props) {
  const { state } = useApp();
  const lancer = useLancerSession();
  const moiId = state.currentUser?.id;

  const aAppeler = useMemo(() => {
    const aujourdhui = dateLocale(new Date());
    const { appeles } = sessionDuJour(state, moiId);
    return prospectsAAppelerAutourDe(
      points,
      { prospects: state.prospects, appointments: state.appointments, aujourdhui, etapesAAppeler: ETAPES_A_APPELER },
      appeles,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, moiId, JSON.stringify(points)]);

  // Personne a appeler : pas de bouton mort. Un bouton grise qu'on ne peut jamais cliquer
  // n'apprend rien ; son absence dit la meme chose sans encombrer.
  if (aAppeler.length === 0) return null;

  // Ce qu'on decroche, et ce qu'il y a. Les deux sont dits : le plafond ne doit pas donner
  // l'impression qu'il n'y a que cinquante prospects dans le secteur.
  const pourLaSession = aAppeler.slice(0, SESSION_MAX);
  const plafonne = aAppeler.length > SESSION_MAX;

  const cliquer = (e: React.MouseEvent) => {
    if (stopPropagation) { e.stopPropagation(); e.preventDefault(); }
    lancer.prospects(pourLaSession.map(p => p.id));
  };

  return (
    <button
      onClick={cliquer}
      title={plafonne
        ? `${aAppeler.length} prospects à moins de ${RAYON_APPELS_KM} km. La session prend les ${SESSION_MAX} meilleurs scores ; les suivants viendront au prochain appel, une fois ceux-là faits.`
        : `Lancer une session d'appel avec les ${aAppeler.length} prospects à moins de ${RAYON_APPELS_KM} km`}
      className={className || (compact
        ? 'flex items-center gap-1 px-1.5 py-1 rounded-lg bg-purple-100 text-purple-700 text-[10px] font-semibold hover:bg-purple-200 whitespace-nowrap'
        : 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700 whitespace-nowrap')}
    >
      <Phone className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      {compact
        ? (plafonne ? `${SESSION_MAX}/${aAppeler.length}` : aAppeler.length)
        : (plafonne
          ? `Appeler autour (${SESSION_MAX} sur ${aAppeler.length})`
          : `Appeler autour (${aAppeler.length})`)}
    </button>
  );
}
