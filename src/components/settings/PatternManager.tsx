import { useState } from 'react';
import { MusicNoteIcon, PlusIcon, TrashIcon } from '../icons';
import { useStore } from '../../store';
import { BUILTIN_PATTERNS, type StrumPattern } from '../../data/strumPatterns';
import { MAX_PATTERN_BARS, parsePattern, SLOTS_PER_BAR } from '../../lib/strumPattern';
import { describePattern } from '../../lib/patternDeck';
import { PatternBar } from '../practice/PatternBar';

// A selector must return a stable reference: building `?? []` inline hands React
// a new array on every read, which reads as a change every render and spins the
// component into an update loop. Only bites accounts saved before strumPatterns
// existed, which is the oldest data there is.
const NO_PATTERNS: StrumPattern[] = [];

/** The bar shown before anything is typed: what a finished entry looks like. */
const EXAMPLE = 'D-DU-UDU';

// Manage your own strum patterns. Built-ins are shown for reference; you add and
// remove your own.
//
// WHY THE FIELD REFUSES THINGS IT USED TO TAKE. A pattern is only ever a string,
// and this screen used to accept any twelve characters of D, U and -. The drill
// can score exactly one bar of eighth notes, so six characters, or nine, or an
// up strum on a downbeat, produced a saved pattern that looked fine here, sat in
// a deck, and then could not be dealt at all. The bar under the field is the
// whole answer: what you typed is drawn the way the drill will draw it, and if
// it cannot be drawn it cannot be added.
export function PatternManager() {
  const custom = useStore((s) => s.accounts[s.currentAccountId]?.strumPatterns ?? NO_PATTERNS);
  const addStrumPattern = useStore((s) => s.addStrumPattern);
  const removeStrumPattern = useStore((s) => s.removeStrumPattern);

  const [name, setName] = useState('');
  const [pattern, setPattern] = useState('');

  const clean = (raw: string) =>
    raw.toUpperCase().replace(/[^DU-]/g, '').slice(0, SLOTS_PER_BAR * MAX_PATTERN_BARS);
  const typed = clean(pattern);
  const parsed = parsePattern(typed);
  const preview = parsed ?? parsePattern(EXAMPLE);

  const submit = () => {
    if (!name.trim() || !parsed) return;
    addStrumPattern({ id: crypto.randomUUID(), name: name.trim(), pattern: typed });
    setName('');
    setPattern('');
  };

  return (
    <div className="setting-block">
      <h3 className="setting-head">
        <MusicNoteIcon size={18} className="setting-head-icon" />
        <span>Strum patterns</span>
      </h3>

      <div className="pattern-list">
        {[...BUILTIN_PATTERNS.map((p) => ({ ...p, builtin: true })), ...custom.map((p) => ({ ...p, builtin: false }))].map((p) => {
          const bar = parsePattern(p.pattern);
          return (
            <div key={p.id} className="pattern-item">
              <span className="pattern-item-name">{p.name}</span>
              {bar && (
                <PatternBar
                  className="pattern-item-bar"
                  pattern={bar}
                  size="deck"
                  label={`${p.name}. ${describePattern(bar)}`}
                />
              )}
              {!p.builtin && (
                <button className="pattern-item-remove" onClick={() => removeStrumPattern(p.id)} title="Remove" aria-label={`Remove pattern ${p.name}`}>
                  <TrashIcon size={14} />
                </button>
              )}
            </div>
          );
        })}
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
          aria-label="Pattern, using D for down, U for up and - for a slot the arm travels through"
          placeholder={EXAMPLE}
          value={pattern}
          onChange={(e) => setPattern(clean(e.target.value))}
        />
        <button className="pattern-add-btn" onClick={submit} disabled={!name.trim() || !parsed} title="Add pattern">
          <PlusIcon size={16} />
        </button>
      </div>

      {/* What the drill will make of it, drawn as the drill draws it. Until the
          field holds a bar it can read, this is the example from the
          placeholder, so the picture is of the finished thing rather than of
          the mistake. */}
      {preview && (
        <PatternBar
          className={parsed ? 'pattern-add-preview' : 'pattern-add-preview is-example'}
          pattern={preview}
          size="deck"
          standing={parsed ? 'learning' : 'new'}
          label={parsed ? describePattern(preview) : `Example. ${describePattern(preview)}`}
        />
      )}
    </div>
  );
}
