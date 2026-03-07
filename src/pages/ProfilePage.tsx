import { useState } from 'react';
import { User, Shield, Phone, Mail, Key, Eye, EyeOff, Save, Check, ArrowLeft } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { Link } from 'react-router-dom';

export default function ProfilePage() {
  const { state, dispatch } = useApp();
  const user = state.currentUser;

  const [prenom, setPrenom] = useState(user?.prenom || '');
  const [nom, setNom] = useState(user?.nom || '');
  const [email, setEmail] = useState(user?.email || '');
  const [telephone, setTelephone] = useState(user?.telephone || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  if (!user) return null;

  const isAdmin = user.role === 'admin';

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setError('');
    setSaved(false);

    if (!prenom.trim()) {
      setError('Le prenom est obligatoire.');
      return;
    }
    if (!email.trim()) {
      setError('L\'email est obligatoire.');
      return;
    }
    if (password && password.length < 4) {
      setError('Le mot de passe doit contenir au moins 4 caracteres.');
      return;
    }
    if (password && password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }

    const updated = {
      ...user,
      prenom: prenom.trim(),
      nom: nom.trim(),
      email: email.trim(),
      telephone: telephone.trim(),
      ...(password ? { password } : {}),
    };

    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/commerciaux/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(updated),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Erreur lors de la sauvegarde');
        return;
      }

      // Update local state only after API success
      const { password: _pwd, ...withoutPassword } = updated;
      dispatch({ type: 'UPDATE_COMMERCIAL', payload: withoutPassword });
      dispatch({ type: 'SET_CURRENT_USER', payload: withoutPassword });

      setPassword('');
      setConfirmPassword('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Erreur reseau, reessayez.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-brewery-600 transition-colors mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </Link>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Mon Profil</h1>
        <p className="text-sm text-gray-500 mt-1">Modifiez vos informations personnelles</p>
      </div>

      {/* Profile card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Avatar banner */}
        <div className="bg-gradient-to-r from-brewery-600 to-brewery-700 p-6 flex items-center gap-4">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center shadow-lg ${
            isAdmin ? 'bg-amber-100' : 'bg-white'
          }`}>
            {isAdmin ? (
              <Shield className="w-8 h-8 text-amber-700" />
            ) : (
              <User className="w-8 h-8 text-brewery-700" />
            )}
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">{user.prenom} {user.nom}</h2>
            <span className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
              isAdmin ? 'bg-amber-100 text-amber-800' : 'bg-white/20 text-white'
            }`}>
              {isAdmin ? 'Administrateur' : 'Commercial'}
            </span>
          </div>
        </div>

        {/* Form */}
        <div className="p-5 sm:p-6 space-y-5">
          {/* Prenom / Nom */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Prenom *</label>
              <input
                type="text"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
                value={prenom}
                onChange={e => setPrenom(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Nom</label>
              <input
                type="text"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
                value={nom}
                onChange={e => setNom(e.target.value)}
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5 flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" />
              Email *
            </label>
            <input
              type="email"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
              placeholder="prenom@labrasseriedesplantes.fr"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>

          {/* Telephone */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5 flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5" />
              Telephone
            </label>
            <input
              type="tel"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
              placeholder="06 00 00 00 00"
              value={telephone}
              onChange={e => setTelephone(e.target.value)}
            />
          </div>

          {/* Separator */}
          <div className="border-t border-gray-100 pt-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Key className="w-4 h-4 text-gray-500" />
              Changer le mot de passe
            </h3>
            <p className="text-xs text-gray-400 mb-4">Laissez vide pour conserver le mot de passe actuel.</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Nouveau mot de passe</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm pr-10 focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
                    placeholder="Nouveau mot de passe..."
                    value={password}
                    onChange={e => setPassword(e.target.value)}
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
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Confirmer le mot de passe</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
                  placeholder="Confirmer..."
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {/* Success */}
          {saved && (
            <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 flex items-center gap-2">
              <Check className="w-4 h-4" />
              Profil mis a jour avec succes !
            </div>
          )}

          {/* Save button */}
          <div className="flex justify-end pt-2">
            <button
              className="px-5 py-2.5 bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 transition-colors text-sm font-medium flex items-center gap-2 shadow-sm disabled:opacity-50"
              onClick={handleSave}
              disabled={saving}
            >
              <Save className="w-4 h-4" />
              {saving ? 'Enregistrement...' : 'Enregistrer les modifications'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
