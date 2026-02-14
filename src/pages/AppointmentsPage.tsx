import { useState, useMemo } from 'react';
import {
  Calendar, Plus, X, Save, MapPin, Clock, Download, Trash2, Edit2, Check,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { Appointment, AppointmentStatus, APPOINTMENT_STATUS_LABELS } from '../types';
import { generateId, formatDate, downloadICS } from '../utils/helpers';

export default function AppointmentsPage() {
  const { state, dispatch, getProspect } = useApp();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [filterStatus, setFilterStatus] = useState<AppointmentStatus | ''>('');

  const [formData, setFormData] = useState({
    prospect_id: '',
    date: '',
    heure_debut: '',
    heure_fin: '',
    lieu: '',
    notes: '',
    statut: 'planifie' as AppointmentStatus,
  });

  const appointments = useMemo(() => {
    let list = [...state.appointments];
    if (filterStatus) list = list.filter(a => a.statut === filterStatus);
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [state.appointments, filterStatus]);

  const upcoming = appointments.filter(a => a.date >= new Date().toISOString().split('T')[0] && a.statut !== 'annule' && a.statut !== 'termine');
  const past = appointments.filter(a => a.date < new Date().toISOString().split('T')[0] || a.statut === 'termine' || a.statut === 'annule');

  const openNewForm = () => {
    setFormData({ prospect_id: '', date: '', heure_debut: '', heure_fin: '', lieu: '', notes: '', statut: 'planifie' });
    setEditing(null);
    setShowForm(true);
  };

  const openEditForm = (rdv: Appointment) => {
    setFormData({
      prospect_id: rdv.prospect_id,
      date: rdv.date,
      heure_debut: rdv.heure_debut,
      heure_fin: rdv.heure_fin,
      lieu: rdv.lieu,
      notes: rdv.notes,
      statut: rdv.statut,
    });
    setEditing(rdv);
    setShowForm(true);
  };

  const saveAppointment = () => {
    if (!formData.prospect_id || !formData.date) return;
    if (editing) {
      dispatch({
        type: 'UPDATE_APPOINTMENT',
        payload: { ...editing, ...formData } as Appointment,
      });
    } else {
      dispatch({
        type: 'ADD_APPOINTMENT',
        payload: {
          ...formData,
          id: generateId('rdv'),
          commercial_id: state.currentUser?.id || 'com-1',
        } as Appointment,
      });

      // Auto-transition: move prospect to "RDV / Gagne" when RDV is created
      const prospect = state.prospects.find(p => p.id === formData.prospect_id);
      if (prospect && !['gagne', 'perdu'].includes(prospect.etape_pipeline)) {
        dispatch({
          type: 'MOVE_PROSPECT',
          payload: { id: prospect.id, stage: 'gagne' },
        });
      }
    }
    setShowForm(false);
  };

  const deleteAppointment = (id: string) => {
    if (confirm('Supprimer ce RDV ?')) {
      dispatch({ type: 'DELETE_APPOINTMENT', payload: id });
    }
  };

  const statusColors: Record<AppointmentStatus, string> = {
    planifie: 'bg-blue-100 text-blue-700',
    confirme: 'bg-green-100 text-green-700',
    termine: 'bg-gray-100 text-gray-600',
    annule: 'bg-red-100 text-red-700',
  };

  const renderRdvCard = (rdv: Appointment) => {
    const prospect = getProspect(rdv.prospect_id);
    const commercial = state.commerciaux.find(c => c.id === rdv.commercial_id);
    return (
      <div key={rdv.id} className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition-shadow">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-sm text-gray-900">{prospect?.nom_etablissement || 'Inconnu'}</h4>
            <p className="text-xs text-gray-500 mt-0.5">{prospect?.nom_contact}</p>
          </div>
          <span className={`badge text-[10px] ${statusColors[rdv.statut]}`}>
            {APPOINTMENT_STATUS_LABELS[rdv.statut]}
          </span>
        </div>
        <div className="mt-3 space-y-1.5 text-xs text-gray-600">
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-gray-400" />
            {formatDate(rdv.date)} de {rdv.heure_debut} a {rdv.heure_fin}
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 text-gray-400" />
            {rdv.lieu}
          </div>
          {rdv.notes && (
            <p className="text-gray-500 bg-gray-50 p-2 rounded">{rdv.notes}</p>
          )}
          <p className="text-[10px] text-gray-400">Commercial: {commercial?.prenom}</p>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button
            className="p-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600"
            onClick={() => openEditForm(rdv)}
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          {prospect && (
            <button
              className="p-1.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-600"
              onClick={() => downloadICS(rdv, prospect)}
              title="Exporter .ics"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          )}
          {rdv.statut !== 'termine' && (
            <button
              className="p-1.5 rounded bg-green-50 hover:bg-green-100 text-green-600"
              onClick={() => dispatch({ type: 'UPDATE_APPOINTMENT', payload: { ...rdv, statut: 'confirme' } })}
              title="Confirmer"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            className="p-1.5 rounded bg-red-50 hover:bg-red-100 text-red-500"
            onClick={() => deleteAppointment(rdv.id)}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6 fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rendez-vous</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gestion des RDV et export calendrier</p>
        </div>
        <button
          className="bg-brewery-600 text-white px-4 py-2 rounded-lg hover:bg-brewery-700 flex items-center gap-2 text-sm font-medium"
          onClick={openNewForm}
        >
          <Plus className="w-4 h-4" /> Nouveau RDV
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        <button
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${!filterStatus ? 'bg-brewery-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          onClick={() => setFilterStatus('')}
        >
          Tous ({state.appointments.length})
        </button>
        {(Object.keys(APPOINTMENT_STATUS_LABELS) as AppointmentStatus[]).map(status => (
          <button
            key={status}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filterStatus === status ? 'bg-brewery-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            onClick={() => setFilterStatus(status)}
          >
            {APPOINTMENT_STATUS_LABELS[status]}
          </button>
        ))}
      </div>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div>
          <h3 className="font-semibold text-gray-900 mb-3">A venir ({upcoming.length})</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {upcoming.map(renderRdvCard)}
          </div>
        </div>
      )}

      {/* Past */}
      {past.length > 0 && (
        <div>
          <h3 className="font-semibold text-gray-700 mb-3">Passes / Termines ({past.length})</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-75">
            {past.map(renderRdvCard)}
          </div>
        </div>
      )}

      {appointments.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Aucun rendez-vous</p>
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">{editing ? 'Modifier le RDV' : 'Nouveau RDV'}</h3>
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
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
                  <input type="date" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.date} onChange={e => setFormData(prev => ({ ...prev, date: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Debut</label>
                  <input type="time" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.heure_debut} onChange={e => setFormData(prev => ({ ...prev, heure_debut: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Fin</label>
                  <input type="time" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.heure_fin} onChange={e => setFormData(prev => ({ ...prev, heure_fin: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Lieu</label>
                <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.lieu} onChange={e => setFormData(prev => ({ ...prev, lieu: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Statut</label>
                <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.statut} onChange={e => setFormData(prev => ({ ...prev, statut: e.target.value as AppointmentStatus }))}>
                  {(Object.keys(APPOINTMENT_STATUS_LABELS) as AppointmentStatus[]).map(s => (
                    <option key={s} value={s}>{APPOINTMENT_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm h-20 resize-none" value={formData.notes} onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))} />
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
              <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setShowForm(false)}>Annuler</button>
              <button className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2" onClick={saveAppointment}>
                <Save className="w-4 h-4" /> {editing ? 'Modifier' : 'Creer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
