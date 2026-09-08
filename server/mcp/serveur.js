// Le serveur MCP de SuiviPro : douze outils de lecture, et rien d'autre.
//
// Il n'écrit dans la base que le journal. Le périmètre de chaque personne est appliqué
// dans les requêtes, avant l'envoi — pas à l'affichage, comme le font les écrans.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import outilsContexte from './outils/contexte.js';
import outilsClients from './outils/clients.js';
import outilsProspects from './outils/prospects.js';
import outilsAgenda from './outils/agenda.js';
import { HorsPerimetre } from './perimetre.js';
import { journaliserAppel, journaliserRefus, verifierSeuils } from './journal.js';
import { reponse } from './format.js';
import { LIBELLES_ROLE } from '../../shared/libelles.js';

export const OUTILS = [...outilsContexte, ...outilsClients, ...outilsProspects, ...outilsAgenda];

/** Les outils que ce rôle a le droit d'appeler (matrice du cahier des charges). */
const INTERDITS = {
  prospection: ['chercher_client', 'fiche_client', 'clients_en_retard'],
};

export function outilsDuRole(role) {
  const interdits = INTERDITS[role] || [];
  return OUTILS.filter(o => !interdits.includes(o.nom));
}

function messageDErreur(err) {
  if (err instanceof HorsPerimetre) return err.message;
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
        'Lecture seule : rien ne peut être créé, modifié ni supprimé.',
        'Appelez « contexte » avant d\'interpréter des états, des étapes ou des couleurs : les règles de la maison y sont écrites.',
        'Les réponses citent les établissements par leur nom et leur ville. Les listes indiquent toujours le total réel, même tronquées.',
        'Les photos ne sortent jamais du logiciel : seul leur nombre est indiqué.',
      ].join('\n'),
    }
  );

  for (const outil of outilsDuRole(utilisateur.role)) {
    serveur.registerTool(
      outil.nom,
      {
        title: outil.titre,
        description: outil.description,
        inputSchema: outil.schema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
          const refuse = err instanceof HorsPerimetre;
          await journaliserAppel({ utilisateur, outil: outil.nom, filtres: args, resultats: 0, ms: Date.now() - debut, mention: refuse ? 'refus' : 'erreur' });
          if (refuse) { await journaliserRefus(utilisateur, outil.nom, err.message); verifierSeuils(utilisateur); }
          return { ...reponse(messageDErreur(err)), isError: true };
        }
      }
    );
  }

  return serveur;
}
