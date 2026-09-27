import { useEffect, useRef } from 'react';

// Échap ferme une vue plein écran faite à la main (visionneuse, photo en grand). La touche
// est arrêtée là : elle ne ferme pas aussi la fenêtre ouverte en dessous (une photo ouverte
// depuis une fiche, par exemple). Écoutée sur window à la capture, donc avant les fenêtres
// Radix, qui écoutent le document.
export function useEchap(actif: boolean, fermer: () => void) {
  const rappel = useRef(fermer);
  rappel.current = fermer;
  useEffect(() => {
    if (!actif) return;
    const touche = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      rappel.current();
    };
    window.addEventListener('keydown', touche, true);
    return () => window.removeEventListener('keydown', touche, true);
  }, [actif]);
}
