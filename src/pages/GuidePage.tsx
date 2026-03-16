import { useState } from 'react';

const ROLE_FILTERS = [
  { id: 'all', label: 'Tous', color: 'bg-gray-100 text-gray-800' },
  { id: 'commercial', label: 'Commercial', color: 'bg-emerald-100 text-emerald-800' },
  { id: 'admin', label: 'Admin', color: 'bg-blue-100 text-blue-800' },
  { id: 'prospection', label: 'Prospection', color: 'bg-purple-100 text-purple-800' }
]

interface ContentItem {
  subtitle?: string
  text?: string
  list?: string[]
}

interface GuideSection {
  id: string
  title: string
  icon: string
  roles: string[]
  content: ContentItem[]
}

const sections: GuideSection[] = [
  {
    id: 'premiers-pas',
    title: 'Connexion et premiers pas',
    icon: '🚀',
    roles: ['all'],
    content: [
      {
        subtitle: 'Se connecter',
        text: 'Ouvrez l\'application et saisissez votre **identifiant** (votre prenom) et votre **mot de passe**. Cliquez sur "Se connecter" pour acceder a votre espace.'
      },
      {
        subtitle: 'Premiere connexion',
        text: 'Lors de votre premiere connexion, l\'application vous demandera de **changer votre mot de passe**. Saisissez un nouveau mot de passe (minimum 4 caracteres) et confirmez-le. Ce mot de passe sera utilise pour toutes vos connexions futures.'
      },
      {
        subtitle: 'Les 3 roles de l\'application',
        text: 'Chaque utilisateur a un role qui determine ce qu\'il peut faire :',
        list: [
          '**Commercial** : Gere ses prospects et clients, passe des appels, prend des rendez-vous, planifie ses tournees et gere ses taches.',
          '**Admin (Administrateur)** : Supervise tous les commerciaux, voit toutes les donnees, configure le systeme, gere les utilisateurs, les imports et les integrations.',
          '**Prospection** : Consulte en lecture seule l\'ensemble des plannings, prospects et clients de tous les commerciaux pour coordonner l\'activite.'
        ]
      },
      {
        subtitle: 'Naviguer dans l\'application',
        text: 'La barre laterale a gauche vous permet d\'acceder a toutes les sections. Elle est organisee en sous-dossiers depliables :',
        list: [
          '**Accueil** : Votre tableau de bord avec les KPIs et le resume d\'activite.',
          '**Taches** : Gestion des taches a faire, en cours et terminees.',
          '**Rappels** : Vos rappels avec un badge indiquant les rappels urgents.',
          '**Prospects** : Pipeline commercial et historique des appels.',
          '**Prospects & RDV** : Rendez-vous et pipeline des comptes-rendus.',
          '**Clients** : Liste des clients et planning semaine.',
          '**Visites et CR** : Visites clients, tournees et comptes-rendus.',
          '**Guide** : Cette aide, les documents et les modeles d\'emails.',
          '**Administration** : Import/export et SIRENE (admin seulement).'
        ]
      },
      {
        subtitle: 'Notifications',
        text: 'La cloche en haut a droite affiche vos **notifications non lues** (nouveaux prospects, rappels, etc.). Un badge rouge indique le nombre de notifications. Cliquez pour les consulter et les marquer comme lues.'
      },
      {
        subtitle: 'Hub LBDP',
        text: 'Le bouton Hub en haut a droite ouvre le panneau de **communication interne**. Vous pouvez y echanger des messages avec votre equipe en temps reel.'
      }
    ]
  },
  {
    id: 'dashboard',
    title: 'Tableau de bord (Dashboard)',
    icon: '📊',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Vue d\'ensemble',
        text: 'Le Dashboard est votre page d\'accueil. Il affiche un **resume de votre activite commerciale** avec des indicateurs cles en temps reel.'
      },
      {
        subtitle: 'Indicateurs (KPIs)',
        text: 'En haut de page, vous trouvez vos metriques principales :',
        list: [
          '**Appels aujourd\'hui / cette semaine / ce mois** : Nombre d\'appels passes.',
          '**RDV cette semaine / ce mois** : Nombre de rendez-vous programmes.',
          '**Taux de conversion** : Pourcentage de prospects devenus clients.',
          '**Taux de reponse** : Pourcentage d\'appels decroches.',
          '**Duree moyenne des appels** : Temps moyen de vos appels telephoniques.'
        ]
      },
      {
        subtitle: 'Classement equipe',
        text: 'Le classement compare les performances de toute l\'equipe :',
        list: [
          '**Par appels** : Qui a passe le plus d\'appels.',
          '**Par RDV** : Qui a le plus de rendez-vous.',
          '**Par prospects** : Qui a ajoute le plus de prospects.',
          '**Par CA** : Classement par chiffre d\'affaires.',
          '**Par visites** : Nombre de visites effectuees.',
          '**Par couverture** : Taux de couverture du portefeuille client.'
        ]
      },
      {
        subtitle: 'Analyse des resultats RDV',
        text: 'Le Dashboard affiche une **analyse detaillee** des resultats de vos rendez-vous par semaine (Client, Mail envoye, Commande plus tard, A relancer, Pas interesse). Vous pouvez **filtrer par commercial** et **naviguer entre les mois**.'
      },
      {
        subtitle: 'Graphiques',
        text: 'Des graphiques visuels (camemberts, barres) vous montrent la **repartition des resultats d\'appels** et les **tendances de RDV** au fil du temps.'
      },
      {
        subtitle: 'Vue Admin vs Commercial',
        text: 'Les **administrateurs** voient les statistiques de toute l\'equipe avec des filtres par commercial. Les **commerciaux** voient uniquement leurs propres donnees.'
      }
    ]
  },
  {
    id: 'pipeline',
    title: 'Pipeline commercial',
    icon: '📋',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Principe du pipeline',
        text: 'Le pipeline est un **tableau Kanban** qui visualise vos prospects par etape de progression commerciale. Chaque prospect est une carte que vous faites avancer d\'une colonne a l\'autre.'
      },
      {
        subtitle: 'Les etapes du pipeline',
        text: 'Les etapes par defaut sont :',
        list: [
          '**Importe Datagouv** : Prospects importes automatiquement depuis la base SIRENE.',
          '**Nouveau** : Prospect tout juste ajoute dans le systeme.',
          '**A contacter** : Prospect identifie comme interessant, a contacter.',
          '**Contacte** : Un premier contact a ete etabli (appel, email).',
          '**Proposition** : Une offre commerciale a ete presentee.',
          '**Negociation** : On negocie les conditions (prix, quantites, delais).',
          '**RDV** : Un rendez-vous de degustation ou presentation est planifie.',
          '**Gagne** : Le prospect est devenu client !',
          '**Perdu** : Le prospect n\'est pas interesse.',
          '**Ne pas contacter** : Prospect qui ne souhaite plus etre contacte.'
        ]
      },
      {
        subtitle: 'Personnaliser les colonnes',
        text: 'Cliquez sur l\'icone **engrenage** pour acceder aux parametres du pipeline. Vous pouvez **creer, renommer, reordonner et supprimer** des colonnes selon votre processus commercial.'
      },
      {
        subtitle: 'Deplacer un prospect',
        text: 'Faites **glisser-deposer** une carte d\'une colonne a l\'autre pour faire progresser un prospect. Les changements sont sauvegardes automatiquement.'
      },
      {
        subtitle: 'Filtrer le pipeline',
        text: 'Utilisez les filtres en haut pour affiner l\'affichage :',
        list: [
          '**Par secteur** : Filtrer par zone geographique.',
          '**Par code postal / departement** : Zoom geographique.',
          '**Par commercial** : Voir uniquement les prospects d\'un commercial.',
          '**Avec RDV** : Afficher uniquement les prospects avec un RDV planifie.'
        ]
      },
      {
        subtitle: 'Actions rapides',
        text: 'Depuis une carte prospect, vous pouvez ajouter des **notes rapides**, envoyer un **email depuis un modele**, ou consulter les **tags** du prospect.'
      }
    ]
  },
  {
    id: 'prospects',
    title: 'Gestion des prospects',
    icon: '👥',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'La page Prospects',
        text: 'La page Prospects affiche la **liste complete** de vos prospects avec recherche et filtres avances. Chaque prospect est une carte avec ses informations essentielles.'
      },
      {
        subtitle: 'Creer un prospect',
        text: 'Cliquez sur **"+ Nouveau prospect"** pour ajouter un prospect. Renseignez au minimum le **nom d\'etablissement**, puis ajoutez les informations complementaires : adresse, telephone, email, type d\'activite, secteur, score, etc.'
      },
      {
        subtitle: 'Fiche prospect',
        text: 'Cliquez sur un prospect pour ouvrir sa fiche detaillee. Vous y trouverez :',
        list: [
          '**Informations generales** : Nom, adresse, contact, telephone, email.',
          '**Historique des interactions** : Appels, emails, visites passes.',
          '**Rendez-vous** : Liste des RDV passes et a venir.',
          '**Rappels** : Rappels programmes pour ce prospect.',
          '**Tags** : Etiquettes pour categoriser (bar, restaurant, cave, etc.).',
          '**Score** : Note de 1 a 5 pour evaluer le potentiel.',
          '**Notes** : Zone de texte libre pour vos observations.'
        ]
      },
      {
        subtitle: 'Recherche et filtres',
        text: 'Utilisez la barre de recherche pour trouver un prospect par **nom, adresse ou telephone**. Les filtres permettent de trier par etape pipeline, secteur, code postal, tags, ou commercial assigne.'
      },
      {
        subtitle: 'Import et export',
        text: 'Les **administrateurs** peuvent importer des prospects depuis un fichier Excel/CSV ou depuis la base SIRENE. L\'export permet de telecharger toute la base en CSV.'
      }
    ]
  },
  {
    id: 'appels',
    title: 'Appels telephoniques',
    icon: '📞',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Enregistrer un appel',
        text: 'Depuis la fiche d\'un prospect ou la page Appels, cliquez sur **"Nouvel appel"**. Selectionnez le prospect, indiquez le **resultat** et ajoutez des **notes**.'
      },
      {
        subtitle: 'Resultats d\'appel',
        text: 'Chaque appel est enregistre avec un resultat :',
        list: [
          '**Repondu** : Le prospect a decroche et un echange a eu lieu.',
          '**Pas de reponse** : Personne n\'a repondu au telephone.',
          '**Messagerie** : Un message vocal a ete laisse sur le repondeur.',
          '**Injoignable** : Le numero ne fonctionne pas ou est injoignable.'
        ]
      },
      {
        subtitle: 'Statistiques d\'appels',
        text: 'En haut de la page, consultez vos metriques :',
        list: [
          '**Appels aujourd\'hui** : Nombre d\'appels passes dans la journee.',
          '**Appels cette semaine** : Total de la semaine en cours.',
          '**Taux de reponse global** : Pourcentage d\'appels decroches sur l\'ensemble.',
          '**Taux de reponse semaine** : Pourcentage pour la semaine courante.'
        ]
      },
      {
        subtitle: 'Historique',
        text: 'L\'historique chronologique affiche tous vos appels avec pagination. Vous pouvez **filtrer par resultat** (repondu, pas de reponse, etc.) et **rechercher** par nom de prospect ou notes.'
      },
      {
        subtitle: 'Click-to-call',
        text: 'Sur mobile, cliquez directement sur le **numero de telephone** d\'un prospect pour lancer l\'appel. L\'application vous proposera ensuite d\'enregistrer le resultat.'
      }
    ]
  },
  {
    id: 'rdv',
    title: 'Rendez-vous (RDV)',
    icon: '📅',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Planifier un RDV',
        text: 'Depuis la page RDV ou la fiche d\'un prospect, cliquez sur **"+ Nouveau RDV"**. Renseignez le **prospect ou client**, la **date et l\'heure**, le **lieu**, le **type d\'evenement** et les **notes**.'
      },
      {
        subtitle: 'Types d\'evenements',
        text: 'Vous pouvez creer differents types d\'evenements :',
        list: [
          '**RDV** : Rendez-vous commercial classique.',
          '**Reunion** : Reunion interne ou externe.',
          '**Boutique** : Evenement en boutique.',
          '**Depot** : Livraison ou depot.',
          '**Marche** : Presence sur un marche.',
          '**Autre** : Tout autre type d\'evenement.'
        ]
      },
      {
        subtitle: 'Statuts de RDV',
        text: 'Chaque RDV passe par differents statuts :',
        list: [
          '**Planifie** : Le RDV est programme mais pas encore confirme.',
          '**Confirme** : Le prospect a confirme sa disponibilite.',
          '**Termine** : Le RDV a eu lieu, il faut remplir le compte-rendu.',
          '**Annule** : Le RDV a ete annule.'
        ]
      },
      {
        subtitle: 'Vues d\'affichage',
        text: 'Trois vues sont disponibles :',
        list: [
          '**Liste** : Tous les RDV en liste simple avec filtres.',
          '**Agenda** : Vue calendrier avec Google Calendar integre.',
          '**Planning** : Vue semaine avec les creneaux horaires.'
        ]
      },
      {
        subtitle: 'Compte-rendu de RDV',
        text: 'Apres un RDV termine, cliquez sur **"Compte-rendu"** pour enregistrer le resultat :',
        list: [
          '**Client** : Le prospect est devenu client ! Il passe automatiquement en "Gagne".',
          '**Mail envoye** : Un email de suivi a ete envoye. Passage en "Negociation".',
          '**Commande plus tard** : Le prospect commandera plus tard. Passage en "Proposition".',
          '**A relancer** : Il faut relancer le prospect. Un rappel est cree automatiquement.',
          '**RDV decale** : Le RDV est repousse a une nouvelle date.',
          '**Pas interesse** : Le prospect n\'est pas interesse. Passage en "Perdu".'
        ]
      },
      {
        subtitle: 'Recurrence',
        text: 'Vous pouvez creer des RDV **recurrents hebdomadaires**. Definissez une date de fin pour la recurrence. Utile pour les visites regulieres chez les clients.'
      },
      {
        subtitle: 'Detection de conflits',
        text: 'L\'application detecte automatiquement les **conflits horaires** et vous alerte si deux RDV se chevauchent.'
      },
      {
        subtitle: 'Export calendrier',
        text: 'Exportez vos RDV au format **ICS** pour les importer dans Google Agenda, Outlook ou Apple Calendar. Vous pouvez exporter un seul RDV ou tous les RDV de la semaine.'
      }
    ]
  },
  {
    id: 'rappels',
    title: 'Rappels',
    icon: '🔔',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Creer un rappel',
        text: 'Cliquez sur **"+ Nouveau rappel"** pour programmer un rappel lie a un prospect. Indiquez la **date**, l\'**heure** et le **message** du rappel.'
      },
      {
        subtitle: 'Organisation des rappels',
        text: 'Les rappels sont organises en 4 categories :',
        list: [
          '**Aujourd\'hui** : Rappels urgents pour la journee en cours (fond rouge).',
          '**A venir** : Rappels programmes pour les prochains jours.',
          '**En retard** : Rappels dont la date est depassee (a traiter en priorite).',
          '**Termines** : Historique des rappels deja traites.'
        ]
      },
      {
        subtitle: 'Actions sur un rappel',
        text: 'Pour chaque rappel, vous pouvez :',
        list: [
          '**Terminer** : Marquer le rappel comme fait.',
          '**Reporter** : Repousser la date du rappel.',
          '**Modifier** : Changer le message ou la date.',
          '**Supprimer** : Effacer definitivement le rappel.'
        ]
      },
      {
        subtitle: 'Badge dans la navigation',
        text: 'Un **badge rouge** sur l\'icone Rappels dans la barre laterale indique le nombre de rappels urgents (aujourd\'hui + en retard). Ce badge ne compte que **vos propres rappels**.'
      }
    ]
  },
  {
    id: 'emails',
    title: 'Emails et modeles',
    icon: '✉️',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Modeles d\'emails',
        text: 'La page Emails permet de creer et gerer des **modeles d\'emails** reutilisables. Chaque modele a un **nom**, un **type** (presentation, suivi, relance, etc.) et un **contenu**.'
      },
      {
        subtitle: 'Utiliser un modele',
        text: 'Depuis la fiche d\'un prospect ou le pipeline, cliquez sur l\'icone **email**. Selectionnez un modele, personnalisez-le si besoin, puis **copiez le contenu** pour l\'envoyer depuis votre messagerie.'
      },
      {
        subtitle: 'Variables dynamiques',
        text: 'Les modeles supportent des **variables** qui sont automatiquement remplacees par les donnees du prospect (nom, prenom, etc.).'
      },
      {
        subtitle: 'Gestion des modeles',
        text: 'Vous pouvez **creer**, **modifier**, **dupliquer** et **supprimer** des modeles. Les modeles sont partages entre tous les utilisateurs.'
      }
    ]
  },
  {
    id: 'clients',
    title: 'Gestion des clients',
    icon: '🏢',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'La page Clients',
        text: 'La page Clients affiche tous vos clients actifs. Un client est un **prospect converti** apres un RDV reussi ou cree manuellement. Chaque client a une fiche detaillee avec ses informations, son historique et ses visites.'
      },
      {
        subtitle: 'Informations client',
        text: 'Chaque fiche client contient :',
        list: [
          '**Nom d\'etablissement** et type (bar, restaurant, cave, etc.).',
          '**Adresse complete** avec code postal et ville.',
          '**Contact** : Nom, telephone, email.',
          '**Commercial** responsable du client.',
          '**Tournee** : Zone geographique assignee.',
          '**Statut** : ACTIF, INACTIF ou SUSPENDU.',
          '**Frequence de visite** : Recurrence personnalisee en jours.',
          '**Prochaine visite** : Date calculee automatiquement.'
        ]
      },
      {
        subtitle: 'Statuts de visite',
        text: 'Chaque client a un indicateur de visite :',
        list: [
          '**En retard** (rouge) : La date de visite est depassee. Prioritaire.',
          '**Aujourd\'hui** (vert) : Visite prevue aujourd\'hui.',
          '**A venir** (bleu) : Visite programmee dans le futur.',
          '**Pas de recurrence** (gris) : Aucune frequence de visite configuree.',
          '**Inactif** (gris) : Client desactive.'
        ]
      },
      {
        subtitle: 'Filtres avances',
        text: 'Filtrez vos clients par :',
        list: [
          '**Type** d\'etablissement (bar, restaurant, cave, etc.).',
          '**Statut** (actif, inactif, suspendu).',
          '**Statut de visite** (en retard, aujourd\'hui, a venir).',
          '**Commercial** responsable.',
          '**Tournee** assignee.',
          '**Sans type / sans tournee** pour reperer les fiches incompletes.'
        ]
      },
      {
        subtitle: 'Actions sur un client',
        text: 'Depuis la fiche client, vous pouvez :',
        list: [
          '**Click-to-call** : Appeler directement en cliquant sur le numero.',
          '**Click-to-email** : Envoyer un email avec un modele.',
          '**Navigation GPS** : Ouvrir l\'adresse dans Google Maps.',
          '**Enregistrer une interaction** : Visite, appel, email ou autre.',
          '**Planifier un RDV** : Creer un rendez-vous pour ce client.',
          '**Creer une tache** : Associer une tache au client.',
          '**Exporter en ICS** : Ajouter le prochain RDV au calendrier.'
        ]
      },
      {
        subtitle: 'Selection multiple',
        text: 'Selectionnez plusieurs clients pour effectuer des **actions de masse** : changer le commercial, modifier la tournee, ajuster la recurrence de visite, modifier la date de prochaine visite, desactiver ou reactiver des clients.'
      }
    ]
  },
  {
    id: 'planning-clients',
    title: 'Planning semaine clients',
    icon: '📆',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Vue planning',
        text: 'Le Planning semaine affiche vos clients organises **par jour de la semaine** en fonction de leurs tournees configurees. Chaque jour montre le nombre de RDV prevus.'
      },
      {
        subtitle: 'Naviguer entre les semaines',
        text: 'Utilisez les **fleches gauche/droite** pour passer a la semaine precedente ou suivante. La semaine courante est selectionnee par defaut.'
      },
      {
        subtitle: 'Clients en retard',
        text: 'Les clients en retard de visite apparaissent dans une **section speciale repliable** en haut de la page, avec un badge rouge indiquant le nombre de jours de retard.'
      },
      {
        subtitle: 'Filtre par commercial',
        text: 'Les administrateurs peuvent filtrer par commercial pour voir le planning de chaque membre de l\'equipe. Les commerciaux voient leur propre planning par defaut.'
      },
      {
        subtitle: 'Modale client',
        text: 'Cliquez sur un client dans le planning pour ouvrir une **modale detaillee** avec ses informations, son historique et des boutons d\'action rapide (modifier, actif/inactif, supprimer).'
      }
    ]
  },
  {
    id: 'tournees',
    title: 'Tournees',
    icon: '🗺️',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Principe des tournees',
        text: 'Les tournees definissent **quels jours vous visitez quelles zones**. Chaque commercial configure ses tournees pour organiser ses visites geographiquement.'
      },
      {
        subtitle: 'Configurer vos tournees',
        text: 'Depuis la page Tournees, assignez des **zones a chaque jour de la semaine**. Par exemple : Lundi = "Zone Nord", Mardi = "Vallee du Rhone", etc. Vous pouvez selectionner des zones existantes dans la liste.'
      },
      {
        subtitle: 'Recurrence des tournees',
        text: 'Les tournees supportent differents modes de recurrence :',
        list: [
          '**Toutes les semaines** : La meme tournee chaque semaine.',
          '**Semaines paires** : Uniquement les semaines paires.',
          '**Semaines impaires** : Uniquement les semaines impaires.'
        ]
      },
      {
        subtitle: 'Zones de prospection prioritaires',
        text: 'Vous pouvez definir des **zones prioritaires de prospection** pour chaque jour, en plus des tournees clients. Ces zones s\'affichent dans le planning pour vous rappeler ou prospecter.'
      },
      {
        subtitle: 'Compteur de RDV',
        text: 'Chaque jour affiche le **nombre de RDV** prevus pour le commercial, permettant d\'equilibrer la charge de travail sur la semaine.'
      },
      {
        subtitle: 'Navigation semaine',
        text: 'Naviguez entre les semaines pour voir les tournees planifiees et les visites associees a chaque periode.'
      }
    ]
  },
  {
    id: 'visites',
    title: 'Visites clients',
    icon: '📋',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Vue des visites',
        text: 'La page Visites affiche vos clients a visiter cette semaine, organises **par jour** selon les tournees configurees. C\'est votre outil principal de suivi terrain.'
      },
      {
        subtitle: 'Clients en retard',
        text: 'Les clients dont la visite est **en retard** apparaissent en haut avec un fond rouge. Le nombre de jours de retard est indique. Ils sont prioritaires.'
      },
      {
        subtitle: 'Enregistrer une visite',
        text: 'Cliquez sur un client pour ouvrir la modale d\'action. Vous pouvez enregistrer :',
        list: [
          '**Visite** : Visite effectuee sur place.',
          '**Appel** : Appel telephonique au client.',
          '**RDV** : Planifier ou enregistrer un rendez-vous.',
          '**Email** : Envoyer un email depuis un modele.'
        ]
      },
      {
        subtitle: 'Mise a jour automatique',
        text: 'Quand vous enregistrez une visite, la **date de derniere visite** est mise a jour et la **prochaine visite** est recalculee automatiquement selon la frequence configuree.'
      },
      {
        subtitle: 'Vue equipe (Admin)',
        text: 'Les administrateurs peuvent voir les visites de **tous les commerciaux** avec un filtre par commercial. Utile pour suivre l\'activite terrain de l\'equipe.'
      },
      {
        subtitle: 'Export ICS',
        text: 'Exportez les visites de la semaine au format **ICS** pour les ajouter a votre calendrier.'
      }
    ]
  },
  {
    id: 'compte-rendu',
    title: 'Rapport Journalier / Compte-rendu',
    icon: '✅',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Vues disponibles',
        text: 'La page Compte-rendu offre plusieurs vues pour suivre vos activites :',
        list: [
          '**Vue jour** : Bilan de la journee avec toutes les interactions.',
          '**Vue semaine** : Resume de la semaine avec regroupement par jour.',
          '**Vue mois** : Vue mensuelle avec les tendances.',
          '**Vue periode** : Selectionnez une periode personnalisee.'
        ]
      },
      {
        subtitle: 'Types d\'interactions',
        text: 'Le rapport journalier recense toutes vos interactions :',
        list: [
          '**Visites** : Visites effectuees chez les clients.',
          '**Appels** : Appels telephoniques passes.',
          '**RDV** : Rendez-vous (planifies, realises, annules).',
          '**Taches** : Taches terminees dans la journee.'
        ]
      },
      {
        subtitle: 'Resultats des RDV',
        text: 'Les resultats des rendez-vous sont affiches de maniere **interactive** avec des statistiques par type de resultat. Vous pouvez voir les resultats par commercial en vue equipe.'
      },
      {
        subtitle: 'Regroupement par commercial',
        text: 'En **vue equipe** (admin), les RDV sont regroupes par commercial pour comparer les performances.'
      },
      {
        subtitle: 'Detection de conflits',
        text: 'Le rapport journalier detecte les **conflits horaires** entre vos RDV et les signale visuellement.'
      },
      {
        subtitle: 'Notes rapides',
        text: 'Ajoutez des **notes rapides** sur vos clients directement depuis le rapport journalier.'
      }
    ]
  },
  {
    id: 'pipeline-cr',
    title: 'Pipeline CR (suivi des comptes-rendus)',
    icon: '📑',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Principe',
        text: 'Le Pipeline CR est un tableau **Kanban** dedie au suivi des resultats de rendez-vous. Chaque RDV termine est place dans une colonne correspondant a son resultat.'
      },
      {
        subtitle: 'Colonnes par defaut',
        text: 'Les colonnes representent les differents resultats :',
        list: [
          '**RDV en attente** : RDV termines sans compte-rendu renseigne.',
          '**RDV decale** : Rendez-vous repousses a une nouvelle date.',
          '**Mail envoye** : Un email de suivi a ete envoye.',
          '**Commande plus tard** : Le prospect commandera plus tard.',
          '**A relancer** : Prospects a relancer.',
          '**Client gagne** : Prospect converti en client.',
          '**Pas interesse** : Prospect non interesse.'
        ]
      },
      {
        subtitle: 'Actions rapides',
        text: 'Depuis une carte, vous pouvez **appeler**, **envoyer un email**, ou **planifier un nouveau RDV** directement.'
      },
      {
        subtitle: 'Personnalisation',
        text: 'Comme le pipeline principal, les colonnes sont **personnalisables** : ajoutez, renommez ou supprimez des colonnes selon votre processus.'
      }
    ]
  },
  {
    id: 'taches',
    title: 'Gestion des taches',
    icon: '📝',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Creer une tache',
        text: 'Cliquez sur **"+ Nouvelle tache"** pour creer une tache. Renseignez le **titre**, la **description**, la **priorite**, la **categorie**, la **date d\'echeance** et l\'**assignation** (a un commercial ou un client).'
      },
      {
        subtitle: 'Statuts de tache',
        text: 'Chaque tache passe par 3 statuts :',
        list: [
          '**A faire** : Tache en attente de traitement.',
          '**En cours** : Tache commencee.',
          '**Terminee** : Tache achevee.'
        ]
      },
      {
        subtitle: 'Priorites',
        text: 'Trois niveaux de priorite :',
        list: [
          '**Haute** : Tache urgente et importante.',
          '**Moyenne** : Tache a traiter dans les delais normaux.',
          '**Basse** : Tache non urgente.'
        ]
      },
      {
        subtitle: 'Categories',
        text: 'Classez vos taches par categorie : **General**, **Tournee/Visite**, **Prospection**, **Administratif**, **Livraison**, **Evenement**, **Autre**.'
      },
      {
        subtitle: 'Filtres',
        text: 'Filtrez vos taches par **statut**, **priorite**, **commercial**, **client** ou via la **recherche** par titre/description.'
      }
    ]
  },
  {
    id: 'carte',
    title: 'Carte interactive',
    icon: '🗺️',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Vue carte',
        text: 'La carte affiche vos **prospects et clients** sur une carte interactive OpenStreetMap. Chaque marqueur est cliquable pour voir les details.'
      },
      {
        subtitle: 'Filtres geographiques',
        text: 'Filtrez les marqueurs par :',
        list: [
          '**Type d\'etablissement** : Bar, restaurant, cave, etc.',
          '**Etape pipeline** : Voir uniquement les prospects a un stade donne.',
          '**Tags** : Filtrer par etiquettes.',
          '**Secteur, region, departement, code postal** : Zoom geographique.',
          '**Commercial** : Voir les prospects/clients d\'un commercial.'
        ]
      },
      {
        subtitle: 'Prospects vs Clients',
        text: 'Des **boutons bascule** permettent d\'afficher ou masquer les prospects et/ou les clients sur la carte.'
      },
      {
        subtitle: 'Panneau RDV',
        text: 'A droite de la carte, un panneau affiche les **RDV de la semaine**. Vous pouvez naviguer entre les semaines, filtrer par commercial et confirmer des RDV directement depuis la carte.'
      },
      {
        subtitle: 'Clustering',
        text: 'Quand il y a beaucoup de marqueurs, ils sont **regroupes en clusters** avec un compteur. Zoomez pour voir les marqueurs individuels.'
      }
    ]
  },
  {
    id: 'documents',
    title: 'Documents',
    icon: '📄',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Consulter les documents',
        text: 'La page Documents liste tous les fichiers partages par l\'administration : **catalogues**, **tarifs**, **fiches techniques**, etc. Cliquez sur un document pour le **telecharger**.'
      },
      {
        subtitle: 'Categories de documents',
        text: 'Les documents sont classes par categorie :',
        list: [
          '**Bar/Restaurant** : Tarifs et fiches pour les bars et restaurants.',
          '**Prix CE** : Grilles tarifaires comites d\'entreprise.',
          '**Cave/Epicerie** : Documents pour les cavistes et epiceries fines.',
          '**Grand Public** : Supports pour la vente directe.',
          '**Autre** : Documents divers.'
        ]
      },
      {
        subtitle: 'Gestion (Admin)',
        text: 'Les administrateurs peuvent **uploader** de nouveaux documents, les **categoriser** et les **supprimer**. Les formats acceptes incluent PDF, images et tableurs.'
      }
    ]
  },
  {
    id: 'annuaire',
    title: 'Annuaire',
    icon: '📒',
    roles: ['commercial', 'admin'],
    content: [
      {
        subtitle: 'Types d\'entites',
        text: 'L\'annuaire affiche les **types d\'etablissements** configures dans l\'application (bar, restaurant, cave, epicerie, etc.). Chaque type est represente par une carte avec son icone et sa couleur.'
      },
      {
        subtitle: 'Gestion des types (Admin)',
        text: 'Les administrateurs peuvent **creer, modifier et supprimer** des types d\'entites. Chaque type a un **nom**, une **icone**, une **couleur** et une **description**.'
      },
      {
        subtitle: 'Filtrer par type',
        text: 'L\'annuaire permet de filtrer les prospects et clients par **activite** et par **commercial**, pour rapidement trouver tous les etablissements d\'un meme type.'
      }
    ]
  },
  {
    id: 'sirene',
    title: 'SIRENE / Datagouv (Import automatique)',
    icon: '🏛️',
    roles: ['admin'],
    content: [
      {
        subtitle: 'Principe',
        text: 'L\'integration SIRENE permet d\'**importer automatiquement** des etablissements depuis la base de donnees nationale des entreprises (data.gouv.fr). Les etablissements correspondant a vos criteres sont ajoutes comme prospects.'
      },
      {
        subtitle: 'Configuration des zones',
        text: 'Configurez des **zones d\'import** en selectionnant :',
        list: [
          '**Departement** : Zone geographique ciblee.',
          '**Codes NAF** : Types d\'activite recherches (restaurants, bars, etc.).',
          '**Commercial par defaut** : A qui seront assignes les nouveaux prospects.',
          '**Regles d\'import** : Criteres d\'inclusion automatique.'
        ]
      },
      {
        subtitle: 'Synchronisation automatique',
        text: 'Un **CRON hebdomadaire** (chaque lundi a 6h) synchronise automatiquement les nouvelles entreprises correspondant a vos criteres. Les doublons sont detectes et filtres.'
      },
      {
        subtitle: 'Synchronisation manuelle',
        text: 'Cliquez sur **"Lancer le CRON manuellement"** pour declencher une synchronisation immediate. Les logs affichent le nombre d\'etablissements recuperes, inseres et mis a jour.'
      },
      {
        subtitle: 'Journal de synchronisation',
        text: 'Consultez l\'historique des synchronisations avec les statistiques : date/heure, nombre de records traites, inserts, updates et erreurs eventuelles.'
      },
      {
        subtitle: 'Detection de doublons',
        text: 'L\'application detecte automatiquement les **doublons** lors de l\'import (par SIRET, nom ou adresse) et peut **enrichir** les prospects existants avec de nouvelles donnees.'
      }
    ]
  },
  {
    id: 'import',
    title: 'Import / Export',
    icon: '📥',
    roles: ['admin'],
    content: [
      {
        subtitle: 'Importer des prospects',
        text: 'Importez des prospects depuis un fichier **Excel ou CSV**. L\'application detecte automatiquement les colonnes et vous propose un **mapping** pour chaque champ.'
      },
      {
        subtitle: 'Etapes d\'import',
        text: 'Le processus d\'import se deroule en plusieurs etapes :',
        list: [
          '**Chargement du fichier** : Glissez-deposez ou selectionnez votre fichier.',
          '**Detection des colonnes** : L\'application identifie automatiquement les colonnes.',
          '**Mapping** : Associez chaque colonne a un champ prospect.',
          '**Validation** : Verifiez les donnees avant import.',
          '**Import** : Les prospects sont crees avec geocodage optionnel des adresses.'
        ]
      },
      {
        subtitle: 'Geocodage',
        text: 'Lors de l\'import, les adresses peuvent etre **geocodees automatiquement** pour obtenir les coordonnees GPS. Un indicateur de progression vous montre l\'avancement.'
      },
      {
        subtitle: 'Exporter les donnees',
        text: 'Exportez tous vos prospects en fichier **CSV/Excel** avec toutes les colonnes disponibles.'
      }
    ]
  },
  {
    id: 'admin',
    title: 'Administration',
    icon: '⚙️',
    roles: ['admin'],
    content: [
      {
        subtitle: 'Gestion des utilisateurs',
        text: 'Depuis l\'onglet Administration, gerez les comptes utilisateurs :',
        list: [
          '**Ajouter un utilisateur** : Creez un compte avec nom, email et role (Admin, Commercial, Prospection).',
          '**Modifier** : Changez le role, les zones actives ou les informations.',
          '**Desactiver** : Suspendez un compte sans le supprimer.',
          '**Supprimer** : Supprimez definitivement un compte.'
        ]
      },
      {
        subtitle: 'Statistiques globales',
        text: 'Les statistiques admin donnent une vue d\'ensemble :',
        list: [
          '**Total prospects et clients** dans le systeme.',
          '**Repartition par etape pipeline** avec graphiques.',
          '**Metriques d\'appels** (journee, semaine, mois).',
          '**Taux de conversion** et de reponse.',
          '**Repartition geographique** des prospects/clients.'
        ]
      },
      {
        subtitle: 'Gestion des tags',
        text: 'Creez, modifiez et supprimez les **tags** utilises pour categoriser les prospects. Personnalisez les **couleurs** et suivez le nombre d\'utilisations.'
      },
      {
        subtitle: 'Suivi d\'activite',
        text: 'L\'onglet **Activite** dans l\'administration permet de suivre les connexions et actions de chaque utilisateur :',
        list: [
          '**Derniere connexion** de chaque utilisateur.',
          '**Nombre d\'actions** effectuees (appels, RDV, visites).',
          '**Historique** des modifications importantes.'
        ]
      },
      {
        subtitle: 'Configuration des webhooks',
        text: 'Configurez les **webhooks** pour recevoir les donnees d\'EasyBeer (commandes, facturation) et d\'autres systemes externes.'
      }
    ]
  },
  {
    id: 'astuces',
    title: 'Astuces et bonnes pratiques',
    icon: '💡',
    roles: ['all'],
    content: [
      {
        subtitle: 'Raccourcis utiles',
        text: 'Gagnez du temps avec ces raccourcis :',
        list: [
          '**Click-to-call** : Cliquez sur un numero pour appeler directement (mobile).',
          '**Click-to-email** : Cliquez sur un email pour ouvrir votre messagerie.',
          '**Navigation GPS** : Cliquez sur une adresse pour l\'ouvrir dans Google Maps.',
          '**Recherche rapide** : Utilisez la barre de recherche en haut de chaque page.'
        ]
      },
      {
        subtitle: 'Bien remplir ses donnees',
        text: 'Pour tirer le meilleur parti de l\'application :',
        list: [
          '**Toujours enregistrer le resultat d\'un appel** : Meme un "pas de reponse" est une information precieuse.',
          '**Remplir les comptes-rendus de RDV** : Ils alimentent le pipeline et les statistiques.',
          '**Mettre a jour les visites** : Enregistrez vos visites pour calculer automatiquement les prochaines.',
          '**Utiliser les tags** : Categorisez vos prospects pour mieux les retrouver.',
          '**Ajouter des notes** : Les notes sur les fiches prospect/client aident toute l\'equipe.'
        ]
      },
      {
        subtitle: 'Organiser sa semaine',
        text: 'Pour une semaine efficace :',
        list: [
          '**Configurez vos tournees** : Definissez quelles zones visiter chaque jour.',
          '**Consultez le planning semaine** : Visualisez vos visites jour par jour.',
          '**Traitez les rappels en retard** : Commencez par les rappels urgents.',
          '**Exportez vos RDV** : Synchronisez avec votre calendrier.',
          '**Consultez le rapport journalier** : Faites le bilan chaque soir.'
        ]
      },
      {
        subtitle: 'Synchronisation multi-utilisateurs',
        text: 'L\'application se **synchronise automatiquement** toutes les 30 secondes. Si vous travaillez en equipe, les modifications de vos collegues apparaitront rapidement. En cas de conflit, la derniere modification enregistree sur le serveur l\'emporte.'
      }
    ]
  }
]

