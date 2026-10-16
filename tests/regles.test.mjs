// Les règles métier partagées (shared/) : ce que l'appli, le serveur et l'IA appliquent tous.
// Lancer : npm test — avec le lanceur de tests de Node, sans dépendance à installer.
import { describe, it, before as beforeAll } from 'node:test';
import assert from 'node:assert/strict';
import { jourDe, dateLocale, rdvPasse, rdvSansCompteRendu, estEnRetard, estEvenement, lundiDeLaSemaine } from '../shared/regles.js';
import { estAppel, estMail, estRdvPris, quiAPrisLeRdv, jourDePriseDuRdv, rdvRealise, compteCommeVisite, montantCA } from '../shared/activite.js';
import { etapeApresAppel, etapeApresMail, etapeApresNumero, ETAPE_NUMERO } from '../shared/tunnel.js';
import { sirenValide, siretValide, tvaIntracom } from '../shared/siret.js';
import { normaliserPourComparaison, memeTelephone, aUnNumero } from '../shared/normalisation.js';
import { estSansReponse } from '../shared/visites.js';

const expect = (obtenu) => ({
  toBe: (attendu) => assert.equal(obtenu, attendu),
  toBeNull: () => assert.equal(obtenu, null),
});

beforeAll(() => { process.env.TZ = 'Europe/Paris'; });

describe('jours et heures (heure de Paris)', () => {
  it('un horodatage UTC de 22 h 30 tombe sur le lendemain à Paris', () => {
    expect(jourDe('2026-10-15T22:30:00.000Z')).toBe('2026-10-16');
  });
  it('un jour nu reste tel quel', () => {
    expect(jourDe('2026-10-16')).toBe('2026-10-16');
    expect(jourDe('')).toBe('');
  });
  it('dateLocale donne le jour local', () => {
    expect(dateLocale(new Date(2026, 9, 16, 0, 30))).toBe('2026-10-16');
  });
  it('un rendez-vous est passé dès son heure de début, à Paris', () => {
    const rdv = { date: '2026-10-16', heure_debut: '15:00', statut: 'planifie', compte_rendu: '' };
    expect(rdvPasse(rdv, new Date(2026, 9, 16, 15, 30))).toBe(true);
    expect(rdvPasse(rdv, new Date(2026, 9, 16, 14, 30))).toBe(false);
    expect(rdvSansCompteRendu(rdv, new Date(2026, 9, 16, 15, 30))).toBe(true);
  });
  it('le lundi à 0 h 30 reste la semaine en cours', () => {
    expect(dateLocale(lundiDeLaSemaine(new Date(2026, 9, 19, 0, 30)))).toBe('2026-10-19');
  });
});

describe('clients en retard', () => {
  it('en retard quand la visite prévue est dépassée', () => {
    expect(estEnRetard({ statut: 'ACTIF', next_visit: '2026-10-10' }, '2026-10-16')).toBe(true);
    expect(estEnRetard({ statut: 'ACTIF', next_visit: '2026-10-16' }, '2026-10-16')).toBe(false);
  });
});

describe('ce qu’on compte (shared/activite)', () => {
  it('un mail envoyé n’est pas un appel', () => {
    expect(estAppel({ resultat: 'email_envoye' })).toBe(false);
    expect(estMail({ resultat: 'email_envoye' })).toBe(true);
    expect(estAppel({ resultat: 'pas_de_reponse' })).toBe(true);
  });
  it('un RDV pris : chez un prospect, daté de sa prise, non annulé, au nom de qui l’a pris', () => {
    const rdv = { prospect_id: 'p1', created_at: '2026-09-30T22:30:00.000Z', statut: 'planifie', prospecteur_id: 'louis', commercial_id: 'loic' };
    expect(estRdvPris(rdv)).toBe(true);
    expect(quiAPrisLeRdv(rdv)).toBe('louis');
    expect(jourDePriseDuRdv(rdv)).toBe('2026-10-01');
    expect(estRdvPris({ ...rdv, statut: 'annule' })).toBe(false);
    expect(estRdvPris({ ...rdv, created_at: '' })).toBe(false);
    expect(quiAPrisLeRdv({ ...rdv, prospecteur_id: null })).toBe('loic');
  });
  it('un RDV réalisé : non annulé, terminé ou avec compte rendu ; jamais un événement', () => {
    expect(rdvRealise({ statut: 'termine', compte_rendu: '' })).toBe(true);
    expect(rdvRealise({ statut: 'planifie', compte_rendu: 'client' })).toBe(true);
    expect(rdvRealise({ statut: 'planifie', compte_rendu: '' })).toBe(false);
    expect(rdvRealise({ statut: 'termine', compte_rendu: 'client', event_type: 'reunion' })).toBe(false);
    expect(estEvenement({ event_type: 'boutique' })).toBe(true);
  });
  it('une visite : ce qui a compté comme telle', () => {
    expect(compteCommeVisite({ type: 'VISITE' })).toBe(true);
    expect(compteCommeVisite({ type: 'APPEL', compte_visite: true })).toBe(true);
    expect(compteCommeVisite({ type: 'APPEL', compte_visite: false })).toBe(false);
    expect(compteCommeVisite({ type: 'RDV_PLANIFIE' })).toBe(false);
  });
  it('le CA : hors taxes, sans les annulées', () => {
    expect(montantCA({ statut: 'livree', date_commande: '2026-10-01', montant_ht: 100, montant_ttc: 120 })).toBe(100);
    expect(montantCA({ statut: 'annulee', date_commande: '2026-10-01', montant_ht: 100 })).toBe(0);
  });
});

describe('tunnel de vente', () => {
  it('un numéro non attribué envoie dans « Numéro à attribuer », sauf fiche tranchée', () => {
    expect(etapeApresAppel({ injoignable: true }, 'a_contacter')).toBe(ETAPE_NUMERO);
    expect(etapeApresAppel({ injoignable: true }, 'perdu')).toBeNull();
  });
  it('le retour depuis « Numéro à attribuer » revient à l’étape d’avant', () => {
    expect(etapeApresNumero([{ de: 'contacte', vers: ETAPE_NUMERO }])).toBe('contacte');
    expect(etapeApresNumero([])).toBe('a_contacter');
  });
  it('un mail fait passer en négociation, sauf si c’est déjà fait ou tranché', () => {
    expect(etapeApresMail('a_contacter')).toBe('negociation');
    expect(etapeApresMail('negociation')).toBeNull();
    expect(etapeApresMail('perdu')).toBeNull();
  });
});

describe('identité et normalisation', () => {
  it('SIREN / SIRET avec clé de contrôle', () => {
    expect(sirenValide('552 100 554')).toBe(true);
    expect(sirenValide('552100555')).toBe(false);
    expect(siretValide('55210055400013')).toBe(true);
    expect(tvaIntracom('552100554')).toBe('FR96552100554');
  });
  it('accents et casse ne comptent pas, les téléphones se comparent par leurs chiffres', () => {
    expect(normaliserPourComparaison('Café de l’Étoile')).toBe(normaliserPourComparaison('CAFE DE L ETOILE'));
    expect(memeTelephone('04 71 00 11 22', '0471001122')).toBe(true);
    expect(aUnNumero('')).toBe(false);
  });
  it('« messagerie » est un appel sans réponse', () => {
    expect(estSansReponse('messagerie')).toBe(true);
    expect(estSansReponse('repondu')).toBe(false);
  });
});
