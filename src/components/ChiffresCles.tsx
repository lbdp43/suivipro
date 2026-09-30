// Les chiffres clés en cartes : le nombre, l'écart avec la période d'avant, et une petite
// courbe sur 8 semaines. Chacun voit s'il avance sans ouvrir de graphique.
//
// Inspiré des cartes KPI « Progress Metric Card » (makviesainte) et « Card » (wensity) de
// 21st.dev, dessiné en SVG sans bibliothèque : 8 points ne justifient pas Chart.js.
import { useMemo, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { Navigation, CalendarCheck, AlertTriangle, Euro, Phone, TrendingUp, TrendingDown } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { appelsProspects, chiffreAffaires, clientsEnRetard, ecart, rdvPris, visitesEtAppels, NB_SEMAINES, type ChiffreCle } from '../utils/chiffresCles';

type Sorte = 'visites' | 'appels' | 'rdv' | 'retards' | 'ca';

const DEFINITIONS: Record<Sorte, {
  titre: string;
  icone: ComponentType<{ className?: string }>;
  lien: string;
  periode: string;
  /** Monter est une mauvaise nouvelle (clients en retard). */
  inverse?: boolean;
  euros?: boolean;
  couleur: string;
}> = {
  visites: { titre: 'Visites et appels', icone: Navigation, lien: '/clients', periode: 'cette semaine', couleur: 'text-green-600' },
  appels: { titre: 'Appels', icone: Phone, lien: '/appels', periode: 'cette semaine', couleur: 'text-blue-600' },
  rdv: { titre: 'RDV pris', icone: CalendarCheck, lien: '/rdv', periode: 'cette semaine', couleur: 'text-purple-600' },
  retards: { titre: 'Clients en retard', icone: AlertTriangle, lien: '/clients', periode: "aujourd'hui", inverse: true, couleur: 'text-red-600' },
  ca: { titre: 'CA EasyBeer', icone: Euro, lien: '/easybeer', periode: 'ce mois-ci, HT', euros: true, couleur: 'text-amber-600' },
};

const COMPARAISON: Record<Sorte, string> = {
  visites: 'la semaine dernière',
  appels: 'la semaine dernière',
  rdv: 'la semaine dernière',
  retards: 'il y a 7 jours',
  ca: 'le mois dernier',
};

const nombre = (n: number, euros?: boolean) => euros
  ? n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
  : n.toLocaleString('fr-FR');

function Courbe({ points, couleur, titre }: { points: number[]; couleur: string; titre: string }) {
  const L = 100; const H = 32; const marge = 3;
  const max = Math.max(...points, 1);
  const pas = (L - marge * 2) / Math.max(points.length - 1, 1);
  const xy = points.map((v, i) => [marge + i * pas, H - marge - (v / max) * (H - marge * 2)] as const);
  const ligne = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const aire = `${ligne} L${xy[xy.length - 1][0].toFixed(1)} ${H} L${xy[0][0].toFixed(1)} ${H} Z`;
  const [dx, dy] = xy[xy.length - 1];
  return (
    <svg viewBox={`0 0 ${L} ${H}`} preserveAspectRatio="none" className={`h-8 w-full ${couleur}`} role="img" aria-label={`${titre} sur ${NB_SEMAINES} semaines : ${points.join(', ')}`}>
      <path d={aire} fill="currentColor" fillOpacity={0.12} />
      <path d={ligne} fill="none" stroke="currentColor" strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={dx} cy={dy} r={2.2} fill="currentColor" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Carte({ sorte, chiffre }: { sorte: Sorte; chiffre: ChiffreCle }) {
  const d = DEFINITIONS[sorte];
  const e = ecart(chiffre);
  const monte = (e ?? 0) > 0; const baisse = (e ?? 0) < 0;
  const bon = d.inverse ? baisse : monte;
  const mauvais = d.inverse ? monte : baisse;
  const Fleche = monte ? TrendingUp : TrendingDown;
  return (
    <Link to={d.lien} className="flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white p-3 hover:border-gray-300">
      <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
        <d.icone className={`h-3.5 w-3.5 ${d.couleur}`} /> <span className="truncate">{d.titre}</span>
      </p>
      <p className="mt-1 text-2xl font-bold leading-none tabular-nums text-gray-900">{nombre(chiffre.valeur, d.euros)}</p>
      <p className="mt-0.5 text-xs text-gray-400">{d.periode}</p>
      <div className="mt-2"><Courbe points={chiffre.courbe} couleur={d.couleur} titre={d.titre} /></div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-1 text-xs">
        {e === null ? (
          <span className="text-gray-400">{chiffre.avant === null ? '—' : `contre ${nombre(chiffre.avant, d.euros)} ${COMPARAISON[sorte]}`}</span>
        ) : e === 0 ? (
          <span className="text-gray-400">stable, comme {COMPARAISON[sorte]}</span>
        ) : (
          <>
            <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium tabular-nums ${bon ? 'bg-green-50 text-green-700' : mauvais ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
              <Fleche className="h-3 w-3" /> {e > 0 ? '+' : ''}{e} %
            </span>
            <span className="text-gray-400">vs {COMPARAISON[sorte]}</span>
          </>
        )}
      </p>
    </Link>
  );
}

/**
 * Les cartes pour une personne (son identifiant) ou pour l'équipe (null). Pour la
 * prospection, les appels aux prospects remplacent les visites, sans clients ni CA.
 */
export default function ChiffresCles({ pour, prospection = false }: { pour: string | null; prospection?: boolean }) {
  const { stateComplet } = useApp();
  const { interactions, appointments, clients, commandes, calls } = stateComplet;
  const cartes = useMemo(() => {
    const maintenant = new Date();
    const l: { sorte: Sorte; chiffre: ChiffreCle }[] = [];
    if (prospection) {
      l.push({ sorte: 'appels', chiffre: appelsProspects(calls, interactions, pour, maintenant) });
      l.push({ sorte: 'rdv', chiffre: rdvPris(appointments, pour, maintenant) });
    } else {
      l.push({ sorte: 'visites', chiffre: visitesEtAppels(interactions, pour, maintenant) });
      l.push({ sorte: 'rdv', chiffre: rdvPris(appointments, pour, maintenant) });
      l.push({ sorte: 'retards', chiffre: clientsEnRetard(clients, interactions, pour, maintenant) });
      l.push({ sorte: 'ca', chiffre: chiffreAffaires(commandes, clients, pour, maintenant) });
    }
    return l;
  }, [interactions, appointments, clients, commandes, calls, pour, prospection]);

  return (
    <div className={`grid gap-2 sm:gap-3 ${cartes.length > 2 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2'}`}>
      {cartes.map(c => <Carte key={c.sorte} sorte={c.sorte} chiffre={c.chiffre} />)}
    </div>
  );
}
