import { useState, useMemo, DragEvent } from 'react';
import { Phone, Mail, MapPin, GripVertical, Eye, Settings, Edit2, Trash2, Plus, X, Save, AlertTriangle, MessageSquare } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useCallModal } from '../components/CallModal';
import EmailTemplateModal from '../components/EmailTemplateModal';
import { PIPELINE_LABELS, PIPELINE_COLORS, ESTABLISHMENT_LABELS, PipelineStage, PipelineColumn, Prospect } from '../types';
import { Link } from 'react-router-dom';

export default function PipelinePage() {
  const { state, dispatch } = useApp();
  const { startCall } = useCallModal();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [editingColumn, setEditingColumn] = useState<PipelineColumn | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editColor, setEditColor] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('#6b7280');
  const [quickNoteId, setQuickNoteId] = useState<string | null>(null);
  const [quickNoteText, setQuickNoteText] = useState('');
  const [emailProspect, setEmailProspect] = useState<Prospect | null>(null);

  const openQuickNote = (prospect: Prospect, e: React.MouseEvent) => {
    e.stopPropagation();
    setQuickNoteId(prospect.id);
    setQuickNoteText(prospect.notes);
  };

  const saveQuickNote = () => {
    if (!quickNoteId) return;
    const prospect = state.prospects.find(p => p.id === quickNoteId);
    if (prospect) {
      dispatch({
        type: 'UPDATE_PROSPECT',
        payload: { ...prospect, notes: quickNoteText, date_modification: new Date().toISOString() },
      });
    }
    setQuickNoteId(null);
  };

  const columns = state.pipelineColumns;

  const prospectsByStage = useMemo(() => {
    const map: Record<string, Prospect[]> = {};
    for (const col of columns) {
      map[col.id] = state.prospects.filter(p => p.etape_pipeline === col.id);
    }
    // Also count prospects in stages not in columns (orphaned)
    const columnIds = new Set(columns.map(c => c.id));
    const orphaned = state.prospects.filter(p => !columnIds.has(p.etape_pipeline));
    if (orphaned.length > 0) {
      map['_orphaned'] = orphaned;
    }
    return map;
  }, [state.prospects, columns]);

  const handleDragStart = (e: DragEvent, prospectId: string) => {
    setDraggedId(prospectId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', prospectId);
  };

  const handleDragOver = (e: DragEvent, stageId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(stageId);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (e: DragEvent, stageId: string) => {
    e.preventDefault();
    const prospectId = e.dataTransfer.getData('text/plain');
    if (prospectId) {
      dispatch({ type: 'MOVE_PROSPECT', payload: { id: prospectId, stage: stageId as PipelineStage } });
    }
    setDraggedId(null);
    setDragOverColumn(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverColumn(null);
  };

  const startEditColumn = (col: PipelineColumn) => {
    setEditingColumn(col);
    setEditLabel(col.label);
    setEditColor(col.color);
  };

  const saveEditColumn = () => {
    if (!editingColumn || !editLabel.trim()) return;
    dispatch({
      type: 'UPDATE_PIPELINE_COLUMN',
      payload: { ...editingColumn, label: editLabel.trim(), color: editColor },
    });
    setEditingColumn(null);
  };

  const deleteColumn = (col: PipelineColumn) => {
    if (columns.length <= 1) {
      alert('Impossible de supprimer la derniere etape.');
      return;
    }
    const count = (prospectsByStage[col.id] || []).length;
    const firstOther = columns.find(c => c.id !== col.id);
    const msg = count > 0
      ? `Supprimer l'etape "${col.label}" ?\n\n${count} prospect(s) seront deplaces vers "${firstOther?.label}".`
      : `Supprimer l'etape "${col.label}" ?`;
    if (confirm(msg)) {
      dispatch({ type: 'DELETE_PIPELINE_COLUMN', payload: col.id });
    }
  };

  const addColumn = () => {
    if (!newLabel.trim()) return;
    const id = newLabel.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
    if (columns.some(c => c.id === id)) {
      alert('Une etape avec cet identifiant existe deja');
      return;
    }
    dispatch({
      type: 'ADD_PIPELINE_COLUMN',
      payload: { id: id as PipelineStage, label: newLabel.trim(), color: newColor },
    });
    setNewLabel('');
    setNewColor('#6b7280');
    setShowAddForm(false);
  };

  const presetColors = [
    '#6b7280', '#3b82f6', '#8b5cf6', '#f59e0b', '#f97316', '#ef4444', '#22c55e', '#dc2626',
    '#ec4899', '#14b8a6', '#06b6d4', '#84cc16',
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 sm:p-4 bg-white border-b border-gray-200 flex items-center gap-2 sm:gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-base sm:text-xl font-bold text-gray-900">Pipeline commercial</h1>
          <p className="text-[10px] sm:text-sm text-gray-500 mt-0.5 hidden sm:block">Glissez-deposez les prospects entre les etapes</p>
        </div>
        <button
          className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors flex-shrink-0 ${
            showSettings ? 'bg-brewery-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
          onClick={() => setShowSettings(!showSettings)}
        >
          <Settings className="w-4 h-4" />
          <span className="hidden sm:inline">Gerer les etapes</span>
          <span className="sm:hidden">Etapes</span>
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="bg-white border-b border-gray-200 p-4 fade-in">
          <div className="max-w-3xl mx-auto space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 text-sm">Etapes du pipeline</h3>
              <button
                className="flex items-center gap-1 px-3 py-1.5 bg-brewery-600 text-white rounded-lg text-xs font-medium hover:bg-brewery-700"
                onClick={() => setShowAddForm(true)}
              >
                <Plus className="w-3 h-3" /> Ajouter une etape
              </button>
            </div>

            {/* Add form */}
            {showAddForm && (
              <div className="flex items-center gap-3 p-3 bg-brewery-50 rounded-lg border border-brewery-200">
                <input
                  type="text"
                  placeholder="Nom de l'etape..."
                  className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  autoFocus
                />
                <div className="flex gap-1">
                  {presetColors.slice(0, 6).map(c => (
                    <button
                      key={c}
                      className={`w-6 h-6 rounded-full border-2 ${newColor === c ? 'border-gray-900' : 'border-transparent'}`}
                      style={{ backgroundColor: c }}
                      onClick={() => setNewColor(c)}
                    />
                  ))}
                </div>
                <button className="px-3 py-1.5 bg-brewery-600 text-white rounded-lg text-xs font-medium" onClick={addColumn}>
                  <Save className="w-3 h-3" />
                </button>
                <button className="p-1.5 text-gray-400 hover:text-gray-600" onClick={() => setShowAddForm(false)}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Existing columns */}
            <div className="space-y-2">
              {columns.map(col => {
                const count = (prospectsByStage[col.id] || []).length;
                const isEditing = editingColumn?.id === col.id;

                return (
                  <div key={col.id} className="flex items-center gap-3 p-2 rounded-lg border border-gray-200 bg-white">
                    <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: col.color }} />

                    {isEditing ? (
                      <>
                        <input
                          type="text"
                          className="flex-1 px-2 py-1 border border-gray-200 rounded text-sm"
                          value={editLabel}
                          onChange={e => setEditLabel(e.target.value)}
                          autoFocus
                        />
                        <div className="flex gap-1">
                          {presetColors.map(c => (
                            <button
                              key={c}
                              className={`w-5 h-5 rounded-full border-2 ${editColor === c ? 'border-gray-900' : 'border-transparent'}`}
                              style={{ backgroundColor: c }}
                              onClick={() => setEditColor(c)}
                            />
                          ))}
                        </div>
                        <button className="p-1 text-green-600 hover:text-green-700" onClick={saveEditColumn}>
                          <Save className="w-4 h-4" />
                        </button>
                        <button className="p-1 text-gray-400 hover:text-gray-600" onClick={() => setEditingColumn(null)}>
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm font-medium text-gray-900">{col.label}</span>
                        <span className="text-xs text-gray-400">{count} prospect{count > 1 ? 's' : ''}</span>
                        <button className="p-1 text-gray-400 hover:text-blue-600" onClick={() => startEditColumn(col)}>
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          className="p-1 text-gray-400 hover:text-red-600"
                          onClick={() => deleteColumn(col)}
                          title={count > 0 ? `${count} prospect(s) seront deplaces` : 'Supprimer'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-[10px] text-gray-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Supprimer une etape deplacera ses prospects vers la premiere etape restante
            </p>
          </div>
        </div>
      )}

      {/* Kanban board */}
      <div className="flex-1 overflow-x-auto p-2 sm:p-4">
        <div className="flex gap-2 sm:gap-4 h-full min-w-max">
          {columns.map(col => (
            <div
              key={col.id}
              className={`kanban-column w-60 sm:w-72 flex-shrink-0 flex flex-col rounded-xl border-2 transition-colors ${
                dragOverColumn === col.id ? 'border-brewery-500 bg-brewery-50' : 'border-gray-200 bg-gray-50'
              }`}
              onDragOver={e => handleDragOver(e, col.id)}
              onDragLeave={handleDragLeave}
              onDrop={e => handleDrop(e, col.id)}
            >
              {/* Column header */}
              <div className="p-3 border-b border-gray-200 flex items-center gap-2">
                <div className="pipeline-dot" style={{ backgroundColor: col.color }} />
                <h3 className="font-semibold text-sm text-gray-900 flex-1">{col.label}</h3>
                <span className="text-xs text-gray-400 bg-white px-2 py-0.5 rounded-full border border-gray-200">
                  {(prospectsByStage[col.id] || []).length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {(prospectsByStage[col.id] || []).map(prospect => (
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
                          {prospect.secteur && <span> - {prospect.secteur}</span>}
                        </p>
                        <div className="flex items-center gap-1 mt-1 text-[10px] text-gray-400">
                          <MapPin className="w-3 h-3" />
                          {prospect.ville || prospect.adresse}
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
                          {prospect.telephone && (
                            <button
                              className="p-1 rounded bg-green-50 text-green-600 hover:bg-green-100"
                              onClick={e => { e.stopPropagation(); startCall(prospect.id); }}
                              title="Appeler"
                            >
                              <Phone className="w-3 h-3" />
                            </button>
                          )}
                          {prospect.email && (
                            <button
                              className="p-1 rounded bg-purple-50 text-purple-600 hover:bg-purple-100"
                              onClick={e => { e.stopPropagation(); setEmailProspect(prospect); }}
                              title="Envoyer un e-mail"
                            >
                              <Mail className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            className="p-1 rounded bg-amber-50 text-amber-600 hover:bg-amber-100"
                            onClick={e => openQuickNote(prospect, e)}
                            title="Notes rapides"
                          >
                            <MessageSquare className="w-3 h-3" />
                          </button>
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

                {(prospectsByStage[col.id] || []).length === 0 && (
                  <div className="text-center py-8 text-xs text-gray-400">
                    Aucun prospect
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Email template modal */}
      {emailProspect && (
        <EmailTemplateModal prospect={emailProspect} onClose={() => setEmailProspect(null)} />
      )}

      {/* Quick notes modal */}
      {quickNoteId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setQuickNoteId(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-amber-500" />
                Notes - {state.prospects.find(p => p.id === quickNoteId)?.nom_etablissement}
              </h3>
              <button className="p-1 rounded hover:bg-gray-100" onClick={() => setQuickNoteId(null)}>
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-4">
              <textarea
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm h-32 resize-none focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
                placeholder="Ajoutez vos notes ici..."
                value={quickNoteText}
                onChange={e => setQuickNoteText(e.target.value)}
                autoFocus
              />
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
              <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setQuickNoteId(null)}>
                Annuler
              </button>
              <button
                className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2"
                onClick={saveQuickNote}
              >
                <Save className="w-4 h-4" /> Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
