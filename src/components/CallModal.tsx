// Lancer un appel de n'importe où : useCallModal().startCall(…), startSession(…)…
//
// Ce fichier reste léger, il est chargé à l'ouverture de l'appli. L'écran d'appel lui-même
// (EcranAppel.tsx, avec les fiches client et prospect) se télécharge au premier appel — ou
// avant, quand le téléphone n'a rien d'autre à faire. Une demande faite pendant ce
// téléchargement est gardée, puis rejouée dès que l'écran est prêt.
import { createContext, useCallback, useContext, useMemo, useRef, useState, Suspense, type ReactNode } from 'react';
import { pageParesseuse } from '../utils/pageParesseuse';

export type SessionAppel = { ids: string[]; index: number; genre: 'prospect' | 'client' };

export interface ApiAppel {
  startCall: (prospectId: string) => void;
  /** Session d'appels : une file de prospects, enchaînés avec « Suivant ». */
  startSession: (prospectIds: string[]) => void;
  /** Appel d'un client : même fenêtre, même chrono, mêmes résultats ; l'appel est une interaction « APPEL ». */
  startCallClient: (clientId: string) => void;
  /** Session d'appels clients ; `tachesPrecochees` : les tâches qui ont motivé la session, à marquer faites. */
  startSessionClients: (clientIds: string[], tachesPrecochees?: string[]) => void;
}

interface CallModalContextType extends ApiAppel {
  session: SessionAppel | null;
}

const CallModalContext = createContext<CallModalContextType | undefined>(undefined);

export function useCallModal() {
  const context = useContext(CallModalContext);
  if (!context) {
    throw new Error('useCallModal must be used within a CallModalProvider');
  }
  return context;
}

export const chargerEcranAppel = () => import('./EcranAppel');
const EcranAppel = pageParesseuse(chargerEcranAppel);

type Demande = { [K in keyof ApiAppel]: [K, Parameters<ApiAppel[K]>] }[keyof ApiAppel];

export function CallModalProvider({ children }: { children: ReactNode }) {
  const [monte, setMonte] = useState(false);
  const [session, setSession] = useState<SessionAppel | null>(null);
  const api = useRef<ApiAppel | null>(null);
  const enAttente = useRef<Demande[]>([]);

  const brancher = useCallback((a: ApiAppel) => {
    api.current = a;
    // L'écran vient d'arriver : on rejoue ce qu'on a demandé pendant son téléchargement.
    const file = enAttente.current.splice(0);
    for (const [nom, args] of file) (a[nom] as (...x: unknown[]) => void)(...args);
  }, []);

  const valeur = useMemo<CallModalContextType>(() => {
    const demander = (d: Demande) => {
      if (api.current) (api.current[d[0]] as (...x: unknown[]) => void)(...d[1]);
      else { enAttente.current.push(d); setMonte(true); }
    };
    return {
      startCall: (...args) => demander(['startCall', args]),
      startSession: (...args) => demander(['startSession', args]),
      startCallClient: (...args) => demander(['startCallClient', args]),
      startSessionClients: (...args) => demander(['startSessionClients', args]),
      session,
    };
  }, [session]);

  return (
    <CallModalContext.Provider value={valeur}>
      {children}
      {monte && (
        <Suspense fallback={null}>
          <EcranAppel brancher={brancher} onSession={setSession} />
        </Suspense>
      )}
    </CallModalContext.Provider>
  );
}
