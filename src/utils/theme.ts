// Le thème de l'appli : automatique (comme l'appareil), clair ou sombre. Le choix se fait
// dans le profil et reste sur cet appareil : un téléphone en sombre, un ordinateur en
// clair. index.html le pose avant le premier affichage, pour éviter un éclair blanc.
import { useEffect, useState } from 'react';

export type Theme = 'auto' | 'clair' | 'sombre';
const CLE = 'suivipro_theme';

export function lireTheme(): Theme {
  try {
    const t = localStorage.getItem(CLE);
    return t === 'clair' || t === 'sombre' ? t : 'auto';
  } catch { return 'auto'; }
}

const sombreSysteme = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

/** Pose le thème sur la page : les couleurs (attribut data-theme) et la barre d'état du téléphone. */
export function appliquerTheme(theme: Theme) {
  const racine = document.documentElement;
  if (theme === 'auto') racine.removeAttribute('data-theme');
  else racine.setAttribute('data-theme', theme);
  const sombre = theme === 'sombre' || (theme === 'auto' && sombreSysteme());
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    if (theme === 'auto') m.setAttribute('content', m.getAttribute('media')?.includes('dark') ? '#0f1216' : '#16a34a');
    else m.setAttribute('content', sombre ? '#0f1216' : '#16a34a');
  });
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(lireTheme);
  useEffect(() => { appliquerTheme(theme); }, [theme]);
  const choisir = (t: Theme) => {
    try { if (t === 'auto') localStorage.removeItem(CLE); else localStorage.setItem(CLE, t); } catch { /* navigation privée : le choix vaut pour la visite */ }
    setTheme(t);
  };
  return [theme, choisir];
}
