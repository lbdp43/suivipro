import { useState, useEffect, useCallback, useRef } from 'react';
import { dateLocale } from '../../shared/regles';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Map, 
  Bell, Menu, Beer, LogOut, Shield, User, Clock, BookOpen, ScanLine,
  CheckCheck, ChevronDown,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { apiPut } from '../api/client';
import { groupesDuMenu, groupesOuvertsParDefaut } from './menu';
import BlocErreur from './BlocErreur';
import { libelleRole, faitDeLaProspection } from '../utils/roles';
import { Link } from 'react-router-dom';


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
  commande: '📦',
  commande_auto: '📦',
  commande_orpheline: '⚠️',
  easybeer_client_linked: '🔗',
  easybeer_client_created: '🆕',
  easybeer_client_pending: '⏳',
  easybeer_doublon: '⚠️',
  info: 'ℹ️',
};

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [openSections, setOpenSections] = useState<Set<string> | null>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const { state, logout, perimetre, setPerimetre } = useApp();
  const today = dateLocale(new Date());
  // Badge = rappels en retard filtrés par utilisateur
  // Les prospecteurs partagent leurs rappels entre eux
  const currentUserId = state.currentUser?.id;
  const isProspecteur = state.currentUser?.role === 'prospection';
  const prospecteurIds = isProspecteur
    ? new Set(state.commerciaux.filter(c => c.role === 'prospection').map(c => c.id))
    : null;
  const urgentReminders = state.reminders.filter(r =>
    r.statut === 'actif' && r.date <= today &&
    (isProspecteur ? prospecteurIds!.has(r.commercial_id) : r.commercial_id === currentUserId)
  ).length;
  const isAdmin = state.currentUser?.role === 'admin';

  const token = localStorage.getItem('suivipro_token');
  const userId = state.currentUser?.id;

  const fetchNotifications = useCallback(async () => {
    if (!userId || !token) return;
    try {
      // Une seule requête : la liste, et le compteur de non lues dans l'en-tête X-Non-Lues.
      const notifRes = await fetch(`/api/notifications/${userId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (notifRes.ok) {
        // Lecture brute et non apiGet : il faut l'en-tête de la réponse, pas seulement son corps.
        setNotifications(await notifRes.json());
        setUnreadCount(parseInt(notifRes.headers.get('X-Non-Lues') || '0', 10) || 0);
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

  // Groupes du menu, dans l'ordre du rôle (le sien d'abord). Tout le monde voit tout :
  // un commercial peut aller dans la prospection et inversement, seul l'ordre change.
  const role = state.currentUser?.role;
  const groupes = groupesDuMenu(role);
  const ouverts = openSections ?? groupesOuvertsParDefaut(role, faitDeLaProspection(state.currentUser));
  const toggleSection = (id: string) => {
    setOpenSections(() => {
      const next = new Set(ouverts);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // Un groupe replié s'ouvre quand on arrive sur une de ses pages (lien direct, retour arrière).
  useEffect(() => {
    const g = groupes.find(gr => gr.entrees.some(e => location.pathname === e.to || location.pathname.startsWith(e.to + '/') || (e.alias || []).some(a => location.pathname.startsWith(a))));
    if (g && !ouverts.has(g.id)) setOpenSections(new Set([...ouverts, g.id]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

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
    await apiPut(`/notifications/${notifId}/read`, {});
    setNotifications(prev => prev.map(n => n.id === notifId ? { ...n, read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const markAllRead = async () => {
    if (!userId || !token) return;
    await apiPut(`/notifications/${userId}/read-all`, {});
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  };

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
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          <NavLink
            to="/"
            end
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive ? 'bg-brewery-50 text-brewery-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`
            }
          >
            <LayoutDashboard className="w-5 h-5 flex-shrink-0" />
            <span>Accueil</span>
          </NavLink>
          {/* Rappels et tâches : pour tout le monde, toujours visible, jamais replié dans un groupe. */}
          <NavLink
            to="/rappels"
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive || location.pathname.startsWith('/taches') ? 'bg-brewery-50 text-brewery-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`
            }
          >
            <Bell className="w-5 h-5 flex-shrink-0" />
            <span>Rappels et tâches</span>
            {urgentReminders > 0 && (
              <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {urgentReminders}
              </span>
            )}
          </NavLink>

          {groupes.filter(g => !g.adminOnly || isAdmin).map(groupe => {
            const isOpen = ouverts.has(groupe.id);
            const estMonGroupe = groupe.roles.includes(role || '') || (groupe.id === 'prospection' && faitDeLaProspection(state.currentUser));
            return (
              <div key={groupe.id} className="pt-2">
                <button
                  onClick={() => toggleSection(groupe.id)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide rounded-lg transition-colors ${
                    estMonGroupe ? 'text-brewery-700 hover:bg-brewery-50' : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'
                  }`}
                  aria-expanded={isOpen}
                >
                  <groupe.icon className="w-3.5 h-3.5" />
                  <span className="flex-1 text-left">{groupe.titre}</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                </button>
                {isOpen && (
                  <div className="mt-0.5 space-y-0.5">
                    {groupe.entrees.map(entree => (
                      <NavLink
                        key={entree.to}
                        to={entree.to}
                        onClick={() => setSidebarOpen(false)}
                        className={({ isActive }) => {
                          const actif = isActive || (entree.alias || []).some(a => location.pathname.startsWith(a));
                          return `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                            actif ? 'bg-brewery-50 text-brewery-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                          }`;
                        }}
                      >
                        <entree.icon className="w-5 h-5 flex-shrink-0" />
                        <span>{entree.label}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* External links */}
        <div className="px-3 pb-2 space-y-1">
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
                  {libelleRole(state.currentUser)}
                </p>
              </div>
            </Link>
            <button
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
              onClick={handleLogout}
              title="Se déconnecter"
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
            {/* Périmètre : mes clients (défaut commercial) ou toute l'équipe (remplacement). */}
            <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs font-medium" role="group" aria-label="Périmètre des clients">
              <button
                type="button"
                onClick={() => setPerimetre('moi')}
                className={`px-2.5 py-1 rounded-md transition-colors ${perimetre === 'moi' ? 'bg-white text-brewery-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                title="Mes clients et les fiches sans commercial"
              >
                Mes clients
              </button>
              <button
                type="button"
                onClick={() => setPerimetre('equipe')}
                className={`px-2.5 py-1 rounded-md transition-colors ${perimetre === 'equipe' ? 'bg-white text-brewery-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                title="Tous les clients de l'équipe (remplacement d'un collègue)"
              >
                Toute l'équipe
              </button>
            </div>
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

            <div className={`px-2.5 py-1 rounded-full text-xs font-medium ${
              isAdmin ? 'bg-amber-100 text-amber-700' : state.currentUser?.role === 'prospection' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {isAdmin ? 'Admin' : state.currentUser?.role === 'prospection' ? 'Prospection' : state.currentUser?.prospection ? 'Commercial + prospection' : 'Commercial'}
            </div>
            <Link to="/profil" className="font-medium hover:text-brewery-600 transition-colors">{state.currentUser?.prenom}</Link>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          {/* Une page qui casse sur une donnée inattendue n'emporte ni le menu ni l'en-tête. */}
          <BlocErreur key={location.pathname} titre="cette page">
            <Outlet />
          </BlocErreur>
        </main>
      </div>

    </div>
  );
}