function renderText(text: string) {
  // Render bold text
  const parts = text.split(/(\*\*.*?\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-gray-800">{part.slice(2, -2)}</strong>
    }
    return part
  })
}

export default function GuidePage() {
  const [roleFilter, setRoleFilter] = useState('all')
  const [expandedSection, setExpandedSection] = useState<string | null>(null)

  const filteredSections = sections.filter(s =>
    roleFilter === 'all' ? true : s.roles.includes('all') || s.roles.includes(roleFilter)
  )

  const toggleSection = (id: string) => {
    setExpandedSection(expandedSection === id ? null : id)
  }

  const getRoleBadges = (roles: string[]) => {
    if (roles.includes('all')) return null
    return (
      <div className="flex gap-1 ml-2">
        {roles.map(role => {
          const rf = ROLE_FILTERS.find(r => r.id === role)
          if (!rf) return null
          return (
            <span key={role} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${rf.color}`}>
              {rf.label}
            </span>
          )
        })}
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-r from-brewery-600 to-brewery-700 rounded-xl p-6 text-white">
        <h1 className="text-2xl font-bold mb-1">Guide SuiviPro</h1>
        <p className="text-brewery-100 text-sm">
          Guide complet de toutes les fonctionnalites de SuiviPro, votre outil de suivi commercial.
          Filtrez par role pour voir les sections qui vous concernent.
        </p>
      </div>

      {/* Role filter */}
      <div className="flex gap-2 flex-wrap">
        {ROLE_FILTERS.map(rf => (
          <button
            key={rf.id}
            onClick={() => setRoleFilter(rf.id)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
              roleFilter === rf.id
                ? 'bg-brewery-600 text-white shadow-sm'
                : `${rf.color} hover:opacity-80`
            }`}
          >
            {rf.label}
          </button>
        ))}
      </div>

      {/* Table of contents */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="font-bold text-gray-800 mb-3">Sommaire ({filteredSections.length} sections)</h3>
        <div className="grid grid-cols-2 gap-2">
          {filteredSections.map(section => (
            <button
              key={section.id}
              onClick={() => {
                setExpandedSection(section.id)
                document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth' })
              }}
              className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 hover:bg-gray-100 text-left text-sm"
            >
              <span>{section.icon}</span>
              <span className="text-gray-700 flex-1 text-xs">{section.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Sections */}
      {filteredSections.map(section => (
        <div key={section.id} id={section.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <button
            onClick={() => toggleSection(section.id)}
            className="w-full p-4 flex items-center justify-between bg-gray-50 hover:bg-gray-100"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="text-2xl flex-shrink-0">{section.icon}</span>
              <h3 className="font-bold text-gray-800 text-sm">{section.title}</h3>
              {getRoleBadges(section.roles)}
            </div>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform flex-shrink-0 ${expandedSection === section.id ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expandedSection === section.id && (
            <div className="p-4 space-y-4 border-t border-gray-100">
              {section.content.map((item, idx) => (
                <div key={idx}>
                  {item.subtitle && (
                    <h4 className="font-semibold text-gray-700 mb-1">{item.subtitle}</h4>
                  )}
                  {item.text && (
                    <p className="text-gray-600 text-sm">{renderText(item.text)}</p>
                  )}
                  {item.list && (
                    <ul className="mt-2 space-y-1">
                      {item.list.map((li, liIdx) => (
                        <li key={liIdx} className="text-gray-600 text-sm flex items-start gap-2">
                          <span className="text-brewery-500 mt-1">•</span>
                          <span>{renderText(li)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Contact support */}
      <div className="bg-blue-50 rounded-xl border border-blue-200 p-4 mt-6">
        <h3 className="font-bold text-blue-800 flex items-center gap-2">
          <span>❓</span> Besoin d'aide ?
        </h3>
        <p className="text-blue-700 text-sm mt-1">
          Si vous avez des questions ou rencontrez un probleme, contactez votre administrateur.
          Ce guide est accessible a tout moment depuis le menu lateral de l'application.
        </p>
      </div>
    </div>
  )
}
