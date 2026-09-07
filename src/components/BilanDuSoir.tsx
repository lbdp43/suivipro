import { useMemo, useState } from 'react';
import { MessageSquare, Copy, Send, Check, Moon } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { Appointment, Commercial } from '../types';
import { dateLocale, jourDe, rdvAnnule } from '../../shared/regles';

// Bilan du soir du prospecteur : un message par commercial, avec les rendez-vous pris
// aujourd'hui pour lui — le texte que l'équipe s'envoie déjà à la main chaque soir.
// Envoi par SMS ou WhatsApp (pré-rempli), ou copie du texte.

const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
function dateCourte(iso: string): string {
  const d = new Date(jourDe(iso) + 'T12:00:00');
  return isNaN(d.getTime()) ? iso : `${JOURS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}
function numeroInternational(tel: string): string {
  const chiffres = tel.replace(/[^\d+]/g, '');
  if (chiffres.startsWith('+')) return chiffres.slice(1);
  if (chiffres.startsWith('0')) return '33' + chiffres.slice(1);
  return chiffres;
}

export default function BilanDuSoir({ moi }: { moi: Commercial }) {
  const { state, getProspect, getClient, getCommercial } = useApp();
  const today = dateLocale();
  const [envoyes, setEnvoyes] = useState<Set<string>>(() => {
    try { const v = JSON.parse(localStorage.getItem('suivipro_bilan_' + today) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); }
  });
  const marquer = (id: string) => {
    setEnvoyes(prev => { const next = new Set(prev); next.add(id); try { localStorage.setItem('suivipro_bilan_' + today, JSON.stringify([...next])); } catch { /* */ } return next; });
  };

  const parCommercial = useMemo(() => {
    const pris = state.appointments.filter(a => a.prospecteur_id === moi.id && jourDe(a.created_at) === today && !rdvAnnule(a) && a.commercial_id !== moi.id);
    const m = new Map<string, Appointment[]>();
    for (const r of pris) { const l = m.get(r.commercial_id) || []; l.push(r); m.set(r.commercial_id, l); }
    return [...m.entries()].map(([cid, liste]) => ({ commercial: getCommercial(cid), liste: liste.sort((a, b) => a.date.localeCompare(b.date) || (a.heure_debut || '').localeCompare(b.heure_debut || '')) }));
  }, [state.appointments, moi.id, today, getCommercial]);

  const texteDe = (commercial: Commercial | undefined, liste: Appointment[]) => {
    const lignes = liste.map(r => {
      const p = r.client_id ? null : getProspect(r.prospect_id);
      const c = r.client_id ? getClient(r.client_id) : null;
      const nom = c?.nom || p?.nom_etablissement || r.titre || 'RDV';
      const ville = c?.ville || p?.ville || '';
      const contact = p ? [p.nom_contact, p.telephone].filter(Boolean).join(' ') : c ? [c.contact, c.telephone_mobile || c.telephone].filter(Boolean).join(' ') : '';
      const lieu = r.lieu ? ` — ${r.lieu}` : '';
      const notes = r.notes ? `\n   ${r.notes.trim()}` : '';
      return `• ${dateCourte(r.date)} à ${r.heure_debut || '?'} — ${nom}${ville ? ` (${ville})` : ''}${lieu}${contact ? `\n   Contact : ${contact}` : ''}${notes}`;
    });
    return `Bonjour ${commercial?.prenom || ''},\nvoici ${liste.length > 1 ? `les ${liste.length} rendez-vous pris` : 'le rendez-vous pris'} aujourd'hui pour toi :\n\n${lignes.join('\n')}\n\nBonne soirée,\n${moi.prenom}`;
  };

  const copier = async (id: string, texte: string) => {
    try { await navigator.clipboard.writeText(texte); marquer(id); } catch { window.prompt('Copiez le message :', texte); }
  };

  return (
    <div className="bg-white rounded-xl border border-indigo-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2 text-sm"><Moon className="w-4 h-4 text-indigo-600" /> Bilan du soir</h3>
        <span className="text-[11px] text-gray-400">un message par commercial, avec les RDV pris aujourd'hui</span>
      </div>
      {parCommercial.length === 0 ? (
        <p className="text-xs text-gray-400 italic">Aucun rendez-vous pris aujourd'hui pour un commercial : rien à envoyer.</p>
      ) : (
        <div className="space-y-3">
          {parCommercial.map(({ commercial, liste }) => {
            const id = commercial?.id || 'inconnu';
            const texte = texteDe(commercial, liste);
            const tel = commercial?.telephone || '';
            const fait = envoyes.has(id);
            return (
              <div key={id} className={`rounded-lg border p-3 ${fait ? 'border-green-200 bg-green-50/40' : 'border-gray-200'}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-gray-800">
                    {commercial ? `${commercial.prenom} ${commercial.nom}` : 'Commercial inconnu'} <span className="text-xs font-normal text-gray-400">· {liste.length} RDV</span>
                    {fait && <span className="ml-2 text-[10px] text-green-700 inline-flex items-center gap-0.5"><Check className="w-3 h-3" /> envoyé</span>}
                  </p>
                  <div className="flex gap-1.5">
                    <button onClick={() => copier(id, texte)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200" title="Copier le message"><Copy className="w-3.5 h-3.5" /> Copier</button>
                    {tel && <a href={`sms:${tel.replace(/\s/g, '')}?body=${encodeURIComponent(texte)}`} onClick={() => marquer(id)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100" title="Ouvrir un SMS pré-rempli"><MessageSquare className="w-3.5 h-3.5" /> SMS</a>}
                    {tel && <a href={`https://wa.me/${numeroInternational(tel)}?text=${encodeURIComponent(texte)}`} target="_blank" rel="noopener noreferrer" onClick={() => marquer(id)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100" title="Ouvrir WhatsApp pré-rempli"><Send className="w-3.5 h-3.5" /> WhatsApp</a>}
                    {!tel && <span className="text-[10px] text-amber-700 self-center">pas de téléphone sur sa fiche</span>}
                  </div>
                </div>
                <pre className="mt-2 text-[11px] text-gray-600 whitespace-pre-wrap font-sans bg-gray-50 rounded p-2 max-h-40 overflow-y-auto">{texte}</pre>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
