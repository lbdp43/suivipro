import { lazy, Suspense, useState } from 'react';
import {  Users, Target, Tag, BarChart3, MapPin, Activity } from 'lucide-react';


// La page Administration : un onglet = un composant, chargé quand on l'ouvre.
const OngletEquipe = lazy(() => import('./admin/OngletEquipe'));
const OngletObjectifs = lazy(() => import('./admin/OngletObjectifs'));
const OngletTags = lazy(() => import('./admin/OngletTags'));
const OngletStatistiques = lazy(() => import('./admin/OngletStatistiques'));
const OngletEasyBeer = lazy(() => import('./admin/OngletEasyBeer'));
const OngletTournees = lazy(() => import('./admin/OngletTournees'));
const OngletActivite = lazy(() => import('./admin/OngletActivite'));

export default function AdminPage({ section }: { section?: 'easybeer' } = {}) {

  const pageEasybeer = section === 'easybeer';

  const [activeTab, setActiveTab] = useState<'team' | 'objectives' | 'tags' | 'commercials' | 'easybeer' | 'tournees' | 'activity'>(pageEasybeer ? 'easybeer' : 'team');

  const [ebOnglet, setEbOnglet] = useState<'connexion' | 'synchronisation' | 'controle'>('connexion');

  const tabs = [
    { id: 'team' as const, label: 'Équipe', icon: Users },
    { id: 'objectives' as const, label: 'Objectifs', icon: Target },
    { id: 'tags' as const, label: 'Tags', icon: Tag },
    { id: 'commercials' as const, label: 'Statistiques', icon: BarChart3 },
    { id: 'tournees' as const, label: 'Tournées', icon: MapPin },
    { id: 'activity' as const, label: 'Activité', icon: Activity },
  ];

  const ebOnglets = [
    { id: 'connexion' as const, label: 'Connexion', aide: 'Identifiants API, règles d\'affectation, exploration' },
    { id: 'synchronisation' as const, label: 'Synchronisation', aide: 'Clients, commandes, fiches en attente, liens' },
    { id: 'controle' as const, label: 'Contrôle', aide: 'Commandes orphelines, doublons, journal des webhooks' },
  ];

  // ============================================
  // Team management
  // ============================================

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{pageEasybeer ? 'EasyBeer' : 'Administration'}</h1>
        <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
          {pageEasybeer ? 'Connexion, synchronisation et contrôle des données EasyBeer' : 'Gestion de l\'équipe, objectifs, tags et statistiques'}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-full sm:w-fit flex-wrap overflow-x-auto">
        {pageEasybeer && ebOnglets.map(tab => (
          <button
            key={tab.id}
            title={tab.aide}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              ebOnglet === tab.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setEbOnglet(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        {!pageEasybeer && tabs.map(tab => (
          <button
            key={tab.id}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      <Suspense fallback={<div className="p-6 text-sm text-gray-400">Chargement…</div>}>
        {activeTab === 'team' && <OngletEquipe />}
        {activeTab === 'objectives' && <OngletObjectifs />}
        {activeTab === 'tags' && <OngletTags />}
        {activeTab === 'commercials' && <OngletStatistiques />}
        {activeTab === 'easybeer' && <OngletEasyBeer ebOnglet={ebOnglet} />}
        {activeTab === 'tournees' && <OngletTournees />}
        {activeTab === 'activity' && <OngletActivite />}
      </Suspense>
    </div>
  );
}
