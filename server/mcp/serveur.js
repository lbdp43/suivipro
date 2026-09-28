// Le serveur MCP de SuiviPro : des outils de lecture, et quelques outils qui écrivent.
//
// Le périmètre de chaque personne est appliqué dans les requêtes, avant l'envoi — pas à
// l'affichage, comme le font les écrans. Les outils d'écriture sont de deux sortes : le
// dépôt dans la boîte de prospection, où un humain qualifie ; et le suivi des rendez-vous
// (compte rendu, actions du tunnel, tâches client, visites et appels), qui applique les mêmes règles que
// l'écran et ne s'exécute qu'en deux temps — un aperçu, puis la confirmation.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import outilsContexte from './outils/contexte.js';
import outilsClients from './outils/clients.js';
import outilsProspects from './outils/prospects.js';
import outilsAgenda from './outils/agenda.js';
import outilsBoite from './outils/boite.js';
import outilsSuivi from './outils/suivi.js';
import outilsVisites from './outils/visites.js';
import outilsFiches, { ModificationRefusee } from './outils/fiches.js';
import { HorsPerimetre } from './perimetre.js';
import { DepotRefuse } from '../lib/boiteProspection.js';
import { CompteRenduRefuse, CompteRenduInterdit } from '../lib/compteRendu.js';
import { InteractionRefusee, InteractionInterdite } from '../lib/visitesClient.js';
import { journaliserAppel, journaliserRefus, verifierSeuils } from './journal.js';
import { reponse } from './format.js';
import { LIBELLES_ROLE } from '../../shared/libelles.js';
import { outilsCoupes, famillesCoupees } from './familles.js';

export const OUTILS = [...outilsContexte, ...outilsClients, ...outilsProspects, ...outilsAgenda, ...outilsBoite, ...outilsSuivi, ...outilsVisites, ...outilsFiches];

/** Les outils que ce rôle a le droit d'appeler (matrice du cahier des charges). */
const INTERDITS = {
  // Pas de lecture des clients ; mais elle note l'appel chez un client qu'on lui confie par une tâche.
  // Elle change l'étape des prospects, mais ne désactive pas de client et ne règle pas leurs visites.
  prospection: ['chercher_client', 'fiche_client', 'clients_en_retard', 'visites_et_appels', 'activer_ou_desactiver_client', 'regler_recurrence'],
};

export function outilsDuRole(role) {
  const interdits = INTERDITS[role] || [];
  return OUTILS.filter(o => !interdits.includes(o.nom));
}

/**
 * Les outils de cette personne : ceux de son rôle, moins les familles que
 * l'administration lui a coupées (Administration → Accès IA). Vaut pour tous ses accès,
 * Claude comme ChatGPT.
 */
export function outilsPermis(utilisateur) {
  const coupes = outilsCoupes(utilisateur.iaRefus);
  return outilsDuRole(utilisateur.role).filter(o => !coupes.has(o.nom));
}

function messageDErreur(err) {
  // Un refus (hors périmètre, dépôt incomplet) est une réponse, pas une panne : on le rend
  // tel quel, sans encombrer les journaux d'une pile d'appels.
  if (err instanceof HorsPerimetre || err instanceof DepotRefuse || err instanceof CompteRenduRefuse || err instanceof InteractionRefusee || err instanceof ModificationRefusee) return err.message;
  console.error('[MCP] Outil en échec :', err.stack || err.message);
  return `La demande n'a pas abouti : ${String(err.message || err).slice(0, 200)}`;
}

/**
 * Un serveur par requête : sans état à garder entre deux appels, c'est le montage le plus
 * simple et le plus sûr derrière un hébergement qui redémarre quand il veut.
 */
