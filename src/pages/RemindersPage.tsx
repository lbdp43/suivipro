import { useState, useMemo } from 'react';
import {
  Bell, Plus, X, Save, Clock, Calendar, Check, RotateCcw, Trash2, Edit2,
  AlertCircle, BellRing, CalendarClock, MessageSquare,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { Reminder, ReminderStatus } from '../types';
import { generateId, formatDate, isToday } from '../utils/helpers';

export default function RemindersPage() {
  const { state, dispatch, getProspect } = useApp();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    prospect_id: '',
    date: '',
    heure: '09:00',
    message: '',
  });

  // Modale reporter
  const [snoozeTarget, setSnoozeTarget] = useState<Reminder | null>(null);
  const [snoozeDate, setSnoozeDate] = useState('');
  const [snoozeNote, setSnoozeNote] = useState('');

  // Modale editer
  const [editTarget, setEditTarget] = useState<Reminder | null>(null);
  const [editForm, setEditForm] = useState({ date: '', heure: '', message: '' });

  const reminders = useMemo(() => {
    return [...state.reminders].sort((a, b) => a.date.localeCompare(b.date));
  }, [state.reminders]);

  const todayReminders = reminders.filter(r => r.statut === 'actif' && isToday(r.date));
  const upcomingReminders = reminders.filter(r => r.statut === 'actif' && !isToday(r.date) && r.date >= new Date().toISOString().split('T')[0]);
  const pastReminders = reminders.filter(r => r.statut === 'actif' && r.date < new Date().toISOString().split('T')[0]);
  const completedReminders = reminders.filter(r => r.statut === 'termine');

  const saveReminder = () => {
    if (!formData.prospect_id || !formData.date) return;
    const prospect = getProspect(formData.prospect_id);
    dispatch({
      type: 'ADD_REMINDER',
      payload: {
        id: generateId('rem'),
        prospect_id: formData.prospect_id,
        commercial_id: state.currentUser?.id || 'com-1',
        date: formData.date,
        heure: formData.heure,
        message: formData.message || `Rappeler ${prospect?.nom_etablissement}`,
        statut: 'actif',
      },
    });
    setShowForm(false);
    setFormData({ prospect_id: '', date: '', heure: '09:00', message: '' });
  };

  const markComplete = (id: string) => {
    const rem = state.reminders.find(r => r.id === id);
    if (rem) dispatch({ type: 'UPDATE_REMINDER', payload: { ...rem, statut: 'termine' } });
  };

  const openSnoozeModal = (rem: Reminder) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    setSnoozeTarget(rem);
    setSnoozeDate(tomorrow.toISOString().split('T')[0]);
    setSnoozeNote('');
  };

  const executeSnooze = () => {
    if (!snoozeTarget || !snoozeDate) return;
    const newMessage = snoozeNote
      ? `${snoozeTarget.message}\n[Reporte] ${snoozeNote}`
      : snoozeTarget.message;
    dispatch({
      type: 'UPDATE_REMINDER',
      payload: {
        ...snoozeTarget,
        date: snoozeDate,
        message: newMessage,
        statut: 'actif' as ReminderStatus,
      },
    });
    setSnoozeTarget(null);
  };

  const snoozeQuickOptions = [
    { label: 'Demain', days: 1 },
    { label: 'Dans 2 jours', days: 2 },
    { label: '1 semaine', days: 7 },
    { label: '2 semaines', days: 14 },
  ];

  const setSnoozeQuickDate = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    setSnoozeDate(date.toISOString().split('T')[0]);
  };

  const deleteReminder = (id: string) => {
    dispatch({ type: 'DELETE_REMINDER', payload: id });
  };

  const openEditModal = (rem: Reminder) => {
    setEditTarget(rem);
    setEditForm({ date: rem.date, heure: rem.heure, message: rem.message });
  };

  const saveEdit = () => {
    if (!editTarget || !editForm.date) return;
    dispatch({
      type: 'UPDATE_REMINDER',
      payload: { ...editTarget, date: editForm.date, heure: editForm.heure, message: editForm.message },
    });
    setEditTarget(null);
  };

  const reactivateReminder = (rem: Reminder) => {
    dispatch({
      type: 'UPDATE_REMINDER',
      payload: { ...rem, statut: 'actif' as ReminderStatus },
    });
  };

  // Quick reminder options
  const quickOptions = [
    { label: 'Dans 2 jours', days: 2 },
    { label: '1 semaine', days: 7 },
    { label: '2 semaines', days: 14 },
    { label: '1 mois', days: 30 },
  ];

  const setQuickDate = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    setFormData(prev => ({ ...prev, date: date.toISOString().split('T')[0] }));
  };

  const renderReminder = (rem: Reminder, showActions = true) => {
    const prospect = getProspect(rem.prospect_id);
    const isOverdue = rem.statut === 'actif' && rem.date < new Date().toISOString().split('T')[0];
    const isTodayRem = isToday(rem.date);
    return (
      <div
        key={rem.id}
        className={`p-4 rounded-xl border transition-colors ${
          isOverdue ? 'border-red-200 bg-red-50' :
          isTodayRem ? 'border-amber-200 bg-amber-50' :
          rem.statut === 'termine' ? 'border-gray-200 bg-gray-50 opacity-60' :
          'border-gray-200 bg-white'
        }`}
      >
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg flex-shrink-0 ${
            isOverdue ? 'bg-red-100' : isTodayRem ? 'bg-amber-100' : 'bg-gray-100'
          }`}>
            {isOverdue ? (
              <AlertCircle className="w-4 h-4 text-red-500" />
            ) : isTodayRem ? (
              <BellRing className="w-4 h-4 text-amber-500" />
            ) : (
              <Bell className="w-4 h-4 text-gray-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 whitespace-pre-line">{rem.message}</p>
            <div className="flex items-center gap-3 mt-1.5">
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <Calendar className="w-3 h-3" /> {formatDate(rem.date)}
              </span>
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <Clock className="w-3 h-3" /> {rem.heure}
              </span>
              {prospect && (
                <span className="text-xs text-brewery-600 font-medium">{prospect.nom_etablissement}</span>
              )}
            </div>

            {/* Boutons d'action - actif */}
            {showActions && rem.statut === 'actif' && (
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                  onClick={() => markComplete(rem.id)}
                >
                  <Check className="w-3.5 h-3.5" /> Terminer
                </button>
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
                  onClick={() => openSnoozeModal(rem)}
                >
                  <CalendarClock className="w-3.5 h-3.5" /> Reporter
                </button>
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                  onClick={() => openEditModal(rem)}
                >
                  <Edit2 className="w-3.5 h-3.5" /> Modifier
                </button>
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
                  onClick={() => deleteReminder(rem.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" /> Supprimer
                </button>
              </div>
            )}
            {/* Boutons d'action - termine */}
            {rem.statut === 'termine' && (
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                  onClick={() => reactivateReminder(rem)}
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Reactiver
                </button>
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                  onClick={() => openEditModal(rem)}
                >
                  <Edit2 className="w-3.5 h-3.5" /> Modifier
                </button>
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
                  onClick={() => deleteReminder(rem.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" /> Supprimer
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Rappels</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">Programmez vos rappels de prospection</p>
        </div>
        <button
          className="bg-brewery-600 text-white px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg hover:bg-brewery-700 flex items-center gap-2 text-xs sm:text-sm font-medium self-start sm:self-auto"
          onClick={() => setShowForm(true)}
        >
          <Plus className="w-4 h-4" /> Nouveau rappel
        </button>
      </div>

      {/* Today's reminders - highlighted */}
      {todayReminders.length > 0 && (
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 sm:p-5">
          <h3 className="font-semibold text-amber-800 mb-3 flex items-center gap-2">
            <BellRing className="w-5 h-5" />
            Aujourd'hui ({todayReminders.length} rappel{todayReminders.length > 1 ? 's' : ''})
          </h3>
          <div className="space-y-3">
            {todayReminders.map(r => renderReminder(r))}
          </div>
        </div>
      )}

      {/* Overdue */}
      {pastReminders.length > 0 && (
        <div>
          <h3 className="font-semibold text-red-600 mb-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" /> En retard ({pastReminders.length})
          </h3>
          <div className="space-y-3">
            {pastReminders.map(r => renderReminder(r))}
          </div>
        </div>
      )}

      {/* Upcoming */}
      {upcomingReminders.length > 0 && (
        <div>
          <h3 className="font-semibold text-gray-900 mb-3">A venir ({upcomingReminders.length})</h3>
          <div className="space-y-3">
            {upcomingReminders.map(r => renderReminder(r))}
          </div>
        </div>
      )}

      {/* Completed */}
      {completedReminders.length > 0 && (
        <div>
          <h3 className="font-semibold text-gray-500 mb-3">Termines ({completedReminders.length})</h3>
          <div className="space-y-3">
            {completedReminders.map(r => renderReminder(r))}
          </div>
        </div>
      )}

      {reminders.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <Bell className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Aucun rappel programme</p>
        </div>
      )}

      {/* Modale Reporter */}
      {snoozeTarget && (
        <div className="modal-backdrop" onClick={() => setSnoozeTarget(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <CalendarClock className="w-5 h-5 text-blue-600" /> Reporter le rappel
              </h3>
              <button className="p-1 rounded hover:bg-gray-100" onClick={() => setSnoozeTarget(null)}>
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Rappel concerne */}
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-sm font-medium text-gray-800">{snoozeTarget.message}</p>
                <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Actuellement prevu le {formatDate(snoozeTarget.date)} a {snoozeTarget.heure}
                </p>
              </div>

              {/* Options rapides */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Reporter a</label>
                <div className="flex flex-wrap gap-2">
                  {snoozeQuickOptions.map(opt => {
                    const d = new Date();
                    d.setDate(d.getDate() + opt.days);
                    const dateStr = d.toISOString().split('T')[0];
                    return (
                      <button
                        key={opt.days}
                        className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                          snoozeDate === dateStr
                            ? 'bg-blue-600 text-white'
                            : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                        }`}
                        onClick={() => setSnoozeQuickDate(opt.days)}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Date personnalisee */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ou choisir une date</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={snoozeDate}
                  onChange={e => setSnoozeDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>

              {/* Note optionnelle */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5" /> Ajouter une note (optionnel)
                </label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm h-20 resize-none"
                  placeholder="Raison du report, informations complementaires..."
                  value={snoozeNote}
                  onChange={e => setSnoozeNote(e.target.value)}
                />
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
              <button
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                onClick={() => setSnoozeTarget(null)}
              >
                Annuler
              </button>
              <button
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={executeSnooze}
                disabled={!snoozeDate}
              >
                <CalendarClock className="w-4 h-4" /> Reporter au {snoozeDate ? formatDate(snoozeDate) : '...'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale Modifier */}
      {editTarget && (
        <div className="modal-backdrop" onClick={() => setEditTarget(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-gray-600" /> Modifier le rappel
              </h3>
              <button className="p-1 rounded hover:bg-gray-100" onClick={() => setEditTarget(null)}>
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">Prospect</p>
                <p className="text-sm font-medium text-gray-900">{getProspect(editTarget.prospect_id)?.nom_etablissement}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                  <input
                    type="date"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    value={editForm.date}
                    onChange={e => setEditForm(prev => ({ ...prev, date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Heure</label>
                  <input
                    type="time"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    value={editForm.heure}
                    onChange={e => setEditForm(prev => ({ ...prev, heure: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Message</label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm h-24 resize-none"
                  value={editForm.message}
                  onChange={e => setEditForm(prev => ({ ...prev, message: e.target.value }))}
                />
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
              <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setEditTarget(null)}>
                Annuler
              </button>
              <button
                className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2"
                onClick={saveEdit}
              >
                <Save className="w-4 h-4" /> Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">Programmer un rappel</h3>
              <button className="p-1 rounded hover:bg-gray-100" onClick={() => setShowForm(false)}>
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Prospect *</label>
                <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.prospect_id} onChange={e => setFormData(prev => ({ ...prev, prospect_id: e.target.value }))}>
                  <option value="">Selectionnez</option>
                  {state.prospects.map(p => (<option key={p.id} value={p.id}>{p.nom_etablissement}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Options rapides</label>
                <div className="flex flex-wrap gap-2">
                  {quickOptions.map(opt => (
                    <button
                      key={opt.days}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brewery-50 text-brewery-700 hover:bg-brewery-100"
                      onClick={() => setQuickDate(opt.days)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
                  <input type="date" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.date} onChange={e => setFormData(prev => ({ ...prev, date: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Heure</label>
                  <input type="time" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.heure} onChange={e => setFormData(prev => ({ ...prev, heure: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Message</label>
                <textarea className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm h-20 resize-none" placeholder="Message du rappel..." value={formData.message} onChange={e => setFormData(prev => ({ ...prev, message: e.target.value }))} />
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
              <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setShowForm(false)}>Annuler</button>
              <button className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2" onClick={saveReminder}>
                <Save className="w-4 h-4" /> Programmer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
