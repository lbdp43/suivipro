// Les tournées des commerciaux vues par la prospection, dans Rendez-vous : pour un jour,
// une puce par commercial (secteurs, RDV à prendre, pris), et une fenêtre avec tout ce
// que le commercial a réglé et écrit sur sa tournée.
import { Info, X, Calendar, MapPin, User } from 'lucide-react';
import { ResumeTournee, JOURS_SEMAINE, LIBELLES_JOURS } from '../utils/resumeTournees';
import { colorForCommercial } from '../types';

export function PucesTourneesDuJour({ resumes, jour, onInfo, compact = false }: { resumes: ResumeTournee[]; jour: string; onInfo: (r: ResumeTournee) => void; compact?: boolean }) {
  const lignes = resumes
    .map(r => ({ r, j: r.jours.find(x => x.jour === jour)! }))
    .filter(({ j }) => j && (j.zones.length > 0 || j.aPrendre > 0));
  if (lignes.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-1 ${compact ? '' : 'mt-1.5'}`}>
      {lignes.map(({ r, j }) => (
        <button
          key={r.commercial.id}
          type="button"
          onClick={() => onInfo(r)}
          title={`${r.commercial.prenom} ${r.commercial.nom} : voir sa tournée`}
          className={`inline-flex items-center gap-1 rounded-full border bg-white pl-1.5 pr-2 py-0.5 text-left hover:bg-gray-50 ${compact ? 'text-[10px]' : 'text-[11px]'} ${j.aPrendre > j.pris ? 'border-green-300' : 'border-gray-200'}`}
        >
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: colorForCommercial(r.commercial.id) }} />
          <span className="font-semibold text-gray-800">{r.commercial.prenom}</span>
          <span className="text-gray-600 truncate max-w-[180px]">{j.zones.join(', ') || 'sans secteur'}</span>
          {j.aPrendre > 0 && <span className={`font-semibold px-1 rounded ${j.pris >= j.aPrendre ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-800'}`}>{j.pris}/{j.aPrendre} RDV</span>}
          {j.aPrendre === 0 && j.pris > 0 && <span className="font-semibold px-1 rounded bg-blue-100 text-blue-700">{j.pris} pris</span>}
          <Info className="w-3 h-3 text-gray-400 flex-shrink-0" />
        </button>
      ))}
    </div>
  );
}

export function InfoTourneeModal({ resume, semaine, onClose }: { resume: ResumeTournee; semaine: string; onClose: () => void }) {
  const c = resume.commercial;
  const restant = Math.max(0, resume.totalAPrendre - resume.totalPris);
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-200 flex items-start justify-between gap-2">
          <div>
            <h3 className="font-bold text-gray-900 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full inline-block" style={{ background: colorForCommercial(c.id) }} />
              Tournée de {c.prenom} {c.nom}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">{resume.motif}{!resume.active ? ' · pas de tournée cette semaine' : ''} · {semaine}{c.telephone ? ` · ${c.telephone}` : ''}</p>
          </div>
          <button className="p-1 rounded hover:bg-gray-100" onClick={onClose}><X className="w-5 h-5 text-gray-500" /></button>
        </div>
        <div className="p-4 space-y-4">
          {/* Situation générale */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-green-50 border border-green-100 p-2"><p className="text-lg font-bold text-green-700 tabular-nums">{resume.totalAPrendre}</p><p className="text-[11px] text-green-800">RDV demandés cette semaine</p></div>
            <div className="rounded-lg bg-blue-50 border border-blue-100 p-2"><p className="text-lg font-bold text-blue-700 tabular-nums">{resume.totalPris}</p><p className="text-[11px] text-blue-800">RDV pris</p></div>
            <div className={`rounded-lg border p-2 ${restant ? 'bg-amber-50 border-amber-100' : 'bg-gray-50 border-gray-100'}`}><p className={`text-lg font-bold tabular-nums ${restant ? 'text-amber-700' : 'text-gray-500'}`}>{restant}</p><p className={`text-[11px] ${restant ? 'text-amber-800' : 'text-gray-500'}`}>reste à prendre</p></div>
          </div>
          {/* Ce qu'il a écrit */}
          <div className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${resume.info ? 'bg-blue-50 border-blue-100 text-blue-900' : 'bg-gray-50 border-gray-100 text-gray-400 italic'}`}>
            <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <p className="whitespace-pre-wrap break-words">{resume.info || 'Rien d\'écrit sur sa tournée pour l\'instant.'}</p>
          </div>
          <p className="text-xs text-gray-500 flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> {resume.nbZonesDessinees ? `${resume.nbZonesDessinees} zone${resume.nbZonesDessinees > 1 ? 's' : ''} dessinée${resume.nbZonesDessinees > 1 ? 's' : ''} sur la carte` : 'Aucune zone dessinée sur la carte'}</p>
          {/* Semaine */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {JOURS_SEMAINE.map(jour => {
              const j = resume.jours.find(x => x.jour === jour)!;
              const vide = j.zones.length === 0 && j.pris === 0;
              return (
                <div key={jour} className={`p-2 rounded-lg text-center border ${j.aPrendre > 0 ? 'bg-green-50 border-green-200' : j.zones.length ? 'bg-indigo-50 border-indigo-100' : j.pris ? 'bg-blue-50 border-blue-100' : 'bg-gray-50 border-gray-100'}`}>
                  <p className="text-[10px] font-medium text-gray-500 mb-1">{LIBELLES_JOURS[jour]}</p>
                  {vide ? <span className="text-xs text-gray-400">-</span> : (
                    <div className="space-y-0.5">
                      {j.zones.map(z => <p key={z} className={`text-xs font-medium ${j.aPrendre ? 'text-green-700' : 'text-indigo-700'}`}>{z}</p>)}
                      {j.visitesTotal > 0 && <p className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-orange-700 bg-orange-100 rounded-full px-2 py-0.5"><User className="w-2.5 h-2.5" /> {j.visitesFaites}/{j.visitesTotal} visites</p>}
                      {j.aPrendre > 0 && <p className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-green-700 bg-green-100 rounded-full px-2 py-0.5"><Calendar className="w-2.5 h-2.5" /> {j.aPrendre} à prendre</p>}
                      {j.pris > 0 && <p className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-700 bg-blue-100 rounded-full px-2 py-0.5"><Calendar className="w-2.5 h-2.5" /> {j.pris} pris</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
