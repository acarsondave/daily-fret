import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MinusIcon, PauseIcon, PlayIcon, PlusIcon, RetryIcon, ICON_STROKE } from '../icons';
import { useStore } from '../../store';
import {
  metronome,
  MIN_BPM,
  MAX_BPM,
  type BeatAccent,
  type BeatEvent,
} from '../../audio/metronome';
import {
  METER_IDS,
  countInFor,
  cycleAccents,
  meterOf,
  nextAccentLevel,
  normaliseAccents,
  type AccentLevel,
  type MeterId,
} from '../../audio/meter';
import { armOutputAudioUnlock } from '../../audio/outputContext';
import { DEFAULT_PRACTICE_BPM, type TempoPlan } from '../../lib/tempo';

// Ignore taps more than this far apart: they belong to different attempts, not
// one steady tempo.
const TAP_RESET_MS = 2000;
// Two taps is one interval, and one interval is a guess. Three is a tempo.
const TAPS_NEEDED = 3;

// The live variant of MetronomeIcon: same geometry and the same 1.75 pen as the
// rest of the set, with the arm swinging in real time. It is driven off the beat
// events, which come from the audio clock, and it reaches the end of its travel
// exactly on the click, which is where a mechanical metronome's escapement
// actually fires. A swing on a fixed loop would say "running" while disagreeing
// with the tempo it is running at, which is the kind of small lie that makes a
// tool feel cheap.
function MetronomeMark({ beat }: { beat: BeatEvent | null }) {
  const swing = beat ? (beat.position % 2 === 0 ? -18 : 18) : 0;
  return (
    <svg
      className="icon-glyph"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 20 10 5a2 2 0 0 1 4 0l2 15Z" />
      <path d="M6.4 20h11.2" />
      <motion.line
        x1="12"
        y1="17.6"
        x2="12"
        y2="8.4"
        style={{ originX: '12px', originY: '17.6px' }}
        animate={{ rotate: swing }}
        transition={
          beat
            ? { duration: beat.secondsPerBeat, ease: 'easeInOut' }
            : { duration: 0.2, ease: 'easeOut' }
        }
      />
    </svg>
  );
}

