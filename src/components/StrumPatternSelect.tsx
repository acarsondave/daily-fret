import { useStore } from '../store';
import { BUILTIN_PATTERNS } from '../data/strumPatterns';

interface Props {
  value: string; // the pattern string ('' = none)
  onChange: (pattern: string) => void;
}

// Dropdown of strum patterns (built-ins + the account's own) for a timed block.
// Stores the pattern string directly, so deleting a saved pattern can't break a
// task that already uses it.
export function StrumPatternSelect({ value, onChange }: Props) {
  const custom = useStore((s) => s.accounts[s.currentAccountId]?.strumPatterns ?? []);
  return (
    <select className="task-input drill-song-select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">No strum pattern</option>
      <optgroup label="Built-in">
        {BUILTIN_PATTERNS.map((p) => (
          <option key={p.id} value={p.pattern}>{p.name}</option>
        ))}
      </optgroup>
      {custom.length > 0 && (
        <optgroup label="Yours">
          {custom.map((p) => (
            <option key={p.id} value={p.pattern}>{p.name}</option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
