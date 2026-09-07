// Équipe : membres, rôles, mots de passe — onglet de la page Administration, extrait tel quel.
import { useState } from 'react';
import { Users, Plus, X, Save, Edit2, Trash2, Shield, User, Eye, EyeOff, Key } from 'lucide-react';
import { apiPost, apiPut, apiDelete } from '../../api/client';
import { Commercial, UserRole } from '../../types';
import { objectifsParDefaut } from '../../utils/objectifs';
import { generateId } from '../../utils/helpers';
import { useApp } from '../../store/AppContext';
import { useToast } from '../../components/Toast';

export default function OngletEquipe() {
  const { state, dispatchLocal } = useApp();
  const toast = useToast();

  // Team management state
  const [showUserForm, setShowUserForm] = useState(false);

  const [editingUser, setEditingUser] = useState<Commercial | null>(null);

  const [userForm, setUserForm] = useState({
    prenom: '', nom: '', email: '', telephone: '', role: 'commercial' as UserRole, password: '', prospection: false,
  });

  const [showPassword, setShowPassword] = useState(false);

  const openNewUser = () => {
    setUserForm({ prenom: '', nom: '', email: '', telephone: '', role: 'commercial', password: '', prospection: false });
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
      prospection: !!user.prospection,
    });
    setEditingUser(user);
    setShowUserForm(true);
    setShowPassword(false);
  };

  const saveUser = async () => {
    if (!userForm.prenom || !userForm.email) return;

    try {
      if (editingUser) {
        const updated: Commercial = {
          ...editingUser,
          prenom: userForm.prenom,
          nom: userForm.nom,
          email: userForm.email,
          telephone: userForm.telephone,
          role: userForm.role,
          prospection: userForm.role !== 'prospection' && userForm.prospection,
          password: userForm.password || editingUser.password,
        };
        await apiPut(`/commerciaux/${editingUser.id}`, updated);
        dispatchLocal({ type: 'UPDATE_COMMERCIAL', payload: updated });
      } else {
        if (!userForm.password) return;
        const newUser: Commercial = {
          id: generateId('com'),
          prenom: userForm.prenom,
          nom: userForm.nom,
          email: userForm.email,
          telephone: userForm.telephone,
          role: userForm.role,
          prospection: userForm.role !== 'prospection' && userForm.prospection,
          password: userForm.password,
          objectifs: objectifsParDefaut(userForm.role, userForm.role !== 'prospection' && userForm.prospection),
        };
        await apiPost('/commerciaux', newUser);
        dispatchLocal({ type: 'ADD_COMMERCIAL', payload: newUser });
      }
      setShowUserForm(false);
    } catch (error) {
      toast.error('Erreur lors de la sauvegarde de l\'utilisateur.');
    }
  };

  const deleteUser = async (user: Commercial) => {
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
      try {
        await apiDelete(`/commerciaux/${user.id}`);
        dispatchLocal({ type: 'DELETE_COMMERCIAL', payload: user.id });
      } catch (error) {
        toast.error('Erreur lors de la suppression de l\'utilisateur.');
      }
    }
  };

  // ============================================
  // Objectives
  // ============================================

  return (
    <>
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
                    user.role === 'admin' ? 'bg-amber-100 text-amber-700' : user.role === 'prospection' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
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
                      ) : user.role === 'prospection' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-700">
                          <Users className="w-3 h-3" /> Prospection
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700">
                          <User className="w-3 h-3" /> Commercial
                        </span>
                      )}
                      {user.role !== 'prospection' && user.prospection && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-700">
                          <Users className="w-3 h-3" /> + prospection
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
            <div className="modal-backdrop">
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
                    <label className="block text-xs font-medium text-gray-600 mb-1">Téléphone</label>
                    <input
                      type="tel"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      placeholder="06 00 00 00 00"
                      value={userForm.telephone}
                      onChange={e => setUserForm(prev => ({ ...prev, telephone: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Rôle</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium border transition-colors ${
                          userForm.role === 'admin'
                            ? 'border-amber-500 bg-amber-50 text-amber-700'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                        onClick={() => setUserForm(prev => ({ ...prev, role: 'admin' }))}
                      >
                        <Shield className="w-4 h-4" /> Admin
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
                      <button
                        className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium border transition-colors ${
                          userForm.role === 'prospection'
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                        onClick={() => setUserForm(prev => ({ ...prev, role: 'prospection' }))}
                      >
                        <Users className="w-4 h-4" /> Prospection
                      </button>
                    </div>
                    {userForm.role !== 'prospection' && (
                      <label className="mt-2 flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
                        <input type="checkbox" className="mt-0.5" checked={userForm.prospection} onChange={e => setUserForm(prev => ({ ...prev, prospection: e.target.checked }))} />
                        <span><b>Fait aussi de la prospection</b> — appels et rendez-vous pris pour les autres. Il aura les deux accueils, les deux jeux d'objectifs, et comptera dans les deux vues d'équipe.</span>
                      </label>
                    )}
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
                    <Save className="w-4 h-4" /> {editingUser ? 'Modifier' : 'Créer'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
    </>
  );
}
