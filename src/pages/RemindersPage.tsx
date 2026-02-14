import { useState, useMemo } from 'react';
import {
  Bell, Plus, X, Save, Clock, Calendar, Check, RotateCcw, Trash2,
  AlertCircle, BellRing,
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

  const snooze = (id: string, days: number) => {
    const rem = state.reminders.find(r => r.id === id);
    if (rem) {
      const newDate = new Date(rem.date);
      newDate.setDate(newDate.getDate() + days);
      dispatch({
        type: 'UPDATE_REMINDER',
        payload: { ...rem, date: newDate.toISOString().split('T')[0], statut: 'actif' },
      });
    }
  };

  const deleteReminder = (id: string) => {
    dispatch({ type: 'DELETE_REMINDER', payload: id });
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
        className={`p-4 rounded-lg border transition-colors ${
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
            <p className="text-sm font-medium text-gray-900">{rem.message}</p>
            <div className="flex items-center gap-3 mt-1">
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
          </div>
          {showActions && rem.statut === 'actif' && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                className="p-1.5 rounded bg-green-50 hover:bg-green-100 text-green-600"
                onClick={() => markComplete(rem.id)}
                title="Terminer"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                className="p-1.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-600"
                onClick={() => snooze(rem.id, 2)}
                title="Reporter +2j"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                className="p-1.5 rounded bg-red-50 hover:bg-red-100 text-red-500"
                onClick={() => deleteReminder(rem.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6 fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rappels</h1>
          <p className="text-sm text-gray-500 mt-0.5">Programmez vos rappels de prospection</p>
        </div>
        <button
          className="bg-brewery-600 text-white px-4 py-2 rounded-lg hover:bg-brewery-700 flex items-center gap-2 text-sm font-medium"
          onClick={() => setShowForm(true)}
        >
          <Plus className="w-4 h-4" /> Nouveau rappel
        </button>
      </div>

      {/* Today's reminders - highlighted */}
      {todayReminders.length > 0 && (
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-5">
          <h3 className="font-semibold text-amber-800 mb-3 flex items-center gap-2">
            <BellRing className="w-5 h-5" />
            Aujourd'hui ({todayReminders.length} rappel{todayReminders.length > 1 ? 's' : ''})
          </h3>
          <div className="space-y-2">
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
          <div className="space-y-2">
            {pastReminders.map(r => renderReminder(r))}
          </div>
        </div>
      )}

      {/* Upcoming */}
      {upcomingReminders.length > 0 && (
        <div>
          <h3 className="font-semibold text-gray-900 mb-3">A venir ({upcomingReminders.length})</h3>
          <div className="space-y-2">
            {upcomingReminders.map(r => renderReminder(r))}
          </div>
        </div>
      )}

      {/* Completed */}
      {completedReminders.length > 0 && (
        <div>
          <h3 className="font-semibold text-gray-500 mb-3">Termines ({completedReminders.length})</h3>
          <div className="space-y-2">
            {completedReminders.map(r => renderReminder(r, false))}
          </div>
        </div>
      )}

      {reminders.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <Bell className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Aucun rappel programme</p>
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
