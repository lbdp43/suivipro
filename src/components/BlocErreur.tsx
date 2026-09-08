import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { estUneErreurDeChargement, rechargerUneFois } from '../utils/version';

// Limite d'erreur PAR BLOC : si un bloc de l'accueil casse sur une donnée inattendue, lui
// seul affiche un message ; le reste de la page continue à fonctionner.
interface Props { titre?: string; children: React.ReactNode }
interface State { erreur: Error | null }

export default class BlocErreur extends React.Component<Props, State> {
  state: State = { erreur: null };
  static getDerivedStateFromError(erreur: Error): State { return { erreur }; }
  componentDidCatch(erreur: Error, info: React.ErrorInfo) {
    console.error(`[BlocErreur${this.props.titre ? ' ' + this.props.titre : ''}]`, erreur, info.componentStack);
    // Un fichier de page introuvable (nouvelle version déployée) : recharger règle tout.
    if (estUneErreurDeChargement(erreur)) rechargerUneFois();
  }
  render() {
    if (this.state.erreur) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          <p className="font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {this.props.titre ? `Le bloc « ${this.props.titre} » n'a pas pu s'afficher.` : 'Ce bloc n\'a pas pu s\'afficher.'}</p>
          <p className="text-xs text-red-600 mt-1 font-mono break-all">{this.state.erreur.message}</p>
          <div className="mt-2 flex gap-3">
            <button onClick={() => this.setState({ erreur: null })} className="text-xs underline">Réessayer</button>
            <button onClick={() => window.location.reload()} className="text-xs underline">Recharger la page</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
