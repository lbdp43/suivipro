import {
  Users, Kanban, Phone, Calendar, Mail, Map, Building2, CalendarDays, GitBranch,
  Bell, FileText, Contact, BookOpen, Settings, Link2, Upload, ScanLine,
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
  if (role === 'prospection') return [PROSPECTION, COMMERCIAL, COMMUN];
  if (role === 'admin') return [COMMERCIAL, PROSPECTION, COMMUN, ADMIN];
  return [COMMERCIAL, PROSPECTION, COMMUN];
}

export function groupesOuvertsParDefaut(role: string | undefined): Set<string> {
  if (role === 'prospection') return new Set(['prospection', 'commun']);
  if (role === 'admin') return new Set(['commercial', 'prospection', 'commun', 'admin']);
  return new Set(['commercial', 'commun']);
}
