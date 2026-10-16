// Un verrou pour les boutons qui écrivent : « Créer », « Enregistrer », « Confirmer ».
//
// Un double appui (ou un clic pendant que le géocodage répond) relançait l'enregistrement
// avant le retour du premier : deux rendez-vous, deux clients, trois prospects. Un état
// React seul ne suffit pas, il n'est pris en compte qu'au rendu suivant ; la référence,
// elle, est à jour dès le premier appui. L'état sert à griser le bouton.
import { useCallback, useRef, useState } from 'react';

export function useVerrou(): { enCours: boolean; verrouiller: <T>(action: () => Promise<T>) => Promise<T | undefined> } {
  const occupe = useRef(false);
  const [enCours, setEnCours] = useState(false);
  const verrouiller = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    if (occupe.current) return undefined;
    occupe.current = true;
    setEnCours(true);
    try {
      return await action();
    } finally {
      occupe.current = false;
      setEnCours(false);
    }
  }, []);
  return { enCours, verrouiller };
}
