import { useState } from 'react';
import { Mail, X, Send, Eye, ChevronRight, Paperclip, FileText, Download, Edit2, Check } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { Prospect, Client, DOCUMENT_CATEGORY_LABELS, DocumentCategory } from '../types';
import { downloadDocument } from '../api/client';
import { generateId, toLocalDateStr } from '../utils/helpers';

interface ProspectProps {
  prospect: Prospect;
  client?: never;
  onClose: () => void;
}

interface ClientProps {
  client: Client;
  prospect?: never;
  onClose: () => void;
}

type Props = ProspectProps | ClientProps;

export default function EmailTemplateModal(props: Props) {
  const { onClose } = props;
  const isProspect = !!props.prospect;
  const prospect = props.prospect || null;
  const client = props.client || null;

  // Unified fields
  const entityName = prospect ? prospect.nom_etablissement : client?.nom || '';
  const contactName = prospect ? prospect.nom_contact : client?.contact || '';
  const entityEmail = prospect?.email || client?.email || '';

  const { state, dispatch } = useApp();
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [showDocPicker, setShowDocPicker] = useState(false);
  const [emailAddress, setEmailAddress] = useState(entityEmail);
  const [editingEmail, setEditingEmail] = useState(!entityEmail);

  const commercial = state.currentUser;

  const replaceVariables = (text: string) => {
    return text
      .replace(/\{\{nom_contact\}\}/g, contactName)
      .replace(/\{\{nom_etablissement\}\}/g, entityName)
      .replace(/\{\{commercial\}\}/g, commercial ? `${commercial.prenom} ${commercial.nom}` : '')
      .replace(/\{\{telephone_commercial\}\}/g, commercial?.telephone || '')
      .replace(/\{\{date_rdv\}\}/g, '');
  };

  const selectedTemplate = state.emailTemplates.find(t => t.id === selectedTemplateId);
  const selectedDocs = state.documents.filter(d => selectedDocIds.includes(d.id));

  const toggleDoc = (docId: string) => {
    setSelectedDocIds(prev =>
      prev.includes(docId) ? prev.filter(id => id !== docId) : [...prev, docId]
    );
  };

  const saveEmail = () => {
    if (emailAddress.trim()) {
      if (isProspect && prospect) {
        dispatch({
          type: 'UPDATE_PROSPECT',
          payload: { ...prospect, email: emailAddress.trim(), date_modification: new Date().toISOString() },
        });
      } else if (client) {
        dispatch({
          type: 'UPDATE_CLIENT',
          payload: { ...client, email: emailAddress.trim(), date_modification: new Date().toISOString() },
        });
      }
      setEditingEmail(false);
    }
  };

  const sendEmail = () => {
    if (!selectedTemplate || !emailAddress.trim()) return;
    const emailToUse = emailAddress.trim();

    // Save email if changed
    if (emailToUse !== entityEmail) {
      if (isProspect && prospect) {
        dispatch({
          type: 'UPDATE_PROSPECT',
          payload: { ...prospect, email: emailToUse, date_modification: new Date().toISOString() },
        });
      } else if (client) {
        dispatch({
          type: 'UPDATE_CLIENT',
          payload: { ...client, email: emailToUse, date_modification: new Date().toISOString() },
        });
      }
    }

    const subject = encodeURIComponent(replaceVariables(selectedTemplate.sujet));
    let bodyText = replaceVariables(selectedTemplate.corps);

    // Add attachment note if documents selected
    if (selectedDocs.length > 0) {
      bodyText += '\n\n---\nPieces jointes a envoyer :\n';
      selectedDocs.forEach(doc => {
        bodyText += `- ${doc.nom} (${doc.nom_fichier})\n`;
      });
      bodyText += '\n(Pensez a telecharger et joindre ces fichiers manuellement dans votre client email)';
    }

    const body = encodeURIComponent(bodyText);
    window.open(`mailto:${emailToUse}?subject=${subject}&body=${body}`, '_blank');

    // Auto-download selected documents so the user can attach them
    selectedDocs.forEach(doc => {
      downloadDocument(doc.id, doc.nom_fichier).catch(() => {});
    });

    // Prospect-specific: move to negociation stage
    if (isProspect && prospect) {
      if (!['gagne', 'client_gagne', 'perdu', 'ne_pas_contacter', 'negociation'].includes(prospect.etape_pipeline)) {
        dispatch({ type: 'MOVE_PROSPECT', payload: { id: prospect.id, stage: 'negociation' } });
      }
    }

    // Create a reminder for 7-day follow-up
    const in7days = new Date();
    in7days.setDate(in7days.getDate() + 7);
    dispatch({
      type: 'ADD_REMINDER',
      payload: {
        id: generateId('rem'),
        prospect_id: isProspect ? prospect!.id : '',
        commercial_id: state.currentUser?.id || 'com-1',
        date: toLocalDateStr(in7days),
        heure: '09:00',
        message: `Relance email - ${entityName} (${selectedTemplate.nom})`,
        statut: 'actif',
      },
    });

    onClose();
  };

  return (
    <div className="modal-backdrop">
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
            <p className="text-xs text-gray-500 mb-1">Destinataire</p>
            <p className="text-sm font-medium text-gray-900">
              {contactName ? `${contactName} - ` : ''}{entityName}
            </p>
            {editingEmail ? (
              <div className="flex items-center gap-2 mt-1.5">
                <input
                  type="email"
                  className="flex-1 px-2.5 py-1.5 border border-purple-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white"
                  placeholder="Saisir l'email..."
                  value={emailAddress}
                  onChange={e => setEmailAddress(e.target.value)}
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter' && emailAddress.trim()) saveEmail(); }}
                />
                <button
                  className="p-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                  onClick={saveEmail}
                  disabled={!emailAddress.trim()}
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 mt-0.5">
                <Mail className="w-3 h-3 text-gray-400" />
                <span className="text-xs text-gray-600">{emailAddress}</span>
                <button
                  className="p-0.5 text-gray-400 hover:text-purple-600 rounded"
                  onClick={() => setEditingEmail(true)}
                  title="Modifier l'email"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              </div>
            )}
            {!emailAddress.trim() && !editingEmail && (
              <button
                className="mt-1.5 text-xs text-purple-600 hover:text-purple-700 font-medium underline"
                onClick={() => setEditingEmail(true)}
              >
                + Ajouter un email
              </button>
            )}
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

          {/* Pieces jointes */}
          {state.documents.length > 0 && (
            <div>
              <button
                className="flex items-center gap-1.5 text-xs font-medium text-purple-600 hover:text-purple-700 mb-2"
                onClick={() => setShowDocPicker(!showDocPicker)}
              >
                <Paperclip className="w-3.5 h-3.5" />
                Pieces jointes ({selectedDocIds.length})
              </button>
              {showDocPicker && (
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 space-y-2 max-h-48 overflow-y-auto">
                  {state.documents.map(doc => (
                    <label key={doc.id} className="flex items-center gap-2.5 cursor-pointer hover:bg-white rounded p-1.5 transition-colors">
                      <input
                        type="checkbox"
                        checked={selectedDocIds.includes(doc.id)}
                        onChange={() => toggleDoc(doc.id)}
                        className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                      />
                      <FileText className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-700 truncate">{doc.nom}</p>
                        <p className="text-[10px] text-gray-400">{DOCUMENT_CATEGORY_LABELS[doc.categorie as DocumentCategory] || doc.categorie} — {doc.nom_fichier}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
              {selectedDocs.length > 0 && !showDocPicker && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedDocs.map(doc => (
                    <span key={doc.id} className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 rounded text-[11px]">
                      <FileText className="w-3 h-3" />
                      {doc.nom}
                      <button className="hover:text-purple-900" onClick={() => toggleDoc(doc.id)}>
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

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
                  {selectedDocs.length > 0 && (
                    <>
                      <hr className="border-gray-200" />
                      <div className="text-xs text-gray-500">
                        <p className="font-medium mb-1">Pieces jointes :</p>
                        {selectedDocs.map(doc => (
                          <p key={doc.id} className="flex items-center gap-1">
                            <Paperclip className="w-3 h-3" /> {doc.nom} ({doc.nom_fichier})
                          </p>
                        ))}
                      </div>
                    </>
                  )}
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
            disabled={!selectedTemplateId || !emailAddress.trim()}
          >
            <Send className="w-4 h-4" /> Envoyer
            {selectedDocIds.length > 0 && (
              <span className="bg-purple-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                {selectedDocIds.length}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
