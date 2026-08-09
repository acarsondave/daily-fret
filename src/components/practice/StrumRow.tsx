import { ArrowDownIcon, ArrowUpIcon } from '../icons';
import { parseStrum } from '../../data/songs';

interface Props {
  strum: string; // D/U/- string, any length
  size?: number;
}

// A chord's strum as arrow art: down/up arrows for strums, a dim dot for rests.
// Length is the strum count, so "DD" reads as two downs and "DDDDDD" as six.
export function StrumRow({ strum, size = 13 }: Props) {
  const slots = parseStrum(strum);
  return (
    <div className="strum-row" aria-hidden="true">
      {slots.map((dir, i) => (
        <span key={i} className={dir === '-' ? 'strum-arrow is-rest' : 'strum-arrow'}>
          {dir === 'D' && <ArrowDownIcon size={size} />}
          {dir === 'U' && <ArrowUpIcon size={size} />}
          {dir === '-' && <span className="strum-rest-dot" />}
        </span>
      ))}
    </div>
  );
}
