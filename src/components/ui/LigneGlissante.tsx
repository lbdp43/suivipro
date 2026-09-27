// Une ligne de liste qu'on fait glisser au doigt pour agir sans ouvrir la fiche.
//
// Sur téléphone seulement. Vers la droite : les gestes de terrain (appeler, noter une
// visite) ; vers la gauche : le reste (tâche, rendez-vous, note). Un petit glissement
// découvre les boutons, qu'on touche ensuite ; un grand glissement fait tout de suite la
// première action du côté tiré (le téléphone vibre au passage du seuil). Rien d'autre ne
// change : la ligne s'ouvre toujours d'un appui, défile toujours de haut en bas, et ses
// boutons habituels restent là — le glissement est un raccourci, pas un passage obligé.
//
// Inspiré du « Swipe Row » de molecule-lab-rushil (21st.dev), écrit sans bibliothèque de
// gestes : le défilement vertical reste celui du navigateur (touch-action: pan-y).
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useEcranEtroit } from '../../utils/useEcranEtroit';

export interface ActionGlissee {
  libelle: string;
  icone: ComponentType<{ className?: string }>;
  couleur: 'vert' | 'bleu' | 'violet' | 'ambre' | 'jaune' | 'gris' | 'emeraude';
  /** Un lien (tel:, itinéraire) plutôt qu'un bouton. */
  href?: string;
  onChoisir?: () => void;
}

const COULEURS: Record<ActionGlissee['couleur'], string> = {
  vert: 'bg-green-600',
  bleu: 'bg-blue-600',
  violet: 'bg-purple-600',
  ambre: 'bg-amber-600',
  jaune: 'bg-yellow-600',
  gris: 'bg-gray-600',
  emeraude: 'bg-emerald-600',
};

const LARGEUR_ACTION = 76;   // px par bouton découvert
const DECISION = 8;          // px avant de savoir si le geste est horizontal ou vertical
const SEUIL_DIRECT = 0.55;   // part de la largeur au-delà de laquelle la première action part seule

// Une seule ligne ouverte à la fois dans toute l'appli.
const fermeurs = new Set<() => void>();
const fermerLesAutres = (sauf: () => void) => fermeurs.forEach(f => { if (f !== sauf) f(); });