export function construireServeur(utilisateur) {
  const serveur = new McpServer(
    { name: 'suivipro', version: '1.0.0' },
    {
      instructions: [
        `Vous parlez à SuiviPro, le logiciel commercial de La Brasserie des Plantes, pour le compte de ${utilisateur.prenom} ${utilisateur.nom} (${LIBELLES_ROLE[utilisateur.role] || utilisateur.role}).`,
        'Quelques gestes modifient quelque chose. « deposer_dans_la_boite » range un établissement dans la boîte de prospection, à qualifier par l\'équipe. « ecrire_compte_rendu », « terminer_action » et « terminer_tache » font le suivi des rendez-vous avec les règles de l\'écran : étape du tunnel, relance ou tâche de suivi, nouveau rendez-vous si c\'est décalé. « noter_visite_ou_appel » note une visite ou un appel chez un client (« noter_visites_en_serie » pour toute une tournée, un commentaire par client) : un appel compte comme une visite, sauf sans réponse. « activer_ou_desactiver_client » et « regler_recurrence » tiennent les fiches clients à jour (état actif, fréquence et prochaine visite) ; « changer_etape_prospect » déplace des prospects dans le tunnel — c\'est aussi ainsi qu\'on écarte un prospect (« ne pas contacter », « perdu »).',
        'Ces outils qui écrivent travaillent en deux temps : un premier appel sans « confirmer » montre ce qui va être fait, sans rien écrire ; montrez-le à la personne, et n\'appelez avec « confirmer: true » qu\'après son accord explicite. N\'inventez jamais un résultat, une date de relance ni une raison de perte : demandez-les. Les sujets « comptes_rendus » et « visites » de « contexte » donnent les règles.',
        'Tout le reste est en lecture seule : aucun prospect ni client ne peut être créé ni supprimé, et les réglages de l\'appli ne se changent pas d\'ici. « proposer_mail » prépare un texte et n\'envoie rien.',
        'Appelez « contexte » avant d\'interpréter des états, des étapes ou des couleurs : les règles de la maison y sont écrites.',
        'Les réponses citent les établissements par leur nom et leur ville. Les listes indiquent toujours le total réel, même tronquées.',
        'L\'identité légale d\'un établissement (raison sociale, SIREN, SIRET, numéro de TVA) se lit sur sa fiche et se transmet au dépôt. Ces numéros sont vérifiés par leur clé de contrôle : un numéro faux est écarté et la réponse le dit. Ne les devinez jamais — le sujet « identite » de « contexte » explique ce que chacun désigne.',
        'Les photos ne sortent jamais du logiciel : seul leur nombre est indiqué.',
        ...(famillesCoupees(utilisateur.iaRefus).length ? [
          `L'administration n'a pas ouvert à cette personne : ${famillesCoupees(utilisateur.iaRefus).map(f => f.libelle.toLowerCase()).join(', ')}. Les outils correspondants n'existent pas ici : si on vous le demande, dites que ce n'est pas autorisé pour ce compte et qu'il faut voir avec l'administrateur de SuiviPro.`,
        ] : []),
      ].join('\n'),
    }
  );

  for (const outil of outilsPermis(utilisateur)) {
    serveur.registerTool(
      outil.nom,
      {
        title: outil.titre,
        description: outil.description,
        inputSchema: outil.schema,
        annotations: outil.ecrit
          ? { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
          : { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async (args) => {
        const debut = Date.now();
        try {
          const sortie = await outil.executer(args || {}, { utilisateur });
          const { texte, resultats } = typeof sortie === 'string' ? { texte: sortie, resultats: null } : sortie;
          await journaliserAppel({ utilisateur, outil: outil.nom, filtres: args, resultats, ms: Date.now() - debut });
          verifierSeuils(utilisateur);
          return reponse(texte);
        } catch (err) {
          // Une saisie incomplète (compte rendu sans notes, relance sans date) n'est pas une
          // tentative hors périmètre : elle est journalisée à part et ne compte pas dans les seuils.
          const refuse = err instanceof HorsPerimetre || err instanceof DepotRefuse || err instanceof CompteRenduInterdit || err instanceof InteractionInterdite;
          const saisie = !refuse && (err instanceof CompteRenduRefuse || err instanceof InteractionRefusee || err instanceof ModificationRefusee);
          await journaliserAppel({ utilisateur, outil: outil.nom, filtres: args, resultats: 0, ms: Date.now() - debut, mention: saisie ? 'saisie' : refuse ? 'refus' : 'erreur' });
          if (refuse) { await journaliserRefus(utilisateur, outil.nom, err.message); verifierSeuils(utilisateur); }
          return { ...reponse(messageDErreur(err)), isError: true };
        }
      }
    );
  }

  return serveur;
}
