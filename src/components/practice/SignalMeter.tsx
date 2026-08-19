import { MicIcon } from '../icons';
import type { SignalQuality } from './signalQuality';
import './signal.css';

/**
 * What the bars cannot say on their own.
 *
 * Every state used to carry a phrase, including the two the bars already draw
 * completely: three green bars beside the words "Good signal" is a label
 * repeating a shape, on a screen whose whole job is to be read in a glance while
 * both hands are busy. So the healthy states are bars alone, and words are kept
 * for the states where the level is not the problem and no amount of playing
 * louder is the answer.
 */
const COPY: Partial<Record<SignalQuality, string>> = {
  silent: 'Too quiet. Move closer.',
  // The distinction the bars alone cannot draw: the level is fine, the shapes
  // are not being recognised. Naming the likely cause matters here because it is
  // the one state where the player's instinct is to blame their own hands.
  unreadable: 'Nothing is matching. Try recalibrating.',
  // The one state that is not about the playing at all. It says what happened
  // and what to do, because no amount of strumming is the answer.
  lost: 'The microphone stopped. Reopen the drill.',
  loud: 'Too loud. Back off the mic.',
};

/** Read out where the meter is drawn rather than written. */
const SPOKEN: Record<SignalQuality, string> = {
  silent: 'Microphone hearing nothing.',
  weak: 'Weak signal.',
  unreadable: 'Loud enough, nothing matching.',
  lost: 'The microphone stopped.',
  good: 'Good signal.',
  loud: 'Signal too loud.',
};

const FILLED: Record<SignalQuality, number> = {
  silent: 0,
  weak: 1,
  // Full bars, because the signal genuinely is strong. The bars report level and
  // they are not lying; what is wrong is downstream of them, which is why this
  // state is drawn as full-but-hollow rather than as fewer bars.
  unreadable: 3,
  // Nothing is arriving, and the bars say exactly that.
  lost: 0,
  good: 3,
  loud: 2,
};

interface Props {
  quality: SignalQuality;
}

export function SignalMeter({ quality }: Props) {
  const filled = FILLED[quality];
  const note = COPY[quality];
  return (
    <div
      className={note ? `signal-meter is-${quality}` : `signal-meter is-${quality} is-bare`}
      title={SPOKEN[quality]}
      role="status"
      aria-label={SPOKEN[quality]}
    >
      <MicIcon size={14} className="signal-mic" />
      <div className="signal-bars" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={i < filled ? 'signal-bar is-on' : 'signal-bar'} />
        ))}
      </div>
      {note && <span className="signal-label">{note}</span>}
    </div>
  );
}
