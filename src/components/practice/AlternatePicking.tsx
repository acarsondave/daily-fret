import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { HourglassIcon, MicIcon, PlayIcon, RetryIcon } from '../icons';
import { useStrumTiming } from '../../hooks/useStrumTiming';
import { metronome } from '../../audio/metronome';
import { diag, DIAG_CODE } from '../../audio/diagnostics';
import { sfx } from '../../audio/sfx';
import { fitBeatGrid, offsetAt, summariseTiming, IN_TIME_MS, type BeatGrid, type TimingSummary } from '../../lib/strumTiming';
import { PICK_CEILING_BPM, pickHalves, type PickHalf } from '../../lib/picking';
import { ProgressRing } from './ProgressRing';
import { ringScale } from '../../lib/ringScale';
import { SignalMeter } from './SignalMeter';
import { useTimingSignalMeter } from './signalQuality';
import { CoachAdvance } from './CoachAdvance';
import { ClickPath } from './ClickPath';
import type { DrillConfig } from '../../types';
import './picking.css';

const AUTO_ADVANCE_SECONDS = 5;
const CLICK_GRACE_SECONDS = 7;
/** Picks the string remembers on screen. */
const TRAIL = 6;

export interface PickingResult {
  bpm: number;
  summary: TimingSummary;
  halves: Record<PickHalf, TimingSummary>;
}

interface Props {
  config?: DrillConfig;
  bpm: number;
  personalBest?: number;
  onResult?: (result: PickingResult) => void;
  onClose?: () => void;
  autoStart?: boolean;
  onNext?: () => void;
  autoAdvance?: boolean;
  nextLabel?: string;
  onAgain?: () => void;
  onSkip?: () => void;
  onSessionStart?: () => void;
}

/**
 * Alternate picking on one string, B1-601.
 *
 * Justin's whole lesson is two pictures: the pick held flat catches the string,
 * angled it glides; and the motion is in toward the guitar and out away from
 * it, not down and up. So the stage is that picture. The string is seen end on,
 * the guitar top is the line beneath it, and the pick swings through the string
 * on every click, in on one and out on the next, driven by the click itself. The
 * first half of the block it is drawn flat, the second half it turns to the
 * angle, which is his own suggested exercise: play both and feel the difference.
 *
 * What the app hears is when each pick lands, from the same two-band analyser
 * strum timing uses, so it can say how even the two halves were. It cannot see
 * the pick, so it never says whether the angle was right. One pick per click: the
 * analyser needs about a fifth of a second between two attacks before it will
 * hear the second, and Justin asks for accuracy over speed anyway.
 */
