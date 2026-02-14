import { useState } from 'react';
import { Beer, LogIn, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useApp } from '../store/AppContext';

export default function LoginPage() {
  const { state, dispatch } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    setTimeout(() => {
      const user = state.commerciaux.find(
        c => c.email.toLowerCase() === email.toLowerCase() && c.password === password
      );

      if (user) {
        dispatch({ type: 'SET_CURRENT_USER', payload: user });
      } else {
        setError('Email ou mot de passe incorrect');
      }
      setLoading(false);
    }, 300);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brewery-50 via-white to-green-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-brewery-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Beer className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">SuiviPro</h1>
          <p className="text-sm text-gray-500 mt-1">La Brasserie des Plantes</p>
        </div>

        {/* Login card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Connexion</h2>
          <p className="text-sm text-gray-500 mb-6">Connectez-vous pour acceder a l'application</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500"
                placeholder="votre@email.fr"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mot de passe</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brewery-500 focus:border-brewery-500 pr-10"
                  placeholder="Votre mot de passe"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
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

            {error && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brewery-600 text-white py-2.5 rounded-lg hover:bg-brewery-700 font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              Se connecter
            </button>
          </form>
        </div>

        {/* Hint */}
        <div className="mt-4 bg-white/80 rounded-xl border border-gray-200 p-4 text-xs text-gray-500 text-center">
          <p className="font-medium text-gray-600 mb-1">Comptes par defaut :</p>
          <p>Guillaume (admin) : guillaume@labrasseriedesplantes.fr / admin123</p>
          <p>Louis : louis@labrasseriedesplantes.fr / louis123</p>
          <p>Lucas : lucas@labrasseriedesplantes.fr / lucas123</p>
          <p>Alban : alban@labrasseriedesplantes.fr / alban123</p>
          <p>Loic : loic@labrasseriedesplantes.fr / loic123</p>
        </div>
      </div>
    </div>
  );
}
