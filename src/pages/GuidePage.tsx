import {
  LayoutDashboard, Kanban, Users, Phone, Calendar, Bell, Mail, Map, Upload,
  FileText, Tag, ArrowRight, CheckCircle2, XCircle, Clock, TrendingUp,
  MessageSquare, Star, Search, Filter, MousePointer, BookOpen, Info,
} from 'lucide-react';

const PIPELINE_STAGES = [
  { id: 'nouveau', label: 'Nouveau', color: '#6b7280', desc: 'Prospect tout juste ajoute dans le systeme. Aucun contact n\'a encore ete etabli.' },
  { id: 'a_contacter', label: 'A contacter', color: '#3b82f6', desc: 'Prospect identifie comme interessant. Il faut le contacter (appel, email, visite).' },
  { id: 'contacte', label: 'Contacte', color: '#8b5cf6', desc: 'Un premier contact a ete etabli (appel, email envoye). En attente de retour.' },
  { id: 'proposition', label: 'Proposition', color: '#f97316', desc: 'Une offre commerciale ou un catalogue a ete presente. Le prospect reflechit.' },
  { id: 'negociation', label: 'Negociation', color: '#ef4444', desc: 'Le prospect est interesse, on negocie les conditions (prix, quantites, delais).' },
  { id: 'gagne', label: 'RDV', color: '#22c55e', desc: 'Un rendez-vous de degustation ou de presentation est planifie.' },
  { id: 'client_gagne', label: 'Gagne', color: '#16a34a', desc: 'Le prospect est devenu client ! La vente est conclue.' },
  { id: 'perdu', label: 'Perdu', color: '#dc2626', desc: 'Le prospect n\'est pas interesse ou a choisi un concurrent.' },
  { id: 'ne_pas_contacter', label: 'Ne pas contacter', color: '#991b1b', desc: 'Prospect qui ne souhaite plus etre contacte (demande explicite, blacklist).' },
];

const CALL_RESULTS = [
  { label: 'Repondu', color: 'bg-green-100 text-green-700', icon: <CheckCircle2 className="w-4 h-4" />, desc: 'Le prospect a decroche et un echange a eu lieu.' },
  { label: 'Pas de reponse', color: 'bg-red-100 text-red-700', icon: <XCircle className="w-4 h-4" />, desc: 'Personne n\'a repondu au telephone.' },
  { label: 'Messagerie', color: 'bg-amber-100 text-amber-700', icon: <MessageSquare className="w-4 h-4" />, desc: 'Un message vocal a ete laisse sur le repondeur.' },
  { label: 'Injoignable', color: 'bg-gray-100 text-gray-700', icon: <XCircle className="w-4 h-4" />, desc: 'Le numero ne fonctionne pas ou est injoignable.' },
];

const RDV_STATUSES = [
  { label: 'Planifie', color: 'bg-amber-100 text-amber-700', desc: 'Le rendez-vous est programme mais pas encore confirme.' },
  { label: 'Confirme', color: 'bg-green-100 text-green-700', desc: 'Le prospect a confirme sa disponibilite.' },
  { label: 'Termine', color: 'bg-gray-100 text-gray-600', desc: 'Le rendez-vous a eu lieu. Il faut remplir le compte-rendu.' },
  { label: 'Annule', color: 'bg-red-100 text-red-700', desc: 'Le rendez-vous a ete annule.' },
];

const COMPTE_RENDU_OPTIONS = [
  { label: 'Client', color: 'bg-green-100 text-green-700', pipeline: 'Gagne', desc: 'Le prospect est devenu client ! Il passe automatiquement en etape "Gagne".' },
  { label: 'Mail envoye', color: 'bg-blue-100 text-blue-700', pipeline: 'Negociation', desc: 'Un email de suivi a ete envoye. Le prospect passe en "Negociation".' },
  { label: 'Commande plus tard', color: 'bg-amber-100 text-amber-700', pipeline: 'Proposition', desc: 'Le prospect est interesse mais commandera plus tard. Il passe en "Proposition".' },
  { label: 'A relancer', color: 'bg-purple-100 text-purple-700', pipeline: 'Proposition', desc: 'Il faut relancer le prospect. Il passe en "Proposition".' },
  { label: 'Pas interesse', color: 'bg-red-100 text-red-700', pipeline: 'Perdu', desc: 'Le prospect n\'est pas interesse. Il passe en "Perdu".' },
];

