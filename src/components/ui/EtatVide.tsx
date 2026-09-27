// Une liste vide qui dit pourquoi, et propose le geste qui la remplit : « Aucun rappel —
// Programmer un rappel », « Aucun client ne correspond — Effacer les filtres ».
// Inspiré du bloc « Empty » de cnippet-dev (21st.dev) : icône dans une pastille, titre,
// une phrase, puis les boutons.
import type { ComponentType, ReactNode } from 'react';

export default function EtatVide({ icone: Icone, titre, texte, children, compact }: {
  icone: ComponentType<{ className?: string }>;
  titre: string;
  texte?: ReactNode;
  /** Les boutons d'action (Bouton ou liens). */
  children?: ReactNode;
  /** Dans un bloc de page (accueil) plutôt qu'en pleine liste. */
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center text-center ${compact ? 'px-4 py-6' : 'px-6 py-14'}`}>
      <div className={`flex items-center justify-center rounded-full bg-gray-100 text-gray-400 ${compact ? 'mb-2 h-10 w-10' : 'mb-4 h-14 w-14'}`}>
        <Icone className={compact ? 'h-5 w-5' : 'h-7 w-7'} />
      </div>
      <p className={`font-semibold text-gray-900 ${compact ? 'text-sm' : 'text-base'}`}>{titre}</p>
      {texte && <p className="mt-1 max-w-sm text-sm text-gray-500">{texte}</p>}
      {children && <div className={`flex flex-wrap justify-center gap-2 ${compact ? 'mt-3' : 'mt-5'}`}>{children}</div>}
    </div>
  );
}
