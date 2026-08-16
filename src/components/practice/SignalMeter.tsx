import { MicIcon } from '../icons';
import type { SignalQuality } from './signalQuality';
import './signal.css';

const COPY: Record<SignalQuality, string> = {
  silent: 'Too quiet. Strum louder or move closer.',
  weak: 'Weak signal',
  // The distinction the bars alone cannot draw: the level is fine, the shapes
  // are not being recognised. Naming the likely cause matters here because it is
  // the one state where the player's instinct is to blame their own hands.
  unreadable: 'Loud enough, but nothing is matching. Try recalibrating.',
  good: 'Good signal',
  loud: 'Too loud. Back off the mic.',
};

const FILLED: Record<SignalQuality, number> = {
  silent: 0,
  weak: 1,
  // Full bars, because the signal genuinely is strong. The bars report level and
  // they are not lying; what is wrong is downstream of them, which is why this
  // state is drawn as full-but-hollow rather than as fewer bars.
  unreadable: 3,
  good: 3,
  loud: 2,
};

interface Props {
  quality: SignalQuality;
}

export function SignalMeter({ quality }: Props) {
  const filled = FILLED[quality];
  return (
    <div className={`signal-meter is-${quality}`} title={COPY[quality]}>
      <MicIcon size={14} className="signal-mic" />
      <div className="signal-bars" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={i < filled ? 'signal-bar is-on' : 'signal-bar'} />
        ))}
      </div>
      <span className="signal-label">{COPY[quality]}</span>
    </div>
  );
}
