// Le centre de notifications : deux onglets (Toutes, Non lues), groupées par jour, et
// chacune mène là où il y a quelque chose à faire — la fiche, la boîte de prospection,
// l'onglet EasyBeer concerné. Sur ordinateur, une bulle sous la cloche ; sur téléphone, un
// panneau qui monte du bas de l'écran.
//
// Inspiré de « Notification Inbox Popover » (ruixen.ui) et « Vercel Notification Popover »
// (patrick-xin) de 21st.dev.
import { Suspense, useEffect, useMemo, useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, CheckCheck, ChevronRight, ClipboardList, CheckCircle2, MapPin, Building2, Hourglass, Package,
  AlertTriangle, Link2, Sparkles, Megaphone, Info, RefreshCw, Bot, Copy,
} from 'lucide-react';
import { dateLocale } from '../../shared/regles';
import { pageParesseuse } from '../utils/pageParesseuse';

const Fenetre = pageParesseuse(() => import('./ui/Fenetre'));

export interface NotificationRecue {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
  data?: string;
}

type Teinte = 'gris' | 'vert' | 'ambre' | 'rouge' | 'bleu' | 'violet';

const GENRES: Record<string, { icone: ComponentType<{ className?: string }>; teinte: Teinte }> = {
  TASK_ASSIGNED: { icone: ClipboardList, teinte: 'violet' },
  TASK_COMPLETED: { icone: CheckCircle2, teinte: 'vert' },
  VISIT_REMINDER: { icone: MapPin, teinte: 'vert' },
  NEW_CLIENT_ASSIGNED: { icone: Building2, teinte: 'bleu' },
  CLIENT_PENDING: { icone: Hourglass, teinte: 'ambre' },
  commande: { icone: Package, teinte: 'ambre' },
  commande_auto: { icone: Package, teinte: 'ambre' },
  commande_orpheline: { icone: AlertTriangle, teinte: 'rouge' },
  easybeer_client_linked: { icone: Link2, teinte: 'bleu' },
  easybeer_client_created: { icone: Sparkles, teinte: 'vert' },
  easybeer_client_pending: { icone: Hourglass, teinte: 'ambre' },
  easybeer_doublon: { icone: Copy, teinte: 'ambre' },
  sync_erreur: { icone: RefreshCw, teinte: 'rouge' },
  mcp_usage: { icone: Bot, teinte: 'rouge' },
  signalement: { icone: Megaphone, teinte: 'violet' },
  info: { icone: Info, teinte: 'gris' },
};

const TEINTES: Record<Teinte, string> = {
  gris: 'bg-gray-100 text-gray-600',
  vert: 'bg-green-100 text-green-700',
  ambre: 'bg-amber-100 text-amber-700',
  rouge: 'bg-red-100 text-red-700',
  bleu: 'bg-blue-100 text-blue-700',
  violet: 'bg-purple-100 text-purple-700',
};

function lireDonnees(n: NotificationRecue): Record<string, unknown> {
  try { return n.data ? JSON.parse(n.data) : {}; } catch { return {}; }
}

/** Où mène une notification ; null quand il n'y a rien à ouvrir. */
export function destination(n: NotificationRecue): string | null {
  const d = lireDonnees(n);
  switch (n.type) {
    case 'signalement': return '/boite';
    case 'easybeer_doublon':
    case 'commande_orpheline': return '/easybeer?onglet=controle';
    case 'easybeer_client_pending':
    case 'sync_erreur': return '/easybeer?onglet=synchronisation';
    case 'mcp_usage': return '/admin?onglet=claude';
    case 'TASK_ASSIGNED':
    case 'TASK_COMPLETED': return '/taches';
    default: break;
  }
  if (typeof d.client_id === 'string' && d.client_id) return `/clients?id=${encodeURIComponent(d.client_id)}`;
  if (typeof d.existing_client_id === 'string' && d.existing_client_id) return `/clients?id=${encodeURIComponent(d.existing_client_id)}`;
  if (typeof d.prospect_id === 'string' && d.prospect_id) return `/prospects?id=${encodeURIComponent(d.prospect_id)}`;
  return null;
}

