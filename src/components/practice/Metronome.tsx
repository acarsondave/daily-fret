import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, Minus, Plus } from '@phosphor-icons/react';
import { useStore } from '../../store';
import { metronome, MIN_BPM, MAX_BPM } from '../../audio/metronome';

const DEFAULT_BPM = 90;
// Ignore taps more than this far apart — they belong to different attempts, not
// one steady tempo.
const TAP_RESET_MS = 2000;

// Custom metronome mark: the app's stroke language (2px, round caps) drawn as a
// tapered body with a swinging pendulum, not a stock glyph.
function MetronomeMark({ swinging }: { swinging: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 20 L10 5 A2 2 0 0 1 14 5 L16 20 Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <line x1="6.5" y1="20" x2="17.5" y2="20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <motion.line
        x1="12"
        y1="18"
        x2="12"
        y2="8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        style={{ originX: '12px', originY: '18px' }}
        animate={swinging ? { rotate: [-18, 18, -18] } : { rotate: 0 }}
        transition={swinging ? { duration: 1, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
      />
    </svg>
  );
}

// Shared tempo control. Owns the app's single metronome engine, remembers the
// last tempo, and can be dropped into any practice top bar. Starts stopped.
export function Metronome() {
  const storedBpm = useStore((s) => s.accounts[s.currentAccountId]?.metronomeBpm);
  const setMetronomeBpm = useStore((s) => s.setMetronomeBpm);

  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [bpm, setBpm] = useState(storedBpm ?? DEFAULT_BPM);
  const [beat, setBeat] = useState(0);
  const tapsRef = useRef<number[]>([]);

  // Keep the engine's tempo in step with the slider while it plays.
  useEffect(() => {
    metronome.setBpm(bpm);
  }, [bpm]);

  // Drive the visual pulse from the audio clock, and tear the engine down when
  // this control unmounts so a click never outlives the drill.
  useEffect(() => {
    metronome.onBeat = () => setBeat((b) => b + 1);
    return () => {
      metronome.onBeat = null;
      metronome.stop();
    };
  }, []);

  const commitBpm = (next: number) => {
    const clamped = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(next)));
    setBpm(clamped);
    setMetronomeBpm(clamped);
  };

  const toggle = () => {
    if (running) {
      metronome.stop();
      setRunning(false);
    } else {
      metronome.start(bpm);
      setRunning(true);
    }
  };

  const tap = () => {
    const now = performance.now();
    const taps = tapsRef.current;
    if (taps.length && now - taps[taps.length - 1] > TAP_RESET_MS) taps.length = 0;
    taps.push(now);
    if (taps.length > 5) taps.shift();
    if (taps.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      commitBpm(60000 / avg);
    }
  };

  return (
    <div className="metro">
      <button
        className={running ? 'practice-close metro-trigger is-live' : 'practice-close metro-trigger'}
        onClick={() => setOpen((o) => !o)}
        title="Metronome"
        aria-pressed={open}
      >
        <MetronomeMark swinging={running} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="metro-panel"
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="metro-readout">
              <span key={beat} className={running ? 'metro-pulse is-beat' : 'metro-pulse'} />
              <span className="metro-bpm">{bpm}</span>
              <span className="metro-unit">BPM</span>
            </div>

            <div className="metro-stepper">
              <button className="metro-step" onClick={() => commitBpm(bpm - 1)} aria-label="Slower">
                <Minus size={16} weight="bold" />
              </button>
              <input
                className="metro-slider"
                type="range"
                min={MIN_BPM}
                max={MAX_BPM}
                value={bpm}
                onChange={(e) => commitBpm(Number(e.target.value))}
                aria-label="Tempo"
              />
              <button className="metro-step" onClick={() => commitBpm(bpm + 1)} aria-label="Faster">
                <Plus size={16} weight="bold" />
              </button>
            </div>

            <div className="metro-actions">
              <button className="metro-tap" onClick={tap}>Tap</button>
              <button className="practice-btn primary metro-play" onClick={toggle}>
                {running ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
                {running ? 'Stop' : 'Start'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
