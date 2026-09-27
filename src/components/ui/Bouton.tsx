// Le bouton de SuiviPro : une couleur d'action (le vert de la brasserie), trois façons de
// l'employer. Avant, chaque écran choisissait sa teinte — douze couleurs pour « valider ».
//
// - principal : l'action attendue sur l'écran (une seule par zone) ;
// - secondaire : les autres choix ;
// - discret : les actions de troisième rang, dans une ligne ou une barre ;
// - danger : ce qui supprime ou retire, sans retour.
//
// La hauteur minimale suit le doigt (44 px en « normal ») ; « petit » reste à 36 px pour les
// barres d'outils denses.
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export type VarianteBouton = 'principal' | 'secondaire' | 'discret' | 'danger';

const VARIANTES: Record<VarianteBouton, string> = {
  principal: 'bg-primaire text-white hover:bg-primaire-fort shadow-sm',
  secondaire: 'bg-surface text-encre border border-trait hover:bg-surface-2',
  discret: 'text-encre-douce hover:bg-surface-2 hover:text-encre',
  danger: 'bg-danger text-white hover:bg-red-700 shadow-sm',
};

const TAILLES = {
  normal: 'min-h-11 px-4 text-sm gap-2',
  petit: 'min-h-9 px-3 text-sm gap-1.5',
};

export interface BoutonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBouton;
  taille?: keyof typeof TAILLES;
  icone?: ReactNode;
  /** Pendant l'enregistrement : le bouton se désactive et tourne. */
  occupe?: boolean;
  pleineLargeur?: boolean;
}

export const Bouton = forwardRef<HTMLButtonElement, BoutonProps>(function Bouton(
  { variante = 'secondaire', taille = 'normal', icone, occupe, pleineLargeur, className = '', children, disabled, type = 'button', ...reste },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || occupe}
      aria-busy={occupe || undefined}
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaire focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTES[variante]} ${TAILLES[taille]} ${pleineLargeur ? 'w-full' : ''} ${className}`}
      {...reste}
    >
      {occupe ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : icone}
      {children}
    </button>
  );
});

export default Bouton;
