import { useState, useRef, useEffect } from 'react';
import { Filter, ChevronDown, Check } from 'lucide-react';

interface MultiSelectDropdownProps {
  label: string;
  options: { value: string; label: string; color?: string }[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  color?: string;
}

const colorMap: Record<string, { btn: string; active: string }> = {
  brewery: { btn: 'border-brewery-300 text-brewery-700 bg-brewery-50', active: 'bg-brewery-600 text-white border-brewery-600' },
  blue: { btn: 'border-blue-300 text-blue-700 bg-blue-50', active: 'bg-blue-600 text-white border-blue-600' },
  amber: { btn: 'border-amber-300 text-amber-700 bg-amber-50', active: 'bg-amber-500 text-white border-amber-500' },
  teal: { btn: 'border-teal-300 text-teal-700 bg-teal-50', active: 'bg-teal-600 text-white border-teal-600' },
  indigo: { btn: 'border-indigo-300 text-indigo-700 bg-indigo-50', active: 'bg-indigo-600 text-white border-indigo-600' },
};

export default function MultiSelectDropdown({ label, options, selected, onToggle, color = 'brewery' }: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const count = selected.size;
  const c = colorMap[color] || colorMap.brewery;

  return (
    <div className="relative" ref={ref}>
      <button
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
          count > 0 ? c.active : 'border-gray-200 text-gray-600 bg-white hover:bg-gray-50'
        }`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Filtre ${label}`}
      >
        <Filter className="w-3 h-3" />
        {label}
        {count > 0 && <span className="bg-white/30 rounded-full px-1 text-[10px]">{count}</span>}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[200px] max-h-64 overflow-y-auto" role="listbox">
          {/* Select/Deselect all */}
          <div className="sticky top-0 bg-white border-b border-gray-100 px-3 py-2 flex items-center justify-between">
            <span className="text-[10px] text-gray-400">{count}/{options.length} selectionne(s)</span>
            <button
              className="text-[10px] text-brewery-600 hover:text-brewery-800 font-medium"
              onClick={() => {
                if (count === options.length) {
                  options.forEach(o => { if (selected.has(o.value)) onToggle(o.value); });
                } else {
                  options.forEach(o => { if (!selected.has(o.value)) onToggle(o.value); });
                }
              }}
            >
              {count === options.length ? 'Tout deselect.' : 'Tout select.'}
            </button>
          </div>

          {options.map(option => (
            <button
              key={option.value}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs hover:bg-gray-50 transition-colors ${
                selected.has(option.value) ? 'bg-gray-50 font-medium' : ''
              }`}
              onClick={() => onToggle(option.value)}
              role="option"
              aria-selected={selected.has(option.value)}
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                selected.has(option.value) ? 'bg-brewery-600 border-brewery-600' : 'border-gray-300'
              }`}>
                {selected.has(option.value) && <Check className="w-3 h-3 text-white" />}
              </div>
              {option.color && (
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: option.color }} />
              )}
              <span className="truncate text-gray-700">{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
