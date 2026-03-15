import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, Phone, Calendar, BarChart3, Clock, ChevronLeft, ChevronRight,
  UserCheck, Star, ClipboardCheck, Briefcase, Target, Building2, MapPin, ArrowRightLeft,
  AlertTriangle, ShoppingCart, TrendingUp, Euro,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { APPOINTMENT_RESULT_LABELS, CLIENT_TYPE_LABELS, CLIENT_VISIT_FREQUENCIES, ClientType } from '../types';
import {
  getCallsToday, getCallsThisWeek, getCallsThisMonth,
  getAppointmentsThisWeek, getAppointmentsThisMonth,
  getResponseRate, getAverageCallDuration,
  formatDuration, formatDate, isLastMonth,
} from '../utils/helpers';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement } from 'chart.js';
import { Doughnut, Bar } from 'react-chartjs-2';
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval, parseISO, startOfWeek, endOfWeek, addWeeks, subWeeks } from 'date-fns';
import { fr } from 'date-fns/locale';
import AdminClientsDashboard from '../components/AdminClientsDashboard';
import CommercialClientsDashboard from '../components/CommercialClientsDashboard';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

// Filter appointments by created_at (fallback to date for old records)
function getAppointmentsByCreatedAt<T extends { date: string; created_at?: string }>(items: T[], start: Date, end: Date): T[] {
  return items.filter(item => {
    try {
      const d = parseISO(item.created_at || item.date);
      return isWithinInterval(d, { start, end });
    } catch { return false; }
  });
}

// Helpers for month navigation
function getCallsInRange<T extends { date: string }>(calls: T[], start: Date, end: Date): T[] {
  return calls.filter(c => {
    try {
      const d = parseISO(c.date);
      return isWithinInterval(d, { start, end });
    } catch { return false; }
  });
}

function getWeeksInMonth(date: Date) {
  const start = startOfMonth(date);
  const end = endOfMonth(date);
  const weeks: { start: Date; end: Date; label: string }[] = [];
  let weekStart = startOfWeek(start, { weekStartsOn: 1 });
  let weekNum = 1;
  while (weekStart <= end) {
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
    const clampedStart = weekStart < start ? start : weekStart;
    const clampedEnd = weekEnd > end ? end : weekEnd;
    weeks.push({
      start: clampedStart,
      end: clampedEnd,
      label: `S${weekNum} (${format(clampedStart, 'dd/MM')}-${format(clampedEnd, 'dd/MM')})`,
    });
    weekStart = addWeeks(weekStart, 1);
    weekNum++;
  }
  return weeks;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin / Prospecteur',
  commercial: 'Commercial / Prospecteur',
};

type TimePeriod = 'week' | 'week-1' | 'week-2' | 'week-3' | 'month' | 'month-1' | 'month-2';

const PERIOD_OPTIONS: { value: TimePeriod; label: string }[] = [
  { value: 'week', label: 'Cette semaine' },
  { value: 'week-1', label: 'Semaine derniere' },
  { value: 'week-2', label: 'Il y a 2 sem.' },
  { value: 'week-3', label: 'Il y a 3 sem.' },
  { value: 'month', label: 'Ce mois' },
  { value: 'month-1', label: 'Mois dernier' },
];

function getPeriodRange(period: TimePeriod): { start: Date; end: Date } {
  const now = new Date();
  switch (period) {
    case 'week':
      return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    case 'week-1': {
      const d = subWeeks(now, 1);
      return { start: startOfWeek(d, { weekStartsOn: 1 }), end: endOfWeek(d, { weekStartsOn: 1 }) };
    }
    case 'week-2': {
      const d = subWeeks(now, 2);
      return { start: startOfWeek(d, { weekStartsOn: 1 }), end: endOfWeek(d, { weekStartsOn: 1 }) };
    }
    case 'week-3': {
      const d = subWeeks(now, 3);
      return { start: startOfWeek(d, { weekStartsOn: 1 }), end: endOfWeek(d, { weekStartsOn: 1 }) };
    }
    case 'month':
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case 'month-1': {
      const d = subMonths(now, 1);
      return { start: startOfMonth(d), end: endOfMonth(d) };
    }
    case 'month-2': {
      const d = subMonths(now, 2);
      return { start: startOfMonth(d), end: endOfMonth(d) };
    }
    default:
      return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
  }
}

