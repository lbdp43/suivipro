import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Identifiant de cette construction : les données gardées sur le téléphone par une autre
  // version de l'appli ne sont pas relues (leur forme a pu changer).
  define: {
    __BUILD__: JSON.stringify(String(Date.now())),
  },
  build: {
    rollupOptions: {
      output: {
        // Les pages se chargent à la demande ; sans regroupement, chaque icône et chaque petit
        // module partagé devient un fichier à part — une quarantaine pour l'accueil, autant
        // d'allers-retours sur un réseau mobile. On les regroupe en quelques fichiers.
        manualChunks(id) {
          // Le socle (React, le routeur) à part : sinon Rollup le range avec le premier groupe
          // qui s'en sert, et ce groupe se retrouve chargé à l'ouverture.
          if (/\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run)\//.test(id)) return 'socle';
          if (id.includes('/node_modules/lucide-react/')) return 'icones';
          if (/\/node_modules\/(vaul|@radix-ui|react-remove-scroll|react-remove-scroll-bar|aria-hidden|use-sidecar|use-callback-ref|react-style-singleton|get-nonce|detect-node-es|cmdk)\//.test(id)) return 'fenetres';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