export function AlternatePicking({
  config,
  bpm,
  personalBest = 0,
  onResult,
  onClose,
  autoStart = false,
  onNext,
  autoAdvance = false,
  nextLabel = 'Up next',
  onAgain,
  onSkip,
  onSessionStart,
}: Props) {
  const { status, route, error, start, stop } = useStrumTiming();
  const duration = config?.durationSec ?? 60;
  const [view, setView] = useState<'setup' | 'playing' | 'results'>(autoStart ? 'playing' : 'setup');
  const [timeLeft, setTimeLeft] = useState(duration);
  const [half, setHalf] = useState<PickHalf>('flat');
  const [trail, setTrail] = useState<{ id: number; inTime: boolean }[]>([]);
  const [deaf, setDeaf] = useState(false);
  const [tempo, setTempo] = useState(bpm);
  const [result, setResult] = useState<PickingResult | null>(null);
  const [advanceLeft, setAdvanceLeft] = useState(AUTO_ADVANCE_SECONDS);
  const { quality: signal, push: pushSignal, reset: resetSignal } = useTimingSignalMeter(route);

  const picksRef = useRef<{ at: number; half: PickHalf }[]>([]);
  const clicksRef = useRef<number[]>([]);
  const lastClickRef = useRef<number | null>(null);
  const gridRef = useRef<BeatGrid | null>(null);
  const periodRef = useRef(60 / bpm);
  const tempoRef = useRef(bpm);
  const halfRef = useRef<PickHalf>('flat');
  const silentSinceRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idRef = useRef(0);
  const pickEl = useRef<SVGGElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const handleClick = (at: number) => {
    clicksRef.current.push(at);
    lastClickRef.current = Date.now();
    diag.timing(DIAG_CODE.CLICK_HEARD, 0);
    gridRef.current = fitBeatGrid(clicksRef.current, periodRef.current);
  };

  const handlePick = (at: number) => {
    const grid = gridRef.current;
    if (!grid) return;
    picksRef.current.push({ at, half: halfRef.current });
    const { offsetMs } = offsetAt(grid, at);
    diag.timing(DIAG_CODE.STRUM_TIMED, offsetMs);
    idRef.current += 1;
    const id = idRef.current;
    setTrail((t) => [{ id, inTime: Math.abs(offsetMs) <= IN_TIME_MS }, ...t].slice(0, TRAIL));
  };

  // The pick, swung by the click. On a click it is at the string; between two
  // clicks it travels to the far side and back, alternately in toward the top
  // and out away from it. Written to the DOM on each frame rather than through
  // React state, because sixty renders a second of a whole drill to move one
  // shape is the drill competing with the analyser for the thread.
  const swing = () => {
    const phase = metronome.phase();
    const el = pickEl.current;
    if (el) {
      if (!phase) {
        el.style.transform = 'translate(0px, 0px)';
      } else {
        const beats = phase.position + phase.sinceSeconds / phase.secondsPerBeat;
        const x = Math.sin(Math.PI * beats) * 42;
        el.style.transform = `translate(${x.toFixed(1)}px, ${(x * 0.42).toFixed(1)}px)`;
      }
    }
    rafRef.current = requestAnimationFrame(swing);
  };

  /** Throw away what was collected and measure from now, at this tempo. */
  const resetMeasurement = (nextBpm: number) => {
    picksRef.current = [];
    clicksRef.current = [];
    lastClickRef.current = null;
    gridRef.current = null;
    periodRef.current = 60 / nextBpm;
    tempoRef.current = nextBpm;
    setTempo(nextBpm);
    setTrail([]);
  };

  const finish = () => {
    clearTimer();
    // Read through a ref: this runs from the timer the first render set up, and
    // the tempo state that render saw may be one the click has since left.
    const tempo = tempoRef.current;
    const fresh = lastClickRef.current !== null && Date.now() - lastClickRef.current < Math.max(2000, periodRef.current * 3000);
    const grid = fresh && tempo <= PICK_CEILING_BPM ? gridRef.current : null;
    const empty = { origin: 0, period: periodRef.current, clicks: 0 };
    const all = summariseTiming(grid ? picksRef.current.map((p) => p.at) : [], grid ?? empty);
    const halves = pickHalves(grid ? picksRef.current : [], grid ?? empty);
    diag.mark(`alternate picking finish at ${tempo} BPM: ${all.beatsInTime}/${all.expectedBeats}; median ${all.medianMs} ms, spread ${all.spreadMs} ms; ${clicksRef.current.length} clicks, ${picksRef.current.length} picks; grid ${JSON.stringify(grid)}; halves ${JSON.stringify(halves)}`);
    void stop();
    if (all.enough && all.score > personalBest) sfx.best();
    else sfx.complete();
    const out = { bpm: tempo, summary: all, halves };
    setResult(out);
    setView('results');
    onResult?.(out);
  };

  const startSession = async () => {
    sfx.go();
    resetMeasurement(metronome.getBpm());
    halfRef.current = 'flat';
    setHalf('flat');
    setDeaf(false);
    setTimeLeft(duration);
    resetSignal();
    onSessionStart?.();
    setView('playing');

    const running = await start(
      {
        onStrum: (onset) => handlePick(onset.at),
        onClick: (onset) => handleClick(onset.at),
        onLevel: (level) => pushSignal(level),
      },
      'alternate picking',
    );
    if (!running) return;
    clearTimer();
    rafRef.current = requestAnimationFrame(swing);
    const began = Date.now();
    const deadline = began + duration * 1000;
    timerRef.current = setInterval(() => {
      const now = Date.now();
      setTimeLeft(Math.max(0, Math.ceil((deadline - now) / 1000)));
      // The click's own panel applies the prescription a tick after this starts,
      // and the player can move it at any time; a measurement against the wrong
      // period is not a measurement, so it restarts, as strum timing does.
      const current = metronome.getBpm();
      if (Math.abs(60 / current - periodRef.current) > 1e-9) resetMeasurement(current);
      const next: PickHalf = now - began >= (duration * 1000) / 2 ? 'angled' : 'flat';
      if (next !== halfRef.current) {
        halfRef.current = next;
        setHalf(next);
        sfx.go();
      }
      const clickStale = lastClickRef.current !== null && now - lastClickRef.current > Math.max(2000, periodRef.current * 3000);
      if (metronome.phase() === null || !gridRef.current || clickStale) {
        if (silentSinceRef.current === null) silentSinceRef.current = now;
        if (now - silentSinceRef.current > CLICK_GRACE_SECONDS * 1000) setDeaf(true);
      } else {
        silentSinceRef.current = null;
        setDeaf(false);
      }
      if (now >= deadline) finish();
    }, 200);
  };

  useEffect(() => {
    const t = autoStart ? setTimeout(() => void startSession(), 0) : null;
    return () => {
      if (t) clearTimeout(t);
      clearTimer();
      void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (view !== 'results' || !autoAdvance || !onNext) return;
    const deadline = Date.now() + AUTO_ADVANCE_SECONDS * 1000;
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setAdvanceLeft(left);
      if (left <= 0) {
        clearInterval(id);
        onNext();
      }
    }, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, autoAdvance]);

  if (view === 'setup') {
    return (
      <div className="om-setup pk-setup">
        <PickStage half="flat" demo />
        <button className="practice-btn primary" onClick={startSession}>
          <PlayIcon size={20} /> Start {duration}s
        </button>
      </div>
    );
  }

  if (view === 'playing') {
    if (status === 'error') {
      return (
        <div className="mic-gate">
          <MicIcon size={40} color="var(--text-secondary)" />
          <p>{error ?? 'Microphone unavailable.'}</p>
          <button className="practice-btn primary" onClick={startSession}>
            <RetryIcon size={18} /> Try again
          </button>
        </div>
      );
    }
    if (status !== 'running') {
      return (
        <div className="mic-gate">
          <MicIcon size={40} color="var(--accent-primary)" />
          <p>Allow microphone access to begin…</p>
        </div>
      );
    }
    if (deaf) {
      const silent = !metronome.isAudible;
      return (
        <div className="mic-gate">
          <ClickPath state={silent ? 'silent' : 'broken'} className="st-diagram" />
          <button
            className="practice-btn primary"
            onClick={() => {
              if (silent) metronome.unlockAndStart(tempo);
              silentSinceRef.current = null;
              setDeaf(false);
            }}
          >
            <RetryIcon size={18} /> {silent ? 'Turn the click on' : 'Try again'}
          </button>
        </div>
      );
    }
    return (
      <div className="pk-stage drill-stage">
        <div className="drill-cue">
          <PickStage half={half} pickRef={pickEl} trail={trail} />
        </div>
        <div className="drill-read">
          <div className="om-timer">
            <HourglassIcon size={26} /> {timeLeft}
          </div>
          <SignalMeter quality={signal} />
          {tempo > PICK_CEILING_BPM && <p className="om-caption" role="status">Timing needs {PICK_CEILING_BPM} BPM or less.</p>}
        </div>
      </div>
    );
  }

  const summary = result?.summary;
  const score = summary?.enough ? summary.score : 0;
  return (
    <motion.div className="om-results pk-results" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
      <ProgressRing {...ringScale(score, personalBest, 100)} className="om-ring">
        <div className="om-ring-value">{summary?.enough ? score : '--'}</div>
        <div className="om-caption">% in time</div>
      </ProgressRing>
      {result && <HalvesCompared halves={result.halves} />}
      {autoAdvance ? (
        <CoachAdvance nextLabel={nextLabel} advanceLeft={advanceLeft} onAgain={onAgain} onSkip={onSkip} />
      ) : (
        <div className="om-actions">
          <button className="practice-btn ghost" onClick={() => onClose?.()}>
            Done
          </button>
          <button className="practice-btn primary" onClick={() => setView('setup')}>
            Again
          </button>
        </div>
      )}
    </motion.div>
  );
}

