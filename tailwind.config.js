/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brewery: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
        // Couleurs de rôle (src/index.css) : un bouton principal, une surface, un texte…
        // plutôt qu'une teinte choisie à la main. Définies en variables, elles changent d'un
        // coup en mode sombre.
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
      },
    },
  },
  plugins: [],
}
