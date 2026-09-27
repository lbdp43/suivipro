// La fenêtre de SuiviPro. (Les clics à l'intérieur ne remontent pas jusqu'aux éléments de
// la page qui l'ont ouverte : React fait suivre les événements à travers les portails.)
// Sur téléphone, un tiroir qui monte du bas de l'écran : il se
// ferme d'un glissement du doigt, reste au-dessus de la barre d'accueil de l'iPhone et du
// clavier. Sur ordinateur, une fenêtre centrée. Dans les deux cas : la touche Échap et
// le fond la ferment, le focus reste dedans, la page derrière ne défile plus, et un
// lecteur d'écran l'annonce avec son titre.
//
// Tiroir inspiré du « Drawer » de wensity (21st.dev) — poignée, marges, mouvement réduit —,
// construit sur vaul (tiroir) et Radix Dialog (fenêtre), éprouvés sur iOS.
import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Drawer } from 'vaul';
import { X } from 'lucide-react';
import { useEcranEtroit } from '../../utils/useEcranEtroit';

export interface FenetreProps {
  ouvert: boolean;
  onFermer: () => void;
  titre: ReactNode;
  /** Une ligne sous le titre (le client, la date…). */
  sousTitre?: ReactNode;
  icone?: ReactNode;
  children?: ReactNode;
  /** Les boutons d'action, toujours visibles en bas. */
  pied?: ReactNode;
  largeur?: 'etroite' | 'normale' | 'large';
  /**
   * Cadre seul : le contenu garde sa propre mise en page (titre, boutons). Le titre sert
   * alors aux lecteurs d'écran. Pour faire passer une fenêtre existante dans ce cadre sans
   * réécrire son contenu.
   */
  brut?: boolean;
  /** Au-dessus d'une autre fenêtre (une confirmation, une fenêtre ouverte depuis la fenêtre d'appel). */
  auPremierPlan?: boolean;
}

const COUCHE = 'z-[80]';
const COUCHE_HAUTE = 'z-[10000]';

function EnTete({ titre, sousTitre, icone, Titre, Fermer }: {
  titre: ReactNode; sousTitre?: ReactNode; icone?: ReactNode;
  Titre: typeof Dialog.Title; Fermer: typeof Dialog.Close;
}) {
  return (
    <div className="flex items-start gap-3 px-5 pb-3 pt-1 sm:pt-5">
      {icone && <div className="mt-0.5 flex-shrink-0 text-primaire">{icone}</div>}
      <div className="min-w-0 flex-1">
        <Titre className="text-base font-semibold text-encre leading-snug">{titre}</Titre>
        {sousTitre && <p className="mt-0.5 text-sm text-encre-douce">{sousTitre}</p>}
      </div>
      <Fermer
        className="-mr-2 -mt-1 inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-encre-douce hover:bg-surface-2 hover:text-encre focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaire"
        aria-label="Fermer"
      >
        <X className="h-5 w-5" />
      </Fermer>
    </div>
  );
}

const LARGEURS = { etroite: 'max-w-md', normale: 'max-w-lg', large: 'max-w-2xl' };

export default function Fenetre({ ouvert, onFermer, titre, sousTitre, icone, children, pied, largeur = 'normale', auPremierPlan, brut }: FenetreProps) {
  const etroit = useEcranEtroit();
  const couche = auPremierPlan ? COUCHE_HAUTE : COUCHE;
  const changer = (o: boolean) => { if (!o) onFermer(); };

  if (brut && etroit) {
    return (
      <Drawer.Root open={ouvert} onOpenChange={changer}>
        <Drawer.Portal>
          <Drawer.Overlay className={`fixed inset-0 bg-black/40 ${couche}`} />
          <Drawer.Content aria-describedby={undefined} className={`fixed inset-x-0 bottom-0 ${couche} flex max-h-[92dvh] flex-col rounded-t-2xl bg-surface shadow-2xl outline-none`}>
            <Drawer.Title className="sr-only">{titre}</Drawer.Title>
            <div className="flex justify-center pb-1 pt-3" aria-hidden><span className="h-1.5 w-10 rounded-full bg-gray-300" /></div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-safe" onClick={e => e.stopPropagation()}>{children}</div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }
  if (brut) {
    return (
      <Dialog.Root open={ouvert} onOpenChange={changer}>
        <Dialog.Portal>
          <Dialog.Overlay className={`fixed inset-0 bg-black/40 ${couche}`} />
          <Dialog.Content aria-describedby={undefined} className={`fixed left-1/2 top-1/2 ${couche} max-h-[90dvh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-surface shadow-2xl outline-none ${LARGEURS[largeur]}`}>
            <Dialog.Title className="sr-only">{titre}</Dialog.Title>
            <div onClick={e => e.stopPropagation()}>{children}</div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  if (etroit) {
    return (
      <Drawer.Root open={ouvert} onOpenChange={changer}>
        <Drawer.Portal>
          <Drawer.Overlay className={`fixed inset-0 bg-black/40 ${couche}`} />
          <Drawer.Content
            aria-describedby={undefined}
            onClick={e => e.stopPropagation()}
            className={`fixed inset-x-0 bottom-0 ${couche} flex max-h-[92dvh] flex-col rounded-t-2xl bg-surface shadow-2xl outline-none`}
          >
            <div className="flex justify-center pb-2 pt-3" aria-hidden>
              <span className="h-1.5 w-10 rounded-full bg-gray-300" />
            </div>
            <EnTete titre={titre} sousTitre={sousTitre} icone={icone} Titre={Drawer.Title} Fermer={Drawer.Close} />
            {children != null && <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>}
            {pied && (
              <div className="flex flex-wrap justify-end gap-2 border-t border-trait bg-surface px-5 pt-3" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
                {pied}
              </div>
            )}
            {!pied && <div className="pb-safe" />}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  return (
    <Dialog.Root open={ouvert} onOpenChange={changer}>
      <Dialog.Portal>
        <Dialog.Overlay className={`fixed inset-0 bg-black/40 ${couche} data-[state=open]:animate-[fadeIn_0.15s_ease-out]`} />
        <Dialog.Content
          aria-describedby={undefined}
          onClick={e => e.stopPropagation()}
          className={`fixed left-1/2 top-1/2 ${couche} flex max-h-[90dvh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-surface shadow-2xl outline-none ${LARGEURS[largeur]}`}
        >
          <EnTete titre={titre} sousTitre={sousTitre} icone={icone} Titre={Dialog.Title} Fermer={Dialog.Close} />
          {children != null && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>}
          {pied && <div className="flex flex-wrap justify-end gap-2 border-t border-trait px-5 py-3">{pied}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
