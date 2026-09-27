// Les messages de SuiviPro (« Visite enregistrée », « Erreur… »), affichés par sonner :
// empilés proprement, fermés d'un glissement du doigt, placés sous l'encoche de l'iPhone,
// annoncés aux lecteurs d'écran. L'usage ne change pas : `const toast = useToast();
// toast.success('…')`. Hors d'un composant, `import { toast } from 'sonner'`.
import { type ReactNode } from 'react';
import { Toaster, toast as sonner } from 'sonner';
import { HoteConfirmation } from './ui/Confirmation';

const TOAST = {
  success: (msg: string) => { sonner.success(msg); },
  error: (msg: string) => { sonner.error(msg, { duration: 6000 }); },
  warning: (msg: string) => { sonner.warning(msg); },
  info: (msg: string) => { sonner.info(msg); },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster
        position="top-center"
        richColors
        closeButton
        duration={4000}
        offset={{ top: 'max(1rem, env(safe-area-inset-top))' }}
        mobileOffset={{ top: 'max(0.75rem, env(safe-area-inset-top))', left: '0.75rem', right: '0.75rem' }}
        toastOptions={{ style: { zIndex: 10001 }, closeButtonAriaLabel: 'Fermer' }}
      />
      <HoteConfirmation />
    </>
  );
}

export function useToast() {
  return TOAST;
}
