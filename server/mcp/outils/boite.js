// Le seul outil qui écrit.
//
// Il ne crée pas de prospect : il dépose un signalement dans la boîte de prospection, à
// qualifier. C'est un humain qui décide ensuite d'en faire un prospect, de le rattacher à
// une fiche existante, ou de l'ignorer. La boîte est donc l'étape de validation — pas
// besoin d'inventer une confirmation par-dessus, et une erreur ne coûte qu'un clic.
//
// Les champs sont structurés plutôt qu'un texte libre : c'est ce qui permet d'exiger un nom
// d'établissement et de refuser proprement sans lui, au lieu de ranger une fiche vide.
import { z } from 'zod';
import { LIBELLES_TYPE_ETABLISSEMENT } from '../../../shared/libelles.js';
import { deposer, lirePartage, DepotRefuse } from '../../lib/boiteProspection.js';
import { bloc, ligne, lib } from '../format.js';
import { LIBELLES_MOTIF_ECART } from '../../../shared/libelles.js';
import {
  chiffres, sirenValide, siretValide, sirenDeSiret, tvaIntracom, formaterSiren, formaterSiret,
  normaliserTva, tvaPlausible, sirenDeTva,
} from '../../../shared/siret.js';

const TYPES = Object.keys(LIBELLES_TYPE_ETABLISSEMENT);

const NETTOYER = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

/** Le département se lit dans le code postal, comme partout ailleurs (outre-mer sur trois chiffres). */
const departementDe = (cp) => (/^\d{5}$/.test(cp) ? (cp.startsWith('97') ? cp.slice(0, 3) : cp.slice(0, 2)) : '');

/** Le texte que verra l'équipe dans la boîte : ce que Claude a trouvé, en clair. */
function texteDuDepot(a) {
  return [
    NETTOYER(a.nom_etablissement, 200),
    [NETTOYER(a.adresse, 200), NETTOYER(a.code_postal, 10), NETTOYER(a.ville, 100)].filter(Boolean).join(' '),
    NETTOYER(a.telephone, 40),
    NETTOYER(a.email, 200),
    NETTOYER(a.nom_contact, 120),
    NETTOYER(a.lien, 500),
  ].filter(Boolean).join('\n');
}

// Les hôtes que Google sait résoudre lui-même — « share.google » est ce que donne le bouton
// Partager de Google Maps sur Android. Un lien court est opaque, mais il redirige.
const HOTES_COURTS = /(^|\.)(share\.google|goo\.gl|g\.co|g\.page)$/i;

/**
 * Un lien Google construit autour d'un identifiant de lieu ne mène nulle part : ouvert dans
 * Maps, il cherche le jeton comme s'il s'agissait d'un nom et répond « aucun résultat ».
 * On préfère donc n'en garder aucun : l'adresse, elle, retrouve toujours l'établissement.
 */
