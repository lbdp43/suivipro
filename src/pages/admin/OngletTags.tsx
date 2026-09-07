// Tags et points de score — onglet de la page Administration, extrait tel quel.
import { useState } from 'react';
import {  Plus, X, Save, Edit2, Trash2 } from 'lucide-react';
import { apiPost, apiPut, apiDelete } from '../../api/client';
import {  Tag as TagType } from '../../types';
import { generateId } from '../../utils/helpers';
import { useApp } from '../../store/AppContext';
import { useToast } from '../../components/Toast';

export default function OngletTags() {
  const { state, dispatchLocal } = useApp();
  const toast = useToast();

  // Tag state
  const [showTagForm, setShowTagForm] = useState(false);

  const [editingTag, setEditingTag] = useState<TagType | null>(null);

  const [tagForm, setTagForm] = useState<{ nom: string; couleur: string; points: number }>({ nom: '', couleur: '#22c55e', points: 0 });

  const openNewTag = () => {
    setTagForm({ nom: '', couleur: '#22c55e', points: 0 });
    setEditingTag(null);
    setShowTagForm(true);
  };

  const openEditTag = (tag: TagType) => {
    setTagForm({ nom: tag.nom, couleur: tag.couleur, points: tag.points || 0 });
    setEditingTag(tag);
    setShowTagForm(true);
  };

  const saveTag = async () => {
    if (!tagForm.nom) return;
    try {
      if (editingTag) {
        const updated = { ...editingTag, ...tagForm };
        await apiPut(`/tags/${editingTag.id}`, updated);
        dispatchLocal({ type: 'UPDATE_TAG', payload: updated });
      } else {
        const newTag = { id: generateId('tag'), ...tagForm };
        await apiPost('/tags', newTag);
        dispatchLocal({ type: 'ADD_TAG', payload: newTag });
      }
      setShowTagForm(false);
    } catch (error) {
      toast.error('Erreur lors de la sauvegarde du tag.');
    }
  };

  const deleteTag = async (id: string) => {
    if (confirm('Supprimer ce tag ?')) {
      try {
        await apiDelete(`/tags/${id}`);
        dispatchLocal({ type: 'DELETE_TAG', payload: id });
      } catch (error) {
        toast.error('Erreur lors de la suppression du tag.');
      }
    }
  };

  // ============================================
  // Commercial statistics
  // ============================================

  return (
    <>
        <div className="space-y-4">
          <div className="flex justify-end">
            <button className="bg-brewery-600 text-white px-4 py-2 rounded-lg hover:bg-brewery-700 flex items-center gap-2 text-sm font-medium" onClick={openNewTag}>
              <Plus className="w-4 h-4" /> Nouveau tag
            </button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200">
            <div className="divide-y divide-gray-100">
              {state.tags.map(tag => {
                const prospectCount = state.prospects.filter(p => p.tags.includes(tag.id)).length;
                const convertedCount = state.prospects.filter(p => p.tags.includes(tag.id) && p.etape_pipeline === 'client_gagne').length;
                return (
                  <div key={tag.id} className="p-4 flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: tag.couleur }} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-gray-900">{tag.nom}</p>
                      <p className="text-xs text-gray-500">{prospectCount} prospect(s) - {convertedCount} converti(s)</p>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${(tag.points || 0) > 0 ? 'bg-green-100 text-green-700' : (tag.points || 0) < 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-400'}`} title="Points apportés au score">
                      {(tag.points || 0) > 0 ? '+' : ''}{tag.points || 0} pts
                    </span>
                    <div className="flex gap-2">
                      <button className="p-1.5 rounded bg-gray-100 hover:bg-gray-200" onClick={() => openEditTag(tag)}>
                        <Edit2 className="w-3.5 h-3.5 text-gray-600" />
                      </button>
                      <button className="p-1.5 rounded bg-red-50 hover:bg-red-100" onClick={() => deleteTag(tag.id)}>
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {showTagForm && (
            <div className="modal-backdrop">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-gray-200 flex items-center justify-between">
                  <h3 className="font-bold text-gray-900">{editingTag ? 'Modifier le tag' : 'Nouveau tag'}</h3>
                  <button className="p-1 rounded hover:bg-gray-100" onClick={() => setShowTagForm(false)}>
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Nom du tag</label>
                    <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={tagForm.nom} onChange={e => setTagForm(prev => ({ ...prev, nom: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Couleur</label>
                    <div className="flex items-center gap-3">
                      <input type="color" className="w-10 h-10 rounded cursor-pointer" value={tagForm.couleur} onChange={e => setTagForm(prev => ({ ...prev, couleur: e.target.value }))} />
                      <input className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono" value={tagForm.couleur} onChange={e => setTagForm(prev => ({ ...prev, couleur: e.target.value }))} />
                    </div>
                    <div className="flex gap-2 mt-2">
                      {['#ef4444', '#22c55e', '#eab308', '#3b82f6', '#a855f7', '#f97316', '#6b7280', '#ec4899'].map(c => (
                        <button key={c} className="w-6 h-6 rounded-full border-2 border-white shadow" style={{ backgroundColor: c }} onClick={() => setTagForm(prev => ({ ...prev, couleur: c }))} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Points pour le score</label>
                    <input type="number" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={tagForm.points} onChange={e => setTagForm(prev => ({ ...prev, points: parseInt(e.target.value) || 0 }))} />
                    <p className="text-[11px] text-gray-400 mt-1">Score d'un prospect = 50 + les points de ses tags (positifs ou négatifs), borné de 0 à 100. Un prospect sans tag vaut 50. Tant qu'aucun tag n'a de points, le score reste saisi à la main.</p>
                  </div>
                  <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                    <span className="badge text-white text-xs" style={{ backgroundColor: tagForm.couleur }}>
                      {tagForm.nom || 'Aperçu'}
                    </span>
                    <span className="text-xs text-gray-500">Aperçu du tag</span>
                  </div>
                </div>
                <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
                  <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setShowTagForm(false)}>Annuler</button>
                  <button className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2" onClick={saveTag}>
                    <Save className="w-4 h-4" /> {editingTag ? 'Modifier' : 'Créer'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
    </>
  );
}
