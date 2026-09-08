// Raison de perte : le choix obligatoire quand un prospect passe en « Perdu », partout
// (glisser dans le pipeline, appel, compte rendu, action terminée).
import { useState } from 'react';
import { Ban, X } from 'lucide-react';
import { RAISONS_PERTE, RaisonPerte as CodeRaison } from '../../shared/tunnel';

export const RAISONS: { value: CodeRaison; label: string }[] = (Object.keys(RAISONS_PERTE) as CodeRaison[]).map(v => ({ value: v, label: RAISONS_PERTE[v] }));

export function libelleRaisonPerte(code: string | undefined | null): string {
  if (!code) return '';
  return (RAISONS_PERTE as Record<string, string>)[code] || code;
}

/** Sélecteur en ligne, pour les fenêtres qui ont déjà leur formulaire (appel, compte rendu). */
export function SelectRaisonPerte({ value, onChange, autoFocus = false }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="mt-2">
      <label className="block text-xs font-medium text-red-700 mb-1">Pourquoi est-il perdu ? *</label>
      <div className="flex flex-wrap gap-1.5">
        {RAISONS.map(r => (
          <button
            key={r.value}
            type="button"
            autoFocus={autoFocus && r.value === 'pas_interesse'}
            onClick={() => onChange(r.value)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${value === r.value ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-700 border-gray-200 hover:border-red-300 hover:text-red-700'}`}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Fenêtre à part entière, quand rien d'autre n'est à saisir (glisser dans « Perdu »). */
export default function RaisonPerteModal({ nom, onConfirm, onClose }: { nom: string; onConfirm: (raison: string) => void | Promise<void>; onClose: () => void }) {
  const [raison, setRaison] = useState('');
  const [enCours, setEnCours] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-bold text-gray-900 flex items-center gap-2"><Ban className="w-5 h-5 text-red-500" /> Prospect perdu</h3>
          <button className="p-1 rounded hover:bg-gray-100" onClick={onClose}><X className="w-5 h-5 text-gray-500" /></button>
        </div>
        <div className="p-4">
          <p className="text-sm text-gray-700"><span className="font-semibold">{nom}</span> passe en « Perdu ».</p>
          <SelectRaisonPerte value={raison} onChange={setRaison} autoFocus />
        </div>
        <div className="p-4 border-t border-gray-200 flex justify-end gap-2">
          <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={onClose}>Annuler</button>
          <button
            className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            disabled={!raison || enCours}
            onClick={async () => { setEnCours(true); try { await onConfirm(raison); } finally { setEnCours(false); } }}
          >
            Confirmer la perte
          </button>
        </div>
      </div>
    </div>
  );
}
