import {
  Users, Kanban, Phone, Calendar, Mail, Map, Building2, CalendarDays, GitBranch,
  Bell, FileText, Contact, BookOpen, Settings, Link2, Upload, ScanLine, BarChart3,
} from 'lucide-react';

// Le menu : quatre groupes, les mêmes pour tout le monde. Seul l'ordre dépend du rôle —
// son propre groupe en premier, ouvert ; les autres suivent, repliés sauf « Pour tous ».
// Les libellés sont LE vocabulaire de l'application : une page, un mot.
export interface EntreeMenu {
  to: string;
  icon: typeof Users;
  label: string;
  /** Autres adresses qui allument cette entrée (ex. /taches pour « Rappels et tâches »). */
  alias?: string[];
  /** Rôles qui ne voient pas cette entrée (ex. Statistiques, réservées aux commerciaux et admins). */
  masquePour?: string[];
}
export interface GroupeMenu {
  id: 'prospection' | 'commercial' | 'commun' | 'admin';
  titre: string;
  icon: typeof Users;
  /** Rôles pour qui ce groupe est « le sien ». */
  roles: string[];
  adminOnly?: boolean;
  entrees: EntreeMenu[];
}

const PROSPECTION: GroupeMenu = {
  id: 'prospection', titre: 'Prospection', icon: Phone, roles: ['prospection'],
  entrees: [
    { to: '/prospects', icon: Users, label: 'Prospects' },
    { to: '/pipeline', icon: Kanban, label: 'Pipeline' },
    { to: '/appels', icon: Phone, label: 'Appels' },
    { to: '/rdv', icon: Calendar, label: 'Rendez-vous' },
    { to: '/emails', icon: Mail, label: 'Emails' },
    { to: '/carte', icon: Map, label: 'Carte' },
  ],
};
const COMMERCIAL: GroupeMenu = {
  id: 'commercial', titre: 'Commercial', icon: Building2, roles: ['commercial', 'admin'],
  entrees: [
    { to: '/clients', icon: Building2, label: 'Clients' },
    { to: '/semaine', icon: CalendarDays, label: 'Semaine', alias: ['/clients/planning', '/compte-rendu', '/visites'] },
    { to: '/pipeline-cr', icon: GitBranch, label: 'Suivi des rendez-vous' },
    { to: '/tournees', icon: Map, label: 'Tournées' },
  ],
};
const COMMUN: GroupeMenu = {
  id: 'commun', titre: 'Pour tous', icon: Bell, roles: [],
  entrees: [
    { to: '/rappels', icon: Bell, label: 'Rappels et tâches', alias: ['/taches'] },
    { to: '/statistiques', icon: BarChart3, label: 'Statistiques', masquePour: ['prospection'] },
    { to: '/documents', icon: FileText, label: 'Documents' },
    { to: '/annuaire', icon: Contact, label: 'Annuaire' },
    { to: '/guide', icon: BookOpen, label: 'Guide' },
  ],
};
const ADMIN: GroupeMenu = {
  id: 'admin', titre: 'Administration', icon: Settings, roles: ['admin'], adminOnly: true,
  entrees: [
    { to: '/admin', icon: Settings, label: 'Équipe et réglages' },
    { to: '/easybeer', icon: Link2, label: 'EasyBeer' },
    { to: '/import', icon: Upload, label: 'Import / Export' },
    { to: '/sirene', icon: ScanLine, label: 'SIRENE' },
  ],
};

export function groupesDuMenu(role: string | undefined): GroupeMenu[] {
  const groupes = role === 'prospection' ? [PROSPECTION, COMMERCIAL, COMMUN]
    : role === 'admin' ? [COMMERCIAL, PROSPECTION, COMMUN, ADMIN]
    : [COMMERCIAL, PROSPECTION, COMMUN];
  return groupes.map(g => ({ ...g, entrees: g.entrees.filter(e => !e.masquePour || !role || !e.masquePour.includes(role)) }));
}

/** La page Statistiques n'est pas pour la prospection : les chiffres de vente ne la concernent pas. */
export function peutVoirLesStatistiques(role: string | undefined): boolean {
  return role !== 'prospection';
}

export function groupesOuvertsParDefaut(role: string | undefined, prospection = false): Set<string> {
  if (role === 'prospection') return new Set(['prospection', 'commun']);
  if (role === 'admin') return new Set(['commercial', 'prospection', 'commun', 'admin']);
  // Un commercial qui fait aussi de la prospection a ses deux groupes ouverts.
  return new Set(prospection ? ['commercial', 'prospection', 'commun'] : ['commercial', 'commun']);
}
