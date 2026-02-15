import { useState, useEffect } from 'react';
import { Save, Trash2, FolderOpen, X, Check } from 'lucide-react';

export interface FilterPreset {
  id: string;
  name: string;
  filters: Record<string, unknown>;
}

const STORAGE_KEY = 'suivipro_filter_presets';

function loadPresets(page: string): FilterPreset[] {
  try {
    const data = localStorage.getItem(`${STORAGE_KEY}_${page}`);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function savePresets(page: string, presets: FilterPreset[]) {
  localStorage.setItem(`${STORAGE_KEY}_${page}`, JSON.stringify(presets));
}

interface FilterPresetsProps {
  page: string;
  getCurrentFilters: () => Record<string, unknown>;
  applyFilters: (filters: Record<string, unknown>) => void;
}

export default function FilterPresets({ page, getCurrentFilters, applyFilters }: FilterPresetsProps) {
  const [presets, setPresets] = useState<FilterPreset[]>(() => loadPresets(page));
  const [showSave, setShowSave] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [showList, setShowList] = useState(false);

  useEffect(() => {
    savePresets(page, presets);
  }, [page, presets]);

  const handleSave = () => {
    if (!presetName.trim()) return;
    const newPreset: FilterPreset = {
      id: Date.now().toString(),
      name: presetName.trim(),
      filters: getCurrentFilters(),
    };
    setPresets(prev => [...prev, newPreset]);
    setPresetName('');
    setShowSave(false);
  };

  const handleDelete = (id: string) => {
    setPresets(prev => prev.filter(p => p.id !== id));
  };

  const handleLoad = (preset: FilterPreset) => {
    applyFilters(preset.filters);
    setShowList(false);
  };

  return (
    <div className="flex items-center gap-1.5">
      {/* Load preset button */}
      <div className="relative">
        <button
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
            showList ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
          }`}
          onClick={() => { setShowList(!showList); setShowSave(false); }}
        >
          <FolderOpen className="w-3 h-3" />
          Presets
          {presets.length > 0 && (
            <span className={`text-[9px] rounded-full w-4 h-4 flex items-center justify-center ${
              showList ? 'bg-white/20' : 'bg-indigo-200'
            }`}>{presets.length}</span>
          )}
        </button>

        {showList && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[200px] max-h-64 overflow-y-auto">
            {presets.length === 0 ? (
              <p className="p-3 text-[11px] text-gray-400 text-center">Aucun preset enregistre</p>
            ) : (
              presets.map(preset => (
                <div key={preset.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 group">
                  <button
                    className="flex-1 text-left text-xs text-gray-700 font-medium truncate"
                    onClick={() => handleLoad(preset)}
                  >
                    {preset.name}
                  </button>
                  <button
                    className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={e => { e.stopPropagation(); handleDelete(preset.id); }}
                    title="Supprimer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Save preset button / form */}
      {showSave ? (
        <div className="flex items-center gap-1">
          <input
            type="text"
            placeholder="Nom du preset..."
            className="px-2 py-1 border border-gray-200 rounded-lg text-[11px] w-32"
            value={presetName}
            onChange={e => setPresetName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
            autoFocus
          />
          <button
            className="p-1 text-green-600 hover:text-green-700 disabled:opacity-30"
            onClick={handleSave}
            disabled={!presetName.trim()}
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            className="p-1 text-gray-400 hover:text-gray-600"
            onClick={() => { setShowSave(false); setPresetName(''); }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
          onClick={() => { setShowSave(true); setShowList(false); }}
        >
          <Save className="w-3 h-3" />
          Enregistrer
        </button>
      )}
    </div>
  );
}
