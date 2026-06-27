import { ArrowDown, ArrowUp } from '@phosphor-icons/react';
import type { StrumDir } from '../../data/songs';

interface Props {
  slots: StrumDir[]; // 8 eighth-note slots
  activeSlot?: number; // current beat cursor; -1/undefined = static reference
}

// The strum pattern as arrow art: down/up arrows for strums, a dim dot for
// rests. In the Play pass the active eighth-note is highlighted by the cursor;
// in Learn it sits static as a reference. Eight slots read as four beats.
export function StrumRow({ slots, activeSlot = -1 }: Props) {
  return (
    <div className="strum-row" aria-hidden="true">
      {slots.map((dir, i) => {
        const isBeat = i % 2 === 0; // downbeats (1 2 3 4)
        const isActive = i === activeSlot;
        return (
          <div
            key={i}
            className={[
              'strum-slot',
              isBeat ? 'is-beat' : 'is-off',
              dir === '-' ? 'is-rest' : 'is-strum',
              isActive ? 'is-active' : '',
            ].join(' ').trim()}
          >
            {dir === 'D' && <ArrowDown size={16} weight="bold" />}
            {dir === 'U' && <ArrowUp size={16} weight="bold" />}
            {dir === '-' && <span className="strum-rest-dot" />}
          </div>
        );
      })}
    </div>
  );
}
