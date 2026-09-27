import couleurs from 'tailwindcss/colors';
import plugin from 'tailwindcss/plugin';

// Mode sombre : il suit le réglage du téléphone ou de l'ordinateur, sauf si la personne a
// choisi « Clair » ou « Sombre » dans son profil (attribut data-theme sur <html>, posé par
// src/utils/theme.ts et, dès le chargement, par index.html).
//
// Plutôt que d'ajouter une variante « dark: » à des milliers de classes, les couleurs
// elles-mêmes passent par des variables CSS qui changent de valeur en mode sombre :
// « bg-white » devient la surface sombre, « bg-gray-50 » le fond de page, « text-gray-900 »
// un texte clair, « bg-red-50 » une teinte rouge sur fond sombre, « text-green-700 » un vert
// lisible sur ce fond. Les couleurs vives (boutons, pastilles 400-900) ne bougent pas.
//
// Le fond et le texte n'ont pas la même règle — « bg-green-700 » reste un bouton vert foncé,
// « text-green-700 » s'éclaircit — d'où deux jeux de variables : --p-* (fonds, bordures,
// anneaux, dégradés) et --t-* (textes).

const NUANCES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
const GRIS = ['slate', 'gray', 'zinc', 'neutral', 'stone'];
const VIVES = ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'];

// Le vert de la brasserie est le vert de Tailwind.
const PALETTES = { ...Object.fromEntries([...GRIS, ...VIVES].map(n => [n, couleurs[n]])), brewery: couleurs.green };

const rvb = hex => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
};
const triplet = t => t.join(' ');

// La surface sombre sur laquelle se posent les teintes.
const SURFACE_SOMBRE = [23, 26, 33];
const melange = (hex, part) => rvb(hex).map((v, i) => Math.round(SURFACE_SOMBRE[i] * (1 - part) + v * part));

// Gris en mode sombre : l'échelle est retournée pour les textes et les fonds clairs, mais les
// fonds foncés (« bg-gray-900 » d'une bulle ou d'un bouton noir) restent foncés.
const GRIS_FOND_SOMBRE = {
  50: '#0f1216', 100: '#1f232b', 200: '#2c313a', 300: '#3d434e', 400: '#6b7382', 500: '#8b93a1',
  600: '#4b5563', 700: '#394150', 800: '#2a2f38', 900: '#20242c', 950: '#161a20',
};
const GRIS_TEXTE_SOMBRE = {
  50: '#f9fafb', 100: '#f3f4f6', 200: '#e5e7eb', 300: '#4f5764', 400: '#7c8492', 500: '#9aa1ae',
  600: '#b4bac5', 700: '#cfd4dc', 800: '#e3e6eb', 900: '#f1f3f5', 950: '#f9fafb',
};
// Teintes vives en fond : 50-300 deviennent un voile de la couleur sur la surface sombre.
const PART_FOND = { 50: 0.1, 100: 0.17, 200: 0.28, 300: 0.45 };
// Teintes vives en texte : les foncés, illisibles sur fond sombre, prennent la teinte claire.
const TEXTE_ECLAIRCI = { 600: '400', 700: '300', 800: '200', 900: '200', 950: '100' };

function variables() {
  const clair = {}; const sombre = {};
  for (const [nom, pal] of Object.entries(PALETTES)) {
    const gris = GRIS.includes(nom);
    for (const n of NUANCES) {
      clair[`--p-${nom}-${n}`] = triplet(rvb(pal[n]));
      clair[`--t-${nom}-${n}`] = triplet(rvb(pal[n]));
      if (gris) {
        sombre[`--p-${nom}-${n}`] = triplet(rvb(GRIS_FOND_SOMBRE[n]));
        sombre[`--t-${nom}-${n}`] = triplet(rvb(GRIS_TEXTE_SOMBRE[n]));
      } else {
        sombre[`--p-${nom}-${n}`] = PART_FOND[n] ? triplet(melange(pal['500'], PART_FOND[n])) : triplet(rvb(pal[n]));
        sombre[`--t-${nom}-${n}`] = triplet(rvb(pal[TEXTE_ECLAIRCI[n] || n]));
      }
    }
  }
  // Les couleurs de rôle (src/index.css) et la carte, en sombre.
  Object.assign(sombre, {
    '--c-fond': '15 18 22',
    '--c-surface': '23 26 33',
    '--c-surface-2': '31 35 43',
    '--c-encre': '241 243 245',
    '--c-encre-douce': '180 186 197',
    '--c-trait': '44 49 58',
    '--c-primaire-doux': '23 45 33',
    '--c-danger-doux': '51 26 30',
    '--filtre-carte': 'brightness(0.8) contrast(1.1)',
    'color-scheme': 'dark',
  });
  return { clair, sombre };
}

const palette = prefixe => Object.fromEntries(Object.keys(PALETTES).map(nom => [
  nom,
  Object.fromEntries(NUANCES.map(n => [n, `rgb(var(--${prefixe}-${nom}-${n}) / <alpha-value>)`])),
]));

// Couleurs de rôle (src/index.css) : un bouton principal, une surface, un texte… plutôt
// qu'une teinte choisie à la main.
const ROLES = {
  fond: 'rgb(var(--c-fond) / <alpha-value>)',
  surface: 'rgb(var(--c-surface) / <alpha-value>)',
  'surface-2': 'rgb(var(--c-surface-2) / <alpha-value>)',
  encre: 'rgb(var(--c-encre) / <alpha-value>)',
  'encre-douce': 'rgb(var(--c-encre-douce) / <alpha-value>)',
  trait: 'rgb(var(--c-trait) / <alpha-value>)',
  primaire: 'rgb(var(--c-primaire) / <alpha-value>)',
  'primaire-fort': 'rgb(var(--c-primaire-fort) / <alpha-value>)',
  'primaire-doux': 'rgb(var(--c-primaire-doux) / <alpha-value>)',
  danger: 'rgb(var(--c-danger) / <alpha-value>)',
  'danger-doux': 'rgb(var(--c-danger-doux) / <alpha-value>)',
};

const BASE = { inherit: 'inherit', current: 'currentColor', transparent: 'transparent', black: '#000' };

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    // « white » en fond est la surface (sombre en mode sombre) ; en texte, il reste blanc,
    // posé sur un bouton ou un bandeau de couleur.
    colors: { ...BASE, white: 'rgb(var(--c-surface) / <alpha-value>)', ...palette('p'), ...ROLES },
    textColor: { ...BASE, white: '#fff', ...palette('t'), ...ROLES },
  },
  plugins: [
    plugin(({ addBase }) => {
      const { clair, sombre } = variables();
      addBase({
        ':root': clair,
        // Automatique : le réglage de l'appareil, sauf « Clair » choisi dans le profil.
        '@media screen and (prefers-color-scheme: dark)': { ':root:not([data-theme="clair"])': sombre },
        // « Sombre » choisi dans le profil. (À l'impression, toujours clair.)
        '@media screen': { ':root[data-theme="sombre"]': sombre },
        ':root[data-theme="clair"]': { 'color-scheme': 'light' },
      });
    }),
  ],
}