/**
 * The string, end on, and the pick going through it.
 *
 * The guitar top is the line along the bottom; "in" is toward it. The pick's
 * own tilt is the half: flat against the string, then turned to the angle.
 * `demo` swings it on a CSS loop for the setup screen, where there is no click
 * yet and nothing pretends there is.
 */
function PickStage({
  half,
  pickRef,
  trail = [],
  demo = false,
}: {
  half: PickHalf;
  pickRef?: React.Ref<SVGGElement>;
  trail?: { id: number; inTime: boolean }[];
  demo?: boolean;
}) {
  return (
    <figure className={`pk-figure is-${half}${demo ? ' is-demo' : ''}`}>
      <svg viewBox="-110 -70 220 140" className="pk-svg" role="img" aria-label={half === 'flat' ? 'Pick held flat' : 'Pick angled'}>
        <line className="pk-top" x1="-100" y1="52" x2="100" y2="52" />
        <path className="pk-path" d="M -46 -22 L 46 22" />
        <text className="pk-word" x="62" y="40">in</text>
        <text className="pk-word" x="-80" y="-30">out</text>
        <circle className="pk-string" cx="0" cy="0" r="6" />
        {trail.map((t, i) => (
          <circle
            key={t.id}
            className={t.inTime ? 'pk-ring is-in' : 'pk-ring'}
            cx="0"
            cy="0"
            r={10 + i * 7}
            style={{ opacity: 1 - i / TRAIL }}
          />
        ))}
        <g ref={pickRef} className="pk-pick">
          <g className="pk-tilt">
            <path d="M 0 -26 C 13 -26 20 -18 20 -8 C 20 4 9 18 2 26 C 1 27 -1 27 -2 26 C -9 18 -20 4 -20 -8 C -20 -18 -13 -26 0 -26 Z" />
          </g>
        </g>
      </svg>
      <figcaption className="pk-halves" aria-live="polite">
        <span className={half === 'flat' ? 'is-on' : ''}>Flat</span>
        <span className={half === 'angled' ? 'is-on' : ''}>Angled</span>
      </figcaption>
    </figure>
  );
}

/** Flat against angled, drawn as two bars so the difference is seen first. */
function HalvesCompared({ halves }: { halves: Record<PickHalf, TimingSummary> }) {
  const rows: [PickHalf, string][] = [
    ['flat', 'Flat'],
    ['angled', 'Angled'],
  ];
  return (
    <div className="pk-compare">
      {rows.map(([key, label]) => {
        const h = halves[key];
        const value = h.enough ? h.score : null;
        return (
          <div key={key} className="pk-compare-row">
            <span className="pk-compare-name">{label}</span>
            <span className="pk-compare-bar">
              <motion.span
                className={`pk-compare-fill is-${key}`}
                initial={{ width: 0 }}
                animate={{ width: `${value ?? 0}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              />
            </span>
            <span className="pk-compare-value">{value === null ? '--' : `${value}%`}</span>
          </div>
        );
      })}
    </div>
  );
}
