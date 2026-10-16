// Les étapes du pipeline telles qu'on les montre : les colonnes réglées par l'administrateur,
// plus celles que des fiches portent encore alors que leur colonne a été supprimée. Sans
// ça, un prospect dont l'étape n'a plus de colonne disparaissait du pipeline, des filtres
// et des statistiques sans un mot.
import { PIPELINE_COLORS, PIPELINE_LABELS, type PipelineColumn, type PipelineStage, type Prospect } from '../types';

export const COULEUR_ETAPE_INCONNUE = '#9ca3af';

/** Les colonnes connues, puis une colonne par étape orpheline rencontrée dans les fiches. */
export function etapesConnues(colonnes: PipelineColumn[], prospects: Pick<Prospect, 'etape_pipeline'>[]): PipelineColumn[] {
  const vues = new Set(colonnes.map(c => c.id));
  const orphelines: PipelineColumn[] = [];
  for (const p of prospects) {
    const e = p.etape_pipeline;
    if (!e || vues.has(e)) continue;
    vues.add(e);
    orphelines.push({
      id: e as PipelineStage,
      label: PIPELINE_LABELS[e] || e,
      color: PIPELINE_COLORS[e] || COULEUR_ETAPE_INCONNUE,
      sort_order: 1000 + orphelines.length,
    } as PipelineColumn);
  }
  return orphelines.length ? [...colonnes, ...orphelines] : colonnes;
}
