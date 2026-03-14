import { useState, useEffect, useCallback, useRef } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, Map, Kanban, Users, Phone, Calendar,
  Bell, Mail, Upload, Settings, Menu, X, Beer, LogOut, Shield, User, ExternalLink, Clock, BookOpen, FileText, ScanLine,
  MessageCircle, Building2, CheckCheck, ClipboardCheck,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { isToday } from '../utils/helpers';
import { Link } from 'react-router-dom';
import HubPanel from './HubPanel';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
  data?: string;
}

function timeAgo(dateStr: string) {
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "a l'instant";
  if (diffMin < 60) return `il y a ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `il y a ${diffD}j`;
}

const NOTIF_ICONS: Record<string, string> = {
  TASK_ASSIGNED: '📋',
  TASK_COMPLETED: '✅',
  VISIT_REMINDER: '📍',
  NEW_CLIENT_ASSIGNED: '🏢',
  CLIENT_PENDING: '⏳',
  info: 'ℹ️',
};

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);
  const { state, logout } = useApp();
  const today = new Date().toISOString().split('T')[0];
  // Badge = seulement les rappels du jour + en retard (pas les "a venir")
  const urgentReminders = state.reminders.filter(r => r.statut === 'actif' && r.date <= today).length;
  const isAdmin = state.currentUser?.role === 'admin';

  const token = localStorage.getItem('suivipro_token');
  const userId = state.currentUser?.id;

  const fetchNotifications = useCallback(async () => {
    if (!userId || !token) return;
    try {
      const [notifRes, countRes] = await Promise.all([
        fetch(`/api/notifications/${userId}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/notifications/${userId}/unread-count`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (notifRes.ok) setNotifications(await notifRes.json());
      if (countRes.ok) {
        const data = await countRes.json();
        setUnreadCount(data.count || 0);
      }
    } catch (err) {
      console.error('Erreur chargement notifications:', err);
    }
  }, [userId, token]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  // Poll every 60s
  useEffect(() => {
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    if (notifOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [notifOpen]);

  const markAsRead = async (notifId: string) => {
    if (!token) return;
    await fetch(`/api/notifications/${notifId}/read`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } });
    setNotifications(prev => prev.map(n => n.id === notifId ? { ...n, read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const markAllRead = async () => {
    if (!userId || !token) return;
    await fetch(`/api/notifications/${userId}/read-all`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } });
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard', adminOnly: false },
    { to: '/pipeline', icon: Kanban, label: 'Pipeline', adminOnly: false },
    { to: '/prospects', icon: Users, label: 'Prospects', adminOnly: false },
    { to: '/appels', icon: Phone, label: 'Appels', adminOnly: false },
    { to: '/rdv', icon: Calendar, label: 'Prospects & RDV', adminOnly: false },
    { to: '/rappels', icon: Bell, label: 'Rappels', adminOnly: false },
    { to: '/emails', icon: Mail, label: 'Emails', adminOnly: false },
    { to: '/clients', icon: Building2, label: 'Clients', adminOnly: false },
    { to: '/tournees', icon: Map, label: 'Tournees', adminOnly: false },
    { to: '/visites', icon: ClipboardCheck, label: 'Visites Clients', adminOnly: false },
    { to: '/documents', icon: FileText, label: 'Documents', adminOnly: false },
    { to: '/import', icon: Upload, label: 'Import/Export', adminOnly: false },
    { to: '/guide', icon: BookOpen, label: 'Guide', adminOnly: false },
    { to: '/admin', icon: Settings, label: 'Administration', adminOnly: true },
  ];

  const visibleNavItems = navItems.filter(item => !item.adminOnly || isAdmin);

  const handleLogout = () => {
    logout();
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
        role="navigation"
        aria-label="Menu principal"
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

        {/* External links */}
        <div className="px-3 pb-2 space-y-1">
          <a
            href="https://crm-lbdp-production.up.railway.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors"
          >
            <ExternalLink className="w-4 h-4 flex-shrink-0" />
            <span>CRM LBDP</span>
            <span className="ml-auto text-[10px] text-blue-400">Ouvrir</span>
          </a>
          <a
            href="https://suivi-horaires-alternants-production.up.railway.app/admin"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 transition-colors"
          >
            <Clock className="w-4 h-4 flex-shrink-0" />
            <span>Suivi Horaires</span>
            <span className="ml-auto text-[10px] text-purple-400">Ouvrir</span>
          </a>
          <a
            href="https://labrasseriedesplantes.fr/wp-content/utile/guidecommerciale.html"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 transition-colors"
          >
            <BookOpen className="w-4 h-4 flex-shrink-0" />
            <span>Guide Commercial</span>
            <span className="ml-auto text-[10px] text-emerald-400">Ouvrir</span>
          </a>
          <a
            href="https://scan-docu-production.up.railway.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-orange-600 bg-orange-50 hover:bg-orange-100 transition-colors"
          >
            <ScanLine className="w-4 h-4 flex-shrink-0" />
            <span>Scan Docu</span>
            <span className="ml-auto text-[10px] text-orange-400">Ouvrir</span>
          </a>
        </div>

        {/* User info + logout */}
        <div className="p-3 border-t border-gray-200">
          <div className="flex items-center gap-3 px-3 py-2">
            <Link
              to="/profil"
              onClick={() => setSidebarOpen(false)}
              className="flex items-center gap-3 flex-1 min-w-0 rounded-lg hover:bg-gray-50 transition-colors -mx-1 px-1 py-1"
              title="Mon profil"
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                isAdmin ? 'bg-amber-100' : state.currentUser?.role === 'prospection' ? 'bg-emerald-100' : 'bg-brewery-100'
              }`}>
                {isAdmin ? (
                  <Shield className="w-4 h-4 text-amber-700" />
                ) : (
                  <User className={`w-4 h-4 ${state.currentUser?.role === 'prospection' ? 'text-emerald-700' : 'text-brewery-700'}`} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {state.currentUser?.prenom} {state.currentUser?.nom}
                </p>
                <p className="text-[10px] text-gray-500">
                  {isAdmin ? 'Administrateur' : state.currentUser?.role === 'prospection' ? 'Prospection' : 'Commercial'}
                </p>
              </div>
            </Link>
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
            aria-label="Ouvrir le menu"
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
            {/* Notifications */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => { setNotifOpen(prev => !prev); }}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  notifOpen
                    ? 'bg-brewery-100 text-brewery-700'
                    : 'text-gray-500 hover:bg-brewery-50 hover:text-brewery-700'
                }`}
                title="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl border border-gray-200 shadow-lg z-50 max-h-96 flex flex-col">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                    <h3 className="font-semibold text-sm text-gray-900">Notifications</h3>
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllRead}
                        className="flex items-center gap-1 text-xs text-brewery-600 hover:text-brewery-700"
                      >
                        <CheckCheck className="w-3 h-3" />
                        Tout marquer lu
                      </button>
                    )}
                  </div>
                  <div className="overflow-y-auto flex-1">
                    {notifications.length === 0 ? (
                      <div className="py-8 text-center text-sm text-gray-400">
                        Aucune notification
                      </div>
                    ) : notifications.map(n => (
                      <div
                        key={n.id}
                        className={`px-4 py-3 border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50 transition-colors ${
                          !n.read ? 'bg-brewery-50/50' : ''
                        }`}
                        onClick={() => { if (!n.read) markAsRead(n.id); }}
                      >
                        <div className="flex items-start gap-2">
                          <span className="text-sm mt-0.5">{NOTIF_ICONS[n.type] || NOTIF_ICONS.info}</span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm ${!n.read ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                              {n.title}
                            </p>
                            {n.message && (
                              <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                            )}
                            <p className="text-[10px] text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
                          </div>
                          {!n.read && (
                            <div className="w-2 h-2 bg-brewery-500 rounded-full mt-1.5 flex-shrink-0" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => setHubOpen(prev => !prev)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                hubOpen
                  ? 'bg-brewery-100 text-brewery-700'
                  : 'text-gray-500 hover:bg-brewery-50 hover:text-brewery-700'
              }`}
              title="Hub LBDP"
            >
              <MessageCircle className="w-4 h-4" />
              <span className="hidden sm:inline">Hub</span>
            </button>
            <div className={`px-2.5 py-1 rounded-full text-xs font-medium ${
              isAdmin ? 'bg-amber-100 text-amber-700' : state.currentUser?.role === 'prospection' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {isAdmin ? 'Admin' : state.currentUser?.role === 'prospection' ? 'Prospection' : 'Commercial'}
            </div>
            <Link to="/profil" className="font-medium hover:text-brewery-600 transition-colors">{state.currentUser?.prenom}</Link>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* Hub LBDP side panel */}
      <HubPanel open={hubOpen} onClose={() => setHubOpen(false)} />
    </div>
  );
}
