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
      nom: 'Directeur',
      email: 'guillaume@labrasseriedesplantes.fr',
      telephone: '06 84 44 40 44',
      role: 'admin',
      password: 'admin123',
      objectifs: { appels_semaine: 30, rdv_mois: 15, prospects_mois: 40, taux_conversion: 25 },
    },
    {
      id: 'com-2',
      prenom: 'Louis',
      nom: 'Alternant',
      email: 'louis@labrasseriedesplantes.fr',
      telephone: '06 00 00 00 01',
      role: 'commercial',
      password: 'louis123',
      objectifs: { appels_semaine: 50, rdv_mois: 10, prospects_mois: 30, taux_conversion: 20 },
    },
    {
      id: 'com-3',
      prenom: 'Lucas',
      nom: 'Alternant',
      email: 'lucas@labrasseriedesplantes.fr',
      telephone: '06 00 00 00 02',
      role: 'commercial',
      password: 'lucas123',
      objectifs: { appels_semaine: 50, rdv_mois: 10, prospects_mois: 30, taux_conversion: 20 },
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
      id: 'et-1', nom: 'Presentation entreprise', type: 'presentation',
      sujet: 'La Brasserie des Plantes - Bieres artisanales aux plantes',
      corps: `Bonjour {{nom_contact}},

Je me permets de vous contacter au nom de La Brasserie des Plantes, brasserie artisanale basee a Saint-Didier-en-Velay (43).

Nous elaborons des bieres originales aux plantes locales (verveine, sauge, thym...) qui seduisent une clientele de plus en plus large.

Je serais ravi de vous presenter notre gamme et d'echanger sur une collaboration avec {{nom_etablissement}}.

Seriez-vous disponible pour un rendez-vous de presentation/degustation ?

Cordialement,
{{commercial}}
La Brasserie des Plantes
{{telephone_commercial}}`,
    },
    {
      id: 'et-2', nom: 'Relance prospect', type: 'relance',
      sujet: 'Relance - La Brasserie des Plantes',
      corps: `Bonjour {{nom_contact}},

Je vous avais contacte recemment au sujet de notre gamme de bieres artisanales aux plantes.

N'ayant pas eu de retour, je me permets de revenir vers vous. Nos bieres connaissent un vrai succes aupres des amateurs et nous pensons qu'elles pourraient interesser la clientele de {{nom_etablissement}}.

Puis-je vous proposer un court rendez-vous de degustation sans engagement ?

Bien cordialement,
{{commercial}}
La Brasserie des Plantes
{{telephone_commercial}}`,
    },
    {
      id: 'et-3', nom: 'Confirmation RDV', type: 'confirmation',
      sujet: 'Confirmation de rendez-vous - {{date_rdv}}',
      corps: `Bonjour {{nom_contact}},

Je vous confirme notre rendez-vous le {{date_rdv}} pour une presentation/degustation de nos bieres artisanales.

J'apporterai des echantillons de notre gamme complete afin que vous puissiez decouvrir nos creations.

N'hesitez pas a me contacter si vous avez des questions.

A tres bientot,
{{commercial}}
La Brasserie des Plantes
{{telephone_commercial}}`,
    },
    {
      id: 'et-4', nom: 'Remerciement post-RDV', type: 'remerciement',
      sujet: 'Merci pour votre accueil - La Brasserie des Plantes',
      corps: `Bonjour {{nom_contact}},

Je tenais a vous remercier pour le temps que vous m'avez accorde lors de notre rencontre.

Comme convenu, vous trouverez en piece jointe notre catalogue complet avec les tarifs professionnels.

{{produit_interesse}}

Je reste a votre entiere disposition pour toute question ou pour passer commande.

Bien cordialement,
{{commercial}}
La Brasserie des Plantes
{{telephone_commercial}}`,
    },
    {
      id: 'et-5', nom: 'Envoi catalogue', type: 'catalogue',
      sujet: 'Catalogue et tarifs - La Brasserie des Plantes',
      corps: `Bonjour {{nom_contact}},

Suite a notre echange, je vous fais parvenir notre catalogue et nos tarifs professionnels en piece jointe.

Vous y trouverez notre gamme complete de bieres artisanales aux plantes ainsi que nos conditions commerciales pour {{nom_etablissement}}.

N'hesitez pas a revenir vers moi pour toute question.

Cordialement,
{{commercial}}
La Brasserie des Plantes
{{telephone_commercial}}`,
    },
    {
      id: 'et-6', nom: 'Annonce nouveaute', type: 'nouveaute',
      sujet: 'Nouveaute - La Brasserie des Plantes',
      corps: `Bonjour {{nom_contact}},

Nous avons le plaisir de vous annoncer le lancement de notre derniere creation !

{{produit_interesse}}

Cette nouveaute est disponible des maintenant. Nous serions ravis de vous en faire decouvrir un echantillon.

A tres bientot,
{{commercial}}
La Brasserie des Plantes
{{telephone_commercial}}`,
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