export default function LigneGlissante({ gauche = [], droite = [], desactive, children }: {
  /** Découvertes en tirant vers la droite (à gauche de la ligne). La première est l'action directe. */
  gauche?: ActionGlissee[];
  /** Découvertes en tirant vers la gauche (à droite de la ligne). */
  droite?: ActionGlissee[];
  /** En mode sélection, par exemple : la ligne ne glisse plus. */
  desactive?: boolean;
  children: ReactNode;
}) {
  const etroit = useEcranEtroit();
  const [decalage, setDecalage] = useState(0);
  const [enGeste, setEnGeste] = useState(false);
  const ligne = useRef<HTMLDivElement>(null);
  const geste = useRef<{ x: number; y: number; depart: number; sens: 'h' | 'v' | null; seuil: boolean } | null>(null);
  const aGlisse = useRef(false);

  const fermer = useRef(() => setDecalage(0)).current;
  useEffect(() => { fermeurs.add(fermer); return () => { fermeurs.delete(fermer); }; }, [fermer]);

  if (!etroit || desactive || (gauche.length === 0 && droite.length === 0)) return <>{children}</>;

  const ouvertureG = gauche.length * LARGEUR_ACTION;
  const ouvertureD = droite.length * LARGEUR_ACTION;

  const lancer = (a: ActionGlissee) => {
    setDecalage(0);
    if (a.href) {
      if (a.href.startsWith('tel:')) window.location.href = a.href;
      else window.open(a.href, '_blank', 'noopener');
    } else a.onChoisir?.();
  };

  const debut = (e: React.TouchEvent) => {
    const t = e.touches[0];
    geste.current = { x: t.clientX, y: t.clientY, depart: decalage, sens: null, seuil: false };
    aGlisse.current = false;
  };

  const bouge = (e: React.TouchEvent) => {
    const g = geste.current;
    if (!g) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (!g.sens) {
      if (Math.abs(dx) < DECISION && Math.abs(dy) < DECISION) return;
      g.sens = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'h' : 'v';
      if (g.sens === 'h') { setEnGeste(true); fermerLesAutres(fermer); }
    }
    if (g.sens !== 'h') return;
    aGlisse.current = true;
    let x = g.depart + dx;
    // Pas de côté sans action ; au-delà des boutons, la ligne résiste.
    if (x > 0 && !gauche.length) x = 0;
    if (x < 0 && !droite.length) x = 0;
    const largeur = ligne.current?.offsetWidth || 360;
    const max = largeur * 0.8;
    if (Math.abs(x) > max) x = Math.sign(x) * max;
    const franchi = Math.abs(x) > largeur * SEUIL_DIRECT;
    if (franchi !== g.seuil) { g.seuil = franchi; if (franchi) navigator.vibrate?.(10); }
    setDecalage(x);
  };

  const fin = () => {
    const g = geste.current;
    geste.current = null;
    setEnGeste(false);
    if (!g || g.sens !== 'h') return;
    const x = decalage;
    if (g.seuil) { lancer(x > 0 ? gauche[0] : droite[0]); return; }
    if (x > ouvertureG / 2) setDecalage(ouvertureG);
    else if (x < -ouvertureD / 2) setDecalage(-ouvertureD);
    else setDecalage(0);
  };

  // Après un glissement, le doigt levé ne doit pas ouvrir la fiche ; une ligne ouverte se
  // referme d'un appui au lieu de s'ouvrir.
  const auClic = (e: React.MouseEvent) => {
    if (aGlisse.current || decalage !== 0) {
      e.stopPropagation();
      e.preventDefault();
      aGlisse.current = false;
      setDecalage(0);
    }
  };

  const largeur = ligne.current?.offsetWidth || 360;
  const plein = Math.abs(decalage) > largeur * SEUIL_DIRECT;
  const cote = decalage > 0 ? gauche : droite;

  return (
    <div ref={ligne} className="relative overflow-hidden">
      {decalage !== 0 && (
        <div className={`absolute inset-y-0 flex ${decalage > 0 ? 'left-0 flex-row' : 'right-0 flex-row-reverse'}`} style={{ width: Math.abs(decalage) }}>
          {plein ? (
            // Au-delà du seuil, la première action prend toute la place : c'est elle qui part.
            <div className={`flex flex-1 items-center ${decalage > 0 ? 'justify-start pl-5' : 'justify-end pr-5'} text-white ${COULEURS[cote[0].couleur]}`}>
              <ContenuAction a={cote[0]} />
            </div>
          ) : cote.map(a => (
            <button
              key={a.libelle}
              type="button"
              tabIndex={-1}
              onClick={e => { e.stopPropagation(); lancer(a); }}
              className={`flex flex-1 flex-col items-center justify-center gap-1 px-1 text-white ${COULEURS[a.couleur]}`}
            >
              <ContenuAction a={a} />
            </button>
          ))}
        </div>
      )}
      <div
        onTouchStart={debut}
        onTouchMove={bouge}
        onTouchEnd={fin}
        onTouchCancel={fin}
        onClickCapture={auClic}
        className={`relative bg-white ${enGeste ? '' : 'transition-transform duration-200 ease-out'}`}
        style={{ transform: decalage ? `translateX(${decalage}px)` : undefined, touchAction: 'pan-y' }}
      >
        {children}
      </div>
    </div>
  );
}

function ContenuAction({ a }: { a: ActionGlissee }) {
  const Icone = a.icone;
  return (
    <span className="flex flex-col items-center gap-1">
      <Icone className="h-5 w-5" />
      <span className="text-xs font-medium leading-tight">{a.libelle}</span>
    </span>
  );
}

/** Une ligne d'aide, montrée tant qu'on ne l'a pas fermée (gardé sur l'appareil). */
export function AstuceGlissement({ cle, children }: { cle: string; children: ReactNode }) {
  const etroit = useEcranEtroit();
  const stockage = `suivipro_astuce_${cle}`;
  const [vue, setVue] = useState(() => { try { return localStorage.getItem(stockage) === '1'; } catch { return true; } });
  if (!etroit || vue) return null;
  const fermer = () => { try { localStorage.setItem(stockage, '1'); } catch { /* rien */ } setVue(true); };
  return (
    <div className="mx-4 my-2 flex items-center gap-3 rounded-lg bg-brewery-50 px-3 py-2 text-xs text-brewery-800">
      <span className="flex-1">{children}</span>
      <button type="button" onClick={fermer} className="rounded-md px-2 py-1 font-medium hover:bg-brewery-100">Compris</button>
    </div>
  );
}
