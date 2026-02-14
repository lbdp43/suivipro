import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
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

export default function App() {
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
        <Route path="/admin" element={<AdminPage />} />
      </Route>
    </Routes>
  );
}
