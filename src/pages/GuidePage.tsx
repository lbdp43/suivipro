import { useState } from 'react';
import {
  BookOpen, LayoutDashboard, Kanban, Users, Phone, Calendar, Bell, Mail, Map,
  Upload, FileText, Tag, Building2, MapPin, ClipboardCheck, ListTodo, Activity,
  CheckCheck, ChevronDown, LogIn, Shield, UserCheck, MousePointer, Zap,
  Settings, Search, Filter, ArrowRight, Target, TrendingUp, Star,
  BarChart3, Eye, Layers, GitBranch, Globe, Database, FolderOpen,
  MessageSquare, Repeat, Clock, AlertTriangle, Download, RefreshCw,
} from 'lucide-react';

type RoleId = 'all' | 'commercial' | 'admin' | 'prospection';

const ROLE_FILTERS: { id: RoleId; label: string; color: string; activeColor: string; icon: typeof Users }[] = [
  { id: 'all', label: 'Tous', color: 'bg-gray-100 text-gray-700', activeColor: 'bg-gray-700 text-white', icon: Users },
  { id: 'commercial', label: 'Commercial', color: 'bg-emerald-50 text-emerald-700', activeColor: 'bg-emerald-600 text-white', icon: UserCheck },
  { id: 'admin', label: 'Admin', color: 'bg-blue-50 text-blue-700', activeColor: 'bg-blue-600 text-white', icon: Shield },
  { id: 'prospection', label: 'Prospection', color: 'bg-purple-50 text-purple-700', activeColor: 'bg-purple-600 text-white', icon: Eye },
];

interface ContentItem {
  subtitle?: string;
  text?: string;
  list?: string[];
}

interface GuideSection {
  id: string;
  title: string;
  icon: typeof LayoutDashboard;
  iconColor: string;
  iconBg: string;
  roles: RoleId[];
  content: ContentItem[];
}

