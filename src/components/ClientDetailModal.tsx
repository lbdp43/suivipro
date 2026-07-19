import { useState, useEffect, useMemo } from 'react';
import {
  X, Phone, Mail, MapPin, User, Edit2, Calendar,
  CheckCircle2, PhoneCall, Navigation, Clock, AlertTriangle,
  ListTodo, Plus, Check, StickyNote, Save, Eye, EyeOff, Trash2,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from './Toast';
import {
  Client, CLIENT_TYPE_LABELS, ClientStatus, InteractionType, INTERACTION_TYPE_LABELS,
  TaskClient,
} from '../types';
import { generateId, formatDate, toLocalDateStr } from '../utils/helpers';
import { apiPost, apiPut, apiDelete } from '../api/client';

interface Props {
  clientId: string;
  onClose: () => void;
}

export default function ClientDetailModal({ clientId, onClose }: Props) {
  const { state, dispatchLocal, getCommercial, getInteractionsForClient, getTasksForClient, getCommandesForClient } = useApp();
  const toast = useToast();

  const client = state.clients.find(c => c.id === clientId);
  const interactions = client ? getInteractionsForClient(client.id) : [];
  const tasks = client ? getTasksForClient(client.id) : [];
  const commandes = client ? getCommandesForClient(client.id) : [];

  // Chiffres Easybeer pour préparer la visite (calculés sur les commandes synchronisées)
  const statsCommandes = useMemo(() => {
    const valides = commandes
      .filter(c => c.statut !== 'annulee' && c.date_commande)
      .sort((a, b) => (a.date_commande < b.date_commande ? -1 : 1));
    if (valides.length === 0) return null;
    const totalTtc = valides.reduce((s, c) => s + (c.montant_ttc || 0), 0);
    const derniere = valides[valides.length - 1];
    const unAnAvant = new Date(Date.now() - 365 * 86400000).toISOString();
    const ca12Mois = valides.filter(c => c.date_commande >= unAnAvant).reduce((s, c) => s + (c.montant_ttc || 0), 0);
    // fréquence moyenne : intervalle moyen entre deux commandes (jours)
    let frequenceJours: number | null = null;
    if (valides.length >= 2) {
      const premiere = new Date(valides[0].date_commande).getTime();
      const derniereTs = new Date(derniere.date_commande).getTime();
      frequenceJours = Math.round((derniereTs - premiere) / 86400000 / (valides.length - 1));
    }
    const joursDepuisDerniere = Math.floor((Date.now() - new Date(derniere.date_commande).getTime()) / 86400000);
    return {
      nb: valides.length,
      totalTtc,
      panierMoyen: totalTtc / valides.length,
      ca12Mois,
      derniere,
      joursDepuisDerniere,
      frequenceJours,
      enRetard: frequenceJours != null && joursDepuisDerniere > frequenceJours * 1.5,
    };
  }, [commandes]);

  // Interaction form
  const [showInteraction, setShowInteraction] = useState(false);
  const [interactionType, setInteractionType] = useState<InteractionType>('VISITE');
  const [interactionComment, setInteractionComment] = useState('');
  const [interactionDate, setInteractionDate] = useState('');

  // Task form
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDate, setTaskDate] = useState('');

  // Notes editing
  const [editingNotes, setEditingNotes] = useState(false);
  const [noteText, setNoteText] = useState(client?.notes || '');
  const [noteSaving, setNoteSaving] = useState(false);

  useEffect(() => {
    if (client) setNoteText(client.notes || '');
  }, [client?.notes]);

  if (!client) return null;

  const visitStatus = (() => {
    if (client.statut === 'INACTIF') return 'INACTIF';
    if (!client.next_visit) return 'NO_RECURRENCE';
    const today = toLocalDateStr(new Date());
    if (client.next_visit < today) return 'LATE';
    if (client.next_visit === today) return 'TODAY';
    return 'UPCOMING';
  })();

  const submitInteraction = async () => {
    if (!interactionComment.trim()) { toast.error('Le commentaire est obligatoire'); return; }
    const now = new Date().toISOString();
    const interaction = {
      id: generateId('int'),
      client_id: client.id,
      commercial_id: state.currentUser?.id || '',
      type: interactionType,
      date: interactionType === 'RDV_PLANIFIE' && interactionDate ? new Date(interactionDate).toISOString() : now,
      comment: interactionComment.trim(),
      date_creation: now,
    };
    try {
      await apiPost('/interactions', interaction);
      dispatchLocal({ type: 'ADD_INTERACTION', payload: interaction });

      // For RDV, also create appointment
      if (interactionType === 'RDV_PLANIFIE' && interactionDate) {
        const rdvPayload = {
          id: generateId('rdv'),
          prospect_id: '',
          client_id: client.id,
          commercial_id: state.currentUser?.id || '',
          prospecteur_id: state.currentUser?.id || '',
          date: interactionDate,
          heure_debut: '10:00',
          heure_fin: '11:00',
          lieu: [client.adresse, client.ville].filter(Boolean).join(', '),
          notes: interactionComment.trim(),
          statut: 'planifie' as const,
          created_at: now,
        };
        try {
          await apiPost('/appointments', rdvPayload);
          dispatchLocal({ type: 'ADD_APPOINTMENT', payload: rdvPayload });
        } catch { /* secondary */ }
      }

      toast.success('Interaction enregistree');
      setShowInteraction(false);
      setInteractionComment('');
      setInteractionDate('');
      setInteractionType('VISITE');
    } catch {
      toast.error("Erreur lors de l'enregistrement");
    }
  };

  const addTask = async () => {
    if (!taskTitle.trim()) return;
    const payload = {
      id: generateId('task'),
      titre: taskTitle.trim(),
      description: '',
      statut: 'A_FAIRE' as const,
      priorite: 'MOYENNE' as const,
      date_echeance: taskDate || null,
      commercial_id: state.currentUser?.id || '',
      client_id: client.id,
      date_creation: new Date().toISOString(),
      completed_at: null,
    };
    try {
      await apiPost('/tasks-client', payload);
      dispatchLocal({ type: 'ADD_TASK_CLIENT', payload });
      toast.success('Tache ajoutee');
      setShowTaskForm(false);
      setTaskTitle('');
      setTaskDate('');
    } catch { toast.error("Erreur lors de l'ajout de la tache"); }
  };

  const toggleTask = async (task: TaskClient) => {
    const isComplete = task.statut === 'TERMINEE';
    const payload = {
      ...task,
      statut: (isComplete ? 'A_FAIRE' : 'TERMINEE') as TaskClient['statut'],
      completed_at: isComplete ? null : new Date().toISOString(),
    };
    try {
      await apiPut(`/tasks-client/${task.id}`, payload);
      dispatchLocal({ type: 'UPDATE_TASK_CLIENT', payload });
    } catch { toast.error('Erreur lors de la mise a jour'); }
  };

  const deleteTask = async (taskId: string) => {
    try {
      await apiDelete(`/tasks-client/${taskId}`);
      dispatchLocal({ type: 'DELETE_TASK_CLIENT', payload: taskId });
    } catch { toast.error('Erreur lors de la suppression'); }
  };

  const saveNotes = async () => {
    setNoteSaving(true);
    try {
      const updated: Client = { ...client, notes: noteText, date_modification: new Date().toISOString() };
      await apiPut(`/clients/${client.id}`, updated);
      dispatchLocal({ type: 'UPDATE_CLIENT', payload: updated });
      toast.success('Notes enregistrees');
      setEditingNotes(false);
    } catch { toast.error('Erreur lors de la sauvegarde'); }
    finally { setNoteSaving(false); }
  };

  const toggleStatus = async () => {
    const updated: Client = {
      ...client,
      statut: (client.statut === 'ACTIF' ? 'INACTIF' : 'ACTIF') as ClientStatus,
      date_modification: new Date().toISOString(),
    };
    if (updated.statut === 'INACTIF') {
      updated.next_visit = null;
    }
    try {
      await apiPut(`/clients/${client.id}`, updated);
      dispatchLocal({ type: 'UPDATE_CLIENT', payload: updated });
      toast.success(updated.statut === 'ACTIF' ? 'Client reactive' : 'Client desactive');
    } catch { toast.error('Erreur lors du changement de statut'); }
  };

  const deleteClient = async () => {
    if (!confirm('Supprimer ce client ? Cette action est irreversible.')) return;
    try {
      await apiDelete(`/clients/${client.id}`);
      dispatchLocal({ type: 'DELETE_CLIENT', payload: client.id });
      toast.success('Client supprime');
      onClose();
    } catch { toast.error('Erreur lors de la suppression du client'); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-lg sm:rounded-xl rounded-t-xl shadow-2xl max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-bold text-gray-900 truncate flex-1">{client.nom}</h2>
            <div className="flex items-center gap-1 ml-2">
              <a href={`/clients?id=${client.id}`} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100" title="Modifier">
                <Edit2 className="w-4 h-4" />
              </a>
              <button onClick={toggleStatus} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100" title={client.statut === 'ACTIF' ? 'Desactiver' : 'Reactiver'}>
                {client.statut === 'ACTIF' ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button onClick={deleteClient} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50" title="Supprimer">
                <Trash2 className="w-4 h-4" />
              </button>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
          </div>

          {/* Badges */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${client.statut === 'ACTIF' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {client.statut}
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
              {CLIENT_TYPE_LABELS[client.type_client]}
            </span>
            {client.tournee && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-brewery-50 text-brewery-700">
                {client.tournee}
              </span>
            )}
          </div>

          {/* Contact info */}
          <div className="space-y-1.5 text-sm">
            {client.contact && (
              <div className="flex items-center gap-2 text-gray-600">
                <User className="w-3.5 h-3.5 text-gray-400" />
                <span>{client.contact}</span>
              </div>
            )}
            {client.telephone && (
              <a href={`tel:${client.telephone}`} className="flex items-center gap-2 text-blue-600 hover:text-blue-700">
                <Phone className="w-3.5 h-3.5" />
                <span>{client.telephone}</span>
              </a>
            )}
            {client.telephone_mobile && (
              <a href={`tel:${client.telephone_mobile}`} className="flex items-center gap-2 text-blue-600 hover:text-blue-700">
                <Phone className="w-3.5 h-3.5" />
                <span>{client.telephone_mobile} (mobile)</span>
              </a>
            )}
            {client.email && (
              <a href={`mailto:${client.email}`} className="flex items-center gap-2 text-blue-600 hover:text-blue-700">
                <Mail className="w-3.5 h-3.5" />
                <span className="truncate">{client.email}</span>
              </a>
            )}
            {(client.adresse || client.ville) && (
              <div className="flex items-center gap-2 text-gray-600">
                <MapPin className="w-3.5 h-3.5 text-gray-400" />
                <span>{[client.adresse, client.code_postal, client.ville].filter(Boolean).join(', ')}</span>
              </div>
            )}
          </div>

          {/* Visit info */}
          <div className="mt-3 p-3 bg-gray-50 rounded-lg">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-gray-500">Derniere visite</span>
                <p className="font-medium text-gray-900">{client.last_visit ? formatDate(client.last_visit) : 'Jamais'}</p>
              </div>
              <div>
                <span className="text-gray-500">Prochaine visite</span>
                <p className={`font-medium ${visitStatus === 'LATE' ? 'text-red-600' : 'text-gray-900'}`}>
                  {client.next_visit ? formatDate(client.next_visit) : 'Non planifiee'}
                </p>
              </div>
              <div>
                <span className="text-gray-500">Commercial</span>
                <p className="font-medium text-gray-900">{getCommercial(client.commercial_id)?.prenom || '-'}</p>
              </div>
            </div>
          </div>

          {/* Quick action buttons */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => { setShowInteraction(true); setInteractionType('VISITE'); }}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Visite
            </button>
            <button
              onClick={() => { setShowInteraction(true); setInteractionType('APPEL'); }}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
            >
              <PhoneCall className="w-3.5 h-3.5" /> Appel
            </button>
            <button
              onClick={() => { setShowInteraction(true); setInteractionType('RDV_PLANIFIE'); setInteractionDate(toLocalDateStr(new Date())); }}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 transition-colors"
            >
              <Calendar className="w-3.5 h-3.5" /> RDV
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">

          {/* Interaction form (inline) */}
          {showInteraction && (
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-700">
                  {INTERACTION_TYPE_LABELS[interactionType]}
                </h3>
                <button onClick={() => setShowInteraction(false)} className="p-1 rounded hover:bg-gray-200">
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
              {interactionType === 'RDV_PLANIFIE' && (
                <input
                  type="date"
                  value={interactionDate}
                  onChange={e => setInteractionDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2"
                />
              )}
              <textarea
                value={interactionComment}
                onChange={e => setInteractionComment(e.target.value)}
                placeholder="Commentaire... (obligatoire)"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none h-20 mb-2"
                autoFocus
              />
              <button
                onClick={submitInteraction}
                disabled={!interactionComment.trim()}
                className="w-full py-2 bg-brewery-600 text-white rounded-lg text-sm font-medium hover:bg-brewery-700 disabled:opacity-50 transition-colors"
              >
                Enregistrer
              </button>
            </div>
          )}

          {/* Notes */}
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                <StickyNote className="w-4 h-4" /> Notes
              </h3>
              {!editingNotes ? (
                <button onClick={() => setEditingNotes(true)} className="text-xs text-brewery-600 hover:text-brewery-700 font-medium flex items-center gap-1">
                  <Edit2 className="w-3 h-3" /> Modifier
                </button>
              ) : (
                <button onClick={saveNotes} disabled={noteSaving} className="text-xs text-green-600 hover:text-green-700 font-medium flex items-center gap-1">
                  <Save className="w-3 h-3" /> {noteSaving ? 'Enregistrement...' : 'Sauvegarder'}
                </button>
              )}
            </div>
            {editingNotes ? (
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs resize-none h-20"
                autoFocus
              />
            ) : (
              <p className="text-xs text-gray-600 whitespace-pre-wrap bg-yellow-50 rounded-lg p-2 border border-yellow-200 min-h-[24px]">
                {client.notes || <span className="italic text-gray-400">Aucune note</span>}
              </p>
            )}
          </div>

          {/* Tasks */}
          <div className="px-4 pt-2 pb-2">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                <ListTodo className="w-4 h-4" /> Taches ({tasks.filter(t => t.statut !== 'TERMINEE').length})
              </h3>
              <button
                onClick={() => setShowTaskForm(true)}
                className="text-xs text-brewery-600 hover:text-brewery-700 font-medium flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Ajouter
              </button>
            </div>
            {showTaskForm && (
              <div className="mb-2 p-2 bg-gray-50 rounded-lg space-y-2">
                <input
                  type="text"
                  value={taskTitle}
                  onChange={e => setTaskTitle(e.target.value)}
                  placeholder="Titre de la tache..."
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs"
                  autoFocus
                />
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={taskDate}
                    onChange={e => setTaskDate(e.target.value)}
                    className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-xs"
                  />
                  <button onClick={addTask} disabled={!taskTitle.trim()} className="px-3 py-1.5 bg-brewery-600 text-white rounded text-xs font-medium hover:bg-brewery-700 disabled:opacity-50">
                    Ajouter
                  </button>
                  <button onClick={() => setShowTaskForm(false)} className="px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-200 rounded">
                    Annuler
                  </button>
                </div>
              </div>
            )}
            {tasks.length > 0 && (
              <div className="space-y-1">
                {tasks
                  .sort((a, b) => (a.statut === 'TERMINEE' ? 1 : 0) - (b.statut === 'TERMINEE' ? 1 : 0))
                  .slice(0, 5)
                  .map(task => (
                    <div key={task.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg text-xs">
                      <button onClick={() => toggleTask(task)} className="flex-shrink-0">
                        {task.statut === 'TERMINEE'
                          ? <Check className="w-4 h-4 text-green-500" />
                          : <div className="w-4 h-4 border-2 border-gray-300 rounded" />}
                      </button>
                      <span className={`flex-1 truncate ${task.statut === 'TERMINEE' ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                        {task.titre}
                      </span>
                      {task.date_echeance && (
                        <span className={`text-[10px] flex-shrink-0 ${task.date_echeance < toLocalDateStr(new Date()) && task.statut !== 'TERMINEE' ? 'text-red-500' : 'text-gray-400'}`}>
                          {formatDate(task.date_echeance)}
                        </span>
                      )}
                      <button onClick={() => deleteTask(task.id)} className="flex-shrink-0 p-0.5 rounded hover:bg-red-50">
                        <X className="w-3 h-3 text-gray-400 hover:text-red-500" />
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Chiffres Easybeer — pour préparer la visite */}
          {statsCommandes && (
            <div className="px-4 pt-3 pb-2 border-t border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Chiffres Easybeer</h3>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div className="p-2.5 bg-emerald-50 rounded-lg">
                  <div className="text-[10px] text-emerald-700 uppercase tracking-wide">CA total</div>
                  <div className="text-sm font-bold text-emerald-900">{statsCommandes.totalTtc.toFixed(0)} € TTC</div>
                  <div className="text-[10px] text-emerald-700">{statsCommandes.nb} commande{statsCommandes.nb > 1 ? 's' : ''} · panier moyen {statsCommandes.panierMoyen.toFixed(0)} €</div>
                </div>
                <div className="p-2.5 bg-blue-50 rounded-lg">
                  <div className="text-[10px] text-blue-700 uppercase tracking-wide">12 derniers mois</div>
                  <div className="text-sm font-bold text-blue-900">{statsCommandes.ca12Mois.toFixed(0)} € TTC</div>
                </div>
                <div className="p-2.5 bg-gray-50 rounded-lg">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">Dernière commande</div>
                  <div className="text-sm font-bold text-gray-900">{(statsCommandes.derniere.montant_ttc || 0).toFixed(0)} €</div>
                  <div className="text-[10px] text-gray-500">{formatDate(statsCommandes.derniere.date_commande)} · il y a {statsCommandes.joursDepuisDerniere} j</div>
                </div>
                <div className={`p-2.5 rounded-lg ${statsCommandes.enRetard ? 'bg-red-50' : 'bg-gray-50'}`}>
                  <div className={`text-[10px] uppercase tracking-wide ${statsCommandes.enRetard ? 'text-red-700' : 'text-gray-500'}`}>Fréquence d'achat</div>
                  <div className={`text-sm font-bold ${statsCommandes.enRetard ? 'text-red-900' : 'text-gray-900'}`}>
                    {statsCommandes.frequenceJours != null ? `tous les ~${statsCommandes.frequenceJours} j` : '—'}
                  </div>
                  {statsCommandes.enRetard && <div className="text-[10px] text-red-700 font-medium">⚠ en retard sur son rythme</div>}
                </div>
              </div>
            </div>
          )}

          {/* Commandes */}
          {commandes.length > 0 && (
            <div className="px-4 pt-2 pb-2 border-t border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Commandes ({commandes.length})</h3>
              <div className="space-y-2">
                {commandes.slice(0, 5).map(cmd => (
                  <div key={cmd.id} className="p-2.5 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-gray-900">
                        {cmd.numero ? `#${cmd.numero}` : 'Commande'}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        cmd.statut === 'livree' ? 'bg-green-100 text-green-700' :
                        cmd.statut === 'annulee' ? 'bg-red-100 text-red-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {cmd.statut === 'livree' ? 'Livree' : cmd.statut === 'annulee' ? 'Annulee' : 'En cours'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-gray-500">
                      <span>{cmd.date_commande ? formatDate(cmd.date_commande) : ''}</span>
                      {cmd.montant_ttc > 0 && <span className="font-semibold text-gray-700">{cmd.montant_ttc.toFixed(2)} € TTC</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Interaction history */}
          <div className="px-4 pt-2 pb-4 border-t border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Historique ({interactions.length})</h3>
            {interactions.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">Aucune interaction enregistree</p>
            ) : (
              <div className="space-y-2">
                {interactions.slice(0, 15).map(interaction => {
                  const comm = getCommercial(interaction.commercial_id);
                  return (
                    <div key={interaction.id} className="flex gap-3 p-2.5 bg-gray-50 rounded-lg">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        interaction.type === 'VISITE' ? 'bg-green-100' : interaction.type === 'APPEL' ? 'bg-blue-100' : 'bg-purple-100'
                      }`}>
                        {interaction.type === 'VISITE' ? <Navigation className="w-4 h-4 text-green-600" /> :
                         interaction.type === 'APPEL' ? <PhoneCall className="w-4 h-4 text-blue-600" /> :
                         <Calendar className="w-4 h-4 text-purple-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-gray-900">
                            {INTERACTION_TYPE_LABELS[interaction.type]}
                          </span>
                          <span className="text-[10px] text-gray-400">{formatDate(interaction.date)}</span>
                        </div>
                        {comm && <p className="text-[10px] text-gray-500">{comm.prenom} {comm.nom}</p>}
                        {interaction.comment && <p className="text-xs text-gray-600 mt-1">{interaction.comment}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
