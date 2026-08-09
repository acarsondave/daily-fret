import { MicIcon } from '../icons';
import type { SignalQuality } from './signalQuality';
import './signal.css';

const COPY: Record<SignalQuality, string> = {
  silent: 'Too quiet. Strum louder or move closer.',
  weak: 'Weak signal',
  good: 'Good signal',
  loud: 'Too loud. Back off the mic.',
};

const FILLED: Record<SignalQuality, number> = {
  silent: 0,
  weak: 1,
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
