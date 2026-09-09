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
import { deposer, DepotRefuse } from '../../lib/boiteProspection.js';
import { bloc, ligne, lib } from '../format.js';

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

const deposerDansLaBoite = {
  nom: 'deposer_dans_la_boite',
  titre: 'Déposer dans la boîte de prospection',
  description: [
    'Dépose un établissement dans la boîte de prospection, à qualifier par l\'équipe.',
    'Ne crée pas de prospect : quelqu\'un relira et décidera. Le nom de l\'établissement est obligatoire ;',
    'donnez tout ce que vous savez d\'autre, et rien de plus — ne devinez ni un téléphone ni une adresse.',
    'Les doublons avec les prospects et les clients existants sont signalés dans la réponse.',
  ].join(' '),
  ecrit: true,
  schema: {
    nom_etablissement: z.string().describe('Obligatoire. Le nom de l\'établissement, tel qu\'il s\'écrit.'),
    ville: z.string().optional(),
    code_postal: z.string().optional(),
    adresse: z.string().optional().describe('Le numéro et la rue, sans la ville ni le code postal.'),
    telephone: z.string().optional(),
    email: z.string().optional(),
    nom_contact: z.string().optional().describe('Nom et prénom de la personne, si vous les connaissez.'),
    type_etablissement: z.enum(TYPES).optional().describe(`Un de : ${TYPES.join(', ')}. « autre » par défaut.`),
    lien: z.string().optional().describe('Google Maps, site, Instagram, Facebook : l\'adresse d\'où vient l\'information.'),
    commentaire: z.string().optional().describe('Pourquoi vous le signalez, ce qui peut aider celui qui le traitera.'),
  },
  executer: async (a, { utilisateur }) => {
    const nom = NETTOYER(a.nom_etablissement, 200);
    if (!nom) throw new DepotRefuse('Le nom de l\'établissement est obligatoire.');

    const { doublons, destinataires } = await deposer({
      texte: texteDuDepot({ ...a, nom_etablissement: nom }),
      commentaire: a.commentaire,
      parQui: utilisateur.id,
      source: 'claude',
      // Ce que Claude affirme prime sur ce que la lecture du texte devinerait.
      ficheImposee: {
        nom_etablissement: nom,
        ville: NETTOYER(a.ville, 100),
        code_postal: NETTOYER(a.code_postal, 10),
        departement: departementDe(NETTOYER(a.code_postal, 10)),
        adresse: NETTOYER(a.adresse, 200),
        telephone: NETTOYER(a.telephone, 40),
        email: NETTOYER(a.email, 200),
        nom_contact: NETTOYER(a.nom_contact, 120),
        type_etablissement: TYPES.includes(a.type_etablissement) ? a.type_etablissement : 'autre',
        source_url: NETTOYER(a.lien, 500),
      },
    });

    return {
      resultats: 1,
      texte: bloc(
        `« ${nom} »${a.ville ? ` à ${NETTOYER(a.ville, 100)}` : ''} est dans la boîte de prospection, à qualifier.`,
        ligne('Prévenus', `la prospection, ${destinataires.length} personne(s)`),
        ligne('Type', lib(LIBELLES_TYPE_ETABLISSEMENT, TYPES.includes(a.type_etablissement) ? a.type_etablissement : 'autre')),
        doublons.length
          ? `Attention, ${doublons.length} fiche(s) lui ressemblent déjà :\n`
            + doublons.map(d => `- ${d.genre} : ${d.nom}${d.ville ? ` (${d.ville})` : ''}`).join('\n')
            + '\nCelui qui traitera le signalement pourra rattacher plutôt que créer un doublon.'
          : 'Aucune fiche existante ne lui ressemble.',
        'Rien n\'a été créé dans les prospects : quelqu\'un relira et décidera.',
      ),
    };
  },
};

export default [deposerDansLaBoite];
