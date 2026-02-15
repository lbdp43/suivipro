import { Routes, Route, Navigate } from 'react-router-dom';
import { useApp } from './store/AppContext';
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

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { state } = useApp();
  if (state.currentUser?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const { state } = useApp();

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
        <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
      </Route>
    </Routes>
  );
}