// The bar, drawn. Where a plain pulse says only "a beat happened", this says
// which beat, out of how many, and where the chord change lands, which is the
// thing a strumming pattern needs somewhere to sit. Cells fill through the cycle
// and clear on the downbeat, so the panel answers "how far through am I" without
// the player counting.
function BeatStrip({
  cells,
  accents,
  active,
  counting,
  live,
  onTapBeat,
}: {
  cells: number;
  /** The voice of each cell, from the meter and its accents. */
  accents: readonly BeatAccent[];
  active: number;
  counting: boolean;
  live: boolean;
  /**
   * Set when the strip is one bar of the meter and nothing is running, so each
   * beat can be tapped to change its weight. The bar is the control: the weight
   * of a beat is drawn as its height, so changing it is changing the picture.
   */
  onTapBeat?: (beat: number) => void;
}) {
  return (
    <div
      className={live ? 'metro-strip is-live' : 'metro-strip'}
      role={onTapBeat ? 'group' : 'img'}
      // Deliberately the shape of the bar rather than the beat it is on.
      // Renaming this element four times a second would make a screen reader
      // unusable for the sake of information the ear already has.
      aria-label={counting ? 'Counting in' : onTapBeat ? 'Accents. Tap a beat to change its weight.' : `${cells} beats to a chord change`}
    >
      {Array.from({ length: cells }, (_, i) => {
        const accent = counting ? 'countin' : accents[i % accents.length] ?? 'beat';
        const state = !live || active < 0 ? '' : i === active ? ' is-now' : i < active ? ' is-past' : '';
        if (onTapBeat && i > 0) {
          return (
            <button
              key={i}
              type="button"
              className={`metro-cell is-tappable is-${accent}${state}`}
              onClick={() => onTapBeat(i)}
              aria-label={`Beat ${i + 1}: ${accent === 'downbeat' ? 'strong' : accent === 'midbar' ? 'light' : 'plain'}`}
            />
          );
        }
        return <span key={i} className={`metro-cell is-${accent}${state}`} />;
      })}
    </div>
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
  const storedMeter = useStore((s) => s.accounts[s.currentAccountId]?.metronomeMeter);
  const storedAccents = useStore((s) => s.accounts[s.currentAccountId]?.metronomeAccents);
  const setMetronomeMeter = useStore((s) => s.setMetronomeMeter);
  const setMetronomeAccents = useStore((s) => s.setMetronomeAccents);
  const auto = storedAuto ?? true;
  // A drill prescription owns its written meter, even with auto tempo off;
  // otherwise it is the player's own. Held locally so a plan can switch it for
  // one drill without overwriting what the player chose for every other.
  const [meter, setMeter] = useState<MeterId>(
    plan ? plan.meter : meterOf(storedMeter).id,
  );
  const levels = normaliseAccents(meter, storedAccents?.[meter]);

  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  // Whether the click is actually sounding. The browser can hold audio
  // suspended, and a tempo readout over silence is worse than no readout.
  const [audible, setAudible] = useState(false);
  const [bpm, setBpm] = useState(storedBpm ?? DEFAULT_PRACTICE_BPM);
  const [beat, setBeat] = useState<BeatEvent | null>(null);
  const [tapsIn, setTapsIn] = useState(0);
  const tapsRef = useRef<number[]>([]);
  const tapResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const silent = running && !audible;
  const live = running && audible;
  const counting = live && beat != null && beat.position < 0;
  // The strip has to show something before the first beat lands, so it falls
  // back to the cycle the prescription is about to run at.
  const cells = counting
    ? countInFor(meter)
    : (beat?.beatsPerBar ?? (auto && plan && plan.meter === meter ? plan.beatsPerChange : meterOf(meter).beats));
  const accents = cycleAccents(meter, levels, cells);
  const oneBar = cells === meterOf(meter).beats;
  const levelsKey = levels.join(',');
  const onPlan = plan != null && bpm === plan.bpm;

  // The panel floats over a drill that is running. Escape and a tap outside
  // both close it, so getting back to the chord on screen never costs a
  // second, deliberate tap on the same small target.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Stop the overlay's own Escape handler from ending the whole session
      // just because a panel was open.
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // Keep the engine's meter and accents in step with the panel. setMeter keeps a
  // stretched change cycle when the meter itself has not moved, so this never
  // undoes a plan's beatsPerChange.
  useEffect(() => {
    metronome.setMeter(meter, levels);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meter, levelsKey]);

  // Keep the engine's tempo in step with the slider while it plays.
  useEffect(() => {
    metronome.setBpm(bpm);
  }, [bpm]);

  // Drive the visual pulse from the audio clock, and tear the engine down when
  // this control unmounts so a click never outlives the drill.
  useEffect(() => {
    // The coach starts the click on its own, seconds after the tap that opened
    // this screen. Browsers only free audio on a gesture, so claim that tap now
    // rather than discovering the context is frozen once the drill is running.
    armOutputAudioUnlock();
    metronome.onBeat = (event) => setBeat(event);
    metronome.onAudibleChange = (next) => setAudible(next);
    return () => {
      metronome.onBeat = null;
      metronome.onAudibleChange = null;
      metronome.stop();
      if (tapResetRef.current) clearTimeout(tapResetRef.current);
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
        // Auto controls tempo/start, not the written bar of a drill. A manual
        // start of a 6/8 pattern must still click in six, not the saved meter.
        const own = plan.meter;
        setMeter(own);
        metronome.setMeter(own, normaliseAccents(own, storedAccents?.[own]));
        metronome.setBeatsPerBar(meterOf(own).beats);
        metronome.stop();
        setRunning(false);
        setBeat(null);
        return;
      }
      setMeter(plan.meter);
      metronome.setMeter(plan.meter, normaliseAccents(plan.meter, storedAccents?.[plan.meter]));
      metronome.setBeatsPerBar(plan.beatsPerChange);
      setBpm(plan.bpm);
      if (autoPlay) {
        // No count-in here on purpose: in coached practice the coach has just
        // counted this drill in out loud, and a second count would land on top
        // of a drill that is already counting chord changes.
        metronome.start(plan.bpm);
        setRunning(true);
      } else {
        metronome.stop();
        setRunning(false);
        setBeat(null);
      }
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, auto, autoPlay]);

  const commitBpm = useCallback(
    (next: number) => {
      const clamped = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(next)));
      setBpm(clamped);
      setMetronomeBpm(clamped);
    },
    [setBpm, setMetronomeBpm],
  );

  const toggle = () => {
    if (live) {
      metronome.stop();
      setRunning(false);
      setBeat(null);
      return;
    }
    // Starting by hand is the one case where nothing has counted the player in,
    // so the click does it: one bar of quiet ticks before the first real
    // downbeat, which is what stops bar one being a scramble.
    //
    // Running but silent means the browser never freed audio. This click is a
    // real gesture, which is the one thing that can, so unlock and restart the
    // count from here instead of leaving a dead click running.
    metronome.unlockAndStart(bpm, { countIn: true });
    setRunning(true);
  };

  const tap = () => {
    const now = performance.now();
    const taps = tapsRef.current;
    if (taps.length && now - taps[taps.length - 1] > TAP_RESET_MS) taps.length = 0;
    taps.push(now);
    if (taps.length > 5) taps.shift();
    setTapsIn(taps.length);

    if (tapResetRef.current) clearTimeout(tapResetRef.current);
    tapResetRef.current = setTimeout(() => {
      tapsRef.current.length = 0;
      setTapsIn(0);
    }, TAP_RESET_MS);

    if (taps.length < TAPS_NEEDED) return;
    const intervals: number[] = [];
    for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1]);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const tapped = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(60000 / avg)));
    commitBpm(tapped);
    // You just counted yourself in by tapping. Asking for a second gesture to
    // hear it back would be a step for nothing.
    if (!live) {
      metronome.unlockAndStart(tapped);
      setRunning(true);
    }
  };

  const chooseMeter = (next: MeterId) => {
    if (next === meter) return;
    setMeter(next);
    setMetronomeMeter(next);
    metronome.setMeter(next, normaliseAccents(next, storedAccents?.[next]));
    metronome.setBeatsPerBar(meterOf(next).beats);
    setBeat(null);
  };

  const tapBeat = (index: number) => {
    const row = [...levels];
    row[index] = nextAccentLevel(row[index] as AccentLevel);
    setMetronomeAccents(meter, normaliseAccents(meter, row));
  };

  const tapLabel = tapsIn > 0 && tapsIn < TAPS_NEEDED ? `${TAPS_NEEDED - tapsIn} more` : 'Tap';

  return (
    <div className="metro" ref={rootRef}>
      <button
        ref={triggerRef}
        className={
          silent
            ? 'practice-close metro-trigger is-live is-silent'
            : running
              ? 'practice-close metro-trigger is-live'
              : 'practice-close metro-trigger'
        }
        // The downbeat tints the trigger for the length of one beat. It is a
        // colour change rather than a transform, so it is still the bar marker
        // when the OS asks for reduced motion and the arm stops swinging.
        data-down={live && beat?.accent === 'downbeat' ? 'true' : undefined}
        onClick={() => setOpen((o) => !o)}
        title={silent ? 'Metronome muted by the browser. Tap to turn the sound on.' : running ? `Metronome ${bpm} BPM, ${meter}` : 'Metronome'}
        aria-label={
          silent
            ? 'Metronome: muted by the browser. Open tempo controls.'
            : running
              ? `Metronome: running at ${bpm} BPM in ${meter}. Open tempo controls.`
              : 'Metronome: stopped. Open tempo controls.'
        }
        aria-expanded={open}
      >
        <MetronomeMark beat={live ? beat : null} />
        {running && (
          <span className="metro-trigger-bpm">
            {silent ? 'muted' : bpm}
            {!silent && meter !== '4/4' && <i className="metro-trigger-meter">{meter}</i>}
          </span>
        )}
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
            <BeatStrip
              cells={cells}
              accents={accents}
              active={beat ? beat.beat : -1}
              counting={counting}
              live={live}
              onTapBeat={oneBar && !counting ? tapBeat : undefined}
            />

            {/* The time signature, as the three a beginner course uses. The
                strip above redraws the bar the moment one is picked, so the
                choice is seen as well as named. */}
            <div className="metro-meters" role="radiogroup" aria-label="Time signature">
              {METER_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={meter === id}
                  className={meter === id ? 'metro-meter is-on' : 'metro-meter'}
                  onClick={() => chooseMeter(id)}
                >
                  {id}
                </button>
              ))}
            </div>

            <div className="metro-readout">
              <span className="metro-bpm">{bpm}</span>
              <span className="metro-unit">BPM</span>
              {plan && !onPlan && (
                <button
                  className="metro-restore"
                  onClick={() => commitBpm(plan.bpm)}
                  title={`Back to ${plan.bpm} BPM, the tempo your history asks for`}
                  aria-label={`Return to the prescribed tempo, ${plan.bpm} BPM`}
                >
                  <RetryIcon size={13} />
                  {plan.bpm}
                </button>
              )}
            </div>

            {/* The count-in has no line of its own any more: the strip above is
                already drawing the count-in cells filling one at a time, and a
                sentence under a picture of the thing it describes is the picture
                said twice. The muted case keeps a line because nothing on this
                panel can draw a browser refusing to make a sound, but it is the
                fault only — the button below it is the fix and says so. */}
            {silent ? (
              <p className="metro-note is-warning">The browser is holding the sound.</p>
            ) : plan && auto && onPlan ? (
              <p className="metro-note">{plan.reason}</p>
            ) : plan && auto ? (
              // The reason belongs to the prescribed number. Once the player has
              // moved off it, repeating the reason would describe a tempo that
              // is no longer playing.
              <p className="metro-note">Set by hand. Your history asks for {plan.bpm}.</p>
            ) : null}

            <div className="metro-stepper">
              <button className="metro-step" onClick={() => commitBpm(bpm - 1)} aria-label="Slower">
                <MinusIcon size={16} />
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
                <PlusIcon size={16} />
              </button>
            </div>

            {/* The input stays and is only hidden: it is what a keyboard tabs
                to and what a screen reader announces, and a div pretending to be
                a checkbox has to reimplement both badly. The switch beside it is
                the part that is drawn. The accent is allowed here because it is
                a live state rather than decoration: on means the app is driving
                the number above. */}
            <label className="metro-auto">
              <input
                type="checkbox"
                className="metro-auto-input"
                checked={auto}
                onChange={(e) => setMetronomeAuto(e.target.checked)}
              />
              <span className="metro-switch" aria-hidden="true">
                <span className="metro-switch-knob" />
              </span>
              <span>Set the tempo for me</span>
            </label>

            <div className="metro-actions">
              <button
                className={tapsIn > 0 ? 'metro-tap is-counting' : 'metro-tap'}
                onClick={tap}
                aria-label="Tap a tempo"
              >
                {tapLabel}
              </button>
              <button className="practice-btn primary metro-play" onClick={toggle}>
                {live ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
                {silent ? 'Turn on sound' : running ? 'Stop' : 'Start'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
