// Ce que l'IA (Claude, ChatGPT) peut faire pour chacun : l'administration ouvre ou coupe
// des familles d'outils, par personne. Tout est ouvert par défaut ; ce qui est coupé
// disparaît de l'IA de cette personne, pour tous ses accès.
import { useEffect, useState } from 'react';
import { SlidersHorizontal, ChevronDown, Eye, PenLine } from 'lucide-react';
import { apiGet, apiPut } from '../../api/client';
import { useToast } from '../../components/Toast';
import { libelleRole } from '../../utils/roles';
import type { Commercial } from '../../types';

interface Famille { cle: string; libelle: string; description: string; ecrit: boolean }
interface Personne { id: string; prenom: string; nom: string; role: Commercial['role']; prospection?: boolean; refus: string[] }
interface Droits { familles: Famille[]; horsRole: Record<string, string[]>; personnes: Personne[] }

function Interrupteur({ actif, desactive, onChange, etiquette }: { actif: boolean; desactive?: boolean; onChange: () => void; etiquette: string }) {
  return (
    <button type="button" role="switch" aria-checked={actif} aria-label={etiquette} disabled={desactive} onClick={onChange}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${actif ? 'bg-brewery-600' : 'bg-gray-300'}`}>
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${actif ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

export default function DroitsIA() {
  const toast = useToast();
  const [droits, setDroits] = useState<Droits | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Droits>('/mcp/droits').then(setDroits).catch(err => toast.error(`Droits IA illisibles : ${(err as Error).message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!droits) return null;

  const basculer = async (p: Personne, cle: string) => {
    const refus = p.refus.includes(cle) ? p.refus.filter(c => c !== cle) : [...p.refus, cle];
    setEnCours(`${p.id}:${cle}`);
    try {
      await apiPut(`/mcp/droits/${p.id}`, { refus });
      setDroits(d => d && { ...d, personnes: d.personnes.map(x => (x.id === p.id ? { ...x, refus } : x)) });
      const f = droits.familles.find(x => x.cle === cle);
      toast.success(`${p.prenom} : « ${f?.libelle} » ${refus.includes(cle) ? 'coupé' : 'ouvert'}`);
    } catch (err) {
      toast.error(`Impossible d'enregistrer : ${(err as Error).message}`);
    } finally {
      setEnCours(null);
    }
  };

  const toutOuvrir = async (p: Personne) => {
    setEnCours(`${p.id}:tout`);
    try {
      await apiPut(`/mcp/droits/${p.id}`, { refus: [] });
      setDroits(d => d && { ...d, personnes: d.personnes.map(x => (x.id === p.id ? { ...x, refus: [] } : x)) });
      toast.success(`${p.prenom} : tout est ouvert`);
    } catch (err) {
      toast.error(`Impossible d'enregistrer : ${(err as Error).message}`);
    } finally {
      setEnCours(null);
    }
  };

  const lectureSeule = async (p: Personne) => {
    const refus = droits.familles.filter(f => f.ecrit).map(f => f.cle);
    setEnCours(`${p.id}:tout`);
    try {
      await apiPut(`/mcp/droits/${p.id}`, { refus });
      setDroits(d => d && { ...d, personnes: d.personnes.map(x => (x.id === p.id ? { ...x, refus } : x)) });
      toast.success(`${p.prenom} : lecture seule`);
    } catch (err) {
      toast.error(`Impossible d'enregistrer : ${(err as Error).message}`);
    } finally {
      setEnCours(null);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <SlidersHorizontal className="h-4 w-4 text-brewery-600" /> Ce que l'IA peut faire
        </h3>
        <p className="mt-1 text-xs text-gray-500">
          Par personne, pour tous ses accès (Claude comme ChatGPT). Ce qui est coupé disparaît de son IA dès la prochaine question ;
          si on le lui demande, l'IA répond que ce n'est pas autorisé pour ce compte. Tout est ouvert par défaut.
        </p>
      </div>
      <ul className="divide-y divide-gray-100 border-t border-gray-100">
        {droits.personnes.map(p => {
          const horsRole = new Set(droits.horsRole[p.role] || []);
          const utiles = droits.familles.filter(f => !horsRole.has(f.cle));
          const coupees = utiles.filter(f => p.refus.includes(f.cle));
          const deplie = ouvert === p.id;
          return (
            <li key={p.id}>
              <button type="button" onClick={() => setOuvert(deplie ? null : p.id)} aria-expanded={deplie}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900">{p.prenom} {p.nom}</span>
                  <span className="text-xs text-gray-500">{libelleRole(p)}</span>
                </span>
                <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${coupees.length === 0 ? 'bg-green-50 text-green-700' : coupees.length === utiles.length ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>
                  {coupees.length === 0 ? 'Tout ouvert' : coupees.length === utiles.length ? 'Tout coupé' : `${coupees.length} coupée${coupees.length > 1 ? 's' : ''}`}
                </span>
                <ChevronDown className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${deplie ? 'rotate-180' : ''}`} />
              </button>
              {deplie && (
                <div className="space-y-4 bg-gray-50 px-4 pb-4 pt-2">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={!!enCours} onClick={() => toutOuvrir(p)} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">Tout ouvrir</button>
                    <button type="button" disabled={!!enCours} onClick={() => lectureSeule(p)} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">Lecture seule</button>
                  </div>
                  {[{ titre: 'Lire', icone: Eye, ecrit: false }, { titre: 'Écrire dans SuiviPro', icone: PenLine, ecrit: true }].map(groupe => (
                    <div key={groupe.titre}>
                      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500"><groupe.icone className="h-3.5 w-3.5" /> {groupe.titre}</p>
                      <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
                        {droits.familles.filter(f => f.ecrit === groupe.ecrit).map(f => {
                          const exclu = horsRole.has(f.cle);
                          const actif = !exclu && !p.refus.includes(f.cle);
                          return (
                            <li key={f.cle} className="flex items-center gap-3 px-3 py-2.5">
                              <span className="min-w-0 flex-1">
                                <span className={`block text-sm ${exclu ? 'text-gray-400' : 'text-gray-900'}`}>{f.libelle}</span>
                                <span className="block text-xs text-gray-500">{exclu ? `Jamais pour le rôle ${libelleRole(p).toLowerCase()}.` : f.description}</span>
                              </span>
                              <Interrupteur actif={actif} desactive={exclu || !!enCours} onChange={() => basculer(p, f.cle)} etiquette={`${f.libelle} pour ${p.prenom}`} />
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
