import { Routes, Route, Navigate } from 'react-router-dom';
import { useApp } from './store/AppContext';
import { Beer } from 'lucide-react';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import MapPage from './pages/MapPage';
import PipelinePage from './pages/PipelinePage';
import ProspectsPage from './pages/ProspectsPage';
import CallsPage from './pages/CallsPage';
import AppointmentsPage from './pages/AppointmentsPage';
import RemindersPage from './pages/RemindersPage';
import EmailsPage from './pages/EmailsPage';
import ImportPage from './pages/ImportPage';
import AdminPage from './pages/AdminPage';
import ProfilePage from './pages/ProfilePage';

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
        <Route path="/import" element={<ImportPage />} />
        <Route path="/profil" element={<ProfilePage />} />
        <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
      </Route>
    </Routes>
  );
}
