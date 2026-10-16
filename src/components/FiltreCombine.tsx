// Un seul filtre pour toutes les facettes d'une liste (type, étape, tag, secteur, zone,
// département, code postal…) : on tape « bio », « 43 » ou « resto », on coche, et les choix
// restent visibles en pastilles qu'on enlève d'un appui. Remplace la rangée de sept boutons.
//
// Inspiré du « Select Multi » (uiable) et du « Stacked Chips Combobox » (coss.com) de 21st.dev,
// construit sur cmdk comme la recherche globale : clavier complet (↑ ↓ pour choisir, Entrée
// pour cocher sans fermer, Échap pour effacer puis fermer). Accents et majuscules ne comptent pas.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { Check, ChevronDown, ListFilter, Search, X } from 'lucide-react';
import { normaliserPourComparaison } from '../../shared/normalisation';

export interface OptionFacette {
  value: string;
  label: string;
  /** Le nombre de fiches concernées, affiché à droite. */
  nombre?: number;
  /** Une pastille de couleur (étape, tag). */
  color?: string;
  description?: string;
}

export interface Facette {
  /** Identifiant stable (« type », « etape »…). */
  cle: string;
  titre: string;
  options: OptionFacette[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  /** Teinte des pastilles de cette facette (classes Tailwind), à défaut gris. */
  teinte?: string;
}

interface FiltreCombineProps {
  facettes: Facette[];
  /**
   * Dans un tiroir ou un panneau : la saisie et la liste s'affichent en place, sans bouton
   * ni fenêtre flottante (une liste flottante serait coupée par le tiroir).
   */
  enLigne?: boolean;
  placeholder?: string;
  /** À droite des pastilles (un bouton « Tout effacer » par exemple). */
  apres?: ReactNode;
}

/** Sans recherche, les longues listes (codes postaux) sont tronquées ; on tape pour affiner. */
const MAX_SANS_RECHERCHE = 12;

const TEINTE_DEFAUT = 'bg-gray-100 text-gray-700 hover:bg-gray-200';

export function nombreDeFiltres(facettes: Facette[]): number {
  return facettes.reduce((n, f) => n + f.selected.size, 0);
}

/** Les filtres actifs en pastilles, chacune avec sa croix. */
export function PastillesFiltres({ facettes, apres }: { facettes: Facette[]; apres?: ReactNode }) {
  const actives = facettes.flatMap(f =>
    [...f.selected].map(v => {
      const o = f.options.find(x => x.value === v);
      return { facette: f, value: v, label: o?.label ?? v, color: o?.color };
    }),
  );
  if (actives.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Filtres actifs">
      {actives.map(a => (
        <button
          key={`${a.facette.cle}:${a.value}`}
          type="button"
          onClick={() => a.facette.onToggle(a.value)}
          className={`inline-flex max-w-full items-center gap-1 rounded-full py-1 pl-2.5 pr-1.5 text-xs font-medium transition-colors ${a.facette.teinte || TEINTE_DEFAUT}`}
          aria-label={`Enlever le filtre ${a.facette.titre} : ${a.label}`}
          title={a.facette.titre}
        >
          {a.color && <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: a.color }} />}
          <span className="truncate"><span className="opacity-60">{a.facette.titre} · </span>{a.label}</span>
          <X className="h-3 w-3 flex-shrink-0 opacity-70" aria-hidden />
        </button>
      ))}
      {apres}
    </div>
  );
}

