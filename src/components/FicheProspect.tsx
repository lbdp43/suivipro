import { Phone, Mail, MapPin, User, Bell, Calendar, ExternalLink, StickyNote } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { Prospect, ESTABLISHMENT_LABELS, PIPELINE_LABELS, PIPELINE_COLORS, CALL_RESULT_LABELS, APPOINTMENT_RESULT_LABELS } from '../types';
import { formatDate, formatDateTime } from '../utils/helpers';
import { dateLocale, jourDe } from '../../shared/regles';
import { prochaineActionDe } from '../../shared/tunnel';
import { libelleRaisonPerte } from './RaisonPerte';

// La fiche d'un établissement, telle qu'on veut l'avoir sous les yeux avant de composer :
// qui c'est, où, ce qu'on sait déjà (tags, notes) et ce qui s'est passé avec lui
// (derniers appels, rendez-vous, rappels). Utilisée entre deux appels d'une session.
export default function FicheProspect({ prospect }: { prospect: Prospect }) {
  const { state, getCallsForProspect, getAppointmentsForProspect, getRemindersForProspect, getCommercial } = useApp();
  const colonne = state.pipelineColumns.find(c => c.id === prospect.etape_pipeline);
  const etape = colonne?.label || PIPELINE_LABELS[prospect.etape_pipeline] || prospect.etape_pipeline;
  const couleur = colonne?.color || PIPELINE_COLORS[prospect.etape_pipeline] || '#6b7280';
  const appels = getCallsForProspect(prospect.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  const aujourdhui = dateLocale(new Date());
  const rdv = getAppointmentsForProspect(prospect.id).filter(a => a.statut !== 'annule').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 2);
  const rappels = getRemindersForProspect(prospect.id).filter(r => r.statut === 'actif').sort((a, b) => a.date.localeCompare(b.date)).slice(0, 2);
  const adresse = [prospect.adresse, [prospect.code_postal, prospect.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const lienMaps = prospect.source_url || (adresse ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(adresse)}` : '');
  const qui = (id: string) => { const c = getCommercial(id); return c ? c.prenom : ''; };
  const prochaine = prochaineActionDe(prospect, state.reminders, state.appointments, aujourdhui);

  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-base font-bold text-gray-900 leading-tight">{prospect.nom_etablissement}</h4>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full text-white flex-shrink-0" style={{ backgroundColor: couleur }}>{etape}</span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          {ESTABLISHMENT_LABELS[prospect.type_etablissement] || prospect.type_etablissement}
          {prospect.secteur ? ` · ${prospect.secteur}` : ''}
          {typeof prospect.score === 'number' ? ` · ${prospect.score} pts` : ''}
        </p>
        {prospect.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {prospect.tags.map(id => { const t = state.tags.find(x => x.id === id); return t ? (
              <span key={id} className="text-white text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: t.couleur }}>{t.nom}</span>
            ) : null; })}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
        <div className="flex items-center gap-2 px-3 py-2">
          <Phone className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          {prospect.telephone ? <span className="font-mono font-semibold text-gray-900">{prospect.telephone}</span> : <span className="text-gray-400 italic">Pas de numéro</span>}
        </div>
        <div className="flex items-center gap-2 px-3 py-2">
          <User className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          <span className={prospect.nom_contact ? 'text-gray-800' : 'text-gray-400 italic'}>{prospect.nom_contact || 'Contact inconnu'}</span>
        </div>
        {prospect.email && (
          <div className="flex items-center gap-2 px-3 py-2">
            <Mail className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            <span className="text-gray-800 truncate">{prospect.email}</span>
          </div>
        )}
        <div className="flex items-center gap-2 px-3 py-2">
          <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          <span className={`flex-1 min-w-0 truncate ${adresse ? 'text-gray-800' : 'text-gray-400 italic'}`}>{adresse || 'Adresse inconnue'}</span>
          {lienMaps && (
            <a href={lienMaps} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 hover:underline flex items-center gap-0.5 flex-shrink-0" title="Ouvrir dans Google Maps">
              Maps <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>

      {prospect.etape_pipeline === 'perdu' && prospect.raison_perte && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5">Perdu : {libelleRaisonPerte(prospect.raison_perte)}</p>
      )}
      {prochaine && (
        <p className={`text-xs rounded-lg px-2.5 py-1.5 border ${prochaine.enRetard ? 'bg-red-50 border-red-100 text-red-700' : 'bg-blue-50 border-blue-100 text-blue-800'}`}>
          Prochaine action : {prochaine.libelle} · {formatDate(prochaine.date)}{prochaine.enRetard ? ' (en retard)' : ''}{prochaine.rappel?.message ? ` · ${prochaine.rappel.message}` : ''}
        </p>
      )}
      {prospect.notes && (
        <div className="flex gap-2 p-2.5 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-900">
          <StickyNote className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-500" />
          <p className="whitespace-pre-line line-clamp-4">{prospect.notes}</p>
        </div>
      )}

      {(appels.length > 0 || rdv.length > 0 || rappels.length > 0) && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Historique</p>
          {rappels.map(r => (
            <div key={r.id} className="flex items-start gap-2 text-xs">
              <Bell className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${r.date < aujourdhui ? 'text-red-500' : 'text-amber-500'}`} />
              <span className="text-gray-500 tabular-nums w-16 flex-shrink-0">{formatDate(r.date)}</span>
              <span className="text-gray-800 truncate">Rappel : {r.message || 'à rappeler'}</span>
            </div>
          ))}
          {rdv.map(a => (
            <div key={a.id} className="flex items-start gap-2 text-xs">
              <Calendar className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-green-600" />
              <span className="text-gray-500 tabular-nums w-16 flex-shrink-0">{formatDate(a.date)}</span>
              <span className="text-gray-800 truncate">
                RDV {a.heure_debut}{qui(a.commercial_id) ? ` avec ${qui(a.commercial_id)}` : ''}
                {a.compte_rendu ? ` · ${APPOINTMENT_RESULT_LABELS[a.compte_rendu] || a.compte_rendu}` : jourDe(a.date) >= aujourdhui ? ' · à venir' : ''}
              </span>
            </div>
          ))}
          {appels.map(c => (
            <div key={c.id} className="flex items-start gap-2 text-xs">
              <Phone className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-gray-400" />
              <span className="text-gray-500 tabular-nums w-16 flex-shrink-0" title={formatDateTime(c.date)}>{formatDate(c.date)}</span>
              <span className="text-gray-800 truncate">
                {CALL_RESULT_LABELS[c.resultat] || c.resultat}{qui(c.commercial_id) ? ` (${qui(c.commercial_id)})` : ''}{c.notes ? ` · ${c.notes}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