const sections: GuideSection[] = [
  {
    id: 'premiers-pas',
    title: 'Connexion et premiers pas',
    icon: LogIn,
    iconColor: 'text-brewery-600',
    iconBg: 'bg-brewery-100',
    roles: ['all'],
    content: [
      {
        subtitle: 'Se connecter',
        text: 'Ouvrez l\'application et saisissez votre **identifiant** (votre prenom) et votre **mot de passe**. Cliquez sur "Se connecter" pour acceder a votre espace.',
      },
      {
        subtitle: 'Premiere connexion',
        text: 'Lors de votre premiere connexion, l\'application vous demandera de **changer votre mot de passe**. Saisissez un nouveau mot de passe (minimum 4 caracteres) et confirmez-le.',
      },
      {
        subtitle: 'Les 3 roles de l\'application',
        text: 'Chaque utilisateur a un role qui determine ce qu\'il peut faire :',
        list: [
          '**Commercial** : Gere ses prospects et clients, passe des appels, prend des rendez-vous, planifie ses tournees.',
          '**Admin** : Supervise tous les commerciaux, voit toutes les donnees, configure le systeme et les integrations.',
          '**Prospection** : Consulte en lecture seule l\'ensemble des plannings et clients pour coordonner l\'activite.',
        ],
      },
      {
        subtitle: 'Navigation',
        text: 'La barre laterale a gauche est organisee en sous-dossiers depliables :',
        list: [
          '**Accueil** : Tableau de bord avec KPIs et resume d\'activite.',
          '**Taches** : Gestion des taches (a faire, en cours, terminees).',
          '**Rappels** : Rappels avec badge urgent.',
          '**Prospects** : Pipeline commercial et historique des appels.',
          '**Clients** : Liste des clients et planning semaine.',
          '**Visites et CR** : Visites clients, tournees, comptes-rendus.',
          '**Guide / Documents / Emails** : Aide, fichiers partages, modeles.',
          '**Administration** : Import/export et SIRENE (admin).',
        ],
      },
      {
        subtitle: 'Notifications',
        text: 'La **cloche** en haut a droite affiche vos notifications non lues.',
      },
    ],
  },
  {
    id: 'dashboard',
    title: 'Tableau de bord',
    icon: LayoutDashboard,
    iconColor: 'text-indigo-600',
    iconBg: 'bg-indigo-100',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Indicateurs (KPIs)',
        text: 'En haut de page, vos metriques principales :',
        list: [
          '**CA ce mois** : Chiffre d\'affaires et nombre de commandes.',
          '**Appels** : Aujourd\'hui, cette semaine, ce mois.',
          '**RDV** : Rendez-vous cette semaine et ce mois.',
          '**Taux de reponse** : Pourcentage d\'appels decroches.',
          '**Duree moyenne** : Temps moyen de vos appels.',
        ],
      },
      {
        subtitle: 'Classement equipe',
        text: 'Comparez les performances par appels, RDV, prospects, CA, visites et couverture. La **periode** est configurable (semaine, mois).',
      },
      {
        subtitle: 'Analyse des resultats RDV',
        text: 'Graphiques detailles des resultats de vos rendez-vous par semaine (Client, Mail envoye, Commande plus tard, A relancer, Pas interesse). Filtrable par commercial et navigable par mois.',
      },
      {
        subtitle: 'Vue Admin vs Commercial',
        text: 'Les **administrateurs** voient les statistiques de toute l\'equipe. Les **commerciaux** voient uniquement leurs propres donnees.',
      },
    ],
  },
  {
    id: 'pipeline',
    title: 'Pipeline commercial',
    icon: Kanban,
    iconColor: 'text-violet-600',
    iconBg: 'bg-violet-100',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Tableau Kanban',
        text: 'Le pipeline visualise vos prospects par etape de progression. Chaque prospect est une **carte deplacable** d\'une colonne a l\'autre par glisser-deposer.',
      },
      {
        subtitle: 'Etapes',
        list: [
          '**Importe Datagouv** : Import automatique depuis SIRENE.',
          '**Nouveau** : Prospect tout juste ajoute.',
          '**A contacter** : A contacter en priorite.',
          '**Contacte** : Premier contact etabli.',
          '**Proposition** : Offre commerciale presentee.',
          '**Negociation** : Conditions en discussion.',
          '**RDV** : Rendez-vous planifie.',
          '**Gagne** : Prospect devenu client.',
          '**Perdu / Ne pas contacter** : Clos.',
        ],
      },
      {
        subtitle: 'Personnalisation et filtres',
        text: 'Cliquez sur l\'**engrenage** pour creer, renommer, reordonner et supprimer des colonnes. Filtrez par **secteur**, **code postal**, **commercial** ou **avec RDV**.',
      },
    ],
  },
  {
    id: 'prospects',
    title: 'Gestion des prospects',
    icon: Users,
    iconColor: 'text-cyan-600',
    iconBg: 'bg-cyan-100',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Fiche prospect',
        text: 'Chaque prospect contient : nom, adresse, contact, telephone, email, historique des interactions, RDV, rappels, tags, score (1-5) et notes.',
      },
      {
        subtitle: 'Creer un prospect',
        text: 'Cliquez sur **"+ Nouveau prospect"**. Seul le **nom d\'etablissement** est obligatoire. Le type et l\'etape sont detectes automatiquement.',
      },
      {
        subtitle: 'Recherche et filtres',
        text: 'Recherchez par **nom, adresse ou telephone**. Filtrez par etape pipeline, secteur, tags ou commercial.',
      },
    ],
  },
  {
    id: 'appels',
    title: 'Appels telephoniques',
    icon: Phone,
    iconColor: 'text-green-600',
    iconBg: 'bg-green-100',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Resultats d\'appel',
        list: [
          '**Repondu** : Echange effectue.',
          '**Pas de reponse** : Personne n\'a repondu.',
          '**Messagerie** : Message vocal laisse.',
          '**Injoignable** : Numero ne fonctionne pas.',
        ],
      },
      {
        subtitle: 'Statistiques',
        text: 'En haut de page : appels aujourd\'hui, cette semaine, taux de reponse global et hebdomadaire.',
      },
      {
        subtitle: 'Click-to-call',
        text: 'Sur mobile, cliquez sur le **numero** pour appeler directement. L\'application propose ensuite d\'enregistrer le resultat.',
      },
    ],
  },
  {
    id: 'rdv',
    title: 'Rendez-vous',
    icon: Calendar,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-100',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Types d\'evenements',
        list: [
          '**RDV** : Rendez-vous commercial.',
          '**Reunion** : Reunion interne/externe.',
          '**Boutique / Depot / Marche / Autre**.',
        ],
      },
      {
        subtitle: 'Statuts',
        list: [
          '**Planifie** → **Confirme** → **Termine** (ou **Annule**).',
        ],
      },
      {
        subtitle: 'Vues d\'affichage',
        text: 'Trois vues : **Liste** (filtres), **Agenda** (calendrier + Google Calendar), **Planning** (creneaux semaine).',
      },
      {
        subtitle: 'Compte-rendu',
        text: 'Apres un RDV termine, enregistrez le resultat :',
        list: [
          '**Client** → passage en "Gagne".',
          '**Mail envoye** → passage en "Negociation".',
          '**Commande plus tard / A relancer** → rappel automatique.',
          '**RDV decale** → nouvelle date.',
          '**Pas interesse** → passage en "Perdu".',
        ],
      },
      {
        subtitle: 'Recurrence et conflits',
        text: 'Creez des RDV **recurrents hebdomadaires** avec date de fin. L\'application detecte les **conflits horaires** automatiquement.',
      },
      {
        subtitle: 'Export calendrier',
        text: 'Exportez vos RDV au format **ICS** (Google Agenda, Outlook, Apple Calendar).',
      },
    ],
  },
  {
    id: 'rappels',
    title: 'Rappels',
    icon: Bell,
    iconColor: 'text-amber-600',
    iconBg: 'bg-amber-100',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Organisation',
        list: [
          '**Aujourd\'hui** : Rappels urgents (fond rouge).',
          '**A venir** : Programmes pour les prochains jours.',
          '**En retard** : Date depassee, a traiter en priorite.',
          '**Termines** : Historique.',
        ],
      },
      {
        subtitle: 'Actions',
        text: 'Pour chaque rappel : **Terminer**, **Reporter**, **Modifier** ou **Supprimer**. Le **badge rouge** dans la navigation indique vos rappels urgents.',
      },
    ],
  },
  {
    id: 'emails',
    title: 'Emails et modeles',
    icon: Mail,
    iconColor: 'text-rose-600',
    iconBg: 'bg-rose-100',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Modeles',
        text: 'Creez des **modeles d\'emails** reutilisables (presentation, suivi, relance). Ils supportent des **variables dynamiques** remplacees par les donnees du prospect.',
      },
      {
        subtitle: 'Utilisation',
        text: 'Depuis la fiche prospect ou le pipeline, cliquez sur l\'icone **email**, selectionnez un modele et copiez le contenu.',
      },
    ],
  },
  {
    id: 'clients',
    title: 'Gestion des clients',
    icon: Building2,
    iconColor: 'text-emerald-600',
    iconBg: 'bg-emerald-100',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Fiche client',
        text: 'Chaque client contient :',
        list: [
          '**Nom, adresse, contact, telephone, email.**',
          '**Type** (bar, restaurant, cave, etc.) et **tournee**.',
          '**Commercial** responsable.',
          '**Statut** : ACTIF, INACTIF ou SUSPENDU.',
          '**Frequence de visite** et **prochaine visite** auto-calculee.',
        ],
      },
      {
        subtitle: 'Indicateurs de visite',
        list: [
          '**En retard** (rouge) : Visite depassee, prioritaire.',
          '**Aujourd\'hui** (vert) : Visite prevue ce jour.',
          '**A venir** (bleu) : Visite programmee.',
          '**Pas de recurrence** (gris) : Aucune frequence configuree.',
        ],
      },
      {
        subtitle: 'Filtres avances',
        text: 'Filtrez par **type**, **statut**, **statut de visite**, **commercial**, **tournee**, **sans type** ou **sans tournee**.',
      },
      {
        subtitle: 'Actions',
        list: [
          '**Click-to-call / Click-to-email / Navigation GPS.**',
          '**Enregistrer une interaction** (visite, appel, email).',
          '**Planifier un RDV** ou **creer une tache**.',
          '**Export ICS** vers le calendrier.',
        ],
      },
      {
        subtitle: 'Actions de masse',
        text: 'Selectionnez plusieurs clients pour changer le commercial, la tournee, la recurrence, desactiver ou reactiver en lot.',
      },
    ],
  },
  {
    id: 'planning-clients',
    title: 'Planning semaine',
    icon: Layers,
    iconColor: 'text-teal-600',
    iconBg: 'bg-teal-100',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Vue planning',
        text: 'Clients organises **par jour** selon les tournees. Chaque jour affiche le nombre de RDV. Naviguez entre les semaines avec les fleches.',
      },
      {
        subtitle: 'Clients en retard',
        text: 'Section speciale repliable en haut avec badge rouge pour les retards.',
      },
      {
        subtitle: 'Modale client',
        text: 'Cliquez sur un client pour ouvrir sa fiche detaillee avec boutons **modifier, actif/inactif, supprimer**.',
      },
    ],
  },
  {
    id: 'tournees',
    title: 'Tournees',
    icon: MapPin,
    iconColor: 'text-orange-600',
    iconBg: 'bg-orange-100',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Configuration',
        text: 'Assignez des **zones a chaque jour** de la semaine (ex: Lundi = "Zone Nord").',
      },
      {
        subtitle: 'Recurrence',
        list: [
          '**Toutes les semaines** : Meme tournee chaque semaine.',
          '**Semaines paires** : Uniquement semaines paires.',
          '**Semaines impaires** : Uniquement semaines impaires.',
        ],
      },
      {
        subtitle: 'Zones prioritaires',
        text: 'Definissez des **zones de prospection prioritaires** par jour, en plus des tournees clients.',
      },
    ],
  },
  {
    id: 'visites',
    title: 'Visites clients',
    icon: ClipboardCheck,
    iconColor: 'text-lime-600',
    iconBg: 'bg-lime-100',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Vue des visites',
        text: 'Clients a visiter cette semaine, organises **par jour** selon les tournees. Les clients en retard apparaissent en haut (fond rouge).',
      },
      {
        subtitle: 'Enregistrer une visite',
        text: 'Cliquez sur un client : enregistrez une **visite**, un **appel**, un **RDV** ou un **email**. La prochaine visite est recalculee automatiquement.',
      },
      {
        subtitle: 'Vue equipe (Admin)',
        text: 'Filtrez par commercial pour suivre l\'activite terrain de toute l\'equipe.',
      },
    ],
  },
  {
    id: 'compte-rendu',
    title: 'Rapport Journalier',
    icon: CheckCheck,
    iconColor: 'text-sky-600',
    iconBg: 'bg-sky-100',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Vues',
        list: [
          '**Jour** : Bilan de la journee.',
          '**Semaine** : Resume par jour.',
          '**Mois** : Tendances mensuelles.',
          '**Periode** : Plage personnalisee.',
        ],
      },
      {
        subtitle: 'Contenu',
        text: 'Toutes les interactions (visites, appels, RDV, taches). Resultats interactifs avec statistiques par type. Regroupement par commercial en vue equipe.',
      },
      {
        subtitle: 'Detection de conflits',
        text: 'Les conflits horaires entre RDV sont signales visuellement.',
      },
    ],
  },
  {
    id: 'pipeline-cr',
    title: 'Pipeline CR',
    icon: GitBranch,
    iconColor: 'text-fuchsia-600',
    iconBg: 'bg-fuchsia-100',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Principe',
        text: 'Tableau **Kanban** dedie au suivi des resultats de RDV. Colonnes : RDV en attente, RDV decale, Mail envoye, Commande plus tard, A relancer, Client gagne, Pas interesse.',
      },
      {
        subtitle: 'Actions rapides',
        text: 'Depuis une carte : **appeler**, **envoyer un email** ou **planifier un nouveau RDV**. Colonnes personnalisables.',
      },
    ],
  },
  {
    id: 'taches',
    title: 'Taches',
    icon: ListTodo,
    iconColor: 'text-pink-600',
    iconBg: 'bg-pink-100',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Statuts et priorites',
        text: 'Statuts : **A faire** → **En cours** → **Terminee**. Priorites : **Haute**, **Moyenne**, **Basse**.',
      },
      {
        subtitle: 'Categories',
        text: 'General, Tournee/Visite, Prospection, Administratif, Livraison, Evenement, Autre.',
      },
      {
        subtitle: 'Filtres',
        text: 'Par **statut**, **priorite**, **commercial**, **client** ou via **recherche** par titre.',
      },
    ],
  },
  {
    id: 'carte',
    title: 'Carte interactive',
    icon: Map,
    iconColor: 'text-emerald-600',
    iconBg: 'bg-emerald-100',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Vue carte',
        text: 'Prospects et clients sur une carte **OpenStreetMap** interactive avec **clustering** automatique.',
      },
      {
        subtitle: 'Filtres',
        text: 'Par type d\'etablissement, etape pipeline, tags, secteur, region, departement, code postal, commercial. Boutons **bascule** prospects/clients.',
      },
      {
        subtitle: 'Panneau RDV',
        text: 'A droite : **RDV de la semaine** avec navigation, filtre commercial et confirmation directe.',
      },
    ],
  },
  {
    id: 'documents',
    title: 'Documents',
    icon: FileText,
    iconColor: 'text-slate-600',
    iconBg: 'bg-slate-100',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Categories',
        list: [
          '**Bar/Restaurant** : Tarifs et fiches.',
          '**Prix CE** : Grilles comites d\'entreprise.',
          '**Cave/Epicerie** : Documents cavistes.',
          '**Grand Public** : Supports vente directe.',
          '**Autre** : Documents divers.',
        ],
      },
      {
        subtitle: 'Gestion (Admin)',
        text: 'Les administrateurs peuvent **uploader**, **categoriser** et **supprimer** des documents (PDF, images, tableurs).',
      },
    ],
  },
  {
    id: 'annuaire',
    title: 'Annuaire',
    icon: FolderOpen,
    iconColor: 'text-yellow-600',
    iconBg: 'bg-yellow-100',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Types d\'entites',
        text: 'Affiche les types d\'etablissements configures (bar, restaurant, cave, etc.). Les admins peuvent **creer, modifier et supprimer** des types avec icone, couleur et description.',
      },
    ],
  },
  {
    id: 'sirene',
    title: 'SIRENE / Datagouv',
    icon: Database,
    iconColor: 'text-cyan-600',
    iconBg: 'bg-cyan-100',
    roles: ['admin'],
    content: [
      {
        subtitle: 'Import automatique',
        text: 'Import d\'etablissements depuis la base nationale (data.gouv.fr). Configurez des **zones d\'import** par departement et codes NAF.',
      },
      {
        subtitle: 'Synchronisation',
        text: 'CRON hebdomadaire automatique (lundi 6h). Declenchement manuel possible. Les doublons sont detectes et filtres.',
      },
      {
        subtitle: 'Journal',
        text: 'Historique des synchronisations : date, records traites, inserts, updates, erreurs.',
      },
    ],
  },
  {
    id: 'import',
    title: 'Import / Export',
    icon: Upload,
    iconColor: 'text-emerald-600',
    iconBg: 'bg-emerald-100',
    roles: ['admin'],
    content: [
      {
        subtitle: 'Import prospects',
        text: 'Import depuis **Excel/CSV** avec detection automatique des colonnes, geocodage optionnel et detection des doublons.',
      },
      {
        subtitle: 'Import clients (EasyBeer)',
        text: 'Import en masse depuis le template EasyBeer avec **38 colonnes** reconnues. Flow multi-etapes :',
        list: [
          '**Upload** : Analyse du fichier.',
          '**Verification** : Preview avec doublons (SIRET, nom, telephone), commerciaux inconnus a creer.',
          '**Validation** : L\'admin valide ou annule l\'import apres avoir vu le resume complet.',
        ],
      },
      {
        subtitle: 'Croisement doublons',
        text: 'Comparez un fichier clients avec vos prospects existants pour detecter les doublons (nom, telephone).',
      },
      {
        subtitle: 'Export',
        text: 'Exportez vos prospects en **Excel** ou **CSV**.',
      },
    ],
  },
  {
    id: 'admin',
    title: 'Administration',
    icon: Settings,
    iconColor: 'text-gray-600',
    iconBg: 'bg-gray-200',
    roles: ['admin'],
    content: [
      {
        subtitle: 'Utilisateurs',
        text: 'Ajoutez, modifiez ou supprimez des comptes. Assignez les roles (Admin, Commercial, Prospection) et les zones actives.',
      },
      {
        subtitle: 'Statistiques globales',
        text: 'Total prospects/clients, repartition pipeline, metriques d\'appels, taux de conversion, repartition geographique.',
      },
      {
        subtitle: 'Tags',
        text: 'Creez et gerez les tags pour categoriser les prospects. Personnalisez les couleurs.',
      },
      {
        subtitle: 'Activite',
        text: 'Suivez les connexions et actions de chaque utilisateur : derniere connexion, nombre d\'actions, historique.',
      },
    ],
  },
  {
    id: 'astuces',
    title: 'Astuces et bonnes pratiques',
    icon: Zap,
    iconColor: 'text-amber-500',
    iconBg: 'bg-amber-100',
    roles: ['all'],
    content: [
      {
        subtitle: 'Raccourcis',
        list: [
          '**Click-to-call** : Cliquez sur un numero pour appeler.',
          '**Click-to-email** : Cliquez sur un email pour ecrire.',
          '**Navigation GPS** : Cliquez sur une adresse pour Google Maps.',
          '**Recherche rapide** : Barre de recherche en haut de chaque page.',
        ],
      },
      {
        subtitle: 'Bien remplir ses donnees',
        list: [
          'Toujours enregistrer le **resultat d\'un appel** (meme "pas de reponse").',
          'Remplir les **comptes-rendus de RDV** pour alimenter le pipeline.',
          'Enregistrer ses **visites** pour le calcul automatique des prochaines.',
          'Utiliser les **tags** et **notes** pour mieux retrouver ses prospects.',
        ],
      },
      {
        subtitle: 'Organiser sa semaine',
        list: [
          'Configurer ses **tournees** (zones par jour).',
          'Consulter le **planning semaine** chaque matin.',
          'Traiter les **rappels en retard** en priorite.',
          'Exporter ses **RDV** vers le calendrier.',
          'Consulter le **rapport journalier** chaque soir.',
        ],
      },
      {
        subtitle: 'Synchronisation',
        text: 'L\'application se synchronise automatiquement toutes les **30 secondes**. Les modifications de vos collegues apparaissent rapidement.',
      },
    ],
  },
];

