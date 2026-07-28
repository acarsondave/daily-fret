import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, Minus, Plus } from '@phosphor-icons/react';
import { useStore } from '../../store';
import { metronome, MIN_BPM, MAX_BPM } from '../../audio/metronome';
import { DEFAULT_PRACTICE_BPM, type TempoPlan } from '../../lib/tempo';

// Ignore taps more than this far apart: they belong to different attempts, not
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

interface Props {
  // The tempo this drill should run at, derived from the player's own history
  // (src/lib/tempo.ts). Absent for surfaces with nothing to prescribe from.
  plan?: TempoPlan | null;
  // Identity of the thing `plan` was computed for. The prescription re-applies
  // when this changes, and only then, so a mid-drill manual adjustment sticks.
  planKey?: string;
  // Whether this segment should start the click by itself. False where a click
  // would fight the material (playing along to a recording).
  autoPlay?: boolean;
}

// Shared tempo control. Owns the app's single metronome engine and, in coached
// practice, runs it at the tempo the player's own results justify. Adjustable at
// any time; the prescription is a starting point, never a lock.
export function Metronome({ plan = null, planKey, autoPlay = true }: Props) {
  const storedBpm = useStore((s) => s.accounts[s.currentAccountId]?.metronomeBpm);
  const storedAuto = useStore((s) => s.accounts[s.currentAccountId]?.metronomeAuto);
  const setMetronomeBpm = useStore((s) => s.setMetronomeBpm);
  const setMetronomeAuto = useStore((s) => s.setMetronomeAuto);
  const auto = storedAuto ?? true;

  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [bpm, setBpm] = useState(storedBpm ?? DEFAULT_PRACTICE_BPM);
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

  // Apply the prescription when the drill changes, or when auto is switched.
  // Deliberately not keyed on `bpm`: once a drill is under way the player's own
  // adjustment owns the tempo until the next drill.
  useEffect(() => {
    if (!plan) return;
    // Deferred a tick, the same way the drills defer their auto-start: it keeps
    // setState out of the effect body and is safe across StrictMode's
    // mount/cleanup/mount.
    const t = setTimeout(() => {
      if (!auto) {
        // Hand the click back as a plain 4/4 so a manual start isn't still
        // accenting some earlier drill's change cycle.
        metronome.setBeatsPerBar(4);
        metronome.stop();
        setRunning(false);
        return;
      }
      metronome.setBeatsPerBar(plan.beatsPerChange);
      setBpm(plan.bpm);
      if (autoPlay) {
        metronome.start(plan.bpm);
        setRunning(true);
      } else {
        metronome.stop();
        setRunning(false);
      }
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, auto, autoPlay]);

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
        title={running ? `Metronome ${bpm} BPM` : 'Metronome'}
        aria-pressed={open}
      >
        <MetronomeMark swinging={running} />
        {running && <span className="metro-trigger-bpm">{bpm}</span>}
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

            {plan && auto && <p className="metro-reason">{plan.reason}</p>}

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

            <label className="metro-auto">
              <input
                type="checkbox"
                checked={auto}
                onChange={(e) => setMetronomeAuto(e.target.checked)}
              />
              <span>Set the tempo for me</span>
            </label>

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
