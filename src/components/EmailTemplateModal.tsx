import { useState } from 'react';
import { Mail, X, Send, Eye, ChevronRight } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { Prospect } from '../types';

interface Props {
  prospect: Prospect;
  onClose: () => void;
}

export default function EmailTemplateModal({ prospect, onClose }: Props) {
  const { state } = useApp();
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const commercial = state.currentUser;

  const replaceVariables = (text: string) => {
    return text
      .replace(/\{\{nom_contact\}\}/g, prospect.nom_contact)
      .replace(/\{\{nom_etablissement\}\}/g, prospect.nom_etablissement)
      .replace(/\{\{commercial\}\}/g, commercial ? `${commercial.prenom} ${commercial.nom}` : '')
      .replace(/\{\{telephone_commercial\}\}/g, commercial?.telephone || '')
      .replace(/\{\{produit_interesse\}\}/g, '')
      .replace(/\{\{date_rdv\}\}/g, '');
  };

  const selectedTemplate = state.emailTemplates.find(t => t.id === selectedTemplateId);

  const sendEmail = () => {
    if (!selectedTemplate || !prospect.email) return;
    const subject = encodeURIComponent(replaceVariables(selectedTemplate.sujet));
    const body = encodeURIComponent(replaceVariables(selectedTemplate.corps));
    window.open(`mailto:${prospect.email}?subject=${subject}&body=${body}`, '_blank');
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <Mail className="w-5 h-5 text-purple-600" /> Envoyer un e-mail
          </h3>
          <button className="p-1 rounded hover:bg-gray-100" onClick={onClose}>
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Destinataire */}
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Destinataire</p>
            <p className="text-sm font-medium text-gray-900">{prospect.nom_contact} - {prospect.nom_etablissement}</p>
            <p className="text-xs text-gray-500">{prospect.email || 'Pas d\'email renseigne'}</p>
          </div>

          {/* Liste des templates */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Choisir un modele</label>
            <div className="space-y-2">
              {state.emailTemplates.map(tpl => (
                <button
                  key={tpl.id}
                  className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                    selectedTemplateId === tpl.id
                      ? 'border-purple-500 bg-purple-50'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                  }`}
                  onClick={() => { setSelectedTemplateId(tpl.id); setShowPreview(false); }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{tpl.nom}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">{tpl.sujet}</p>
                    </div>
                    <ChevronRight className={`w-4 h-4 transition-colors ${selectedTemplateId === tpl.id ? 'text-purple-500' : 'text-gray-300'}`} />
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Apercu */}
          {selectedTemplate && (
            <div>
              <button
                className="flex items-center gap-1.5 text-xs font-medium text-purple-600 hover:text-purple-700 mb-2"
                onClick={() => setShowPreview(!showPreview)}
              >
                <Eye className="w-3.5 h-3.5" />
                {showPreview ? 'Masquer l\'apercu' : 'Voir l\'apercu'}
              </button>
              {showPreview && (
                <div className="bg-gray-50 rounded-lg p-4 space-y-2 border border-gray-200">
                  <p className="text-xs font-medium text-gray-700">
                    Objet : {replaceVariables(selectedTemplate.sujet)}
                  </p>
                  <hr className="border-gray-200" />
                  <p className="text-xs text-gray-600 whitespace-pre-line leading-relaxed">
                    {replaceVariables(selectedTemplate.corps)}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
          <button
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
            onClick={onClose}
          >
            Annuler
          </button>
          <button
            className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={sendEmail}
            disabled={!selectedTemplateId || !prospect.email}
          >
            <Send className="w-4 h-4" /> Envoyer
          </button>
        </div>
      </div>
    </div>
  );
}
