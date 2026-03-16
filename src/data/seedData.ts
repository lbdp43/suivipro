import {
  Prospect, Call, Appointment, Reminder, Commercial, Tag, EmailTemplate,
  EstablishmentType, PipelineStage, CallResult, AppointmentStatus,
} from '../types';

// ============================================
// Seed Data - Demo data for La Brasserie des Plantes
// ============================================

export function getSeedData() {
  const commerciaux: Commercial[] = [
    {
      id: 'com-1',
      prenom: 'Guillaume',
      nom: 'Commercial',
      email: 'guillaume@labrasseriedesplantes.fr',
      telephone: '06 84 44 40 44',
      role: 'admin',
      password: 'admin123',
      objectifs: { appels_semaine: 30, rdv_mois: 15, prospects_mois: 40, taux_conversion: 25 },
    },
    {
      id: 'com-2',
      prenom: 'Louis',
      nom: 'Prospection',
      email: 'louis@labrasseriedesplantes.fr',
      telephone: '06 00 00 00 01',
      role: 'commercial',
      password: 'louis123',
      objectifs: { appels_semaine: 50, rdv_mois: 10, prospects_mois: 30, taux_conversion: 20 },
    },
    {
      id: 'com-3',
      prenom: 'Lucas',
      nom: 'Prospection',
      email: 'lucas@labrasseriedesplantes.fr',
      telephone: '06 00 00 00 02',
      role: 'commercial',
      password: 'lucas123',
      objectifs: { appels_semaine: 50, rdv_mois: 10, prospects_mois: 30, taux_conversion: 20 },
    },
    {
      id: 'com-4',
      prenom: 'Alban',
      nom: 'Commercial',
      email: 'alban@labrasseriedesplantes.fr',
      telephone: '06 00 00 00 03',
      role: 'commercial',
      password: 'alban123',
      objectifs: { appels_semaine: 40, rdv_mois: 12, prospects_mois: 35, taux_conversion: 22 },
    },
    {
      id: 'com-5',
      prenom: 'Loic',
      nom: 'Commercial',
      email: 'loic@labrasseriedesplantes.fr',
      telephone: '06 00 00 00 04',
      role: 'commercial',
      password: 'loic123',
      objectifs: { appels_semaine: 40, rdv_mois: 12, prospects_mois: 35, taux_conversion: 22 },
    },
  ];

  const tags: Tag[] = [
    { id: 'tag-1', nom: 'Budget limite', couleur: '#ef4444' },
    { id: 'tag-2', nom: 'Gros potentiel', couleur: '#22c55e' },
    { id: 'tag-3', nom: 'Decideur absent', couleur: '#eab308' },
    { id: 'tag-4', nom: 'Interesse bio', couleur: '#3b82f6' },
    { id: 'tag-5', nom: 'Deja client concurrent', couleur: '#a855f7' },
    { id: 'tag-6', nom: 'Evenement prevu', couleur: '#f97316' },
    { id: 'tag-7', nom: 'A rappeler', couleur: '#6b7280' },
  ];

  const prospects: Prospect[] = [
    {
      id: 'p-1', nom_etablissement: 'Cave Martin', type_etablissement: 'cave' as EstablishmentType,
      nom_contact: 'Jean Martin', telephone: '04 71 61 12 34', email: 'contact@cavemartin.fr',
      adresse: '12 Rue du Commerce', ville: 'Saint-Etienne', code_postal: '42000', departement: 'Loire', secteur: 'Loire',
      latitude: 45.4397, longitude: 4.3872, etape_pipeline: 'gagne' as PipelineStage,
      tags: ['tag-2', 'tag-4'], commercial_id: 'com-1', notes: 'Tres interesse par la gamme bio',
      date_creation: '2026-01-10T09:00:00Z', date_modification: '2026-02-10T14:30:00Z', score: 85,
    },
    {
      id: 'p-2', nom_etablissement: 'Le Bistrot du Marche', type_etablissement: 'bar_restaurant' as EstablishmentType,
      nom_contact: 'Marie Dupont', telephone: '04 71 66 55 44', email: 'bistrot@marche.fr',
      adresse: '5 Place du Marche', ville: 'Le Puy-en-Velay', code_postal: '43000', departement: 'Haute-Loire', secteur: 'Haute-Loire',
      latitude: 45.0435, longitude: 3.8853, etape_pipeline: 'contacte' as PipelineStage,
      tags: ['tag-7'], commercial_id: 'com-1', notes: 'Rappeler apres le 15 fevrier',
      date_creation: '2026-01-15T10:00:00Z', date_modification: '2026-02-08T16:00:00Z', score: 60,
    },
    {
      id: 'p-3', nom_etablissement: 'Epicerie Fine du Velay', type_etablissement: 'epicerie' as EstablishmentType,
      nom_contact: 'Pierre Roche', telephone: '04 71 59 88 77', email: 'epicerie@velay.fr',
      adresse: '8 Rue Nationale', ville: 'Saint-Didier-en-Velay', code_postal: '43140', departement: 'Haute-Loire', secteur: 'Haute-Loire',
      latitude: 45.3003, longitude: 4.2789, etape_pipeline: 'proposition' as PipelineStage,
      tags: ['tag-2'], commercial_id: 'com-2', notes: 'Proposition envoyee, attente retour',
      date_creation: '2026-01-05T08:00:00Z', date_modification: '2026-02-12T11:00:00Z', score: 75,
    },
    {
      id: 'p-4', nom_etablissement: 'Hotel Le Regent', type_etablissement: 'hotel' as EstablishmentType,
      nom_contact: 'Sophie Blanc', telephone: '04 77 32 11 22', email: 'reception@leregent.fr',
      adresse: '22 Avenue de la Liberation', ville: 'Saint-Etienne', code_postal: '42000', departement: 'Loire', secteur: 'Loire',
      latitude: 45.4340, longitude: 4.3900, etape_pipeline: 'nouveau' as PipelineStage,
      tags: ['tag-3'], commercial_id: 'com-1', notes: 'Hotel 3 etoiles, bar interieur',
      date_creation: '2026-02-01T09:00:00Z', date_modification: '2026-02-01T09:00:00Z', score: 40,
    },
    {
      id: 'p-5', nom_etablissement: 'Carrefour City Lyon 3', type_etablissement: 'supermarche' as EstablishmentType,
      nom_contact: 'Marc Girard', telephone: '04 72 44 33 22', email: 'lyon3@carrefourcity.fr',
      adresse: '15 Cours Gambetta', ville: 'Lyon', code_postal: '69003', departement: 'Rhone', secteur: 'Rhone',
      latitude: 45.7578, longitude: 4.8532, etape_pipeline: 'a_contacter' as PipelineStage,
      tags: ['tag-1'], commercial_id: 'com-2', notes: 'GMS, volume important si accepte',
      date_creation: '2026-02-05T10:00:00Z', date_modification: '2026-02-05T10:00:00Z', score: 50,
    },
    {
      id: 'p-6', nom_etablissement: 'Le Comptoir des Saveurs', type_etablissement: 'bar_restaurant' as EstablishmentType,
      nom_contact: 'Antoine Moreau', telephone: '04 71 02 33 44', email: 'comptoir@saveurs.fr',
      adresse: '3 Rue de la Republique', ville: 'Monistrol-sur-Loire', code_postal: '43120', departement: 'Haute-Loire', secteur: 'Haute-Loire',
      latitude: 45.2936, longitude: 4.1714, etape_pipeline: 'gagne' as PipelineStage,
      tags: ['tag-2', 'tag-4'], commercial_id: 'com-1', notes: 'Client fidele, commande mensuelle',
      date_creation: '2025-11-15T09:00:00Z', date_modification: '2026-02-01T10:00:00Z', score: 95,
    },
    {
      id: 'p-7', nom_etablissement: 'Cave a Vins Saint-Just', type_etablissement: 'cave' as EstablishmentType,
      nom_contact: 'Isabelle Faure', telephone: '04 77 55 66 77', email: 'cave@saintjust.fr',
      adresse: '11 Place Saint-Just', ville: 'Lyon', code_postal: '69005', departement: 'Rhone', secteur: 'Rhone',
      latitude: 45.7600, longitude: 4.8200, etape_pipeline: 'negociation' as PipelineStage,
      tags: ['tag-5', 'tag-2'], commercial_id: 'com-2', notes: 'Actuellement chez un concurrent, interesse par nos prix',
      date_creation: '2026-01-20T14:00:00Z', date_modification: '2026-02-11T15:00:00Z', score: 70,
    },
    {
      id: 'p-8', nom_etablissement: 'Marche de Firminy', type_etablissement: 'marche' as EstablishmentType,
      nom_contact: 'Paul Bonnefoy', telephone: '06 11 22 33 44', email: 'marche@firminy.fr',
      adresse: 'Place du Breuil', ville: 'Firminy', code_postal: '42700', departement: 'Loire', secteur: 'Loire',
      latitude: 45.3891, longitude: 4.2897, etape_pipeline: 'contacte' as PipelineStage,
      tags: ['tag-6'], commercial_id: 'com-1', notes: 'Marche hebdomadaire le samedi',
      date_creation: '2026-01-25T11:00:00Z', date_modification: '2026-02-06T09:00:00Z', score: 55,
    },
    {
      id: 'p-9', nom_etablissement: 'Distrib Boissons 42', type_etablissement: 'distributeur' as EstablishmentType,
      nom_contact: 'Francois Petit', telephone: '04 77 88 99 00', email: 'contact@distrib42.fr',
      adresse: 'ZI La Plaine', ville: 'Andrezieux-Boutheon', code_postal: '42160', departement: 'Loire', secteur: 'Loire',
      latitude: 45.5280, longitude: 4.2700, etape_pipeline: 'gagne' as PipelineStage,
      tags: ['tag-2'], commercial_id: 'com-2', notes: 'Distributeur regional, gros potentiel',
      date_creation: '2026-01-18T08:00:00Z', date_modification: '2026-02-13T10:00:00Z', score: 90,
    },
    {
      id: 'p-10', nom_etablissement: 'Restaurant La Terrasse', type_etablissement: 'bar_restaurant' as EstablishmentType,
      nom_contact: 'Claire Vidal', telephone: '04 71 05 66 77', email: 'terrasse@restaurant.fr',
      adresse: '7 Boulevard Marechal Fayolle', ville: 'Le Puy-en-Velay', code_postal: '43000', departement: 'Haute-Loire', secteur: 'Haute-Loire',
      latitude: 45.0450, longitude: 3.8870, etape_pipeline: 'perdu' as PipelineStage,
      tags: ['tag-1', 'tag-5'], commercial_id: 'com-1', notes: 'Budget trop serre, reste chez son fournisseur',
      date_creation: '2025-12-10T09:00:00Z', date_modification: '2026-01-20T14:00:00Z', score: 20,
    },
    {
      id: 'p-11', nom_etablissement: 'Bio & Co Clermont', type_etablissement: 'epicerie' as EstablishmentType,
      nom_contact: 'Lucie Bernard', telephone: '04 73 44 55 66', email: 'clermont@bioandco.fr',
      adresse: '25 Rue Blatin', ville: 'Clermont-Ferrand', code_postal: '63000', departement: 'Puy-de-Dome', secteur: 'Puy-de-Dome',
      latitude: 45.7772, longitude: 3.0870, etape_pipeline: 'a_contacter' as PipelineStage,
      tags: ['tag-4'], commercial_id: 'com-2', notes: 'Magasin bio, fort interet potentiel',
      date_creation: '2026-02-10T09:00:00Z', date_modification: '2026-02-10T09:00:00Z', score: 65,
    },
    {
      id: 'p-12', nom_etablissement: 'L\'Auberge du Meygal', type_etablissement: 'hotel' as EstablishmentType,
      nom_contact: 'Henri Chanal', telephone: '04 71 65 44 33', email: 'auberge@meygal.fr',
      adresse: '1 Route du Meygal', ville: 'Les Estables', code_postal: '43150', departement: 'Haute-Loire', secteur: 'Haute-Loire',
      latitude: 44.9060, longitude: 4.1530, etape_pipeline: 'nouveau' as PipelineStage,
      tags: [], commercial_id: 'com-1', notes: 'Auberge de montagne, clientele touristique',
      date_creation: '2026-02-12T10:00:00Z', date_modification: '2026-02-12T10:00:00Z', score: 45,
    },
  ];

  const now = new Date();
  const calls: Call[] = [
    { id: 'call-1', prospect_id: 'p-1', commercial_id: 'com-2', date: '2026-02-10T10:30:00Z', duree: 180, resultat: 'repondu' as CallResult, notes: 'RDV pris pour le 18 fevrier' },
    { id: 'call-2', prospect_id: 'p-1', commercial_id: 'com-2', date: '2026-01-28T14:00:00Z', duree: 120, resultat: 'repondu' as CallResult, notes: 'Interesse, demande rappel' },
    { id: 'call-3', prospect_id: 'p-2', commercial_id: 'com-2', date: '2026-02-08T09:15:00Z', duree: 0, resultat: 'messagerie' as CallResult, notes: 'Message laisse' },
    { id: 'call-4', prospect_id: 'p-2', commercial_id: 'com-2', date: '2026-02-06T11:00:00Z', duree: 90, resultat: 'repondu' as CallResult, notes: 'Rappeler apres le 15' },
    { id: 'call-5', prospect_id: 'p-3', commercial_id: 'com-2', date: '2026-02-12T10:00:00Z', duree: 300, resultat: 'repondu' as CallResult, notes: 'Proposition envoyee par email' },
    { id: 'call-6', prospect_id: 'p-5', commercial_id: 'com-2', date: '2026-02-05T15:00:00Z', duree: 0, resultat: 'pas_de_reponse' as CallResult, notes: '' },
    { id: 'call-7', prospect_id: 'p-7', commercial_id: 'com-2', date: '2026-02-11T11:30:00Z', duree: 420, resultat: 'repondu' as CallResult, notes: 'Negociation en cours, demande tarifs volume' },
    { id: 'call-8', prospect_id: 'p-8', commercial_id: 'com-2', date: '2026-02-06T08:30:00Z', duree: 150, resultat: 'repondu' as CallResult, notes: 'Interesse pour stand au marche' },
    { id: 'call-9', prospect_id: 'p-9', commercial_id: 'com-2', date: '2026-02-13T09:00:00Z', duree: 240, resultat: 'repondu' as CallResult, notes: 'RDV pris pour presentation gamme' },
    { id: 'call-10', prospect_id: 'p-10', commercial_id: 'com-2', date: '2026-01-20T14:00:00Z', duree: 60, resultat: 'repondu' as CallResult, notes: 'Refus definitif, budget' },
    { id: 'call-11', prospect_id: 'p-6', commercial_id: 'com-2', date: '2026-02-01T10:00:00Z', duree: 180, resultat: 'repondu' as CallResult, notes: 'Commande mensuelle confirmee' },
    { id: 'call-12', prospect_id: 'p-4', commercial_id: 'com-2', date: '2026-02-14T09:00:00Z', duree: 0, resultat: 'injoignable' as CallResult, notes: 'Numero hors service' },
    // Extra calls for stats
    { id: 'call-13', prospect_id: 'p-11', commercial_id: 'com-2', date: '2026-02-13T14:00:00Z', duree: 0, resultat: 'pas_de_reponse' as CallResult, notes: '' },
    { id: 'call-14', prospect_id: 'p-12', commercial_id: 'com-2', date: '2026-02-13T16:00:00Z', duree: 0, resultat: 'messagerie' as CallResult, notes: 'Message laisse' },
  ];

  const appointments: Appointment[] = [
    {
      id: 'rdv-1', prospect_id: 'p-1', commercial_id: 'com-2',
      date: '2026-02-18', heure_debut: '10:00', heure_fin: '11:00',
      lieu: 'Cave Martin, 12 Rue du Commerce, Saint-Etienne',
      notes: 'Presentation gamme bio + degustation', statut: 'confirme' as AppointmentStatus,
    },
    {
      id: 'rdv-2', prospect_id: 'p-9', commercial_id: 'com-2',
      date: '2026-02-20', heure_debut: '14:00', heure_fin: '15:30',
      lieu: 'Distrib Boissons 42, ZI La Plaine, Andrezieux-Boutheon',
      notes: 'Presentation gamme complete + tarifs distributeur', statut: 'planifie' as AppointmentStatus,
    },
    {
      id: 'rdv-3', prospect_id: 'p-6', commercial_id: 'com-2',
      date: '2026-02-10', heure_debut: '11:00', heure_fin: '12:00',
      lieu: 'Le Comptoir des Saveurs, Monistrol-sur-Loire',
      notes: 'Suivi commande + presentation nouveautes', statut: 'termine' as AppointmentStatus,
    },
    {
      id: 'rdv-4', prospect_id: 'p-7', commercial_id: 'com-2',
      date: '2026-02-25', heure_debut: '09:30', heure_fin: '10:30',
      lieu: 'Cave a Vins Saint-Just, Lyon 5e',
      notes: 'Negociation tarifaire finale', statut: 'planifie' as AppointmentStatus,
    },
  ];

  const reminders: Reminder[] = [
    {
      id: 'rem-1', prospect_id: 'p-2', commercial_id: 'com-2',
      date: '2026-02-16', heure: '09:00',
      message: 'Rappeler Le Bistrot du Marche (Marie Dupont)', statut: 'actif',
    },
    {
      id: 'rem-2', prospect_id: 'p-5', commercial_id: 'com-2',
      date: '2026-02-17', heure: '10:00',
      message: 'Relancer Carrefour City Lyon 3', statut: 'actif',
    },
    {
      id: 'rem-3', prospect_id: 'p-8', commercial_id: 'com-2',
      date: '2026-02-14', heure: '14:00',
      message: 'Rappeler Marche de Firminy pour confirmer stand', statut: 'actif',
    },
    {
      id: 'rem-4', prospect_id: 'p-11', commercial_id: 'com-2',
      date: '2026-02-15', heure: '09:30',
      message: 'Premier appel Bio & Co Clermont', statut: 'actif',
    },
  ];

  const emailTemplates: EmailTemplate[] = [
    {
      id: 'et-1', nom: 'Premier contact – Cave / Epicerie fine', type: 'presentation',
      sujet: 'Catalogue et tarifs La Brasserie des Plantes – Liqueurs artisanales de Haute-Loire',
      corps: `Bonjour {{nom_contact}},

Suite a notre echange telephonique de ce jour, je vous transmets comme convenu notre catalogue et nos tarifs cave.

La Brasserie des Plantes est un artisan liquoriste de Saint-Didier-en-Velay (43) specialise dans l'assemblage de plantes par maceration. Contrairement aux monoproduits classiques (une verveine, une menthe, un citron...), nous creons des compositions vegetales uniques entre 15° et 50°.

Nos liqueurs phares pour votre clientele :
- L'Alchimie Vegetale (50°) – Meilleur Digestif du Monde 2025 aux World Liqueur Awards de Londres (27 plantes)
- L'Herbe des Druides (28°) – Medaille d'Or au Concours International de Lyon (verveine, serpolet, carvi)
- Le Gorgeon des Machures (30°) – Notre liqueur de verveine aux notes complexes
- La Fleche Ardente (27°) – Fruits rouges assembles (cassis, framboise, myrtille)

Tous nos produits sont elabores artisanalement, avec des plantes principalement issues de Haute-Loire et d'Ardeche.

Je serais ravi de venir vous presenter notre gamme et organiser une degustation a {{nom_etablissement}}. Etes-vous disponible pour un rendez-vous de 30 minutes ?

En piece jointe : catalogue produits et grille tarifaire cave.

N'hesitez pas a me contacter pour toute question.

Bien cordialement,

{{commercial}}
La Brasserie des Plantes
{{telephone_commercial}}
18 Grand Place, 43140 Saint-Didier-en-Velay
www.labrasseriedesplantes.fr

Artisanalement votre`,
    },
    {
      id: 'et-2', nom: 'Premier contact – Bar / Restaurant (CHR)', type: 'presentation',
      sujet: 'Notre gamme liqueurs pour votre carte – La Brasserie des Plantes',
      corps: `Bonjour {{nom_contact}},

Suite a notre echange telephonique, je vous transmets comme convenu notre presentation et nos tarifs CHR.

Nous proposons des liqueurs artisanales de Haute-Loire parfaites pour vos digestifs et cocktails signature. Nos assemblages de plantes offrent des profils uniques :

- L'Herbe des Druides (28°) – Medaille d'Or, parfaite en digestif ou en cocktail
- L'Alchimie Vegetale (50°) – Meilleur Digestif du Monde 2025 aux World Liqueur Awards de Londres
- Le Gorgeon des Machures (30°) – Verveine aux notes de charbon, tres originale en cocktail
- Gamme 15° a 50° adaptee a tous vos besoins (BIB 5L disponibles)

Contrairement aux liqueurs classiques, nos creations permettent de proposer quelque chose de vraiment different a vos clients, avec des marges interessantes.

Pourriez-vous me recevoir 20 minutes a {{nom_etablissement}} pour vous presenter notre gamme ? Je peux venir avec des echantillons pour que vous testiez en conditions reelles.

En piece jointe : catalogue Bar-Restaurant et grille tarifaire professionnelle.

Bien cordialement,

{{commercial}}
La Brasserie des Plantes
{{telephone_commercial}}
18 Grand Place, 43140 Saint-Didier-en-Velay
www.labrasseriedesplantes.fr

Artisanalement votre`,
    },
    {
      id: 'et-3', nom: 'Relance douce (1ere relance)', type: 'relance',
      sujet: 'Re: Catalogue La Brasserie des Plantes – Rendez-vous degustation ?',
      corps: `Bonjour {{nom_contact}},

Je reviens vers vous concernant notre echange et l'envoi de notre catalogue de liqueurs artisanales.

Avez-vous eu l'occasion de parcourir notre gamme ?

Pour rappel :
- Artisan liquoriste de Haute-Loire (Saint-Didier-en-Velay)
- L'Alchimie Vegetale : Meilleur Digestif du Monde 2025 aux World Liqueur Awards de Londres
- Assemblages de plantes exclusifs (pas de monoproduits)
- Marges interessantes pour votre activite

{{commercial}} sera dans votre secteur prochainement. Plutot que d'echanger par mail, seriez-vous interesse par une degustation rapide de 20 minutes a {{nom_etablissement}} ? Vous pourrez gouter nos produits phares et voir concretement ce qui pourrait convenir a votre clientele.

Si les dates ne conviennent pas, n'hesitez pas a me proposer d'autres creneaux !

Bien cordialement,

{{commercial}}
La Brasserie des Plantes
{{telephone_commercial}}
18 Grand Place, 43140 Saint-Didier-en-Velay
www.labrasseriedesplantes.fr

Artisanalement votre`,
    },
    {
      id: 'et-4', nom: 'Relance insistante (derniere tentative)', type: 'relance',
      sujet: 'Derniere proposition – Degustation La Brasserie des Plantes',
      corps: `Bonjour {{nom_contact}},

Je vous ai contacte il y a quelques semaines concernant nos liqueurs artisanales de Haute-Loire.

Derniere proposition : {{commercial}} passe dans votre region prochainement et peut s'arreter 15 minutes a {{nom_etablissement}} pour une degustation express.

L'opportunite :
- Gouter l'Alchimie Vegetale (Meilleur Digestif du Monde 2025)
- Decouvrir nos assemblages exclusifs
- Evaluer l'interet pour votre etablissement
- Aucun engagement

Si cette date ne vous convient pas ou si vous n'etes pas interesse, n'hesitez pas a me le faire savoir et je ne vous solliciterai plus.

Merci pour votre temps !

Bien cordialement,

{{commercial}}
La Brasserie des Plantes
{{telephone_commercial}}
18 Grand Place, 43140 Saint-Didier-en-Velay
www.labrasseriedesplantes.fr

Artisanalement votre`,
    },
    {
      id: 'et-5', nom: 'Confirmation de rendez-vous', type: 'confirmation',
      sujet: 'Confirmation RDV degustation – La Brasserie des Plantes',
      corps: `Bonjour {{nom_contact}},

Je vous confirme notre rendez-vous de degustation :

Date : {{date_rdv}}
Lieu : {{nom_etablissement}}

Je viendrai avec une selection de nos creations pour que vous puissiez gouter et voir ce qui convient le mieux a votre etablissement.

N'hesitez pas a me prevenir si un changement d'horaire est necessaire.

Au plaisir de vous rencontrer !

Bien cordialement,

{{commercial}}
La Brasserie des Plantes
{{telephone_commercial}}
18 Grand Place, 43140 Saint-Didier-en-Velay
www.labrasseriedesplantes.fr

Artisanalement votre`,
    },
    {
      id: 'et-6', nom: 'Remerciement post-degustation', type: 'remerciement',
      sujet: 'Suite a notre degustation – Catalogue La Brasserie des Plantes',
      corps: `Bonjour {{nom_contact}},

Je tenais a vous remercier pour votre accueil chaleureux lors de notre degustation a {{nom_etablissement}}.

Comme convenu, vous trouverez en piece jointe notre catalogue avec les tarifs professionnels et les fiches produits detaillees.

Pour rappel, tous nos produits sont elabores artisanalement a Saint-Didier-en-Velay, avec des plantes principalement issues de Haute-Loire et d'Ardeche.

Je reste a votre disposition pour passer prendre votre commande ou repondre a vos questions.

Dans l'attente de votre retour,

Bien cordialement,

{{commercial}}
La Brasserie des Plantes
{{telephone_commercial}}
18 Grand Place, 43140 Saint-Didier-en-Velay
www.labrasseriedesplantes.fr

Artisanalement votre

P.J. : Catalogue professionnel + grille tarifaire`,
    },
    {
      id: 'et-7', nom: 'Envoi catalogue (sur demande)', type: 'catalogue',
      sujet: 'Catalogue professionnel – La Brasserie des Plantes',
      corps: `Bonjour {{nom_contact}},

Suite a votre demande, vous trouverez en piece jointe notre catalogue professionnel.

Vous y decouvrirez notre gamme complete de liqueurs artisanales a base de plantes de Haute-Loire et d'Ardeche, avec nos tarifs preferentiels pour les professionnels.

Nos produits phares :
- L'Herbe des Druides (28°) – Medaillee d'Or, assemblage verveine / serpolet / carvi
- L'Alchimie Vegetale (50°) – Meilleur Digestif du Monde 2025 (27 plantes)
- Le Gorgeon des Machures (30°) – Liqueur de verveine intense
- La PraliCoquine (15°) – Aperitif a la praline
- Le Zeleste (17,5°) – Notre nouveaute qui cartonne

Tous nos produits sont disponibles en differents conditionnements selon vos besoins : bouteilles 20cl a 3L, BIB 5L, formats degustation, etc.

Je reste a votre disposition pour toute question ou pour organiser une degustation a {{nom_etablissement}}.

Bien cordialement,

{{commercial}}
La Brasserie des Plantes
{{telephone_commercial}}
18 Grand Place, 43140 Saint-Didier-en-Velay
www.labrasseriedesplantes.fr

Artisanalement votre

P.J. : Catalogue professionnel La Brasserie des Plantes`,
    },
    {
      id: 'et-8', nom: 'Annonce nouveaute / medaille', type: 'nouveaute',
      sujet: 'Nouveaute – La Brasserie des Plantes',
      corps: `Bonjour {{nom_contact}},

Nous avons le plaisir de vous annoncer une grande nouvelle !

[DECRIRE LA NOUVEAUTE OU LA MEDAILLE ICI]

Cette distinction / nouveaute vient renforcer notre gamme de liqueurs artisanales elaborees a Saint-Didier-en-Velay.

N'hesitez pas a me contacter pour en savoir plus ou organiser une degustation a {{nom_etablissement}}.

Bien cordialement,

{{commercial}}
La Brasserie des Plantes
{{telephone_commercial}}
18 Grand Place, 43140 Saint-Didier-en-Velay
www.labrasseriedesplantes.fr

Artisanalement votre`,
    },
    {
      id: 'et-9', nom: 'Promotion clients directs', type: 'promotion',
      sujet: 'Promotion exclusive – La Brasserie des Plantes',
      corps: `Bonjour {{nom_contact}},

J'espere que tout va bien de votre cote.

Je vous contacte pour vous informer d'une promotion exceptionnelle reservee a nos clients :

PROMOTION : 5 + 1
5 bouteilles achetees = 1 bouteille offerte
1 BIB achete = 1 bouteille offerte

Cette promotion s'applique sur toute notre gamme, y compris les Magnums et Jeroboams.

Nos produits phares :
- L'Herbe des Druides – Quadruple medaillee (Or Lyon 2023-2024, Argent Paris 2024, Argent World Liqueur Awards 2024)
- L'Alchimie Vegetale – Meilleur Digestif du Monde 2025 aux World Liqueur Awards de Londres

N'hesitez pas a me contacter pour passer commande ou en savoir plus.

[Promotion valable du XX au XX]

Bien cordialement,

{{commercial}}
La Brasserie des Plantes
{{telephone_commercial}}
18 Grand Place, 43140 Saint-Didier-en-Velay
www.labrasseriedesplantes.fr

Artisanalement votre`,
    },
    {
      id: 'et-10', nom: 'Promotion distributeurs', type: 'promotion',
      sujet: 'Promotion – Offre speciale pour vos clients',
      corps: `Bonjour {{nom_contact}},

J'espere que tout va bien de votre cote.

Je vous contacte pour vous informer que nous mettons en place une promotion exceptionnelle pour vos clients.

PROMOTION : 5 + 1
5 bouteilles achetees = 1 bouteille offerte
1 BIB achete = 1 bouteille offerte

Cette promotion s'applique sur toute notre gamme, y compris les Magnums et Jeroboams.

Vos arguments de vente :
- L'Herbe des Druides – Quadruple medaillee (Or Lyon 2023-2024, Argent Paris 2024, Argent World Liqueur Awards 2024)
- L'Alchimie Vegetale – Meilleur Digestif du Monde 2025 aux World Liqueur Awards de Londres

N'hesitez pas a relayer cette information aupres de votre reseau. Je reste a votre disposition pour echanger sur les modalites.

[Promotion valable du XX au XX]

Guillaume
La Brasserie des Plantes
06 84 44 40 44
labrasseriedesplantes@gmail.com
www.labrasseriedesplantes.fr

Artisanalement votre`,
    },
  ];

  return {
    prospects,
    calls,
    appointments,
    reminders,
    commerciaux,
    tags,
    emailTemplates,
  };
}