function titreDuJour(jour: string) {
  const auj = dateLocale(new Date());
  const hier = new Date(); hier.setDate(hier.getDate() - 1);
  if (jour === auj) return "Aujourd'hui";
  if (jour === dateLocale(hier)) return 'Hier';
  const d = new Date(`${jour}T12:00:00`);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function ilYA(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

interface Props {
  notifications: NotificationRecue[];
  nonLues: number;
  onLue: (id: string) => void;
  onToutLu: () => void;
  onFermer: () => void;
}

function Contenu({ notifications, nonLues, onLue, onToutLu, onFermer }: Props) {
  const navigate = useNavigate();
  const [onglet, setOnglet] = useState<'toutes' | 'non_lues'>(nonLues > 0 ? 'non_lues' : 'toutes');
  useEffect(() => { if (nonLues === 0) setOnglet('toutes'); }, [nonLues]);

  const liste = onglet === 'non_lues' ? notifications.filter(n => !n.read) : notifications;
  const parJour = useMemo(() => {
    const g: { jour: string; l: NotificationRecue[] }[] = [];
    for (const n of liste) {
      const jour = dateLocale(new Date(n.created_at));
      const dernier = g[g.length - 1];
      if (dernier && dernier.jour === jour) dernier.l.push(n); else g.push({ jour, l: [n] });
    }
    return g;
  }, [liste]);

  const ouvrir = (n: NotificationRecue) => {
    if (!n.read) onLue(n.id);
    const vers = destination(n);
    if (vers) { onFermer(); navigate(vers); }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
        <div className="flex rounded-lg bg-gray-100 p-0.5 text-xs font-medium" role="tablist" aria-label="Notifications à afficher">
          {([['toutes', 'Toutes'], ['non_lues', 'Non lues']] as const).map(([cle, libelle]) => (
            <button key={cle} type="button" role="tab" aria-selected={onglet === cle} onClick={() => setOnglet(cle)}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 ${onglet === cle ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {libelle}
              {cle === 'non_lues' && nonLues > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-bold leading-4 text-white">{nonLues > 99 ? '99+' : nonLues}</span>}
            </button>
          ))}
        </div>
        {nonLues > 0 && (
          <button type="button" onClick={onToutLu} className="flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-brewery-700 hover:bg-brewery-50">
            <CheckCheck className="h-3.5 w-3.5" /> Tout marquer lu
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {liste.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100"><Bell className="h-5 w-5 text-gray-400" /></span>
            <p className="text-sm font-medium text-gray-700">{onglet === 'non_lues' ? 'Tout est lu' : 'Aucune notification'}</p>
            <p className="text-xs text-gray-400">{onglet === 'non_lues' ? 'Rien de nouveau depuis votre dernier passage.' : 'Les alertes EasyBeer, les signalements et le reste arriveront ici.'}</p>
          </div>
        ) : parJour.map(g => (
          <section key={g.jour} aria-label={titreDuJour(g.jour)}>
            <h4 className="sticky top-0 z-10 bg-gray-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{titreDuJour(g.jour)}</h4>
            <ul>
              {g.l.map(n => {
                const genre = GENRES[n.type] || GENRES.info;
                const vers = destination(n);
                return (
                  <li key={n.id}>
                    <button type="button" onClick={() => ouvrir(n)}
                      className={`flex w-full items-start gap-3 border-b border-gray-50 px-4 py-3 text-left hover:bg-gray-50 ${n.read ? '' : 'bg-brewery-50/40'}`}>
                      <span className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${TEINTES[genre.teinte]}`}>
                        <genre.icone className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm ${n.read ? 'text-gray-700' : 'font-semibold text-gray-900'}`}>{n.title}</span>
                        {n.message && <span className="mt-0.5 block text-xs text-gray-500 line-clamp-2">{n.message}</span>}
                        <span className="mt-1 block text-xs text-gray-400">{ilYA(n.created_at)}</span>
                      </span>
                      <span className="flex flex-shrink-0 flex-col items-end gap-2 pt-1">
                        {!n.read && <span className="h-2 w-2 rounded-full bg-brewery-500" aria-label="non lue" />}
                        {vers && <ChevronRight className="h-4 w-4 text-gray-300" aria-hidden />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Bulle sous la cloche (ordinateur) ou panneau du bas (téléphone). */
export default function CentreNotifications({ ouvert, telephone, ...props }: Props & { ouvert: boolean; telephone: boolean }) {
  if (!ouvert) return null;
  if (telephone) {
    return (
      <Suspense fallback={null}>
        <Fenetre ouvert onFermer={props.onFermer} titre="Notifications" icone={<Bell className="h-5 w-5" />}>
          <div className="-mx-5 -my-4 flex max-h-[70vh] flex-col">
            <Contenu {...props} />
          </div>
        </Fenetre>
      </Suspense>
    );
  }
  return (
    <div className="absolute right-0 top-full z-50 mt-2 flex max-h-[32rem] w-96 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
      <div className="flex items-center gap-2 px-4 pb-1 pt-3">
        <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
      </div>
      <Contenu {...props} />
    </div>
  );
}
