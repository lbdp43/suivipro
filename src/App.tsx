import { Suspense } from 'react';
import { pageParesseuse } from './utils/pageParesseuse';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useApp } from './store/AppContext';
import { Beer } from 'lucide-react';
import Layout from './components/Layout';
import { peutVoirLesStatistiques } from './components/menu';
import LoginPage from './pages/LoginPage';

// Lazy-loaded pages
const DashboardPage = pageParesseuse(() => import('./pages/DashboardPage'));
const AccueilPage = pageParesseuse(() => import('./pages/AccueilPage'));
const MapPage = pageParesseuse(() => import('./pages/MapPage'));
const PipelinePage = pageParesseuse(() => import('./pages/PipelinePage'));
const ProspectsPage = pageParesseuse(() => import('./pages/ProspectsPage'));
const PartagePage = pageParesseuse(() => import('./pages/PartagePage'));
const CallsPage = pageParesseuse(() => import('./pages/CallsPage'));
const AppointmentsPage = pageParesseuse(() => import('./pages/AppointmentsPage'));
const EmailsPage = pageParesseuse(() => import('./pages/EmailsPage'));
const ImportPage = pageParesseuse(() => import('./pages/ImportPage'));
const AdminPage = pageParesseuse(() => import('./pages/AdminPage'));
const ProfilePage = pageParesseuse(() => import('./pages/ProfilePage'));
const DocumentsPage = pageParesseuse(() => import('./pages/DocumentsPage'));
const GuidePage = pageParesseuse(() => import('./pages/GuidePage'));
const ClientsPage = pageParesseuse(() => import('./pages/ClientsPage'));
const TourneesPage = pageParesseuse(() => import('./pages/TourneesPage'));
const PipelineCRPage = pageParesseuse(() => import('./pages/PipelineCRPage'));
const SirenePage = pageParesseuse(() => import('./pages/SirenePage'));
const AnnuairePage = pageParesseuse(() => import('./pages/AnnuairePage'));
const SemainePage = pageParesseuse(() => import('./pages/SemainePage'));
const RappelsTachesPage = pageParesseuse(() => import('./pages/RappelsTachesPage'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-7 h-7 border-3 border-brewery-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { state } = useApp();
  if (state.currentUser?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

// Statistiques : commerciaux et admins seulement. Un prospecteur qui tape l'adresse revient à l'accueil.
function RouteStatistiques({ children }: { children: React.ReactNode }) {
  const { state } = useApp();
  if (!peutVoirLesStatistiques(state.currentUser?.role)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const { state, loading } = useApp();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-brewery-50 via-white to-green-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-brewery-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Beer className="w-9 h-9 text-white" />
          </div>
          <div className="w-8 h-8 border-3 border-brewery-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Chargement...</p>
        </div>
      </div>
    );
  }

  if (!state.currentUser) {
    return <LoginPage />;
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<AccueilPage />} />
          <Route path="/statistiques" element={<RouteStatistiques><DashboardPage /></RouteStatistiques>} />
          <Route path="/carte" element={<MapPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/prospects" element={<ProspectsPage />} />
          <Route path="/partage" element={<PartagePage />} />
          <Route path="/appels" element={<CallsPage />} />
          <Route path="/rdv" element={<AppointmentsPage />} />
          <Route path="/rappels" element={<RappelsTachesPage />} />
          <Route path="/taches" element={<RappelsTachesPage />} />
          <Route path="/emails" element={<EmailsPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/semaine" element={<SemainePage />} />
          <Route path="/semaine/bilan" element={<SemainePage />} />
          {/* Anciennes adresses : Planning semaine, Visites et CR, Visites clients → Semaine */}
          <Route path="/clients/planning" element={<Navigate to="/semaine" replace />} />
          <Route path="/visites" element={<Navigate to="/semaine" replace />} />
          <Route path="/compte-rendu" element={<Navigate to="/semaine/bilan" replace />} />
          <Route path="/tournees" element={<TourneesPage />} />
          <Route path="/pipeline-cr" element={<PipelineCRPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/import" element={<AdminRoute><ImportPage /></AdminRoute>} />
          <Route path="/annuaire" element={<AnnuairePage />} />
          <Route path="/sirene" element={<AdminRoute><SirenePage /></AdminRoute>} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/profil" element={<ProfilePage />} />
          <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
          <Route path="/easybeer" element={<AdminRoute><AdminPage section="easybeer" /></AdminRoute>} />
        </Route>
      </Routes>
    </Suspense>
  );
}
