import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, Map, Kanban, Users, Phone, Calendar,
  Bell, Mail, Upload, Settings, Menu, X, Beer, ChevronDown,
} from 'lucide-react';
import { useApp } from '../store/AppContext';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/carte', icon: Map, label: 'Carte' },
  { to: '/pipeline', icon: Kanban, label: 'Pipeline' },
  { to: '/prospects', icon: Users, label: 'Prospects' },
  { to: '/appels', icon: Phone, label: 'Appels' },
  { to: '/rdv', icon: Calendar, label: 'Rendez-vous' },
  { to: '/rappels', icon: Bell, label: 'Rappels' },
  { to: '/emails', icon: Mail, label: 'Emails' },
  { to: '/import', icon: Upload, label: 'Import/Export' },
  { to: '/admin', icon: Settings, label: 'Administration' },
];

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { state } = useApp();
  const activeReminders = state.reminders.filter(r => r.statut === 'actif').length;

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
          {navItems.map(item => (
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
              {item.to === '/rappels' && activeReminders > 0 && (
                <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {activeReminders}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User info */}
        <div className="p-3 border-t border-gray-200">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-brewery-100 flex items-center justify-center">
              <span className="text-sm font-bold text-brewery-700">
                {state.currentUser?.prenom?.[0] || 'G'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {state.currentUser?.prenom || 'Guillaume'}
              </p>
              <p className="text-[10px] text-gray-500">
                {state.currentUser?.role === 'admin' ? 'Administrateur' : 'Commercial'}
              </p>
            </div>
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
          {/* User selector */}
          <div className="flex items-center gap-2">
            <select
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
              value={state.currentUser?.id || ''}
              onChange={(e) => {
                const user = state.commerciaux.find(c => c.id === e.target.value);
                if (user) {
                  // dispatch set current user
                }
              }}
            >
              {state.commerciaux.map(c => (
                <option key={c.id} value={c.id}>
                  {c.prenom} {c.nom} {c.role === 'admin' ? '(Admin)' : ''}
                </option>
              ))}
            </select>
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
