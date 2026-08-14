import { LoopIcon, MinusIcon, PlusIcon } from '../icons';
import './playbackControls.css';

// The two controls that turn watching a record into learning one.
//
// Speed first, and deliberately the largest thing in the row. Almost every song
// worth playing along to is faster than a beginner can change chords, and the
// player preserves pitch, so three quarter speed is the same song in the same
// key with time to move a hand. It is the highest-value control on the screen
// and it is sized like it.
//
// Then the section loop, which is how a chorus actually gets learned: round and
// round until it is yours, then the whole song. It reads the section you are
// currently in, so arming it is one tap and never a menu.

interface Props {
  /** The player's current rate. */
  rate: number;
  /** Rates this video offers, ascending. Empty until the player has answered. */
  rates: number[];
  onRate: (rate: number) => void;
  /** The section under the playhead, or null outside the chart. */
  sectionLabel: string | null;
  looping: boolean;
  onToggleLoop: () => void;
}

const NORMAL_RATE = 1;

/** Trailing zeroes read as precision this control does not have. 0.75x, not 0.750x. */
const showRate = (rate: number): string => `${Number(rate.toFixed(2))}x`;

const nearestIndex = (rates: number[], rate: number): number => {
  let best = 0;
  for (let i = 1; i < rates.length; i++) {
    if (Math.abs(rates[i] - rate) < Math.abs(rates[best] - rate)) best = i;
  }
  return best;
};

export function PlaybackControls({ rate, rates, onRate, sectionLabel, looping, onToggleLoop }: Props) {
  // A player that has not reported its rates yet is not a player offering only
  // one speed, and the control says which by being unavailable rather than by
  // showing a single option that does nothing.
  const ready = rates.length > 1;
  const index = ready ? nearestIndex(rates, rate) : -1;
  const slower = ready && index > 0 ? rates[index - 1] : null;
  const faster = ready && index < rates.length - 1 ? rates[index + 1] : null;
  const offNormal = Math.abs(rate - NORMAL_RATE) > 0.001;

  return (
    <div className="pbc">
      <div className="pbc-speed" role="group" aria-label="Playback speed">
        <button
          className="pbc-step"
          onClick={() => slower !== null && onRate(slower)}
          disabled={slower === null}
          aria-label="Slower"
        >
          <MinusIcon size={17} />
        </button>
        <button
          className={offNormal ? 'pbc-rate is-off-normal' : 'pbc-rate'}
          onClick={() => onRate(NORMAL_RATE)}
          disabled={!ready || !offNormal}
          aria-label={offNormal ? 'Back to full speed' : 'Playing at full speed'}
        >
          <span className="pbc-rate-value">{ready ? showRate(rate) : '--'}</span>
          <span className="pbc-rate-label">{offNormal ? 'still in key' : 'speed'}</span>
        </button>
        <button
          className="pbc-step"
          onClick={() => faster !== null && onRate(faster)}
          disabled={faster === null}
          aria-label="Faster"
        >
          <PlusIcon size={17} />
        </button>
      </div>

      <button
        className={looping ? 'pbc-loop is-on' : 'pbc-loop'}
        onClick={onToggleLoop}
        disabled={!sectionLabel}
        aria-pressed={looping}
      >
        <LoopIcon size={17} />
        <span className="pbc-loop-text">
          {looping ? 'Looping' : 'Loop'} {sectionLabel ?? 'section'}
        </span>
      </button>
    </div>
  );
}