function renderText(text: string) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-gray-800 font-semibold">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

export default function GuidePage() {
  const [roleFilter, setRoleFilter] = useState<RoleId>('all');
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const filteredSections = sections.filter(s =>
    roleFilter === 'all' ? true : s.roles.includes('all') || s.roles.includes(roleFilter)
  );

  const toggleSection = (id: string) => {
    setExpandedSection(expandedSection === id ? null : id);
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4 sm:space-y-6 fade-in">
      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="bg-brewery-100 p-2 rounded-lg">
            <BookOpen className="w-5 h-5 text-brewery-600" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Guide SuiviPro</h1>
            <p className="text-xs sm:text-sm text-gray-500">Guide complet de toutes les fonctionnalites</p>
          </div>
        </div>

        {/* Role filter */}
        <div className="flex flex-wrap gap-2 mt-4">
          {ROLE_FILTERS.map(rf => {
            const Icon = rf.icon;
            return (
              <button
                key={rf.id}
                onClick={() => setRoleFilter(rf.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  roleFilter === rf.id ? rf.activeColor : `${rf.color} hover:opacity-80`
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {rf.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table of contents */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Sommaire — {filteredSections.length} sections
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {filteredSections.map(section => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                onClick={() => {
                  setExpandedSection(section.id);
                  setTimeout(() => document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
                }}
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 text-left transition-colors group"
              >
                <div className={`${section.iconBg} p-1 rounded ${section.iconColor} group-hover:scale-110 transition-transform`}>
                  <Icon className="w-3 h-3" />
                </div>
                <span className="text-xs text-gray-700 font-medium flex-1 truncate">{section.title}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sections */}
      {filteredSections.map(section => {
        const Icon = section.icon;
        const isExpanded = expandedSection === section.id;
        const roleBadges = section.roles.includes('all') ? null : section.roles;

        return (
          <div key={section.id} id={section.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <button
              onClick={() => toggleSection(section.id)}
              className={`w-full p-4 flex items-center gap-3 transition-colors ${isExpanded ? 'bg-gray-50' : 'hover:bg-gray-50/50'}`}
            >
              <div className={`${section.iconBg} p-1.5 rounded-lg flex-shrink-0`}>
                <Icon className={`w-4 h-4 ${section.iconColor}`} />
              </div>
              <h3 className="font-semibold text-gray-900 text-sm flex-1 text-left">{section.title}</h3>
              {roleBadges && (
                <div className="flex gap-1 mr-2">
                  {roleBadges.map(role => {
                    const rf = ROLE_FILTERS.find(r => r.id === role);
                    if (!rf) return null;
                    return (
                      <span key={role} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${rf.color}`}>
                        {rf.label}
                      </span>
                    );
                  })}
                </div>
              )}
              <ChevronDown
                className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
              />
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 pt-1 space-y-3 border-t border-gray-100">
                {section.content.map((item, idx) => (
                  <div key={idx} className="pl-1">
                    {item.subtitle && (
                      <h4 className="text-xs font-semibold text-gray-800 mb-1 flex items-center gap-1.5">
                        <ArrowRight className="w-3 h-3 text-brewery-500" />
                        {item.subtitle}
                      </h4>
                    )}
                    {item.text && (
                      <p className="text-sm text-gray-600 leading-relaxed ml-[18px]">{renderText(item.text)}</p>
                    )}
                    {item.list && (
                      <ul className="mt-1.5 space-y-1 ml-[18px]">
                        {item.list.map((li, liIdx) => (
                          <li key={liIdx} className="text-sm text-gray-600 flex items-start gap-2">
                            <span className="w-1 h-1 rounded-full bg-brewery-400 mt-2 flex-shrink-0" />
                            <span className="leading-relaxed">{renderText(li)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Help footer */}
      <div className="bg-white rounded-xl border border-blue-200 p-4">
        <div className="flex items-start gap-3">
          <div className="bg-blue-100 p-1.5 rounded-lg flex-shrink-0">
            <MessageSquare className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">Besoin d'aide ?</h3>
            <p className="text-sm text-gray-600 mt-0.5">
              Contactez votre administrateur. Ce guide est accessible a tout moment depuis le menu lateral.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
