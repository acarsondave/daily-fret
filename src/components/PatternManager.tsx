import { useState } from 'react';
import { MusicNoteIcon, PlusIcon, TrashIcon } from './icons';
import { useStore } from '../store';
import { BUILTIN_PATTERNS } from '../data/strumPatterns';
import { StrumRow } from './practice/StrumRow';

// Manage your own strum patterns. Built-ins are shown for reference; you add and
// remove your own. Patterns are a string of D (down), U (up), - (rest).
export function PatternManager() {
  const custom = useStore((s) => s.accounts[s.currentAccountId]?.strumPatterns ?? []);
  const addStrumPattern = useStore((s) => s.addStrumPattern);
  const removeStrumPattern = useStore((s) => s.removeStrumPattern);

  const [name, setName] = useState('');
  const [pattern, setPattern] = useState('');

  const clean = (raw: string) => raw.toUpperCase().replace(/[^DU-]/g, '').slice(0, 12);

  const submit = () => {
    const p = clean(pattern);
    if (!name.trim() || !p) return;
    addStrumPattern({ id: crypto.randomUUID(), name: name.trim(), pattern: p });
    setName('');
    setPattern('');
  };

  return (
    <div className="pattern-manager">
      <div className="mic-setting-head">
        <MusicNoteIcon size={18} />
        <span>Strum patterns</span>
      </div>

      <div className="pattern-list">
        {[...BUILTIN_PATTERNS.map((p) => ({ ...p, builtin: true })), ...custom.map((p) => ({ ...p, builtin: false }))].map((p) => (
          <div key={p.id} className="pattern-item">
            <span className="pattern-item-name">{p.name}</span>
            <StrumRow strum={p.pattern} size={12} />
            {!p.builtin && (
              <button className="pattern-item-remove" onClick={() => removeStrumPattern(p.id)} title="Remove" aria-label={`Remove pattern ${p.name}`}>
                <TrashIcon size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="pattern-add">
        <input
          className="task-input"
          aria-label="Pattern name"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={24}
        />
        <input
          className="task-input pattern-add-code"
          aria-label="Pattern, using D for down, U for up and - for rest"
          placeholder="e.g. DDUUDU"
          value={pattern}
          onChange={(e) => setPattern(clean(e.target.value))}
        />
        <button className="pattern-add-btn" onClick={submit} disabled={!name.trim() || !clean(pattern)} title="Add pattern">
          <PlusIcon size={16} />
        </button>
      </div>
      <p className="pattern-hint">D = down, U = up, - = rest</p>
    </div>
  );
}
