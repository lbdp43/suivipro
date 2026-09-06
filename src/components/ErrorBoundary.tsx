import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string;
}

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: null, componentStack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
    this.setState({ componentStack: info.componentStack || '' });
  }

  // Le message seul (« Cannot read properties of undefined ») ne dit pas OU ca casse.
  // On affiche les premieres lignes de la pile et le composant fautif : c'est ce qui
  // permet de corriger a partir d'une simple capture d'ecran.
  details() {
    const err = this.state.error;
    if (!err) return '';
    const pile = String(err.stack || '').split('\n').slice(0, 5).join('\n');
    const composants = this.state.componentStack.split('\n').filter(Boolean).slice(0, 4).join('\n');
    return `${pile}${composants ? '\n--- composants ---\n' + composants : ''}`;
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 max-w-md w-full text-center">
            <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-7 h-7 text-red-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Une erreur est survenue</h2>
            <p className="text-sm text-gray-500 mb-6">
              L'application a rencontre un probleme inattendu. Rechargez la page pour continuer.
            </p>
            {this.state.error && (
              <p className="text-xs text-gray-400 bg-gray-50 rounded-lg p-3 mb-2 font-mono break-all">
                {this.state.error.message}
              </p>
            )}
            {this.details() && (
              <details className="text-left mb-4">
                <summary className="text-xs text-gray-500 cursor-pointer">Details techniques (a transmettre en cas de blocage)</summary>
                <pre className="text-[10px] text-gray-500 bg-gray-50 rounded-lg p-3 mt-2 overflow-x-auto whitespace-pre-wrap break-all">{this.details()}</pre>
              </details>
            )}
            <button
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 text-sm font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              Recharger la page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