function lienInutilisable(lien) {
  let u;
  try { u = new URL(lien); } catch { return false; }
  if (HOTES_COURTS.test(u.hostname)) return false;
  if (!/(^|\.)google\.[a-z.]+$/i.test(u.hostname)) return false;
  // Un chemin /maps/place/... ou des coordonnées @lat,lng désignent un lieu réel.
  if (/\/maps\/place\//i.test(u.pathname) || /@-?\d+\.\d+,-?\d+\.\d+/.test(u.href)) return false;
  const q = u.searchParams.get('query') || u.searchParams.get('q') || '';
  if (!q || /^(place_id:|cid=)/i.test(q)) return false;
  // Un vrai nom contient des espaces ou reste court. Une suite compacte de lettres, de
  // majuscules et de chiffres est un identifiant.
  return !q.includes(' ') && q.length >= 14 && /\d/.test(q) && /[A-Z]/.test(q);
}

const deposerDansLaBoite = {
  nom: 'deposer_dans_la_boite',
  titre: 'Déposer dans la boîte de prospection',
  description: [
    'Dépose un établissement dans la boîte de prospection, à qualifier par l\'équipe.',
    'Ne crée pas de prospect : quelqu\'un relira et décidera.',
    'Donnez le nom de l\'établissement, ou à défaut un lien Google Maps ou Google Business : la fiche sera lue pour vous.',
    'Donnez tout ce que vous savez d\'autre, et rien de plus — ne devinez ni un téléphone ni une adresse.',
    'L\'identité légale (raison sociale, SIRET, numéro de TVA) est facultative mais précieuse : elle suit la fiche jusqu\'au prospect créé depuis la boîte. Appelez « contexte » avec le sujet « identite » pour savoir ce que chaque numéro désigne.',
    'Les doublons avec les prospects et les clients existants sont signalés dans la réponse, ainsi que les établissements déjà écartés par l\'équipe.',
  ].join(' '),
  ecrit: true,
  schema: {
    nom_etablissement: z.string().optional().describe('Le nom de l\'établissement, tel qu\'il s\'écrit. Vous pouvez l\'omettre si vous donnez un lien Google : il sera lu depuis la fiche.'),
    ville: z.string().optional().describe('La commune, sans le code postal.'),
    code_postal: z.string().optional().describe('Les 5 chiffres. Le département s\'en déduit.'),
    adresse: z.string().optional().describe('Le numéro et la rue, sans la ville ni le code postal.'),
    telephone: z.string().optional().describe('Tel qu\'il s\'écrit ; il sera rendu cliquable dans la boîte.'),
    email: z.string().optional().describe('L\'adresse de l\'établissement, si elle est publiée.'),
    nom_contact: z.string().optional().describe('Nom et prénom de la personne, si vous les connaissez.'),
    type_etablissement: z.enum(TYPES).optional().describe(`Un de : ${TYPES.join(', ')}. « autre » par défaut.`),
    lien: z.string().optional().describe('Google Maps, site, Instagram, Facebook : l\'adresse d\'où vient l\'information. Donnez le lien tel que la personne vous l\'a transmis (« share.google/… », « maps.app.goo.gl/… », une adresse de site). N\'en fabriquez jamais un à partir d\'un identifiant de lieu : il ne mènerait nulle part.'),
    commentaire: z.string().optional().describe('Pourquoi vous le signalez, ce qui peut aider celui qui le traitera.'),
    raison_sociale: z.string().optional().describe('Facultatif. Le nom légal de la société, quand il diffère de l\'enseigne : « SARL Les Trois Chênes » derrière « Le Mulligan ». Si c\'est le même nom, ne le répétez pas.'),
    siret: z.string().optional().describe('Facultatif, mais précieux. Les 14 chiffres de l\'établissement — celui de l\'adresse visitée, pas celui du siège. La clé est vérifiée : un numéro faux est écarté. Ne le devinez pas et ne le fabriquez pas en ajoutant « 00001 » à un SIREN.'),
    siren: z.string().optional().describe('Facultatif. Les 9 chiffres de l\'entreprise. Inutile si vous donnez le SIRET : il s\'en déduit tout seul. La clé est vérifiée ici aussi.'),
    tva_intracom: z.string().optional().describe('Facultatif, et rarement utile : le numéro français se calcule depuis le SIREN, il n\'est donc pas à donner. Ne le renseignez que pour une société étrangère (« BE… », « IT… »), dont le numéro ne se déduit d\'aucun SIREN.'),
  },
  executer: async (a, { utilisateur }) => {
    let lien = NETTOYER(a.lien, 500);
    // Un lien Google fabriqué autour d'un identifiant est pire que pas de lien : dans la
    // boîte, il s'annonce « Fiche Google » et ne donne aucun résultat. On l'écarte, et
    // l'adresse reste cliquable, elle.
    const lienEcarte = lienInutilisable(lien);
    if (lienEcarte) lien = '';
    let nom = NETTOYER(a.nom_etablissement, 200);
    // Un lien Google seul suffit : on lit la fiche, comme le fait l'application quand
    // quelqu'un partage depuis son téléphone. Ce qui en sort ne sert qu'à compléter —
    // les valeurs données explicitement priment toujours.
    let lue = {};
    if (!nom && lien) {
      const partage = await lirePartage(lien);
      lue = partage.fiche || {};
      nom = NETTOYER(lue.nom_etablissement, 200);
    }
    if (!nom) {
      throw new DepotRefuse(
        'Il faut au moins le nom de l\'établissement. Un lien Google Maps ou Google Business suffit aussi : '
        + 'le nom sera lu depuis la fiche. Ici, ni l\'un ni l\'autre n\'a donné de nom.'
      );
    }

    // Ces numéros portent leur propre clé de contrôle : on refuse plutôt que d'écrire un
    // SIRET inventé dans une fiche — un faux numéro a l'air vrai et se propage.
    const siretDonne = chiffres(a.siret);
    const sirenDonne = chiffres(a.siren);
    const siret = siretValide(siretDonne) ? siretDonne : '';
    // Un numéro de TVA français porte son SIREN et sa propre clé : quand on n'a rien
    // d'autre, il vaut un SIREN de plus — mais seulement s'il se recalcule.
    const tvaDonnee = normaliserTva(a.tva_intracom);
    const siren = siret ? sirenDeSiret(siret) : (sirenValide(sirenDonne) ? sirenDonne : sirenDeTva(tvaDonnee));

    // Le numéro français se calcule : on ne stocke que ce qui ne se calcule pas, c'est-à-dire
    // celui d'une société étrangère. C'est la règle des fiches, gardée à l'identique ici.
    const calculee = tvaIntracom(siren);
    const etrangere = !calculee && tvaPlausible(tvaDonnee) && !tvaDonnee.startsWith('FR') ? tvaDonnee : '';
    const tvaRetenue = calculee || etrangere;
    const numerosEcartes = [
      siretDonne && !siret ? `SIRET ${siretDonne}` : '',
      sirenDonne && !siren ? `SIREN ${sirenDonne}` : '',
      tvaDonnee && !tvaRetenue ? `TVA ${tvaDonnee}` : '',
    ].filter(Boolean);

    const { doublons, ecartes, destinataires } = await deposer({
      texte: texteDuDepot({ ...lue, ...a, nom_etablissement: nom, lien }),
      commentaire: a.commentaire,
      parQui: utilisateur.id,
      source: 'claude',
      // Ce que Claude affirme prime sur ce que la lecture du texte devinerait.
      ficheImposee: {
        ...lue,
        nom_etablissement: nom,
        ville: NETTOYER(a.ville, 100),
        code_postal: NETTOYER(a.code_postal, 10),
        departement: departementDe(NETTOYER(a.code_postal, 10)),
        adresse: NETTOYER(a.adresse, 200),
        telephone: NETTOYER(a.telephone, 40),
        email: NETTOYER(a.email, 200),
        nom_contact: NETTOYER(a.nom_contact, 120),
        type_etablissement: TYPES.includes(a.type_etablissement) ? a.type_etablissement : 'autre',
        // `lien`, pas `a.lien` : le lien écarté ne doit pas revenir par cette porte.
        source_url: lien,
        raison_sociale: NETTOYER(a.raison_sociale, 200),
        siret,
        siren,
        tva_intracom: etrangere,
      },
    });

    return {
      resultats: 1,
      texte: bloc(
        `« ${nom} »${a.ville ? ` à ${NETTOYER(a.ville, 100)}` : ''} est dans la boîte de prospection, à qualifier.`,
        ligne('Prévenus', `la prospection, ${destinataires.length} personne(s)`),
        ligne('Type', lib(LIBELLES_TYPE_ETABLISSEMENT, TYPES.includes(a.type_etablissement) ? a.type_etablissement : 'autre')),
        // Quelqu'un a déjà tranché sur cet établissement. Ce n'est pas un refus — le dépôt
        // a bien eu lieu — mais celui qui a demandé mérite de le savoir.
        ecartes && ecartes.total
          ? `Attention, cet établissement a déjà été écarté ${ecartes.total > 1 ? `${ecartes.total} fois` : 'une fois'} :\n`
            + ecartes.lignes.map(e => `- ${e.nom}${e.ville ? ` (${e.ville})` : ''} : ${lib(LIBELLES_MOTIF_ECART, e.motif)}`).join('\n')
          : '',
        doublons.length
          ? `Attention, ${doublons.length} fiche(s) lui ressemblent déjà :\n`
            + doublons.map(d => `- ${d.genre} : ${d.nom}${d.ville ? ` (${d.ville})` : ''}`).join('\n')
            + '\nCelui qui traitera le signalement pourra rattacher plutôt que créer un doublon.'
          : 'Aucune fiche existante ne lui ressemble.',
        siret || siren || tvaRetenue
          ? ligne(
              'Identité',
              NETTOYER(a.raison_sociale, 200),
              siret ? `SIRET ${formaterSiret(siret)}` : (siren ? `SIREN ${formaterSiren(siren)}` : ''),
              tvaRetenue ? `TVA ${tvaRetenue}` : '',
            )
          : '',
        tvaDonnee && tvaRetenue && tvaDonnee !== tvaRetenue
          ? `Le numéro de TVA donné (${tvaDonnee}) ne correspond pas au SIREN retenu : c'est ${tvaRetenue} qui a été gardé, `
            + 'puisqu\'il se calcule. Vérifiez qu\'il s\'agit bien de la même société.'
          : '',
        numerosEcartes.length
          ? `Numéro écarté, la clé de contrôle ne tombe pas juste : ${numerosEcartes.join(', ')}. `
            + 'Un numéro faux vaut moins que pas de numéro : ne le devinez pas.'
          : '',
        lienEcarte
          ? 'Le lien donné était construit autour d\'un identifiant de lieu : il ne mène nulle part, il n\'a pas été gardé. '
            + 'L\'adresse reste cliquable dans la boîte. Ne transmettez qu\'un lien reçu tel quel.'
          : '',
        'Rien n\'a été créé dans les prospects : quelqu\'un relira et décidera.',
      ),
    };
  },
};

export default [deposerDansLaBoite];
