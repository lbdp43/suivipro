// Objectifs mensuels par personne — onglet de la page Administration, extrait tel quel.
import { useState } from 'react';
import { Save, Edit2 } from 'lucide-react';
import { apiPut } from '../../api/client';
import { Commercial, Objectifs } from '../../types';
import { objectifsDe, mesurerObjectifs, COULEUR_ETAT } from '../../utils/objectifs';
import { libelleRole } from '../../utils/roles';
import { useApp } from '../../store/AppContext';
import { useToast } from '../../components/Toast';

export default function OngletObjectifs() {
  const { state, dispatchLocal } = useApp();
  const toast = useToast();

  // Objectives state
  const [editingObjectives, setEditingObjectives] = useState<string | null>(null);

  const [objectivesForm, setObjectivesForm] = useState<Objectifs>({});

  const startEditObjectives = (commercial: Commercial) => {
    setEditingObjectives(commercial.id);
    // Les clés du rôle, pré-remplies avec l'existant ou la valeur proposée.
    const f: Objectifs = { ...commercial.objectifs };
    for (const def of objectifsDe(commercial)) if (f[def.cle] === undefined) f[def.cle] = def.defaut;
    setObjectivesForm(f);
  };

  const saveObjectives = async () => {
    if (!editingObjectives) return;
    const commercial = state.commerciaux.find(c => c.id === editingObjectives);
    if (commercial) {
      const updated = { ...commercial, objectifs: objectivesForm };
      try {
        await apiPut(`/commerciaux/${commercial.id}`, updated);
        dispatchLocal({
          type: 'UPDATE_COMMERCIAL',
          payload: updated,
        });
        setEditingObjectives(null);
      } catch (error) {
        toast.error('Erreur lors de la sauvegarde des objectifs.');
      }
    }
  };

  // ============================================
  // Tags management
  // ============================================

  return (
    <>
        <div className="space-y-4">
          <div className="bg-brewery-50 border border-brewery-100 rounded-xl p-4 text-sm text-brewery-800">
            <p className="font-semibold">Objectifs mensuels, adaptés au rôle.</p>
            <p className="text-xs mt-1 text-brewery-700">
              Prospection : appels et rendez-vous pris. Commercial : rendez-vous réalisés, clients vus, commandes.
              Chacun voit ses jauges sur son accueil ; « dans le rythme » compare à ce qui devrait être atteint à cette date du mois.
            </p>
          </div>
          {state.commerciaux.map(commercial => {
            const isEditing = editingObjectives === commercial.id;
            const mesures = mesurerObjectifs(state, commercial);
            const defs = objectifsDe(commercial);
            return (
              <div key={commercial.id} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${
                      commercial.role === 'admin' ? 'bg-amber-100 text-amber-700' : commercial.role === 'prospection' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {commercial.prenom[0]}
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{commercial.prenom} {commercial.nom}</h3>
                      <p className="text-xs text-gray-500">{libelleRole(commercial)} · objectifs du mois</p>
                    </div>
                  </div>
                  {isEditing ? (
                    <div className="flex gap-2">
                      <button className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setEditingObjectives(null)}>Annuler</button>
                      <button className="px-3 py-1.5 text-xs bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-1" onClick={saveObjectives}>
                        <Save className="w-3 h-3" /> Enregistrer
                      </button>
                    </div>
                  ) : (
                    <button className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200" onClick={() => startEditObjectives(commercial)} title="Modifier les objectifs">
                      <Edit2 className="w-4 h-4 text-gray-600" />
                    </button>
                  )}
                </div>

                <div className={`grid grid-cols-1 sm:grid-cols-2 ${defs.length > 2 ? 'lg:grid-cols-3' : ''} gap-4`}>
                  {mesures.map(m => {
                    const couleur = COULEUR_ETAT[m.etat];
                    return (
                      <div key={m.cle} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500" title={m.aide}>{m.label} / mois</span>
                          {!isEditing && <span className={`text-[10px] font-medium ${couleur.texte}`}>{couleur.label}</span>}
                        </div>
                        {isEditing ? (
                          <input
                            type="number"
                            min={0}
                            className="w-full px-2 py-1 border border-gray-200 rounded text-sm"
                            value={objectivesForm[m.cle] ?? 0}
                            onChange={e => setObjectivesForm(prev => ({ ...prev, [m.cle]: parseInt(e.target.value) || 0 }))}
                          />
                        ) : (
                          <>
                            <p className="text-lg font-bold text-gray-900">{m.valeur} <span className="text-sm font-normal text-gray-400">/ {m.objectif || '—'}</span></p>
                            <div className="bg-gray-200 rounded-full h-2">
                              <div className={`h-2 rounded-full progress-bar ${couleur.barre}`} style={{ width: `${Math.min(m.pct, 100)}%` }} />
                            </div>
                            <p className="text-[10px] text-gray-400">{m.objectif > 0 ? `${m.pct} % · attendu à ce jour : ${m.attendu}` : 'Fixez un objectif pour suivre l\'avancement'}</p>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
    </>
  );
}
