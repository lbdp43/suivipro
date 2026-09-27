// Une liste vide qui dit pourquoi, et propose le geste qui la remplit : « Aucun rappel —
// Programmer un rappel », « Aucun client ne correspond — Effacer les filtres ».
// Inspiré du bloc « Empty » de cnippet-dev (21st.dev) : icône dans une pastille, titre,
// une phrase, puis les boutons.
import type { ComponentType, ReactNode } from 'react';

export default function EtatVide({ icone: Icone, titre, texte, children, compact, ligne }: {
  icone: ComponentType<{ className?: string }>;
  titre: string;
  texte?: ReactNode;
  /** Les boutons d'action (Bouton ou liens). */
  children?: ReactNode;
  /** Dans un bloc de page (accueil) plutôt qu'en pleine liste. */
  compact?: boolean;
  /** Sur une seule ligne, pour une carte de résumé (l'accueil) : ne prend pas plus de place qu'un texte. */
  ligne?: boolean;
}) {
  if (ligne) {
    return (
      <div className="flex items-center gap-3 py-1">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400">
          <Icone className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-700">{titre}</p>
          {texte && <p className="text-xs text-gray-500">{texte}</p>}
        </div>
        {children && <div className="ml-auto flex flex-shrink-0 gap-2">{children}</div>}
      </div>
    );
  }
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
