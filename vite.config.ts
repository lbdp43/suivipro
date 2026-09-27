import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Identifiant de cette construction : les données gardées sur le téléphone par une autre
  // version de l'appli ne sont pas relues (leur forme a pu changer).
  define: {
    __BUILD__: JSON.stringify(String(Date.now())),
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
