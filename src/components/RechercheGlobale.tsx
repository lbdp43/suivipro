// La recherche de SuiviPro : un client, un prospect ou une page, depuis n'importe quel écran.
// La loupe de l'en-tête l'ouvre, et Ctrl+K (⌘K sur Mac) au clavier.
//
// Tout est cherché dans les données déjà présentes sur le téléphone (lot « données
// rapides ») : pas d'aller-retour au serveur, les résultats suivent la frappe, même hors
// connexion. Accents et majuscules ne comptent pas ; un nom qui commence par ce qu'on tape
// passe devant un nom qui le contient.
//
// Palette inspirée du « Command » de wensity (21st.dev) — groupes titrés, ligne en surbrillance,
// aide au clavier, Échap qui efface avant de fermer —, construite sur cmdk et Radix Dialog.
import { useDeferredValue, useEffect, useMemo, useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { Search, Building2, Users, CornerDownLeft, X, Home, Bell, Map } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { normaliserPourComparaison } from '../../shared/normalisation';
import { groupesDuMenu } from './menu';
import { faitDeLaProspection } from '../utils/roles';

const PAR_GROUPE = 8;

interface Entree {
  id: string;
  titre: string;
  detail: string;
  vers: string;
  cle: string;
  nom: string;
}

function classer(entrees: Entree[], q: string): Entree[] {
  if (!q) return [];
  const debut: Entree[] = []; const dedans: Entree[] = [];
  for (const e of entrees) {
    if (e.nom.startsWith(q)) debut.push(e);
    else if (e.cle.includes(q)) dedans.push(e);
    if (debut.length >= PAR_GROUPE) break;
  }
  return [...debut, ...dedans].slice(0, PAR_GROUPE);
}

export default function RechercheGlobale({ ouvert, onChanger }: { ouvert: boolean; onChanger: (o: boolean) => void }) {
  // Dans le périmètre affiché (« Moi » / « Équipe ») : un client trouvé s'ouvre là où on le voit.
  const { state: stateComplet } = useApp();
  const navigate = useNavigate();
  const [texte, setTexte] = useState('');
  const differe = useDeferredValue(texte);
  const q = normaliserPourComparaison(differe.trim());

  // Ctrl+K / ⌘K, partout.
  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); onChanger(!ouvert); }
    };
    document.addEventListener('keydown', touche);
    return () => document.removeEventListener('keydown', touche);
  }, [ouvert, onChanger]);
  useEffect(() => { if (!ouvert) setTexte(''); }, [ouvert]);

  // L'index se refait quand les données changent, pas à chaque lettre.
  const clients = useMemo<Entree[]>(() => stateComplet.clients.map(c => ({
    id: `c-${c.id}`, titre: c.nom, detail: [c.ville, c.contact, c.statut === 'INACTIF' ? 'inactif' : ''].filter(Boolean).join(' · '),
    vers: `/clients?id=${c.id}`, nom: normaliserPourComparaison(c.nom || ''),
    cle: normaliserPourComparaison([c.nom, c.ville, c.contact, c.telephone, c.telephone_mobile, c.code_postal].filter(Boolean).join(' ')),
  })), [stateComplet.clients]);
  const prospects = useMemo<Entree[]>(() => stateComplet.prospects.map(p => ({
    id: `p-${p.id}`, titre: p.nom_etablissement, detail: [p.ville, p.nom_contact].filter(Boolean).join(' · '),
    vers: `/prospects?id=${p.id}`, nom: normaliserPourComparaison(p.nom_etablissement || ''),
    cle: normaliserPourComparaison([p.nom_etablissement, p.ville, p.nom_contact, p.telephone, p.code_postal].filter(Boolean).join(' ')),
  })), [stateComplet.prospects]);
  const pages = useMemo(() => {
    const u = stateComplet.currentUser;
    const fixes = [
      { to: '/', label: 'Accueil', icon: Home },
      { to: '/rappels', label: 'Rappels et tâches', icon: Bell },
      { to: '/carte', label: 'Carte', icon: Map },
    ];
    const menu = groupesDuMenu(u?.role, faitDeLaProspection(u)).flatMap(g => g.entrees.map(e => ({ to: e.to, label: e.label, icon: e.icon as ComponentType<{ className?: string }> })));
    return [...fixes, ...menu].filter((p, i, t) => t.findIndex(x => x.to === p.to) === i);
  }, [stateComplet.currentUser]);

  const resClients = useMemo(() => classer(clients, q), [clients, q]);
  const resProspects = useMemo(() => classer(prospects, q), [prospects, q]);
  const resPages = useMemo(() => (q ? pages.filter(p => normaliserPourComparaison(p.label).includes(q)) : pages.slice(0, 6)), [pages, q]);

  const aller = (vers: string) => { onChanger(false); navigate(vers); };

  // Le premier résultat est toujours celui qu'Entrée ouvre, même quand la liste change sous
  // les doigts (la recherche suit la frappe avec un temps de retard).
  const premier = resClients[0]?.id ?? resProspects[0]?.id ?? (resPages[0] ? `page-${resPages[0].to}` : '');
  const [choix, setChoix] = useState('');
  useEffect(() => { setChoix(premier); }, [premier]);

  return (
    <Dialog.Root open={ouvert} onOpenChange={onChanger}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          onEscapeKeyDown={e => { if (texte) { e.preventDefault(); setTexte(''); } }}
          className="fixed inset-0 z-[90] flex flex-col bg-white outline-none pt-safe sm:inset-auto sm:left-1/2 sm:top-[12vh] sm:w-[calc(100vw-2rem)] sm:max-w-xl sm:-translate-x-1/2 sm:rounded-2xl sm:shadow-2xl sm:pt-0"
        >
          <Dialog.Title className="sr-only">Rechercher dans SuiviPro</Dialog.Title>
          <Command shouldFilter={false} value={choix} onValueChange={setChoix} label="Rechercher dans SuiviPro" className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2.5 border-b border-gray-200 px-4">
              <Search className="h-5 w-5 flex-shrink-0 text-gray-400" aria-hidden />
              <Command.Input
                value={texte}
                onValueChange={setTexte}
                autoFocus
                placeholder="Un client, un prospect, une page…"
                className="h-14 w-full min-w-0 border-0 bg-transparent text-base text-gray-900 outline-none placeholder:text-gray-400"
              />
              <Dialog.Close className="-mr-2 inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 sm:hidden" aria-label="Fermer">
                <X className="h-5 w-5" />
              </Dialog.Close>
            </div>
            <Command.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 sm:max-h-[26rem] pb-safe">
              {q && resClients.length + resProspects.length + resPages.length === 0 && (
                <Command.Empty className="px-3 py-10 text-center text-sm text-gray-500">Rien ne correspond à « {differe.trim()} ».</Command.Empty>
              )}
              {resClients.length > 0 && (
                <Groupe titre="Clients">
                  {resClients.map(e => <Ligne key={e.id} valeur={e.id} icone={Building2} titre={e.titre} detail={e.detail} onChoisir={() => aller(e.vers)} />)}
                </Groupe>
              )}
              {resProspects.length > 0 && (
                <Groupe titre="Prospects">
                  {resProspects.map(e => <Ligne key={e.id} valeur={e.id} icone={Users} titre={e.titre} detail={e.detail} onChoisir={() => aller(e.vers)} />)}
                </Groupe>
              )}
              {resPages.length > 0 && (
                <Groupe titre={q ? 'Pages' : 'Aller à'}>
                  {resPages.map(p => <Ligne key={p.to} valeur={`page-${p.to}`} icone={p.icon} titre={p.label} onChoisir={() => aller(p.to)} />)}
                </Groupe>
              )}
            </Command.List>
            <div className="hidden items-center gap-4 border-t border-gray-200 px-4 py-2 text-xs text-gray-500 sm:flex">
              <span className="inline-flex items-center gap-1.5"><Touche><CornerDownLeft className="h-3 w-3" /></Touche> ouvrir</span>
              <span className="inline-flex items-center gap-1.5"><Touche>↑</Touche><Touche>↓</Touche> choisir</span>
              <span className="inline-flex items-center gap-1.5"><Touche>Échap</Touche> {texte ? 'effacer' : 'fermer'}</span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Groupe({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <Command.Group heading={titre} className="mb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-gray-500">
      {children}
    </Command.Group>
  );
}

function Ligne({ valeur, icone: Icone, titre, detail, onChoisir }: { valeur: string; icone: ComponentType<{ className?: string }>; titre: string; detail?: string; onChoisir: () => void }) {
  return (
    <Command.Item
      value={valeur}
      onSelect={onChoisir}
      className="flex min-h-12 cursor-pointer select-none items-center gap-3 rounded-lg px-3 py-2 text-gray-900 data-[selected=true]:bg-brewery-50"
    >
      <Icone className="h-4 w-4 flex-shrink-0 text-gray-400" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{titre}</span>
        {detail && <span className="block truncate text-xs text-gray-500">{detail}</span>}
      </span>
    </Command.Item>
  );
}

function Touche({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-gray-200 bg-gray-50 px-1 font-mono text-xs text-gray-500">{children}</kbd>;
}
