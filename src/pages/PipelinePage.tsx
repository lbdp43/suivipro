import { useState, useMemo, DragEvent } from 'react';
import { Phone, MapPin, GripVertical, Eye } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { PIPELINE_LABELS, PIPELINE_COLORS, ESTABLISHMENT_LABELS, PipelineStage, Prospect } from '../types';
import { Link } from 'react-router-dom';

export default function PipelinePage() {
  const { state, dispatch } = useApp();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<PipelineStage | null>(null);

  const stages = Object.keys(PIPELINE_LABELS) as PipelineStage[];

  const prospectsByStage = useMemo(() => {
    const map: Record<PipelineStage, Prospect[]> = {} as any;
    for (const stage of stages) {
      map[stage] = state.prospects.filter(p => p.etape_pipeline === stage);
    }
    return map;
  }, [state.prospects]);

  const handleDragStart = (e: DragEvent, prospectId: string) => {
    setDraggedId(prospectId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', prospectId);
  };

  const handleDragOver = (e: DragEvent, stage: PipelineStage) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(stage);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (e: DragEvent, stage: PipelineStage) => {
    e.preventDefault();
    const prospectId = e.dataTransfer.getData('text/plain');
    if (prospectId) {
      dispatch({ type: 'MOVE_PROSPECT', payload: { id: prospectId, stage } });
    }
    setDraggedId(null);
    setDragOverColumn(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverColumn(null);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 bg-white border-b border-gray-200">
        <h1 className="text-xl font-bold text-gray-900">Pipeline commercial</h1>
        <p className="text-sm text-gray-500 mt-0.5">Glissez-deposez les prospects entre les etapes</p>
      </div>

      <div className="flex-1 overflow-x-auto p-4">
        <div className="flex gap-4 h-full min-w-max">
          {stages.map(stage => (
            <div
              key={stage}
              className={`kanban-column w-72 flex-shrink-0 flex flex-col rounded-xl border-2 transition-colors ${
                dragOverColumn === stage ? 'border-brewery-500 bg-brewery-50' : 'border-gray-200 bg-gray-50'
              }`}
              onDragOver={e => handleDragOver(e, stage)}
              onDragLeave={handleDragLeave}
              onDrop={e => handleDrop(e, stage)}
            >
              {/* Column header */}
              <div className="p-3 border-b border-gray-200 flex items-center gap-2">
                <div className="pipeline-dot" style={{ backgroundColor: PIPELINE_COLORS[stage] }} />
                <h3 className="font-semibold text-sm text-gray-900 flex-1">{PIPELINE_LABELS[stage]}</h3>
                <span className="text-xs text-gray-400 bg-white px-2 py-0.5 rounded-full border border-gray-200">
                  {prospectsByStage[stage].length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {prospectsByStage[stage].map(prospect => (
                  <div
                    key={prospect.id}
                    draggable
                    onDragStart={e => handleDragStart(e, prospect.id)}
                    onDragEnd={handleDragEnd}
                    className={`kanban-card bg-white rounded-lg border border-gray-200 p-3 cursor-grab active:cursor-grabbing ${
                      draggedId === prospect.id ? 'dragging' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <GripVertical className="w-4 h-4 text-gray-300 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm text-gray-900 truncate">
                          {prospect.nom_etablissement}
                        </h4>
                        <p className="text-[10px] text-gray-500 mt-0.5">
                          {ESTABLISHMENT_LABELS[prospect.type_etablissement]}
                        </p>
                        <div className="flex items-center gap-1 mt-1 text-[10px] text-gray-400">
                          <MapPin className="w-3 h-3" />
                          {prospect.ville}
                        </div>

                        {/* Tags */}
                        {prospect.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {prospect.tags.map(tagId => {
                              const tag = state.tags.find(t => t.id === tagId);
                              return tag ? (
                                <span
                                  key={tagId}
                                  className="text-white text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                                  style={{ backgroundColor: tag.couleur }}
                                >
                                  {tag.nom}
                                </span>
                              ) : null;
                            })}
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 mt-2">
                          <a
                            href={`tel:${prospect.telephone.replace(/\s/g, '')}`}
                            className="p-1 rounded bg-green-50 text-green-600 hover:bg-green-100"
                            onClick={e => e.stopPropagation()}
                          >
                            <Phone className="w-3 h-3" />
                          </a>
                          <Link
                            to={`/prospects?id=${prospect.id}`}
                            className="p-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100"
                            onClick={e => e.stopPropagation()}
                          >
                            <Eye className="w-3 h-3" />
                          </Link>
                          <div className="flex-1" />
                          <span className="text-[10px] text-gray-400">
                            Score: {prospect.score}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {prospectsByStage[stage].length === 0 && (
                  <div className="text-center py-8 text-xs text-gray-400">
                    Aucun prospect
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
