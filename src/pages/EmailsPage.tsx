import { useState } from 'react';
import {
  Mail, Plus, X, Save, Send, Eye, Edit2, Trash2, Copy,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { EmailTemplate, Prospect } from '../types';
import { generateId, processEmailTemplate } from '../utils/helpers';

export default function EmailsPage() {
  const { state, dispatch } = useApp();
  const [showForm, setShowForm] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [selectedProspectId, setSelectedProspectId] = useState('');
  const [formData, setFormData] = useState({ nom: '', sujet: '', corps: '', type: '' });

  const openNewForm = () => {
    setFormData({ nom: '', sujet: '', corps: '', type: '' });
    setEditing(null);
    setShowForm(true);
  };

  const openEditForm = (template: EmailTemplate) => {
    setFormData({ nom: template.nom, sujet: template.sujet, corps: template.corps, type: template.type });
    setEditing(template);
    setShowForm(true);
  };

  const saveTemplate = () => {
    if (!formData.nom || !formData.sujet) return;
    if (editing) {
      dispatch({ type: 'UPDATE_EMAIL_TEMPLATE', payload: { ...editing, ...formData } as EmailTemplate });
    } else {
      dispatch({ type: 'ADD_EMAIL_TEMPLATE', payload: { ...formData, id: generateId('et') } as EmailTemplate });
    }
    setShowForm(false);
  };

  const deleteTemplate = (id: string) => {
    if (confirm('Supprimer ce template ?')) {
      dispatch({ type: 'DELETE_EMAIL_TEMPLATE', payload: id });
    }
  };

  const openPreview = (template: EmailTemplate) => {
    setSelectedTemplate(template);
    setSelectedProspectId(state.prospects[0]?.id || '');
    setShowPreview(true);
  };

  const getPreviewContent = () => {
    if (!selectedTemplate || !selectedProspectId) return { sujet: '', corps: '' };
    const prospect = state.prospects.find(p => p.id === selectedProspectId);
    if (!prospect) return { sujet: selectedTemplate.sujet, corps: selectedTemplate.corps };
    const commercial = state.currentUser || state.commerciaux[0];
    return processEmailTemplate(selectedTemplate, prospect, {
      prenom: commercial.prenom,
      telephone: commercial.telephone,
    }, { date_rdv: 'Mardi 18 fevrier 2026 a 10h30' });
  };

  const sendEmail = () => {
    const preview = getPreviewContent();
    const prospect = state.prospects.find(p => p.id === selectedProspectId);
    if (!prospect) return;

    // Auto-transition: "A contacter" / "Nouveau" → "Contacte" when email is sent
    if (['a_contacter', 'nouveau'].includes(prospect.etape_pipeline)) {
      dispatch({
        type: 'MOVE_PROSPECT',
        payload: { id: prospect.id, stage: 'contacte' },
      });
    }

    // Open mailto link
    const mailto = `mailto:${prospect.email}?subject=${encodeURIComponent(preview.sujet)}&body=${encodeURIComponent(preview.corps)}`;
    window.location.href = mailto;
  };

  const templateTypeColors: Record<string, string> = {
    presentation: 'bg-blue-100 text-blue-700',
    relance: 'bg-amber-100 text-amber-700',
    confirmation: 'bg-green-100 text-green-700',
    remerciement: 'bg-purple-100 text-purple-700',
    catalogue: 'bg-indigo-100 text-indigo-700',
    nouveaute: 'bg-pink-100 text-pink-700',
    promotion: 'bg-emerald-100 text-emerald-700',
  };

  const variables = [
    { var: '{{nom_etablissement}}', desc: 'Nom du prospect (ex : Cave Martin, Le Suffren)' },
    { var: '{{nom_contact}}', desc: 'Nom du contact (ex : Nathalie, M. Bauchart)' },
    { var: '{{commercial}}', desc: 'Prenom du commercial (ex : Guillaume, Alban, Loic)' },
    { var: '{{telephone_commercial}}', desc: 'Telephone du commercial (ex : 06 84 44 40 44)' },
    { var: '{{date_rdv}}', desc: 'Date du RDV (ex : Mardi 18 fevrier 2026 a 10h30)' },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Templates d'emails</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">Modeles d'emails personnalisables</p>
        </div>
        <button
          className="bg-brewery-600 text-white px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg hover:bg-brewery-700 flex items-center gap-2 text-xs sm:text-sm font-medium self-start sm:self-auto"
          onClick={openNewForm}
        >
          <Plus className="w-4 h-4" /> Nouveau template
        </button>
      </div>

      {/* Variables reference */}
      <div className="bg-blue-50 rounded-xl border border-blue-200 p-3 sm:p-4">
        <h3 className="font-semibold text-blue-900 text-sm mb-2">Variables dynamiques disponibles</h3>
        <div className="flex flex-wrap gap-2">
          {variables.map(v => (
            <span key={v.var} className="inline-flex items-center gap-1 px-2 py-1 bg-white rounded text-xs border border-blue-200">
              <code className="text-blue-600 font-mono text-[10px]">{v.var}</code>
              <span className="text-gray-500">{v.desc}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Conseils d'utilisation */}
      <details className="bg-amber-50 rounded-xl border border-amber-200">
        <summary className="p-3 sm:p-4 cursor-pointer font-semibold text-amber-900 text-sm hover:bg-amber-100/50 rounded-xl transition-colors">
          Conseils d'utilisation
        </summary>
        <div className="px-3 sm:px-4 pb-3 sm:pb-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-white rounded-lg p-3 border border-amber-100">
              <h4 className="text-xs font-bold text-amber-800 mb-1.5">Regles generales</h4>
              <ul className="text-xs text-gray-600 space-y-1">
                <li>- Toujours personnaliser avec un element de la conversation telephonique</li>
                <li>- Proposer 2 creneaux precis, jamais "quand vous voulez"</li>
                <li>- Toujours proposer une degustation (c'est notre meilleur argument)</li>
                <li>- Mentionner systematiquement les medailles et le titre mondial</li>
                <li>- Terminer par "Artisanalement votre"</li>
              </ul>
            </div>
            <div className="bg-white rounded-lg p-3 border border-amber-100">
              <h4 className="text-xs font-bold text-amber-800 mb-1.5">Adapter le catalogue joint</h4>
              <ul className="text-xs text-gray-600 space-y-1">
                <li>- Cave / Epicerie fine → Catalogue Cave-Epicerie</li>
                <li>- Bar / Restaurant → Catalogue Bar-Restaurant (tarifs CHR)</li>
                <li>- Distributeur → Catalogue Distributeur</li>
              </ul>
            </div>
            <div className="bg-white rounded-lg p-3 border border-amber-100">
              <h4 className="text-xs font-bold text-amber-800 mb-1.5">Strategie de relance</h4>
              <ul className="text-xs text-gray-600 space-y-1">
                <li>- 1ere relance (template 3) : 5 a 7 jours apres le premier envoi</li>
                <li>- 2eme relance (template 4) : 10 a 15 jours apres la 1ere relance</li>
                <li>- Apres 2 relances sans reponse : passer en "a recontacter dans 3 mois"</li>
              </ul>
            </div>
            <div className="bg-white rounded-lg p-3 border border-amber-100">
              <h4 className="text-xs font-bold text-amber-800 mb-1.5">Timing d'envoi</h4>
              <ul className="text-xs text-gray-600 space-y-1">
                <li>- Meilleurs jours : mardi et mercredi matin</li>
                <li>- Eviter le lundi (surcharge) et le vendredi apres-midi</li>
                <li>- Ideal entre 9h et 11h pour le taux d'ouverture</li>
              </ul>
            </div>
          </div>
          <div className="bg-white rounded-lg p-3 border border-amber-100">
            <h4 className="text-xs font-bold text-amber-800 mb-1.5">Apres chaque envoi</h4>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-600">
              <span>- Creer une tache de relance dans le CRM (5 a 7 jours)</span>
              <span>- Noter le contenu de l'echange telephonique</span>
              <span>- Indiquer les produits qui ont interesse le prospect</span>
              <span>- "Je passe dans le secteur" cree une urgence douce</span>
            </div>
          </div>
        </div>
      </details>

      {/* Template cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {state.emailTemplates.map(template => (
          <div key={template.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-gray-400" />
                  <h3 className="font-semibold text-sm text-gray-900 truncate">{template.nom}</h3>
                </div>
                <span className={`badge text-[10px] mt-2 ${templateTypeColors[template.type] || 'bg-gray-100 text-gray-600'}`}>
                  {template.type}
                </span>
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-3 font-medium">Sujet: {template.sujet}</p>
            <p className="text-xs text-gray-400 mt-1 line-clamp-3">{template.corps.substring(0, 120)}...</p>
            <div className="flex items-center gap-2 mt-4">
              <button className="p-1.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-600" onClick={() => openPreview(template)} title="Previsualiser">
                <Eye className="w-3.5 h-3.5" />
              </button>
              <button className="p-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600" onClick={() => openEditForm(template)} title="Modifier">
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button className="p-1.5 rounded bg-red-50 hover:bg-red-100 text-red-500" onClick={() => deleteTemplate(template.id)} title="Supprimer">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Edit/Create modal */}
      {showForm && (
        <div className="modal-backdrop">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">{editing ? 'Modifier le template' : 'Nouveau template'}</h3>
              <button className="p-1 rounded hover:bg-gray-100" onClick={() => setShowForm(false)}>
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nom du template *</label>
                  <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.nom} onChange={e => setFormData(prev => ({ ...prev, nom: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                  <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="presentation, relance, etc." value={formData.type} onChange={e => setFormData(prev => ({ ...prev, type: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Sujet *</label>
                <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={formData.sujet} onChange={e => setFormData(prev => ({ ...prev, sujet: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Corps de l'email</label>
                <textarea className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm h-64 resize-none font-mono text-xs" value={formData.corps} onChange={e => setFormData(prev => ({ ...prev, corps: e.target.value }))} />
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
              <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setShowForm(false)}>Annuler</button>
              <button className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2" onClick={saveTemplate}>
                <Save className="w-4 h-4" /> {editing ? 'Modifier' : 'Creer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview modal */}
      {showPreview && selectedTemplate && (
        <div className="modal-backdrop">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">Previsualisation</h3>
              <button className="p-1 rounded hover:bg-gray-100" onClick={() => setShowPreview(false)}>
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Prospect</label>
                <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" value={selectedProspectId} onChange={e => setSelectedProspectId(e.target.value)}>
                  {state.prospects.map(p => (<option key={p.id} value={p.id}>{p.nom_etablissement} - {p.email}</option>))}
                </select>
              </div>
              <div className="bg-gray-50 rounded-lg p-5 border border-gray-200">
                <div className="border-b border-gray-200 pb-3 mb-4">
                  <p className="text-xs text-gray-500">Sujet:</p>
                  <p className="text-sm font-medium text-gray-900">{getPreviewContent().sujet}</p>
                </div>
                <div className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed">
                  {getPreviewContent().corps}
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
              <button className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setShowPreview(false)}>Fermer</button>
              <button className="px-4 py-2 text-sm bg-brewery-600 text-white rounded-lg hover:bg-brewery-700 flex items-center gap-2" onClick={sendEmail}>
                <Send className="w-4 h-4" /> Envoyer par email
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
