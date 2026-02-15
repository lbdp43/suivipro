import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, Map, Kanban, Users, Phone, Calendar,
  Bell, Mail, Upload, Settings, Menu, X, Beer, LogOut, Shield, User, ExternalLink,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { isToday } from '../utils/helpers';
import { Link } from 'react-router-dom';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { state, dispatch } = useApp();
  const today = new Date().toISOString().split('T')[0];
  // Badge = seulement les rappels du jour + en retard (pas les "a venir")
  const urgentReminders = state.reminders.filter(r => r.statut === 'actif' && r.date <= today).length;
  const isAdmin = state.currentUser?.role === 'admin';

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard', adminOnly: false },
    { to: '/pipeline', icon: Kanban, label: 'Pipeline', adminOnly: false },
    { to: '/prospects', icon: Users, label: 'Prospects', adminOnly: false },
    { to: '/appels', icon: Phone, label: 'Appels', adminOnly: false },
    { to: '/rdv', icon: Calendar, label: 'Rendez-vous', adminOnly: false },
    { to: '/rappels', icon: Bell, label: 'Rappels', adminOnly: false },
    { to: '/emails', icon: Mail, label: 'Emails', adminOnly: false },
    { to: '/import', icon: Upload, label: 'Import/Export', adminOnly: false },
    { to: '/admin', icon: Settings, label: 'Administration', adminOnly: true },
  ];

  const visibleNavItems = navItems.filter(item => !item.adminOnly || isAdmin);

  const handleLogout = () => {
    dispatch({ type: 'SET_CURRENT_USER', payload: null });
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`sidebar ${sidebarOpen ? 'open' : ''} w-64 bg-white border-r border-gray-200 flex flex-col h-full md:relative md:transform-none`}
      >
        {/* Logo */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brewery-600 rounded-lg flex items-center justify-center">
              <Beer className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-gray-900 text-sm leading-tight">SuiviPro</h1>
              <p className="text-[10px] text-gray-500 leading-tight">Brasserie des Plantes</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {visibleNavItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brewery-50 text-brewery-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              <span>{item.label}</span>
              {item.to === '/rappels' && urgentReminders > 0 && (
                <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {urgentReminders}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* External CRM link */}
        <div className="px-3 pb-2">
          <a
            href="https://crm-lbdp-production.up.railway.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors"
          >
            <ExternalLink className="w-5 h-5 flex-shrink-0" />
            <span>CRM LBDP</span>
            <span className="ml-auto text-[10px] text-blue-400">Ouvrir</span>
          </a>
        </div>

        {/* User info + logout */}
        <div className="p-3 border-t border-gray-200">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              isAdmin ? 'bg-amber-100' : 'bg-brewery-100'
            }`}>
              {isAdmin ? (
                <Shield className="w-4 h-4 text-amber-700" />
              ) : (
                <User className="w-4 h-4 text-brewery-700" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {state.currentUser?.prenom} {state.currentUser?.nom}
              </p>
              <p className="text-[10px] text-gray-500">
                {isAdmin ? 'Administrateur' : 'Commercial'}
              </p>
            </div>
            <button
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
              onClick={handleLogout}
              title="Se deconnecter"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-4 flex-shrink-0">
          <button
            className="md:hidden p-1.5 rounded-lg hover:bg-gray-100"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <Link
              to="/carte"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:bg-brewery-50 hover:text-brewery-700 transition-colors"
              title="Carte des prospects"
            >
              <Map className="w-4 h-4" />
              <span className="hidden sm:inline">Carte</span>
            </Link>
            <div className={`px-2.5 py-1 rounded-full text-xs font-medium ${
              isAdmin ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {isAdmin ? 'Admin' : 'Commercial'}
            </div>
            <span className="font-medium">{state.currentUser?.prenom}</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
