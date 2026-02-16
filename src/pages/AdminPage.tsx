import { useState, useMemo } from 'react';
import {
  Settings, Users, Target, TrendingUp, Tag, Plus, X, Save, Edit2,
  Trash2, BarChart3, Phone, Calendar, Award, Shield, User, Eye, EyeOff, Key,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useToast } from '../components/Toast';
import { Commercial, Tag as TagType, UserRole } from '../types';
import {
  generateId, getCallsThisWeek, getCallsThisMonth, getCallsToday,
  getAppointmentsThisWeek, getAppointmentsThisMonth,
  getResponseRate, getAverageCallDuration, getConversionRate,
  formatDuration,
} from '../utils/helpers';
import { PIPELINE_LABELS, PipelineStage } from '../types';

export default function AdminPage() {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'team' | 'objectives' | 'tags' | 'commercials'>('team');

  // Tag state
  const [showTagForm, setShowTagForm] = useState(false);
  const [editingTag, setEditingTag] = useState<TagType | null>(null);
  const [tagForm, setTagForm] = useState({ nom: '', couleur: '#22c55e' });

  // Objectives state
  const [editingObjectives, setEditingObjectives] = useState<string | null>(null);
  const [objectivesForm, setObjectivesForm] = useState({ appels_semaine: 50, rdv_mois: 10, prospects_mois: 30, taux_conversion: 20 });

  // Team management state
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<Commercial | null>(null);
  const [userForm, setUserForm] = useState({
    prenom: '', nom: '', email: '', telephone: '', role: 'commercial' as UserRole, password: '',
  });
  const [showPassword, setShowPassword] = useState(false);

  const tabs = [
    { id: 'team' as const, label: 'Equipe', icon: Users },
    { id: 'objectives' as const, label: 'Objectifs', icon: Target },
    { id: 'tags' as const, label: 'Tags', icon: Tag },
    { id: 'commercials' as const, label: 'Statistiques', icon: BarChart3 },
  ];

  // ============================================
  // Team management
  // ============================================

  const openNewUser = () => {
    setUserForm({ prenom: '', nom: '', email: '', telephone: '', role: 'commercial', password: '' });
    setEditingUser(null);
    setShowUserForm(true);
    setShowPassword(false);
  };

  const openEditUser = (user: Commercial) => {
    setUserForm({
      prenom: user.prenom,
      nom: user.nom,
      email: user.email,
      telephone: user.telephone,
      role: user.role,
      password: '',
    });
    setEditingUser(user);
    setShowUserForm(true);
    setShowPassword(false);
  };

  const saveUser = () => {
    if (!userForm.prenom || !userForm.email) return;

    if (editingUser) {
      const updated: Commercial = {
        ...editingUser,
        prenom: userForm.prenom,
        nom: userForm.nom,
        email: userForm.email,
        telephone: userForm.telephone,
        role: userForm.role,
        password: userForm.password || editingUser.password,
      };
      dispatch({ type: 'UPDATE_COMMERCIAL', payload: updated });
    } else {
      if (!userForm.password) return;
      const newUser: Commercial = {
        id: generateId('com'),
        prenom: userForm.prenom,
        nom: userForm.nom,
        email: userForm.email,
        telephone: userForm.telephone,
        role: userForm.role,
        password: userForm.password,
        objectifs: { appels_semaine: 50, rdv_mois: 10, prospects_mois: 30, taux_conversion: 20 },
      };
      dispatch({ type: 'ADD_COMMERCIAL', payload: newUser });
    }
    setShowUserForm(false);
  };

  const deleteUser = (user: Commercial) => {
    if (user.id === state.currentUser?.id) {
      toast.warning('Vous ne pouvez pas supprimer votre propre compte.');
      return;
    }
    const adminCount = state.commerciaux.filter(c => c.role === 'admin').length;
    if (user.role === 'admin' && adminCount <= 1) {
      toast.warning('Impossible de supprimer le dernier administrateur.');
      return;
    }
    if (confirm(`Supprimer ${user.prenom} ${user.nom} ? Cette action est irreversible.`)) {
      dispatch({ type: 'DELETE_COMMERCIAL', payload: user.id });
    }
  };

  // ============================================
  // Objectives
  // ============================================

  const startEditObjectives = (commercial: Commercial) => {
    setEditingObjectives(commercial.id);
    setObjectivesForm({ ...commercial.objectifs });
  };

  const saveObjectives = () => {
    if (!editingObjectives) return;
    const commercial = state.commerciaux.find(c => c.id === editingObjectives);
    if (commercial) {
      dispatch({
        type: 'UPDATE_COMMERCIAL',
        payload: { ...commercial, objectifs: objectivesForm },
      });
    }
    setEditingObjectives(null);
  };

  // ============================================
  // Tags management
  // ============================================

  const openNewTag = () => {
    setTagForm({ nom: '', couleur: '#22c55e' });
    setEditingTag(null);
    setShowTagForm(true);
  };

  const openEditTag = (tag: TagType) => {
    setTagForm({ nom: tag.nom, couleur: tag.couleur });
    setEditingTag(tag);
    setShowTagForm(true);
  };

  const saveTag = () => {
    if (!tagForm.nom) return;
    if (editingTag) {
      dispatch({ type: 'UPDATE_TAG', payload: { ...editingTag, ...tagForm } });
    } else {
      dispatch({ type: 'ADD_TAG', payload: { id: generateId('tag'), ...tagForm } });
    }
    setShowTagForm(false);
  };

  const deleteTag = (id: string) => {
    if (confirm('Supprimer ce tag ?')) {
      dispatch({ type: 'DELETE_TAG', payload: id });
    }
  };

  // ============================================
  // Commercial statistics
  // ============================================

  const commercialStats = useMemo(() => {
    return state.commerciaux.map(commercial => {
      const comCalls = state.calls.filter(c => c.commercial_id === commercial.id);
      const comRdv = state.appointments.filter(a => a.commercial_id === commercial.id);
      const comProspects = state.prospects.filter(p => p.commercial_id === commercial.id);

      const weekCalls = getCallsThisWeek(comCalls).length;
      const monthCalls = getCallsThisMonth(comCalls).length;
      const todayCalls = getCallsToday(comCalls).length;
      const weekRdv = getAppointmentsThisWeek(comRdv).length;
      const monthRdv = getAppointmentsThisMonth(comRdv).length;
      const responseRate = getResponseRate(comCalls);
      const avgDuration = getAverageCallDuration(comCalls);
      const conversionRate = getConversionRate(comProspects);

      const callsProgress = commercial.objectifs.appels_semaine > 0 ? Math.round((weekCalls / commercial.objectifs.appels_semaine) * 100) : 0;
      const rdvProgress = commercial.objectifs.rdv_mois > 0 ? Math.round((monthRdv / commercial.objectifs.rdv_mois) * 100) : 0;

      return {
        commercial,
        weekCalls,
        monthCalls,
        todayCalls,
        weekRdv,
        monthRdv,
        responseRate,
        avgDuration,
        conversionRate,
        callsProgress,
        rdvProgress,
        totalProspects: comProspects.length,
      };
    });
  }, [state]);

  const progressColor = (pct: number) =>
    pct >= 100 ? 'bg-green-500' : pct >= 70 ? 'bg-amber-500' : 'bg-red-500';

  const progressLabel = (pct: number) =>
    pct >= 100 ? 'Atteint' : pct >= 70 ? 'En cours' : 'En retard';

  const progressDot = (pct: number) =>
    pct >= 100 ? 'bg-green-500' : pct >= 70 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Administration</h1>
        <p className="text-xs sm:text-sm text-gray-500 mt-0.5">Gestion de l'equipe, objectifs, tags et statistiques</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-full sm:w-fit flex-wrap overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      {/* ============================================ */}
      {/* TEAM TAB */}
      {/* ============================================ */}
      {activeTab === 'team' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-gray-900">Membres de l'equipe</h3>
              <p className="text-xs text-gray-500">{state.commerciaux.length} utilisateur(s)</p>
            </div>
            <button
              className="bg-brewery-600 text-white px-4 py-2 rounded-lg hover:bg-brewery-700 flex items-center gap-2 text-sm font-medium"
              onClick={openNewUser}
            >
              <Plus className="w-4 h-4" /> Ajouter un membre
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {state.commerciaux.map(user => (
              <div key={user.id} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-start gap-3">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${
                    user.role === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {user.prenom[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-gray-900">{user.prenom} {user.nom}</h4>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {user.role === 'admin' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700">
                          <Shield className="w-3 h-3" /> Administrateur
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700">
                          <User className="w-3 h-3" /> Commercial
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">{user.email}</p>
                    <p className="text-xs text-gray-500">{user.telephone}</p>
                  </div>
                </div>

                <div className="flex gap-2 mt-4 pt-3 border-t border-gray-100">
                  <button
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
                    onClick={() => openEditUser(user)}
                  >
                    <Edit2 className="w-3 h-3" /> Modifier
                  </button>
                  <button
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100"
                    onClick={() => deleteUser(user)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* User form modal */}
          {showUserForm && (
            <div className="modal-backdrop" onClick={() => setShowUserForm(false)}>
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-gray-200 flex items-center justify-between">
                  <h3 className="font-bold text-gray-900">
                    {editingUser ? `Modifier ${editingUser.prenom}` : 'Nouveau membre'}
                  </h3>
                  <button className="p-1 rounded hover:bg-gray-100" onClick={() => setShowUserForm(false)}>
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Prenom *</label>
                      <input
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                        value={userForm.prenom}
                        onChange={e => setUserForm(prev => ({ ...prev, prenom: e.target.value }))}
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Nom</label>
                      <input
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                        value={userForm.nom}
                        onChange={e => setUserForm(prev => ({ ...prev, nom: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
                    <input
                      type="email"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      placeholder="prenom@labrasseriedesplantes.fr"
                      value={userForm.email}
                      onChange={e => setUserForm(prev => ({ ...prev, email: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Telephone</label>
                    <input
                      type="tel"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      placeholder="06 00 00 00 00"
                      value={userForm.telephone}
                      onChange={e => setUserForm(prev => ({ ...prev, telephone: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium border transition-colors ${
                          userForm.role === 'admin'
                            ? 'border-amber-500 bg-amber-50 text-amber-700'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                        onClick={() => setUserForm(prev => ({ ...prev, role: 'admin' }))}
                      >
                        <Shield className="w-4 h-4" /> Administrateur
                      </button>
                      <button
                        className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium border transition-colors ${
                          userForm.role === 'commercial'
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                        onClick={() => setUserForm(prev => ({ ...prev, role: 'commercial' }))}
                      >
                        <User className="w-4 h-4" /> Commercial
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                      <Key className="w-3 h-3" />
                      {editingUser ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe *'}
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm pr-10"
                        placeholder={editingUser ? 'Nouveau mot de passe...' : 'Mot de passe...'}
                        value={userForm.password}
                        onChange={e => setUserForm(prev => ({ ...prev, password: e.target.value }))}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
                  <button
                    className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                    onClick={() => setShowUserForm(false)}
                  >
                    Annuler
                  </button>
                  <button
                    className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2"
                    onClick={saveUser}
                  >
                    <Save className="w-4 h-4" /> {editingUser ? 'Modifier' : 'Creer'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================ */}
      {/* OBJECTIVES TAB */}
      {/* ============================================ */}
      {activeTab === 'objectives' && (
        <div className="space-y-4">
          {state.commerciaux.map(commercial => {
            const stats = commercialStats.find(s => s.commercial.id === commercial.id)!;
            const isEditing = editingObjectives === commercial.id;
            return (
              <div key={commercial.id} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${
                      commercial.role === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {commercial.prenom[0]}
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{commercial.prenom} {commercial.nom}</h3>
                      <p className="text-xs text-gray-500">{commercial.role === 'admin' ? 'Administrateur' : 'Commercial'}</p>
                    </div>
                  </div>
                  {isEditing ? (
                    <div className="flex gap-2">
                      <button className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setEditingObjectives(null)}>Annuler</button>
                      <button className="px-3 py-1.5 text-xs bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-1" onClick={saveObjectives}>
                        <Save className="w-3 h-3" /> Sauver
                      </button>
                    </div>
                  ) : (
                    <button className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200" onClick={() => startEditObjectives(commercial)}>
                      <Edit2 className="w-4 h-4 text-gray-600" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Appels / semaine</span>
                      <div className={`w-2 h-2 rounded-full ${progressDot(stats.callsProgress)}`} />
                    </div>
                    {isEditing ? (
                      <input type="number" className="w-full px-2 py-1 border border-gray-200 rounded text-sm" value={objectivesForm.appels_semaine} onChange={e => setObjectivesForm(prev => ({ ...prev, appels_semaine: parseInt(e.target.value) || 0 }))} />
                    ) : (
                      <>
                        <p className="text-lg font-bold text-gray-900">{stats.weekCalls} / {commercial.objectifs.appels_semaine}</p>
                        <div className="bg-gray-200 rounded-full h-2">
                          <div className={`h-2 rounded-full progress-bar ${progressColor(stats.callsProgress)}`} style={{ width: `${Math.min(stats.callsProgress, 100)}%` }} />
                        </div>
                        <p className="text-[10px] text-gray-400">{stats.callsProgress}% - {progressLabel(stats.callsProgress)}</p>
                      </>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">RDV / mois</span>
                      <div className={`w-2 h-2 rounded-full ${progressDot(stats.rdvProgress)}`} />
                    </div>
                    {isEditing ? (
                      <input type="number" className="w-full px-2 py-1 border border-gray-200 rounded text-sm" value={objectivesForm.rdv_mois} onChange={e => setObjectivesForm(prev => ({ ...prev, rdv_mois: parseInt(e.target.value) || 0 }))} />
                    ) : (
                      <>
                        <p className="text-lg font-bold text-gray-900">{stats.monthRdv} / {commercial.objectifs.rdv_mois}</p>
                        <div className="bg-gray-200 rounded-full h-2">
                          <div className={`h-2 rounded-full progress-bar ${progressColor(stats.rdvProgress)}`} style={{ width: `${Math.min(stats.rdvProgress, 100)}%` }} />
                        </div>
                        <p className="text-[10px] text-gray-400">{stats.rdvProgress}% - {progressLabel(stats.rdvProgress)}</p>
                      </>
                    )}
                  </div>

                  <div className="space-y-2">
                    <span className="text-xs text-gray-500">Prospects</span>
                    {isEditing ? (
                      <input type="number" className="w-full px-2 py-1 border border-gray-200 rounded text-sm" value={objectivesForm.prospects_mois} onChange={e => setObjectivesForm(prev => ({ ...prev, prospects_mois: parseInt(e.target.value) || 0 }))} />
                    ) : (
                      <p className="text-lg font-bold text-gray-900">{stats.totalProspects}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <span className="text-xs text-gray-500">Objectif conversion</span>
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <input type="number" className="w-full px-2 py-1 border border-gray-200 rounded text-sm" value={objectivesForm.taux_conversion} onChange={e => setObjectivesForm(prev => ({ ...prev, taux_conversion: parseInt(e.target.value) || 0 }))} />
                        <span className="text-sm text-gray-500">%</span>
                      </div>
                    ) : (
                      <p className="text-lg font-bold text-gray-900">{stats.conversionRate}% / {commercial.objectifs.taux_conversion}%</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ============================================ */}
      {/* TAGS TAB */}
      {/* ============================================ */}
      {activeTab === 'tags' && (
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
                const convertedCount = state.prospects.filter(p => p.tags.includes(tag.id) && p.etape_pipeline === 'gagne').length;
                return (
                  <div key={tag.id} className="p-4 flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: tag.couleur }} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-gray-900">{tag.nom}</p>
                      <p className="text-xs text-gray-500">{prospectCount} prospect(s) - {convertedCount} converti(s)</p>
                    </div>
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
            <div className="modal-backdrop" onClick={() => setShowTagForm(false)}>
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
                  <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                    <span className="badge text-white text-xs" style={{ backgroundColor: tagForm.couleur }}>
                      {tagForm.nom || 'Apercu'}
                    </span>
                    <span className="text-xs text-gray-500">Apercu du tag</span>
                  </div>
                </div>
                <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
                  <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setShowTagForm(false)}>Annuler</button>
                  <button className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2" onClick={saveTag}>
                    <Save className="w-4 h-4" /> {editingTag ? 'Modifier' : 'Creer'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================ */}
      {/* STATISTICS TAB */}
      {/* ============================================ */}
      {activeTab === 'commercials' && (
        <div className="space-y-6">
          {commercialStats.map(stats => (
            <div key={stats.commercial.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold ${
                  stats.commercial.role === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                }`}>
                  {stats.commercial.prenom[0]}
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-lg">{stats.commercial.prenom} {stats.commercial.nom}</h3>
                  <p className="text-xs text-gray-500">{stats.commercial.email} - {stats.commercial.telephone}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 mb-4">
                <div className="bg-gray-50 p-3 rounded-lg text-center">
                  <Phone className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-xl font-bold text-gray-900">{stats.todayCalls}</p>
                  <p className="text-[10px] text-gray-500">Appels aujourd'hui</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg text-center">
                  <Phone className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-xl font-bold text-gray-900">{stats.weekCalls}</p>
                  <p className="text-[10px] text-gray-500">Appels semaine</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg text-center">
                  <Phone className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-xl font-bold text-gray-900">{stats.monthCalls}</p>
                  <p className="text-[10px] text-gray-500">Appels mois</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg text-center">
                  <Calendar className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-xl font-bold text-gray-900">{stats.monthRdv}</p>
                  <p className="text-[10px] text-gray-500">RDV mois</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg text-center">
                  <TrendingUp className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-xl font-bold text-gray-900">{stats.responseRate}%</p>
                  <p className="text-[10px] text-gray-500">Taux reponse</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg text-center">
                  <Award className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-xl font-bold text-gray-900">{stats.conversionRate}%</p>
                  <p className="text-[10px] text-gray-500">Taux conversion</p>
                </div>
              </div>

              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-xs font-medium text-gray-600 mb-2">Duree moyenne des appels: {formatDuration(stats.avgDuration)}</p>
                <p className="text-xs font-medium text-gray-600">Prospects geres: {stats.totalProspects}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
