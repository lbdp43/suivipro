import { useEffect, useState } from 'react';

/** Vrai sur téléphone (moins de 640 px de large) : les fenêtres y deviennent des tiroirs. */
export function useEcranEtroit(): boolean {
  const requete = '(max-width: 639px)';
  const [etroit, setEtroit] = useState(() => typeof window !== 'undefined' && window.matchMedia(requete).matches);
  useEffect(() => {
    const mq = window.matchMedia(requete);
    const maj = () => setEtroit(mq.matches);
    mq.addEventListener('change', maj);
    return () => mq.removeEventListener('change', maj);
  }, []);
  return etroit;
}