export default function DashboardPage() {
  const { state } = useApp();
  const [monthOffset, setMonthOffset] = useState(0);
  const [crFilterResult, setCrFilterResult] = useState<string>('');
  const [crFilterUser, setCrFilterUser] = useState<string>('');
  const [rankingPeriod, setRankingPeriod] = useState<TimePeriod>('week');
  const [perfPeriod, setPerfPeriod] = useState<TimePeriod>('week');
  const [comparePeriod, setComparePeriod] = useState<TimePeriod | ''>('');
  const isAdmin = state.currentUser?.role === 'admin';

  const selectedMonth = subMonths(new Date(), -monthOffset);
  const monthStart = startOfMonth(selectedMonth);
  const monthEnd = endOfMonth(selectedMonth);
  const monthLabel = format(selectedMonth, 'MMMM yyyy', { locale: fr });

  // ALL users - everyone does prospecting and can be commercial
  const allUsers = state.commerciaux;

  const activeColumns = state.pipelineColumns;

  const stats = useMemo(() => {
    const callsToday = getCallsToday(state.calls);
    const callsWeek = getCallsThisWeek(state.calls);
    const callsMonth = getCallsThisMonth(state.calls);
    const rdvWeek = getAppointmentsThisWeek(state.appointments);
    const rdvMonth = getAppointmentsThisMonth(state.appointments);
    const responseRate = getResponseRate(state.calls);
    const avgDuration = getAverageCallDuration(state.calls);

    const prospectsByStage = activeColumns.map(col => ({
      stage: col.id,
      label: col.label,
      color: col.color,
      count: state.prospects.filter(p => p.etape_pipeline === col.id).length,
    }));

    const activeProspects = state.prospects.filter(p => !['client_gagne', 'perdu', 'ne_pas_contacter'].includes(p.etape_pipeline)).length;

    return {
      callsToday: callsToday.length,
      callsWeek: callsWeek.length,
      callsMonth: callsMonth.length,
      rdvWeek: rdvWeek.length,
      rdvMonth: rdvMonth.length,
      responseRate,
      avgDuration,
      prospectsByStage,
      totalProspects: state.prospects.length,
      activeProspects,
    };
  }, [state, activeColumns]);

  // Monthly history data for the selected month
  const monthlyHistory = useMemo(() => {
    const monthCalls = getCallsInRange(state.calls, monthStart, monthEnd);
    const monthRdv = getCallsInRange(state.appointments, monthStart, monthEnd);
    const monthProspects = state.prospects.filter(p => {
      try {
        const d = parseISO(p.date_creation);
        return isWithinInterval(d, { start: monthStart, end: monthEnd });
      } catch { return false; }
    });
    const weeks = getWeeksInMonth(selectedMonth);

    const weeklyBreakdown = weeks.map(week => {
      const weekCalls = getCallsInRange(state.calls, week.start, week.end);
      const weekRdv = getCallsInRange(state.appointments, week.start, week.end);
      const weekProspects = state.prospects.filter(p => {
        try {
          const d = parseISO(p.date_creation);
          return isWithinInterval(d, { start: week.start, end: week.end });
        } catch { return false; }
      });
      const weekAnswered = weekCalls.filter(c => c.resultat === 'repondu').length;
      return {
        label: week.label,
        calls: weekCalls.length,
        rdv: weekRdv.length,
        prospects: weekProspects.length,
        answered: weekAnswered,
        responseRate: weekCalls.length > 0 ? Math.round((weekAnswered / weekCalls.length) * 100) : 0,
      };
    });

    return {
      totalCalls: monthCalls.length,
      totalRdv: monthRdv.length,
      totalProspects: monthProspects.length,
      answered: monthCalls.filter(c => c.resultat === 'repondu').length,
      responseRate: monthCalls.length > 0
        ? Math.round((monthCalls.filter(c => c.resultat === 'repondu').length / monthCalls.length) * 100)
        : 0,
      weeklyBreakdown,
    };
  }, [state.calls, state.appointments, state.prospects, monthStart, monthEnd, selectedMonth]);

  // Per-user activity stats (ALL users)
  const userActivities = useMemo(() => {
    return allUsers.map(user => {
      const userCalls = state.calls.filter(c => c.commercial_id === user.id);
      const userAppointments = state.appointments.filter(a => a.commercial_id === user.id);
      const userProspects = state.prospects.filter(p => p.commercial_id === user.id);

      // RDV taken as prospector (prospecteur_id)
      const rdvTakenAsProspector = state.appointments.filter(a => a.prospecteur_id === user.id);

      const weekCalls = getCallsThisWeek(userCalls);
      const monthCalls = getCallsThisMonth(userCalls);
      const todayCalls = getCallsToday(userCalls);
      const weekRdv = getAppointmentsThisWeek(userAppointments);
      const monthRdv = getAppointmentsThisMonth(userAppointments);
      const now = new Date();
      const monthRdvTaken = getAppointmentsByCreatedAt(rdvTakenAsProspector, startOfMonth(now), endOfMonth(now));
      const responseRate = getResponseRate(userCalls);
      const avgDuration = getAverageCallDuration(userCalls);
      const wonProspects = userProspects.filter(p => p.etape_pipeline === 'client_gagne').length;

      // Prospects created this month by this user
      const mStart = startOfMonth(now);
      const mEnd = endOfMonth(now);
      const monthProspectsCreated = userProspects.filter(p => {
        try {
          const d = parseISO(p.date_creation);
          return isWithinInterval(d, { start: mStart, end: mEnd });
        } catch { return false; }
      }).length;

      const objective = user.objectifs.appels_semaine;
      const progress = objective > 0 ? Math.round((weekCalls.length / objective) * 100) : 0;

      return {
        user,
        todayCalls: todayCalls.length,
        weekCalls: weekCalls.length,
        monthCalls: monthCalls.length,
        weekRdv: weekRdv.length,
        monthRdv: monthRdv.length,
        monthRdvTaken: monthRdvTaken.length,
        monthProspectsCreated,
        responseRate,
        avgDuration,
        totalProspects: userProspects.length,
        activeProspects: userProspects.filter(p => !['client_gagne', 'perdu', 'ne_pas_contacter'].includes(p.etape_pipeline)).length,
        wonProspects,
        objective,
        progress,
      };
    }).sort((a, b) => b.weekCalls - a.weekCalls); // Sort by most active
  }, [allUsers, state.calls, state.appointments, state.prospects]);

  // Ranked user activities for "Classement" section (based on selected period)
  const rankedActivities = useMemo(() => {
    const range = getPeriodRange(rankingPeriod);
    return allUsers.map(user => {
      const userCalls = state.calls.filter(c => c.commercial_id === user.id);
      const userAppointments = state.appointments.filter(a => a.commercial_id === user.id);
      const userProspects = state.prospects.filter(p => p.commercial_id === user.id);
      const userVisites = (state as any).visites ? (state as any).visites.filter((v: any) => v.commercial_id === user.id) : [];

      const periodCalls = getCallsInRange(userCalls, range.start, range.end);
      const periodRdv = getCallsInRange(userAppointments, range.start, range.end);
      const periodVisites = getCallsInRange(userVisites, range.start, range.end);
      const periodProspectsCreated = userProspects.filter(p => {
        try {
          const d = parseISO(p.date_creation);
          return isWithinInterval(d, { start: range.start, end: range.end });
        } catch { return false; }
      });

      // For prospection role: score = calls + prospects created
      // For commercial/admin: score = rdv + visites + calls
      const isProspection = user.role === 'prospection';
      const score = isProspection
        ? periodCalls.length + periodProspectsCreated.length
        : periodRdv.length + periodVisites.length + periodCalls.length;

      return {
        user,
        periodCalls: periodCalls.length,
        periodRdv: periodRdv.length,
        periodVisites: periodVisites.length,
        periodProspectsCreated: periodProspectsCreated.length,
        totalProspects: userProspects.length,
        score,
      };
    }).sort((a, b) => b.score - a.score);
  }, [allUsers, state, rankingPeriod]);

  // Performance table user activities (based on selected period)
  const perfUserActivities = useMemo(() => {
    const range = getPeriodRange(perfPeriod);
    const isMonthPeriod = perfPeriod.startsWith('month');

    return allUsers.map(user => {
      const userCalls = state.calls.filter(c => c.commercial_id === user.id);
      const userAppointments = state.appointments.filter(a => a.commercial_id === user.id);
      const userProspects = state.prospects.filter(p => p.commercial_id === user.id);
      const rdvTakenAsProspector = state.appointments.filter(a => a.prospecteur_id === user.id);

      const todayCalls = getCallsToday(userCalls);
      const periodCalls = getCallsInRange(userCalls, range.start, range.end);
      const periodRdv = getCallsInRange(userAppointments, range.start, range.end);
      const periodRdvTaken = getAppointmentsByCreatedAt(rdvTakenAsProspector, range.start, range.end);

      const periodResponseRate = periodCalls.length > 0
        ? Math.round((periodCalls.filter(c => c.resultat === 'repondu').length / periodCalls.length) * 100)
        : 0;
      const periodAnsweredCalls = periodCalls.filter(c => c.duree > 0);
      const periodAvgDuration = periodAnsweredCalls.length > 0
        ? Math.round(periodAnsweredCalls.reduce((sum, c) => sum + c.duree, 0) / periodAnsweredCalls.length)
        : 0;
      const wonProspects = userProspects.filter(p => p.etape_pipeline === 'client_gagne').length;

      const objective = isMonthPeriod ? (user.objectifs.appels_semaine * 4) : user.objectifs.appels_semaine;
      const progress = objective > 0 ? Math.round((periodCalls.length / objective) * 100) : 0;

      return {
        user,
        todayCalls: todayCalls.length,
        periodCalls: periodCalls.length,
        periodRdv: periodRdv.length,
        periodRdvTaken: periodRdvTaken.length,
        responseRate: periodResponseRate,
        avgDuration: periodAvgDuration,
        totalProspects: userProspects.length,
        activeProspects: userProspects.filter(p => !['client_gagne', 'perdu', 'ne_pas_contacter'].includes(p.etape_pipeline)).length,
        wonProspects,
        objective,
        progress,
      };
    }).sort((a, b) => b.periodCalls - a.periodCalls);
  }, [allUsers, state.calls, state.appointments, state.prospects, perfPeriod]);

  // Comparison period data
  const compareUserActivities = useMemo(() => {
    if (!comparePeriod) return null;
    const range = getPeriodRange(comparePeriod);
    const isMonthPeriod = comparePeriod.startsWith('month');

    return allUsers.map(user => {
      const userCalls = state.calls.filter(c => c.commercial_id === user.id);
      const userAppointments = state.appointments.filter(a => a.commercial_id === user.id);
      const userProspects = state.prospects.filter(p => p.commercial_id === user.id);

      const periodCalls = getCallsInRange(userCalls, range.start, range.end);
      const periodRdv = getCallsInRange(userAppointments, range.start, range.end);
      const periodResponseRate = periodCalls.length > 0
        ? Math.round((periodCalls.filter(c => c.resultat === 'repondu').length / periodCalls.length) * 100)
        : 0;
      const wonProspects = userProspects.filter(p => p.etape_pipeline === 'client_gagne').length;
      const objective = isMonthPeriod ? (user.objectifs.appels_semaine * 4) : user.objectifs.appels_semaine;
      const progress = objective > 0 ? Math.round((periodCalls.length / objective) * 100) : 0;

      return {
        userId: user.id,
        periodCalls: periodCalls.length,
        periodRdv: periodRdv.length,
        responseRate: periodResponseRate,
        wonProspects,
        objective,
        progress,
      };
    });
  }, [allUsers, state.calls, state.appointments, state.prospects, comparePeriod]);

  // Recent RDV compte-rendus (with filters)
  const recentCompteRendus = useMemo(() => {
    let list = state.appointments.filter(a => a.compte_rendu && a.statut === 'termine');
    if (crFilterResult) list = list.filter(a => a.compte_rendu === crFilterResult);
    if (crFilterUser) list = list.filter(a => a.commercial_id === crFilterUser);
    return list
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 50)
      .map(apt => {
        const prospect = state.prospects.find(p => p.id === apt.prospect_id);
        const commercial = allUsers.find(u => u.id === apt.commercial_id);
        return { ...apt, prospectName: prospect?.nom_etablissement || 'Inconnu', contactName: prospect?.nom_contact || '', commercialName: commercial ? `${commercial.prenom} ${commercial.nom}` : 'Inconnu' };
      });
  }, [state.appointments, state.prospects, allUsers, crFilterResult, crFilterUser]);

  const compteRenduStats = useMemo(() => {
    let rdvsWithCR = state.appointments.filter(a => a.compte_rendu);
    if (crFilterUser) rdvsWithCR = rdvsWithCR.filter(a => a.commercial_id === crFilterUser);
    const total = rdvsWithCR.length;
    const byResult: Record<string, number> = {};
    rdvsWithCR.forEach(a => { byResult[a.compte_rendu || ''] = (byResult[a.compte_rendu || ''] || 0) + 1; });
    return { total, byResult };
  }, [state.appointments, crFilterUser]);

  // === CA (Chiffre d'affaires) ===
  const caStats = useMemo(() => {
    const now = new Date();
    const monthCommandes = state.commandes.filter(c => {
      try { return isWithinInterval(parseISO(c.date_commande), { start: startOfMonth(now), end: endOfMonth(now) }); } catch { return false; }
    });
    const lastMonthCommandes = state.commandes.filter(c => isLastMonth(c.date_commande));
    const caMonth = monthCommandes.reduce((sum, c) => sum + (c.montant_ttc || 0), 0);
    const caLastMonth = lastMonthCommandes.reduce((sum, c) => sum + (c.montant_ttc || 0), 0);
    const nbCommandesMonth = monthCommandes.length;
    return { caMonth, caLastMonth, nbCommandesMonth };
  }, [state.commandes]);

  // === Sante des visites ===
  const visitHealth = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const activeClients = state.clients.filter(c => c.statut === 'ACTIF');
    const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 }).toISOString().split('T')[0];

    const lateClients = activeClients.filter(c => c.next_visit && c.next_visit < today);
    const todayClients = activeClients.filter(c => c.next_visit && c.next_visit === today);
    const weekClients = activeClients.filter(c => c.next_visit && c.next_visit >= today && c.next_visit <= weekEnd);
    const withRecurrence = activeClients.filter(c => c.next_visit);
    const onTime = withRecurrence.filter(c => c.next_visit! >= today);
    const coverageRate = withRecurrence.length > 0 ? Math.round((onTime.length / withRecurrence.length) * 100) : 100;

    const avgDelay = lateClients.length > 0
      ? Math.round(lateClients.reduce((sum, c) => {
          const diff = Math.floor((new Date(today).getTime() - new Date(c.next_visit!).getTime()) / 86400000);
          return sum + diff;
        }, 0) / lateClients.length)
      : 0;

    return { lateCount: lateClients.length, todayCount: todayClients.length, weekCount: weekClients.length, coverageRate, avgDelay, totalActive: activeClients.length };
  }, [state.clients]);

  // === Entonnoir de conversion ===
  const funnelData = useMemo(() => {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);
    const lastMonthStart = startOfMonth(subMonths(now, 1));
    const lastMonthEnd = endOfMonth(subMonths(now, 1));

    const convertedThisMonth = state.prospects.filter(p => {
      if (p.etape_pipeline !== 'client_gagne') return false;
      try { return isWithinInterval(parseISO(p.date_modification), { start: monthStart, end: monthEnd }); } catch { return false; }
    }).length;
    const convertedLastMonth = state.prospects.filter(p => {
      if (p.etape_pipeline !== 'client_gagne') return false;
      try { return isWithinInterval(parseISO(p.date_modification), { start: lastMonthStart, end: lastMonthEnd }); } catch { return false; }
    }).length;

    // Stagnant prospects: active prospects with no call or RDV in the last 14 days
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);
    const activeProspects = state.prospects.filter(p => !['client_gagne', 'perdu', 'ne_pas_contacter'].includes(p.etape_pipeline));
    const stagnant = activeProspects.filter(p => {
      const lastCall = state.calls.filter(c => c.prospect_id === p.id).sort((a, b) => b.date.localeCompare(a.date))[0];
      const lastRdv = state.appointments.filter(a => a.prospect_id === p.id).sort((a, b) => b.date.localeCompare(a.date))[0];
      const lastActivity = [lastCall?.date, lastRdv?.date].filter(Boolean).sort().pop();
      if (!lastActivity) return true;
      try { return parseISO(lastActivity) < twoWeeksAgo; } catch { return true; }
    });

    return { convertedThisMonth, convertedLastMonth, stagnantCount: stagnant.length, totalActive: activeProspects.length };
  }, [state.prospects, state.calls, state.appointments]);

  // === Top clients par CA ===
  const topClientsData = useMemo(() => {
    const clientCA = state.clients.map(c => {
      const commandes = state.commandes.filter(cmd => cmd.client_id === c.id);
      const totalCA = commandes.reduce((sum, cmd) => sum + (cmd.montant_ttc || 0), 0);
      const lastOrder = commandes.sort((a, b) => b.date_commande.localeCompare(a.date_commande))[0];
      return { client: c, totalCA, orderCount: commandes.length, lastOrderDate: lastOrder?.date_commande || '' };
    });

    const top10 = clientCA.filter(c => c.totalCA > 0).sort((a, b) => b.totalCA - a.totalCA).slice(0, 10);

    // CA par type de client
    const caByType: Record<string, number> = {};
    clientCA.forEach(c => {
      const type = c.client.type_client || 'AUTRE';
      caByType[type] = (caByType[type] || 0) + c.totalCA;
    });

    // Clients actifs sans commande depuis 60 jours
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0];
    const inactiveOrdering = clientCA.filter(c =>
      c.client.statut === 'ACTIF' && c.orderCount > 0 && c.lastOrderDate < sixtyDaysAgo
    );

    // CA par commercial
    const caByCommercial: Record<string, number> = {};
    clientCA.forEach(c => {
      if (c.client.commercial_id) {
        caByCommercial[c.client.commercial_id] = (caByCommercial[c.client.commercial_id] || 0) + c.totalCA;
      }
    });

    // 5 dernieres commandes
    const recentOrders = [...state.commandes]
      .sort((a, b) => b.date_commande.localeCompare(a.date_commande))
      .slice(0, 5)
      .map(cmd => {
        const client = state.clients.find(c => c.id === cmd.client_id);
        return { ...cmd, clientName: client?.nom || (cmd as any).client_name || 'Inconnu' };
      });

    return { top10, caByType, inactiveOrdering, caByCommercial, recentOrders };
  }, [state.clients, state.commandes]);

  // === Alertes ===
  const alerts = useMemo(() => {
    const orphanCommandes = state.commandes.filter(c => !c.client_id).length;
    const overdueTasks = (state as any).tasksClient?.filter((t: any) => t.statut !== 'TERMINEE' && t.date_echeance && t.date_echeance < new Date().toISOString().split('T')[0]).length || 0;
    return { lateVisits: visitHealth.lateCount, stagnantProspects: funnelData.stagnantCount, orphanCommandes, overdueTasks };
  }, [visitHealth, funnelData, state]);

  // Chart: Prospects by pipeline stage (only active columns)
  const pipelineChartData = {
    labels: stats.prospectsByStage.map(s => s.label),
    datasets: [{
      data: stats.prospectsByStage.map(s => s.count),
      backgroundColor: stats.prospectsByStage.map(s => s.color),
      borderWidth: 0,
    }],
  };

  // Chart: Activity by user (ALL users)
  const userActivityChartData = {
    labels: allUsers.map(c => c.prenom),
    datasets: [{
      label: 'Appels cette semaine',
      data: allUsers.map(c => getCallsThisWeek(state.calls.filter(cl => cl.commercial_id === c.id)).length),
      backgroundColor: '#22c55e',
      borderRadius: 6,
    }, {
      label: 'Prospects ce mois',
      data: allUsers.map(c => {
        const now = new Date();
        const mS = startOfMonth(now), mE = endOfMonth(now);
        return state.prospects.filter(p => p.commercial_id === c.id && (() => {
          try { return isWithinInterval(parseISO(p.date_creation), { start: mS, end: mE }); } catch { return false; }
        })()).length;
      }),
      backgroundColor: '#f59e0b',
      borderRadius: 6,
    }, {
      label: 'RDV ce mois',
      data: allUsers.map(c => getAppointmentsThisMonth(state.appointments.filter(a => a.commercial_id === c.id)).length),
      backgroundColor: '#3b82f6',
      borderRadius: 6,
    }, {
      label: 'RDV pris (prospection)',
      data: allUsers.map(c => {
        const now = new Date();
        return getAppointmentsByCreatedAt(state.appointments.filter(a => a.prospecteur_id === c.id), startOfMonth(now), endOfMonth(now)).length;
      }),
      backgroundColor: '#a855f7',
      borderRadius: 6,
    }],
  };

  // Chart: weekly breakdown for selected month
  const weeklyChartData = {
    labels: monthlyHistory.weeklyBreakdown.map(w => w.label),
    datasets: [{
      label: 'Appels',
      data: monthlyHistory.weeklyBreakdown.map(w => w.calls),
      backgroundColor: '#22c55e',
      borderRadius: 6,
    }, {
      label: 'Prospects',
      data: monthlyHistory.weeklyBreakdown.map(w => w.prospects),
      backgroundColor: '#f59e0b',
      borderRadius: 6,
    }, {
      label: 'RDV',
      data: monthlyHistory.weeklyBreakdown.map(w => w.rdv),
      backgroundColor: '#3b82f6',
      borderRadius: 6,
    }],
  };

  // CA par type de client (donut)
  const caByTypeEntries = Object.entries(topClientsData.caByType).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const caByTypeChartData = {
    labels: caByTypeEntries.map(([k]) => CLIENT_TYPE_LABELS[k as ClientType] || k),
    datasets: [{
      data: caByTypeEntries.map(([, v]) => Math.round(v * 100) / 100),
      backgroundColor: ['#6366f1', '#22c55e', '#f59e0b', '#3b82f6', '#a855f7', '#ef4444', '#14b8a6', '#f97316', '#ec4899', '#64748b'],
      borderWidth: 0,
    }],
  };

  // CA par commercial (bar)
  const caByCommChartData = {
    labels: allUsers.map(u => u.prenom),
    datasets: [{
      label: 'CA total (TTC)',
      data: allUsers.map(u => Math.round((topClientsData.caByCommercial[u.id] || 0) * 100) / 100),
      backgroundColor: '#6366f1',
      borderRadius: 6,
    }],
  };

  const totalAlerts = alerts.lateVisits + alerts.stagnantProspects + alerts.orphanCommandes + alerts.overdueTasks;

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 fade-in">
      {/* Page header */}
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* Bandeau alertes */}
      {totalAlerts > 0 && (
        <div className="flex flex-wrap gap-2">
          {alerts.lateVisits > 0 && (
            <Link to="/visites" className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg text-xs font-medium text-red-700 hover:bg-red-100 transition-colors">
              <AlertTriangle className="w-3.5 h-3.5" /> {alerts.lateVisits} clients en retard de visite
            </Link>
          )}
          {alerts.stagnantProspects > 0 && (
            <Link to="/prospects" className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors">
              <AlertTriangle className="w-3.5 h-3.5" /> {alerts.stagnantProspects} prospects stagnants (+14j)
            </Link>
          )}
          {alerts.orphanCommandes > 0 && (
            <Link to="/admin" className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-lg text-xs font-medium text-orange-700 hover:bg-orange-100 transition-colors">
              <ShoppingCart className="w-3.5 h-3.5" /> {alerts.orphanCommandes} commandes a assigner
            </Link>
          )}
          {alerts.overdueTasks > 0 && (
            <Link to="/taches" className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 border border-purple-200 rounded-lg text-xs font-medium text-purple-700 hover:bg-purple-100 transition-colors">
              <AlertTriangle className="w-3.5 h-3.5" /> {alerts.overdueTasks} taches en retard
            </Link>
          )}
        </div>
      )}

      {/* KPI ROW */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white rounded-xl border border-emerald-200 p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="bg-emerald-100 p-1.5 rounded-lg"><Euro className="w-3.5 h-3.5 text-emerald-600" /></div>
            <p className="text-[10px] text-gray-500">CA ce mois</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{caStats.caMonth.toFixed(0)} <span className="text-sm font-normal text-gray-400">EUR</span></p>
          <p className="text-[10px] text-gray-400">{caStats.nbCommandesMonth} cmd / Mois prec. {caStats.caLastMonth.toFixed(0)} EUR</p>
        </div>
        <div className="bg-white rounded-xl border border-indigo-100 p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="bg-indigo-100 p-1.5 rounded-lg"><Building2 className="w-3.5 h-3.5 text-indigo-600" /></div>
            <p className="text-[10px] text-gray-500">Prospects actifs</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{stats.activeProspects}</p>
          <p className="text-[10px] text-gray-400">{stats.totalProspects} total</p>
        </div>
        <div className="bg-white rounded-xl border border-green-100 p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="bg-green-100 p-1.5 rounded-lg"><Phone className="w-3.5 h-3.5 text-green-600" /></div>
            <p className="text-[10px] text-gray-500">Appels</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{stats.callsToday}</p>
          <p className="text-[10px] text-gray-400">{stats.callsWeek} sem. / {stats.callsMonth} mois</p>
        </div>
        <div className="bg-white rounded-xl border border-blue-100 p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="bg-blue-100 p-1.5 rounded-lg"><Calendar className="w-3.5 h-3.5 text-blue-600" /></div>
            <p className="text-[10px] text-gray-500">RDV</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{stats.rdvMonth}</p>
          <p className="text-[10px] text-gray-400">{stats.rdvWeek} cette semaine</p>
        </div>
        <div className="bg-white rounded-xl border border-amber-100 p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="bg-amber-100 p-1.5 rounded-lg"><Clock className="w-3.5 h-3.5 text-amber-600" /></div>
            <p className="text-[10px] text-gray-500">Taux reponse</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{stats.responseRate}%</p>
          <p className="text-[10px] text-gray-400">Duree moy. {formatDuration(stats.avgDuration)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="bg-gray-100 p-1.5 rounded-lg"><Users className="w-3.5 h-3.5 text-gray-600" /></div>
            <p className="text-[10px] text-gray-500">Equipe</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{allUsers.length}</p>
          <p className="text-[10px] text-gray-400">membres actifs</p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* GESTION CLIENTS - Stats & Planning (API-driven)           */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div>
        <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2 mb-3">
          <Briefcase className="w-4.5 h-4.5 text-indigo-500" />
          Gestion Clients
        </h2>
        {isAdmin ? <AdminClientsDashboard /> : <CommercialClientsDashboard />}
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* SANTE DES VISITES                                         */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
        <h3 className="font-semibold text-gray-900 text-sm sm:text-base flex items-center gap-2 mb-4">
          <MapPin className="w-4 h-4 text-indigo-500" />
          Sante des visites
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className={`rounded-lg p-3 text-center ${visitHealth.lateCount > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
            <p className={`text-2xl font-bold ${visitHealth.lateCount > 0 ? 'text-red-700' : 'text-green-700'}`}>{visitHealth.lateCount}</p>
            <p className={`text-[10px] mt-0.5 ${visitHealth.lateCount > 0 ? 'text-red-600' : 'text-green-600'}`}>En retard</p>
          </div>
          <div className="bg-orange-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-orange-700">{visitHealth.todayCount}</p>
            <p className="text-[10px] text-orange-600 mt-0.5">Aujourd'hui</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-blue-700">{visitHealth.weekCount}</p>
            <p className="text-[10px] text-blue-600 mt-0.5">Cette semaine</p>
          </div>
          <div className={`rounded-lg p-3 text-center ${visitHealth.coverageRate >= 80 ? 'bg-green-50' : visitHealth.coverageRate >= 50 ? 'bg-amber-50' : 'bg-red-50'}`}>
            <p className={`text-2xl font-bold ${visitHealth.coverageRate >= 80 ? 'text-green-700' : visitHealth.coverageRate >= 50 ? 'text-amber-700' : 'text-red-700'}`}>{visitHealth.coverageRate}%</p>
            <p className="text-[10px] text-gray-600 mt-0.5">Couverture</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-gray-700">{visitHealth.avgDelay > 0 ? `${visitHealth.avgDelay}j` : '0j'}</p>
            <p className="text-[10px] text-gray-600 mt-0.5">Retard moyen</p>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ENTONNOIR DE CONVERSION + CA                              */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pipeline velocity */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
          <h3 className="font-semibold text-gray-900 text-sm sm:text-base flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-purple-500" />
            Pipeline & Conversion
          </h3>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-700">{funnelData.convertedThisMonth}</p>
              <p className="text-[10px] text-green-600 mt-0.5">Convertis ce mois</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-gray-700">{funnelData.convertedLastMonth}</p>
              <p className="text-[10px] text-gray-600 mt-0.5">Convertis mois prec.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">{funnelData.stagnantCount} prospects stagnants</p>
              <p className="text-[10px] text-amber-600">Sans activite depuis plus de 14 jours sur {funnelData.totalActive} actifs</p>
            </div>
          </div>
        </div>

        {/* CA par type */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
          <h3 className="font-semibold text-gray-900 text-sm sm:text-base flex items-center gap-2 mb-4">
            <Euro className="w-4 h-4 text-emerald-500" />
            CA par type de client
          </h3>
          <div className="h-52 sm:h-64 flex items-center justify-center">
            {caByTypeEntries.length > 0 ? (
              <Doughnut data={caByTypeChartData} options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8, font: { size: 10 } } } },
              }} />
            ) : (
              <p className="text-sm text-gray-400">Aucune commande</p>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* TOP CLIENTS & CA PAR COMMERCIAL                           */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top 10 clients */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
          <h3 className="font-semibold text-gray-900 text-sm sm:text-base flex items-center gap-2 mb-4">
            <Star className="w-4 h-4 text-amber-400" />
            Top 10 clients par CA
          </h3>
          {topClientsData.top10.length > 0 ? (
            <div className="space-y-2">
              {topClientsData.top10.map((item, i) => (
                <div key={item.client.id} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i < 3 ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-600'}`}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.client.nom}</p>
                    <p className="text-[10px] text-gray-500">{item.client.ville} - {item.orderCount} commandes</p>
                  </div>
                  <p className="text-sm font-bold text-emerald-700">{item.totalCA.toFixed(0)} EUR</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-6">Aucune commande</p>
          )}
        </div>

        {/* CA par commercial */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
          <h3 className="font-semibold text-gray-900 text-sm sm:text-base flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-indigo-500" />
            CA par commercial
          </h3>
          <div className="h-52 sm:h-64">
            {allUsers.length > 0 ? (
              <Bar data={caByCommChartData} options={{
                responsive: true, maintainAspectRatio: false,
                scales: { y: { beginAtZero: true } },
                plugins: { legend: { display: false } },
              }} />
            ) : (
              <p className="text-sm text-gray-400 text-center py-6">Aucun membre</p>
            )}
          </div>
        </div>
      </div>

      {/* Commandes recentes + Clients inactifs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 5 dernieres commandes */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
          <h3 className="font-semibold text-gray-900 text-sm sm:text-base flex items-center gap-2 mb-4">
            <ShoppingCart className="w-4 h-4 text-emerald-500" />
            Dernieres commandes
          </h3>
          {topClientsData.recentOrders.length > 0 ? (
            <div className="space-y-2">
              {topClientsData.recentOrders.map(cmd => (
                <div key={cmd.id} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">#{cmd.numero || '—'} - {cmd.clientName}</p>
                    <p className="text-[10px] text-gray-500">{cmd.date_commande ? formatDate(cmd.date_commande) : '—'}</p>
                  </div>
                  <p className="text-sm font-bold text-emerald-700 ml-3">{(cmd.montant_ttc || 0).toFixed(0)} EUR</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-6">Aucune commande</p>
          )}
        </div>

        {/* Clients sans commande depuis 60j */}
        {topClientsData.inactiveOrdering.length > 0 && (
          <div className="bg-white rounded-xl border border-orange-200 p-4 sm:p-5">
            <h3 className="font-semibold text-orange-800 text-sm sm:text-base flex items-center gap-2 mb-4">
              <AlertTriangle className="w-4 h-4" />
              Clients sans commande depuis 60j ({topClientsData.inactiveOrdering.length})
            </h3>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {topClientsData.inactiveOrdering.slice(0, 15).map(item => (
                <div key={item.client.id} className="flex items-center justify-between p-2 bg-orange-50 rounded-lg">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.client.nom}</p>
                    <p className="text-[10px] text-gray-500">{item.client.ville} - Derniere cmd: {item.lastOrderDate ? formatDate(item.lastOrderDate) : '—'}</p>
                  </div>
                  <p className="text-xs text-orange-600 font-medium ml-2">{item.totalCA.toFixed(0)} EUR total</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* PROSPECTION - Charts, Pipeline, Performance               */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div>
        <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2 mb-3">
          <Target className="w-4.5 h-4.5 text-green-600" />
          Prospection
        </h2>

        <div className="space-y-4 sm:space-y-6">
          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pipeline distribution */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
              <h3 className="font-semibold text-gray-900 text-sm sm:text-base mb-4">Repartition du pipeline</h3>
              <div className="h-52 sm:h-64 flex items-center justify-center">
                <Doughnut
                  data={pipelineChartData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8, font: { size: 10 } } },
                    },
                  }}
                />
              </div>
            </div>

            {/* Activity by user (ALL users) */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
              <h3 className="font-semibold text-gray-900 text-sm sm:text-base mb-4">Activite par membre</h3>
              <div className="h-52 sm:h-64">
                {allUsers.length > 0 ? (
                  <Bar
                    data={userActivityChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
                      plugins: { legend: { position: 'top', labels: { boxWidth: 12, padding: 12, font: { size: 11 } } } },
                    }}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-gray-400">Aucun membre</div>
                )}
              </div>
            </div>
          </div>

          {/* Pipeline breakdown - only active columns */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <h3 className="font-semibold text-gray-900 text-sm sm:text-base mb-4">Prospects par etape</h3>
            <div className={`grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-${Math.min(activeColumns.length, 8)} gap-2 sm:gap-3`}>
              {stats.prospectsByStage.map(s => (
                <div key={s.stage} className="text-center p-3 rounded-lg bg-gray-50">
                  <div className="pipeline-dot mx-auto mb-2" style={{ backgroundColor: s.color }} />
                  <p className="text-2xl font-bold text-gray-900">{s.count}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Compte-rendu RDV + Classement side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Compte-rendu RDV */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h3 className="font-semibold text-gray-900 text-sm sm:text-base flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4 text-indigo-500" />
                  Comptes-rendus RDV
                </h3>
                <select
                  className="rounded-lg border border-gray-200 text-xs px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brewery-500"
                  value={crFilterUser}
                  onChange={e => setCrFilterUser(e.target.value)}
                >
                  <option value="">Tout le monde</option>
                  {allUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.prenom} {u.nom}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
                <button onClick={() => setCrFilterResult('')}
                  className={`rounded-lg p-2 text-center transition-all cursor-pointer ${crFilterResult === '' ? 'bg-indigo-50 text-indigo-700 ring-2 ring-indigo-400' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}>
                  <p className="text-lg font-bold">{compteRenduStats.total}</p>
                  <p className="text-[9px] leading-tight">Tous</p>
                </button>
                {Object.entries(APPOINTMENT_RESULT_LABELS).map(([key, label]) => {
                  const count = compteRenduStats.byResult[key] || 0;
                  const colorMap: Record<string, string> = { client: 'bg-green-50 text-green-700', mail_envoye: 'bg-blue-50 text-blue-700', commande_plus_tard: 'bg-amber-50 text-amber-700', a_relancer: 'bg-purple-50 text-purple-700', pas_interesse: 'bg-red-50 text-red-700' };
                  const ringMap: Record<string, string> = { client: 'ring-green-400', mail_envoye: 'ring-blue-400', commande_plus_tard: 'ring-amber-400', a_relancer: 'ring-purple-400', pas_interesse: 'ring-red-400' };
                  const isActive = crFilterResult === key;
                  return (
                    <button key={key} onClick={() => setCrFilterResult(isActive ? '' : key)}
                      className={`${colorMap[key] || 'bg-gray-50 text-gray-700'} rounded-lg p-2 text-center transition-all cursor-pointer hover:opacity-80 ${isActive ? `ring-2 ${ringMap[key] || 'ring-gray-400'}` : ''}`}>
                      <p className="text-lg font-bold">{count}</p>
                      <p className="text-[9px] leading-tight">{label}</p>
                    </button>
                  );
                })}
              </div>
              <div className="space-y-1.5 max-h-[350px] overflow-y-auto">
                {recentCompteRendus.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">Aucun compte-rendu</p>
                ) : recentCompteRendus.map(cr => {
                  const colorMap: Record<string, string> = { client: 'text-green-600 bg-green-50', mail_envoye: 'text-blue-600 bg-blue-50', commande_plus_tard: 'text-amber-600 bg-amber-50', a_relancer: 'text-purple-600 bg-purple-50', pas_interesse: 'text-red-600 bg-red-50' };
                  const crColor = colorMap[cr.compte_rendu || ''] || 'text-gray-600 bg-gray-50';
                  return (
                    <div key={cr.id} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors">
                      <div className={`p-1.5 rounded-lg shrink-0 ${crColor}`}><ClipboardCheck className="w-3.5 h-3.5" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Link to={`/prospects?id=${cr.prospect_id}`} className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline truncate" onClick={e => e.stopPropagation()}>
                            {cr.prospectName}
                          </Link>
                          {cr.contactName && <span className="text-[10px] text-gray-500">({cr.contactName})</span>}
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${crColor}`}>{APPOINTMENT_RESULT_LABELS[cr.compte_rendu || ''] || cr.compte_rendu}</span>
                        </div>
                        <p className="text-[10px] text-gray-500">{formatDate(cr.date)} - {cr.commercialName}</p>
                        {cr.notes_compte_rendu && <p className="text-[10px] text-gray-400 truncate mt-0.5">{cr.notes_compte_rendu}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          {/* Classement */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="font-semibold text-gray-900 text-sm sm:text-base flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-400" />
                Classement
              </h3>
              <select className="rounded-lg border border-gray-200 text-xs px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brewery-500"
                value={rankingPeriod} onChange={e => setRankingPeriod(e.target.value as TimePeriod)}>
                {PERIOD_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div className="space-y-3">
              {rankedActivities.map((ua, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
                const isProspection = ua.user.role === 'prospection';
                return (
                  <div key={ua.user.id} className={`p-3 rounded-lg ${i < 3 ? 'bg-gradient-to-r from-amber-50/50 to-transparent' : 'bg-gray-50'}`}>
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className="w-9 h-9 rounded-full bg-brewery-100 flex items-center justify-center text-sm font-bold text-brewery-700">{ua.user.prenom[0]}{ua.user.nom[0]}</div>
                        {medal && <span className="absolute -top-1 -right-1 text-sm">{medal}</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm text-gray-900">{ua.user.prenom} {ua.user.nom}</p>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600">{ROLE_LABELS[ua.user.role] || ua.user.role}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-[10px] text-green-600 flex items-center gap-0.5"><Phone className="w-3 h-3" /> {ua.periodCalls} appels</span>
                          {isProspection ? (
                            <span className="text-[10px] text-purple-600 flex items-center gap-0.5"><UserCheck className="w-3 h-3" /> {ua.periodProspectsCreated} prospects</span>
                          ) : (
                            <>
                              <span className="text-[10px] text-blue-600 flex items-center gap-0.5"><Calendar className="w-3 h-3" /> {ua.periodRdv} RDV</span>
                              <span className="text-[10px] text-indigo-600 flex items-center gap-0.5"><MapPin className="w-3 h-3" /> {ua.periodVisites} visites</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-bold text-gray-900">{ua.score}</p>
                        <p className="text-[10px] text-gray-400">score</p>
                      </div>
                    </div>
                  </div>
                );
              })}
              {rankedActivities.length === 0 && <p className="text-sm text-gray-400 text-center py-8">Aucun membre</p>}
            </div>
          </div>
          </div>

          {/* Performance detaillee */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="font-semibold text-gray-900 text-sm sm:text-base flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-gray-400" />
                Performance de l'equipe
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                <select className="rounded-lg border border-gray-200 text-xs px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brewery-500"
                  value={perfPeriod} onChange={e => setPerfPeriod(e.target.value as TimePeriod)}>
                  {PERIOD_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
                <div className="flex items-center gap-1">
                  <ArrowRightLeft className="w-3.5 h-3.5 text-gray-400" />
                  <select className="rounded-lg border border-gray-200 text-xs px-2 py-1.5 bg-white text-gray-500 focus:outline-none focus:ring-2 focus:ring-brewery-500"
                    value={comparePeriod} onChange={e => setComparePeriod(e.target.value as TimePeriod | '')}>
                    <option value="">Comparer avec...</option>
                    {PERIOD_OPTIONS.filter(opt => opt.value !== perfPeriod).map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-2 font-medium text-gray-500">Membre</th>
                    <th className="text-center py-3 px-2 font-medium text-gray-500"><span className="hidden sm:inline">Appels</span><span className="sm:hidden">App.</span> auj.</th>
                    <th className="text-center py-3 px-2 font-medium text-gray-500"><span className="hidden sm:inline">Appels</span><span className="sm:hidden">App.</span> per.</th>
                    <th className="text-center py-3 px-2 font-medium text-gray-500">Objectif</th>
                    <th className="text-center py-3 px-2 font-medium text-gray-500">Progres</th>
                    <th className="text-center py-3 px-2 font-medium text-gray-500">RDV</th>
                    <th className="text-center py-3 px-2 font-medium text-gray-500"><span className="hidden sm:inline">RDV prosp.</span><span className="sm:hidden">Prosp.</span></th>
                    <th className="text-center py-3 px-2 font-medium text-gray-500">Rep.</th>
                    <th className="text-center py-3 px-2 font-medium text-gray-500"><span className="hidden sm:inline">Duree</span><span className="sm:hidden">Dur.</span></th>
                    <th className="text-center py-3 px-2 font-medium text-gray-500">Prospects</th>
                    <th className="text-center py-3 px-2 font-medium text-gray-500">Gagnes</th>
                  </tr>
                </thead>
                <tbody>
                  {perfUserActivities.map(ua => {
                    const progressColor = ua.progress >= 100 ? 'bg-green-500' : ua.progress >= 70 ? 'bg-amber-500' : 'bg-red-500';
                    const cmp = compareUserActivities?.find(c => c.userId === ua.user.id);
                    const diffBadge = (current: number, prev: number | undefined) => {
                      if (prev === undefined) return null;
                      const diff = current - prev;
                      if (diff === 0) return null;
                      return <span className={`text-[9px] ml-0.5 ${diff > 0 ? 'text-green-500' : 'text-red-500'}`}>{diff > 0 ? '+' : ''}{diff}</span>;
                    };
                    return (
                      <tr key={ua.user.id} className="border-b border-gray-100 last:border-0">
                        <td className="py-3 px-2">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-brewery-100 flex items-center justify-center text-xs font-bold text-brewery-700">{ua.user.prenom[0]}{ua.user.nom[0]}</div>
                            <div>
                              <p className="font-medium text-gray-900 text-sm">{ua.user.prenom} {ua.user.nom}</p>
                              <p className="text-[10px] text-gray-500">{ROLE_LABELS[ua.user.role] || ua.user.role}</p>
                            </div>
                          </div>
                        </td>
                        <td className="text-center py-3 px-2"><span className={`font-semibold ${ua.todayCalls > 0 ? 'text-green-600' : 'text-gray-400'}`}>{ua.todayCalls}</span></td>
                        <td className="text-center py-3 px-2 font-semibold">{ua.periodCalls}{diffBadge(ua.periodCalls, cmp?.periodCalls)}</td>
                        <td className="text-center py-3 px-2 text-gray-500">{ua.objective}</td>
                        <td className="py-3 px-2">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-200 rounded-full h-2 min-w-[60px]">
                              <div className={`h-2 rounded-full progress-bar ${progressColor}`} style={{ width: `${Math.min(ua.progress, 100)}%` }} />
                            </div>
                            <span className="text-xs font-medium text-gray-600 w-10 text-right">{ua.progress}%{diffBadge(ua.progress, cmp?.progress)}</span>
                          </div>
                        </td>
                        <td className="text-center py-3 px-2 font-semibold text-blue-600">{ua.periodRdv}{diffBadge(ua.periodRdv, cmp?.periodRdv)}</td>
                        <td className="text-center py-3 px-2"><span className={`font-semibold ${ua.periodRdvTaken > 0 ? 'text-purple-600' : 'text-gray-400'}`}>{ua.periodRdvTaken}</span></td>
                        <td className="text-center py-3 px-2">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${ua.responseRate >= 60 ? 'bg-green-100 text-green-700' : ua.responseRate >= 30 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{ua.responseRate}%{diffBadge(ua.responseRate, cmp?.responseRate)}</span>
                        </td>
                        <td className="text-center py-3 px-2 text-gray-600 text-xs">{formatDuration(ua.avgDuration)}</td>
                        <td className="text-center py-3 px-2 font-semibold">{ua.totalProspects}<span className="text-[10px] text-gray-400 ml-0.5">({ua.activeProspects})</span></td>
                        <td className="text-center py-3 px-2"><span className={`font-semibold ${ua.wonProspects > 0 ? 'text-green-600' : 'text-gray-400'}`}>{ua.wonProspects}{diffBadge(ua.wonProspects, cmp?.wonProspects)}</span></td>
                      </tr>
                    );
                  })}
                  {perfUserActivities.length === 0 && <tr><td colSpan={11} className="py-6 text-center text-gray-400 text-sm">Aucun membre</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Historique mensuel */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 text-sm sm:text-base flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-gray-400" />
                Historique mensuel
              </h3>
              <div className="flex items-center gap-2">
                <button className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600" onClick={() => setMonthOffset(prev => prev - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-medium text-gray-700 min-w-[140px] text-center capitalize">{monthLabel}</span>
                <button className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-30" onClick={() => setMonthOffset(prev => prev + 1)} disabled={monthOffset >= 0}>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-green-700">{monthlyHistory.totalCalls}</p>
                <p className="text-[10px] text-green-600 mt-0.5">Appels total</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-amber-700">{monthlyHistory.totalProspects}</p>
                <p className="text-[10px] text-amber-600 mt-0.5">Prospects crees</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-blue-700">{monthlyHistory.totalRdv}</p>
                <p className="text-[10px] text-blue-600 mt-0.5">RDV total</p>
              </div>
              <div className="bg-purple-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-purple-700">{monthlyHistory.answered}</p>
                <p className="text-[10px] text-purple-600 mt-0.5">Repondus</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-gray-700">{monthlyHistory.responseRate}%</p>
                <p className="text-[10px] text-gray-600 mt-0.5">Taux reponse</p>
              </div>
            </div>

            <div className="h-48 mb-4">
              <Bar data={weeklyChartData} options={{
                responsive: true, maintainAspectRatio: false,
                scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
                plugins: { legend: { position: 'top', labels: { boxWidth: 12, padding: 8, font: { size: 10 } } } },
              }} />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-2 font-medium text-gray-500">Semaine</th>
                    <th className="text-center py-2 px-2 font-medium text-gray-500">Appels</th>
                    <th className="text-center py-2 px-2 font-medium text-gray-500">Repondus</th>
                    <th className="text-center py-2 px-2 font-medium text-gray-500">Taux</th>
                    <th className="text-center py-2 px-2 font-medium text-gray-500">Prospects</th>
                    <th className="text-center py-2 px-2 font-medium text-gray-500">RDV</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyHistory.weeklyBreakdown.map((week, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-2 px-2 font-medium text-gray-700">{week.label}</td>
                      <td className="text-center py-2 px-2 font-semibold">{week.calls}</td>
                      <td className="text-center py-2 px-2 text-green-600 font-semibold">{week.answered}</td>
                      <td className="text-center py-2 px-2">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${week.responseRate >= 60 ? 'bg-green-100 text-green-700' : week.responseRate >= 30 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{week.responseRate}%</span>
                      </td>
                      <td className="text-center py-2 px-2 text-amber-600 font-semibold">{week.prospects}</td>
                      <td className="text-center py-2 px-2 text-blue-600 font-semibold">{week.rdv}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
