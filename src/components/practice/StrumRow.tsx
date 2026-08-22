import { ArrowDownIcon, ArrowUpIcon } from '../icons';
import { ICON_STROKE } from '../icons/Icon';
import { parseStrum } from '../../data/songs';
import './strumRow.css';

interface Props {
  strum: string; // D/U/- string, any length
  size?: number;
}

// A chord's strum as arrow art: down/up arrows for strums, a cross for a
// percussive slap, a dim dot for rests. Length is the strum count, so "DD" reads
// as two downs and "DDDDDD" as six.
//
// The cross is the mark tab already uses for a dead stroke, drawn here in the
// icon set's own pen weight rather than typed as a letter, so it sits at the
// same stroke as the arrows either side of it.
export function StrumRow({ strum, size = 13 }: Props) {
  const slots = parseStrum(strum);
  return (
    <div className="strum-row" aria-hidden="true">
      {slots.map((dir, i) => (
        <span key={i} className={dir === '-' ? 'strum-arrow is-rest' : 'strum-arrow'}>
          {dir === 'D' && <ArrowDownIcon size={size} />}
          {dir === 'U' && <ArrowUpIcon size={size} />}
          {dir === 'X' && <MuteMark size={size} />}
          {dir === '-' && <span className="strum-rest-dot" />}
        </span>
      ))}
    </div>
  );
}

/** A dead stroke: the strings crossed and nothing sounding. */
function MuteMark({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M7 7l10 10M17 7L7 17" />
    </svg>
  );
}