export default function FiltreCombine({ facettes, enLigne = false, placeholder = 'Filtrer : type, étape, tag, secteur, code postal…', apres }: FiltreCombineProps) {
  const [ouvert, setOuvert] = useState(enLigne);
  const [texte, setTexte] = useState('');
  const [choix, setChoix] = useState('');
  // Les facettes qu'on a demandé à voir en entier (sans recherche, les longues listes sont tronquées).
  const [depliees, setDepliees] = useState<Set<string>>(new Set());
  const conteneur = useRef<HTMLDivElement>(null);
  const q = normaliserPourComparaison(texte.trim());
  const total = nombreDeFiltres(facettes);

  // Flottant : un clic ailleurs ferme.
  useEffect(() => {
    if (enLigne || !ouvert) return;
    const fermer = (e: MouseEvent) => { if (conteneur.current && !conteneur.current.contains(e.target as Node)) setOuvert(false); };
    document.addEventListener('mousedown', fermer);
    return () => document.removeEventListener('mousedown', fermer);
  }, [enLigne, ouvert]);

  // Ce qui s'affiche : tout (tronqué) sans recherche, sinon ce qui correspond, toutes facettes confondues.
  const groupes = useMemo(() => facettes
    .map(f => {
      const visibles = q
        ? f.options.filter(o => normaliserPourComparaison(`${o.label} ${o.description || ''}`).includes(q) || normaliserPourComparaison(f.titre).includes(q))
        : f.options;
      const tronque = !q && !depliees.has(f.cle) && visibles.length > MAX_SANS_RECHERCHE;
      // Les cochées restent visibles même quand la liste est tronquée.
      const liste = tronque ? visibles.filter((o, i) => i < MAX_SANS_RECHERCHE || f.selected.has(o.value)) : visibles;
      return { facette: f, liste, caches: tronque ? visibles.length - liste.length : 0 };
    })
    .filter(g => g.liste.length > 0), [facettes, q, depliees]);

  const vide = groupes.length === 0;

  const liste = (
    <Command
      shouldFilter={false}
      value={choix}
      onValueChange={setChoix}
      label="Filtrer la liste"
      loop
      className={`flex flex-col ${enLigne ? 'rounded-lg border border-gray-200 bg-white' : ''}`}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (texte) setTexte(''); else if (!enLigne) setOuvert(false);
        }
      }}
    >
      <div className="flex items-center gap-2 border-b border-gray-200 px-3">
        <Search className="h-4 w-4 flex-shrink-0 text-gray-400" aria-hidden />
        <Command.Input
          value={texte}
          onValueChange={setTexte}
          autoFocus={!enLigne}
          placeholder={placeholder}
          className={`w-full min-w-0 border-0 bg-transparent text-gray-900 outline-none placeholder:text-gray-400 ${enLigne ? 'h-11 text-sm' : 'h-10 text-sm'}`}
        />
        {texte && (
          <button type="button" onClick={() => setTexte('')} className="rounded p-1 text-gray-400 hover:text-gray-600" aria-label="Effacer la recherche">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <Command.List className={`overflow-y-auto overscroll-contain p-1.5 ${enLigne ? 'max-h-72' : 'max-h-80'}`}>
        {vide && (
          <div className="px-3 py-8 text-center text-sm text-gray-500">
            {q ? <>Rien ne correspond à « {texte.trim()} ».</> : 'Aucun filtre disponible.'}
          </div>
        )}
        {groupes.map(({ facette: f, liste: options, caches }) => (
          <Command.Group
            key={f.cle}
            heading={f.titre}
            className="mb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-gray-500"
          >
            {options.map(o => {
              const coche = f.selected.has(o.value);
              return (
                <Command.Item
                  key={o.value}
                  value={`${f.cle}:${o.value}`}
                  onSelect={() => f.onToggle(o.value)}
                  className={`flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 text-sm text-gray-800 data-[selected=true]:bg-brewery-50 ${enLigne ? 'min-h-11 py-2' : 'min-h-9 py-1.5'}`}
                  role="option"
                  aria-selected={coche}
                >
                  <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${coche ? 'border-brewery-600 bg-brewery-600' : 'border-gray-300 bg-white'}`} aria-hidden>
                    {coche && <Check className="h-3 w-3 text-white" />}
                  </span>
                  {o.color && <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: o.color }} aria-hidden />}
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate ${coche ? 'font-medium' : ''}`}>{o.label}</span>
                    {o.description && <span className="block truncate text-xs text-gray-400">{o.description}</span>}
                  </span>
                  {o.nombre !== undefined && <span className="flex-shrink-0 text-xs tabular-nums text-gray-400">{o.nombre}</span>}
                </Command.Item>
              );
            })}
            {caches > 0 && (
              <button
                type="button"
                onClick={() => setDepliees(prev => new Set(prev).add(f.cle))}
                className={`flex w-full items-center gap-1.5 rounded-lg px-2.5 text-left text-xs font-medium text-brewery-700 hover:bg-brewery-50 ${enLigne ? 'min-h-11 py-2' : 'min-h-9 py-1.5'}`}
              >
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                Voir les {caches} autre(s)
                <span className="font-normal text-gray-400">· ou tapez pour affiner</span>
              </button>
            )}
          </Command.Group>
        ))}
      </Command.List>
      {!enLigne && (
        <div className="hidden items-center gap-3 border-t border-gray-200 px-3 py-1.5 text-xs text-gray-500 sm:flex">
          <span><kbd className="rounded border border-gray-200 bg-gray-50 px-1 font-mono">↑↓</kbd> choisir</span>
          <span><kbd className="rounded border border-gray-200 bg-gray-50 px-1 font-mono">Entrée</kbd> cocher</span>
          <span><kbd className="rounded border border-gray-200 bg-gray-50 px-1 font-mono">Échap</kbd> {texte ? 'effacer' : 'fermer'}</span>
        </div>
      )}
    </Command>
  );

  if (enLigne) {
    return (
      <div className="flex flex-col gap-2">
        {liste}
        <PastillesFiltres facettes={facettes} apres={apres} />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <div className="relative" ref={conteneur}>
        <button
          type="button"
          onClick={() => setOuvert(o => !o)}
          aria-expanded={ouvert}
          aria-haspopup="listbox"
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
            total > 0 ? 'border-brewery-600 bg-brewery-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          <ListFilter className="h-3.5 w-3.5" aria-hidden />
          Filtrer
          {total > 0 && <span className="rounded-full bg-white/30 px-1.5 text-xs tabular-nums">{total}</span>}
          <ChevronDown className={`h-3 w-3 transition-transform ${ouvert ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        {ouvert && (
          <div className="absolute left-0 top-full z-50 mt-1 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
            {liste}
          </div>
        )}
      </div>
      <PastillesFiltres facettes={facettes} apres={apres} />
    </div>
  );
}