function Section({ icon: Icon, title, id, children }: { icon: React.ElementType; title: string; id: string; children: React.ReactNode }) {
  return (
    <section id={id} className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-4">
        <Icon className="w-5 h-5 text-brewery-600" />
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function GuidePage() {
  const sections = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'pipeline', icon: Kanban, label: 'Pipeline' },
    { id: 'prospects', icon: Users, label: 'Prospects' },
    { id: 'appels', icon: Phone, label: 'Appels' },
    { id: 'rdv', icon: Calendar, label: 'Rendez-vous' },
    { id: 'rappels', icon: Bell, label: 'Rappels' },
    { id: 'emails', icon: Mail, label: 'Emails' },
    { id: 'carte', icon: Map, label: 'Carte' },
    { id: 'import', icon: Upload, label: 'Import / Export' },
    { id: 'tags', icon: Tag, label: 'Tags' },
    { id: 'documents', icon: FileText, label: 'Documents' },
  ];

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-brewery-600 to-brewery-700 rounded-xl p-6 text-white">
        <div className="flex items-center gap-3 mb-2">
          <BookOpen className="w-7 h-7" />
          <h1 className="text-2xl font-bold">Guide SuiviPro</h1>
        </div>
        <p className="text-brewery-100 text-sm">
          Bienvenue dans le guide complet de SuiviPro, votre outil de suivi commercial.
          Cette page explique en detail toutes les fonctionnalites de l'application pour vous aider
          a gerer efficacement vos prospects, appels, rendez-vous et bien plus.
        </p>
      </div>

      {/* Quick nav */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Sommaire</h2>
        <div className="flex flex-wrap gap-2">
          {sections.map(s => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 bg-gray-50 hover:bg-brewery-50 hover:text-brewery-700 transition-colors"
            >
              <s.icon className="w-3.5 h-3.5" />
              {s.label}
            </a>
          ))}
        </div>
      </div>

      {/* ==================== DASHBOARD ==================== */}
      <Section icon={LayoutDashboard} title="Dashboard" id="dashboard">
        <div className="space-y-3 text-sm text-gray-600">
          <p>
            Le Dashboard est votre page d'accueil. Il affiche un resume de votre activite commerciale
            avec des indicateurs cles en temps reel.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 bg-gray-50 rounded-lg">
              <h4 className="font-semibold text-gray-800 text-xs mb-1">Indicateurs (KPIs)</h4>
              <ul className="text-xs space-y-1 text-gray-500">
                <li>- Appels aujourd'hui / cette semaine / ce mois</li>
                <li>- RDV cette semaine / ce mois</li>
                <li>- Taux de conversion (prospects gagnes / total)</li>
                <li>- Taux de reponse aux appels</li>
                <li>- Duree moyenne des appels</li>
              </ul>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <h4 className="font-semibold text-gray-800 text-xs mb-1">Classement equipe</h4>
              <ul className="text-xs space-y-1 text-gray-500">
                <li>- Classement par nombre d'appels</li>
                <li>- Classement par nombre de RDV</li>
                <li>- Classement par nouveaux prospects</li>
                <li>- Periode configurable (semaine, mois)</li>
                <li>- Comparaison avec les objectifs fixes</li>
              </ul>
            </div>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <h4 className="font-semibold text-gray-800 text-xs mb-1">Analyse des resultats RDV</h4>
            <p className="text-xs text-gray-500">
              Le Dashboard affiche egalement une analyse detaillee des resultats de vos rendez-vous par semaine
              (Client, Mail envoye, Commande plus tard, A relancer, Pas interesse). Vous pouvez filtrer par commercial
              et naviguer entre les mois.
            </p>
          </div>
        </div>
      </Section>

      {/* ==================== PIPELINE ==================== */}
      <Section icon={Kanban} title="Pipeline commercial" id="pipeline">
        <div className="space-y-4 text-sm text-gray-600">
          <p>
            Le Pipeline est une vue Kanban qui represente le parcours de chaque prospect,
            de la decouverte jusqu'a la conversion (ou la perte). Chaque colonne represente une etape.
            Vous pouvez deplacer les prospects d'une colonne a l'autre par glisser-deposer.
          </p>

          <h3 className="font-semibold text-gray-800">Les 9 etapes du pipeline</h3>
          <div className="space-y-2">
            {PIPELINE_STAGES.map((stage, i) => (
              <div key={stage.id} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
                <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                  <span className="text-[10px] text-gray-400 w-4">{i + 1}.</span>
                  <span
                    className="inline-block w-3 h-3 rounded-full"
                    style={{ backgroundColor: stage.color }}
                  />
                </div>
                <div>
                  <span className="font-semibold text-gray-800 text-xs">{stage.label}</span>
                  <p className="text-xs text-gray-500 mt-0.5">{stage.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 bg-brewery-50 rounded-lg flex items-start gap-2">
            <Info className="w-4 h-4 text-brewery-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-brewery-700">
              <strong>Parcours type :</strong> Nouveau → A contacter → Contacte → Proposition → Negociation → RDV → Gagne.
              Les etapes "Perdu" et "Ne pas contacter" sont des etapes terminales.
            </p>
          </div>
        </div>
      </Section>

      {/* ==================== PROSPECTS ==================== */}
      <Section icon={Users} title="Gestion des prospects" id="prospects">
        <div className="space-y-4 text-sm text-gray-600">
          <p>
            La page Prospects est le coeur de SuiviPro. Elle liste tous vos prospects avec
            leurs informations, et permet d'acceder a leur fiche detaillee.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 bg-gray-50 rounded-lg">
              <h4 className="font-semibold text-gray-800 text-xs flex items-center gap-1 mb-1">
                <Search className="w-3 h-3" /> Recherche & Filtres
              </h4>
              <ul className="text-xs space-y-1 text-gray-500">
                <li>- Recherche par nom, contact ou notes</li>
                <li>- Filtre par type d'etablissement</li>
                <li>- Filtre par etape pipeline</li>
                <li>- Filtre par secteur, ville, departement</li>
                <li>- Filtre par commercial assigne</li>
                <li>- Filtre par presence de RDV</li>
                <li>- Tri par score ou date</li>
              </ul>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <h4 className="font-semibold text-gray-800 text-xs flex items-center gap-1 mb-1">
                <MousePointer className="w-3 h-3" /> Actions rapides
              </h4>
              <ul className="text-xs space-y-1 text-gray-500">
                <li>- Cliquer sur le telephone → enregistrer un appel</li>
                <li>- Bouton email → ouvrir les templates</li>
                <li>- Bouton calendrier → planifier un RDV</li>
                <li>- Bouton rappel → creer un rappel</li>
                <li>- Bouton notes → ajouter des notes rapides</li>
                <li>- Mode selection multiple → actions en lot</li>
              </ul>
            </div>
          </div>

          <div className="p-3 bg-gray-50 rounded-lg">
            <h4 className="font-semibold text-gray-800 text-xs flex items-center gap-1 mb-1">
              <Star className="w-3 h-3" /> Score prospect
            </h4>
            <p className="text-xs text-gray-500">
              Chaque prospect a un score de 0 a 100 (par defaut : 50). Ce score vous permet de prioriser
              vos prospects. Plus le score est eleve, plus le prospect est considere comme prometteur.
              Vous pouvez trier la liste par score pour vous concentrer sur les meilleurs prospects.
            </p>
          </div>

          <div className="p-3 bg-gray-50 rounded-lg">
            <h4 className="font-semibold text-gray-800 text-xs mb-1">Fiche prospect</h4>
            <p className="text-xs text-gray-500">
              En cliquant sur un prospect, sa fiche detaillee s'ouvre avec :
              le nom de l'etablissement, le nom du contact, le telephone (cliquable pour appeler),
              l'email, l'adresse (lien Google Maps), le secteur, les notes, l'historique des appels,
              les rendez-vous et les rappels. Vous pouvez aussi voir les tags et l'etape pipeline.
            </p>
          </div>
        </div>
      </Section>

      {/* ==================== APPELS ==================== */}
      <Section icon={Phone} title="Appels telephoniques" id="appels">
        <div className="space-y-4 text-sm text-gray-600">
          <p>
            La page Appels vous permet de consulter l'historique de tous vos appels et d'en enregistrer de nouveaux.
            Chaque appel est associe a un prospect et a un resultat.
          </p>

          <h3 className="font-semibold text-gray-800">Comment enregistrer un appel</h3>
          <ol className="text-xs space-y-1 text-gray-500 list-decimal list-inside">
            <li>Allez sur la fiche du prospect (ou cliquez sur l'icone telephone dans la liste)</li>
            <li>Cliquez sur le numero de telephone</li>
            <li>Le modal d'appel s'ouvre avec un chronometre pour la duree</li>
            <li>Apres l'appel, selectionnez le resultat et ajoutez des notes</li>
            <li>Enregistrez l'appel</li>
          </ol>

          <h3 className="font-semibold text-gray-800">Resultats d'appel possibles</h3>
          <div className="space-y-2">
            {CALL_RESULTS.map(r => (
              <div key={r.label} className="flex items-start gap-3 p-2 rounded-lg bg-gray-50">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 ${r.color}`}>{r.label}</span>
                <p className="text-xs text-gray-500">{r.desc}</p>
              </div>
            ))}
          </div>

          <div className="p-3 bg-gray-50 rounded-lg">
            <h4 className="font-semibold text-gray-800 text-xs flex items-center gap-1 mb-1">
              <TrendingUp className="w-3 h-3" /> Statistiques d'appels
            </h4>
            <p className="text-xs text-gray-500">
              En haut de la page Appels, vous voyez vos statistiques : appels aujourd'hui, cette semaine,
              ce mois, et votre taux de reponse. Ces chiffres vous aident a suivre votre activite.
            </p>
          </div>
        </div>
      </Section>

      {/* ==================== RENDEZ-VOUS ==================== */}
      <Section icon={Calendar} title="Rendez-vous (RDV)" id="rdv">
        <div className="space-y-4 text-sm text-gray-600">
          <p>
            La page RDV gere vos rendez-vous de degustation et de presentation.
            Vous pouvez basculer entre les vues Liste, Agenda (semaine) et Planning.
          </p>

          <h3 className="font-semibold text-gray-800">Creer un rendez-vous</h3>
          <ol className="text-xs space-y-1 text-gray-500 list-decimal list-inside">
            <li>Cliquez sur "Nouveau RDV" ou sur l'icone calendrier d'un prospect</li>
            <li>Selectionnez le prospect, la date, l'heure de debut et de fin</li>
            <li>Indiquez le lieu du rendez-vous</li>
            <li>Ajoutez des notes si necessaire</li>
            <li>Enregistrez</li>
          </ol>

          <h3 className="font-semibold text-gray-800">Statuts de rendez-vous</h3>
          <div className="space-y-2">
            {RDV_STATUSES.map(s => (
              <div key={s.label} className="flex items-start gap-3 p-2 rounded-lg bg-gray-50">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 ${s.color}`}>{s.label}</span>
                <p className="text-xs text-gray-500">{s.desc}</p>
              </div>
            ))}
          </div>

          <h3 className="font-semibold text-gray-800">Compte-rendu de RDV</h3>
          <p className="text-xs text-gray-500 mb-2">
            Quand un RDV est termine, vous devez remplir le compte-rendu. Le resultat choisi
            <strong> deplace automatiquement le prospect dans le pipeline</strong> :
          </p>
          <div className="space-y-2">
            {COMPTE_RENDU_OPTIONS.map(cr => (
              <div key={cr.label} className="flex items-start gap-3 p-2 rounded-lg bg-gray-50">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 ${cr.color}`}>{cr.label}</span>
                <div>
                  <p className="text-xs text-gray-500">{cr.desc}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1">
                    <ArrowRight className="w-3 h-3" /> Pipeline : <strong>{cr.pipeline}</strong>
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 bg-brewery-50 rounded-lg flex items-start gap-2">
            <Info className="w-4 h-4 text-brewery-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-brewery-700">
              <strong>Integration Google Calendar :</strong> Si votre compte Google est connecte,
              vos RDV SuiviPro sont automatiquement synchronises avec votre agenda Google.
            </p>
          </div>
        </div>
      </Section>

      {/* ==================== RAPPELS ==================== */}
      <Section icon={Bell} title="Rappels" id="rappels">
        <div className="space-y-4 text-sm text-gray-600">
          <p>
            Les rappels vous permettent de programmer des taches a une date et heure precise
            pour ne jamais oublier de relancer un prospect.
          </p>

          <h3 className="font-semibold text-gray-800">Comment creer un rappel</h3>
          <ol className="text-xs space-y-1 text-gray-500 list-decimal list-inside">
            <li>Depuis la liste des prospects, cliquez sur l'icone cloche</li>
            <li>Choisissez la date et l'heure du rappel</li>
            <li>Ecrivez un message (ex: "Relancer pour devis", "Rappeler apres degustation")</li>
            <li>Enregistrez</li>
          </ol>

          <h3 className="font-semibold text-gray-800">Organisation des rappels</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 bg-red-50 rounded-lg">
              <h4 className="text-xs font-semibold text-red-700">En retard</h4>
              <p className="text-[10px] text-red-600">Rappels dont la date est passee. A traiter en priorite !</p>
            </div>
            <div className="p-3 bg-amber-50 rounded-lg">
              <h4 className="text-xs font-semibold text-amber-700">Aujourd'hui</h4>
              <p className="text-[10px] text-amber-600">Rappels programmes pour aujourd'hui.</p>
            </div>
            <div className="p-3 bg-blue-50 rounded-lg">
              <h4 className="text-xs font-semibold text-blue-700">A venir</h4>
              <p className="text-[10px] text-blue-600">Rappels pour les jours suivants.</p>
            </div>
            <div className="p-3 bg-green-50 rounded-lg">
              <h4 className="text-xs font-semibold text-green-700">Termines</h4>
              <p className="text-[10px] text-green-600">Rappels que vous avez marques comme traites.</p>
            </div>
          </div>

          <div className="p-3 bg-gray-50 rounded-lg">
            <h4 className="font-semibold text-gray-800 text-xs flex items-center gap-1 mb-1">
              <Clock className="w-3 h-3" /> Reporter un rappel
            </h4>
            <p className="text-xs text-gray-500">
              Vous pouvez reporter un rappel avec les options rapides : Demain, Dans 2 jours, Dans 1 semaine,
              Dans 2 semaines. Vous pouvez aussi choisir une date personnalisee.
            </p>
          </div>

          <div className="p-3 bg-brewery-50 rounded-lg flex items-start gap-2">
            <Info className="w-4 h-4 text-brewery-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-brewery-700">
              <strong>Badge dans le menu :</strong> Le nombre de rappels en retard et du jour
              s'affiche en rouge a cote de "Rappels" dans la barre laterale.
            </p>
          </div>
        </div>
      </Section>

      {/* ==================== EMAILS ==================== */}
      <Section icon={Mail} title="Emails & Templates" id="emails">
        <div className="space-y-4 text-sm text-gray-600">
          <p>
            SuiviPro propose des templates d'emails pre-rediges que vous pouvez personnaliser
            et envoyer directement a vos prospects.
          </p>

          <h3 className="font-semibold text-gray-800">Types de templates disponibles</h3>
          <div className="flex flex-wrap gap-2">
            {['Presentation', 'Relance', 'Confirmation', 'Remerciement', 'Catalogue', 'Nouveaute', 'Promotion'].map(t => (
              <span key={t} className="px-2 py-1 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600">{t}</span>
            ))}
          </div>

          <h3 className="font-semibold text-gray-800">Variables dynamiques</h3>
          <p className="text-xs text-gray-500 mb-2">
            Les templates utilisent des variables qui sont automatiquement remplacees par les informations du prospect :
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-1.5 px-2 text-gray-700 font-semibold">Variable</th>
                  <th className="text-left py-1.5 px-2 text-gray-700 font-semibold">Remplacee par</th>
                </tr>
              </thead>
              <tbody className="text-gray-500">
                <tr className="border-b border-gray-100"><td className="py-1.5 px-2 font-mono text-brewery-600">{'{{nom_contact}}'}</td><td className="py-1.5 px-2">Le nom du contact</td></tr>
                <tr className="border-b border-gray-100"><td className="py-1.5 px-2 font-mono text-brewery-600">{'{{nom_etablissement}}'}</td><td className="py-1.5 px-2">Le nom de l'etablissement</td></tr>
                <tr className="border-b border-gray-100"><td className="py-1.5 px-2 font-mono text-brewery-600">{'{{commercial}}'}</td><td className="py-1.5 px-2">Votre nom (commercial)</td></tr>
                <tr className="border-b border-gray-100"><td className="py-1.5 px-2 font-mono text-brewery-600">{'{{telephone_commercial}}'}</td><td className="py-1.5 px-2">Votre telephone</td></tr>
                <tr><td className="py-1.5 px-2 font-mono text-brewery-600">{'{{date_rdv}}'}</td><td className="py-1.5 px-2">La date du prochain RDV</td></tr>
              </tbody>
            </table>
          </div>

          <h3 className="font-semibold text-gray-800">Comment envoyer un email</h3>
          <ol className="text-xs space-y-1 text-gray-500 list-decimal list-inside">
            <li>Depuis la fiche prospect, cliquez sur l'icone email</li>
            <li>Choisissez un template dans la liste</li>
            <li>Previsualisez l'email avec les variables remplacees</li>
            <li>Cliquez "Envoyer" pour ouvrir votre messagerie avec l'email pre-rempli</li>
          </ol>

          <div className="p-3 bg-brewery-50 rounded-lg flex items-start gap-2">
            <Info className="w-4 h-4 text-brewery-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-brewery-700">
              <strong>Astuce :</strong> Quand vous envoyez un email a un prospect "Nouveau" ou "A contacter",
              il passe automatiquement a l'etape "Contacte".
            </p>
          </div>
        </div>
      </Section>

      {/* ==================== CARTE ==================== */}
      <Section icon={Map} title="Carte des prospects" id="carte">
        <div className="space-y-3 text-sm text-gray-600">
          <p>
            La Carte affiche tous vos prospects sur une carte interactive. Chaque marqueur
            est colore selon l'etape du pipeline du prospect.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 bg-gray-50 rounded-lg">
              <h4 className="font-semibold text-gray-800 text-xs flex items-center gap-1 mb-1">
                <Filter className="w-3 h-3" /> Filtres disponibles
              </h4>
              <ul className="text-xs space-y-1 text-gray-500">
                <li>- Par type d'etablissement</li>
                <li>- Par etape pipeline</li>
                <li>- Par tags</li>
                <li>- Par secteur / region</li>
                <li>- Par code postal / departement</li>
              </ul>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <h4 className="font-semibold text-gray-800 text-xs mb-1">Panneau RDV</h4>
              <p className="text-xs text-gray-500">
                Un panneau lateral affiche les rendez-vous de la semaine avec la possibilite
                de naviguer entre les semaines et de filtrer par commercial.
              </p>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Cliquez sur un marqueur pour voir les details du prospect et acceder aux actions rapides
            (appeler, envoyer un email, voir la fiche).
          </p>
        </div>
      </Section>

      {/* ==================== IMPORT/EXPORT ==================== */}
      <Section icon={Upload} title="Import / Export" id="import">
        <div className="space-y-4 text-sm text-gray-600">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 bg-gray-50 rounded-lg">
              <h4 className="font-semibold text-gray-800 text-xs mb-2">Importer des prospects</h4>
              <ol className="text-xs space-y-1 text-gray-500 list-decimal list-inside">
                <li>Preparez votre fichier Excel ou CSV</li>
                <li>Cliquez "Importer" et selectionnez le fichier</li>
                <li>Verifiez la correspondance des colonnes</li>
                <li>Activez le geocodage automatique si besoin</li>
                <li>Lancez l'import</li>
              </ol>
              <p className="text-[10px] text-gray-400 mt-2">
                Le systeme detecte automatiquement les doublons et les types d'etablissement.
              </p>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <h4 className="font-semibold text-gray-800 text-xs mb-2">Exporter les donnees</h4>
              <ul className="text-xs space-y-1 text-gray-500">
                <li>- <strong>CSV</strong> : Export simple, compatible avec tous les tableurs</li>
                <li>- <strong>Excel (XLSX)</strong> : Export formate avec colonnes organisees</li>
              </ul>
              <p className="text-[10px] text-gray-400 mt-2">
                L'export inclut : nom, type, contact, coordonnees, adresse, notes, score, etape pipeline.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ==================== TAGS ==================== */}
      <Section icon={Tag} title="Tags" id="tags">
        <div className="space-y-3 text-sm text-gray-600">
          <p>
            Les tags sont des etiquettes colorees que vous pouvez attribuer a vos prospects
            pour les organiser et les filtrer facilement.
          </p>
          <div className="p-3 bg-gray-50 rounded-lg">
            <h4 className="font-semibold text-gray-800 text-xs mb-2">Exemples de tags</h4>
            <div className="flex flex-wrap gap-1.5">
              {[
                { nom: 'Gros potentiel', couleur: '#22c55e' },
                { nom: 'Budget limite', couleur: '#ef4444' },
                { nom: 'Deja client concurrent', couleur: '#f59e0b' },
                { nom: 'Interesse bio', couleur: '#3b82f6' },
                { nom: 'Urgence', couleur: '#ef4444' },
                { nom: 'Premium', couleur: '#f97316' },
                { nom: 'A relancer', couleur: '#a855f7' },
              ].map(tag => (
                <span key={tag.nom} className="badge text-white text-[10px]" style={{ backgroundColor: tag.couleur }}>
                  {tag.nom}
                </span>
              ))}
            </div>
          </div>
          <ul className="text-xs space-y-1 text-gray-500">
            <li>- Creez vos propres tags avec un nom et une couleur</li>
            <li>- Assignez plusieurs tags a un meme prospect</li>
            <li>- Utilisez le mode selection multiple pour ajouter/retirer des tags en lot</li>
            <li>- Les tags s'affichent sur la fiche prospect, dans la liste et sur le pipeline</li>
          </ul>
        </div>
      </Section>

      {/* ==================== DOCUMENTS ==================== */}
      <Section icon={FileText} title="Documents" id="documents">
        <div className="space-y-3 text-sm text-gray-600">
          <p>
            La section Documents vous permet de stocker et partager des fichiers utiles :
            catalogues, fiches produit, grilles tarifaires, etc.
          </p>
          <div className="p-3 bg-gray-50 rounded-lg">
            <h4 className="font-semibold text-gray-800 text-xs mb-2">Categories de documents</h4>
            <div className="flex flex-wrap gap-2">
              {['Bar / Restaurant', 'Prix C.E.', 'Cave / Epicerie', 'Grand Public', 'Autre'].map(cat => (
                <span key={cat} className="px-2 py-1 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600">{cat}</span>
              ))}
            </div>
          </div>
          <ul className="text-xs space-y-1 text-gray-500">
            <li>- Uploadez vos fichiers (PDF, images, etc.)</li>
            <li>- Organisez par categorie</li>
            <li>- Telechargez a tout moment</li>
          </ul>
        </div>
      </Section>

      {/* Footer */}
      <div className="text-center text-xs text-gray-400 py-4">
        SuiviPro - Brasserie des Plantes
      </div>
    </div>
  );
}
