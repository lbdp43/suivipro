import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useApp } from './store/AppContext';
import { Beer } from 'lucide-react';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';

// Lazy-loaded pages
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const MapPage = lazy(() => import('./pages/MapPage'));
const PipelinePage = lazy(() => import('./pages/PipelinePage'));
const ProspectsPage = lazy(() => import('./pages/ProspectsPage'));
const CallsPage = lazy(() => import('./pages/CallsPage'));
const AppointmentsPage = lazy(() => import('./pages/AppointmentsPage'));
const RemindersPage = lazy(() => import('./pages/RemindersPage'));
const EmailsPage = lazy(() => import('./pages/EmailsPage'));
const ImportPage = lazy(() => import('./pages/ImportPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const DocumentsPage = lazy(() => import('./pages/DocumentsPage'));
const GuidePage = lazy(() => import('./pages/GuidePage'));
const ClientsPage = lazy(() => import('./pages/ClientsPage'));
const TourneesPage = lazy(() => import('./pages/TourneesPage'));
const VisitesPage = lazy(() => import('./pages/VisitesPage'));
const TasksPage = lazy(() => import('./pages/TasksPage'));

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
          <Route path="/" element={<DashboardPage />} />
          <Route path="/carte" element={<MapPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/prospects" element={<ProspectsPage />} />
          <Route path="/appels" element={<CallsPage />} />
          <Route path="/rdv" element={<AppointmentsPage />} />
          <Route path="/rappels" element={<RemindersPage />} />
          <Route path="/emails" element={<EmailsPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/tournees" element={<TourneesPage />} />
          <Route path="/visites" element={<VisitesPage />} />
          <Route path="/taches" element={<TasksPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/profil" element={<ProfilePage />} />
          <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
        </Route>
      </Routes>
    </Suspense>
  );
}
