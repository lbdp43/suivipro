import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppProvider } from './store/AppContext';
import { CallModalProvider } from './components/CallModal';
import { ToastProvider } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';
import App from './App';
import { rechargerUneFois } from './utils/version';
import 'leaflet/dist/leaflet.css';
import './index.css';

// Application installable (écran d'accueil du téléphone) : c'est ce qui fait apparaître
// SuiviPro dans le menu « Partager » de Google Maps et WhatsApp. Le service worker ne
// garde rien en cache : il laisse tout passer au réseau.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* navigateur sans service worker */ }); });
}

// Vite signale ici un fichier de page introuvable (nouvelle version déployée) : on recharge
// une fois au lieu de laisser la page cassée.
window.addEventListener('vite:preloadError', (e) => { if (rechargerUneFois()) e.preventDefault(); });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <ToastProvider>
          <AppProvider>
            <CallModalProvider>
              <App />
            </CallModalProvider>
          </AppProvider>
        </ToastProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);
