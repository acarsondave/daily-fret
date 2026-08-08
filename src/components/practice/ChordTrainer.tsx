import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Play,
  Hourglass,
  ArrowRight,
  Microphone,
  ArrowClockwise,
  Trophy,
} from '@phosphor-icons/react';
import { useChordDetector, type ChordDetectorApi } from '../../hooks/useChordDetector';
import { useLearnedTemplates } from '../../hooks/useLearnedTemplates';
import { usePassiveRefine } from '../../hooks/usePassiveRefine';
import { ProgressRing } from './ProgressRing';
import { Sparkline } from './Sparkline';
import { SignalMeter } from './SignalMeter';
import { useSignalMeter } from './signalQuality';
import { sfx } from '../../audio/sfx';
import { diag } from '../../audio/diagnostics';
import type { DrillConfig } from '../../types';

const ALL_CHORDS = ['A', 'C', 'D', 'E', 'G', 'Am', 'Dm', 'Em', 'F'];
const DEFAULT_POOL = ['A', 'D', 'E', 'G', 'C'];
const AUTO_ADVANCE_SECONDS = 5;
// Shortest sensible block. Below this a chord gets a couple of placements and
// nothing sticks, which is the whole point of the drill.
const MIN_CHORD_SECONDS = 20;

// A placement is confirmed once the shape holds cleanly for this many frames
// (~21ms each), and only counts again after the strings have been released for
// RELEASE_FRAMES. That release is what makes this "place it again from nothing"
// rather than "strum the shape you're already holding".
const CONFIRM_FRAMES = 3;
const RELEASE_FRAMES = 8;

type View = 'setup' | 'playing' | 'results';

interface Props {
  config?: DrillConfig;
  onResult?: (score: number) => void;
  onClose?: () => void;
  personalBest?: number;
  series?: number[];
  autoStart?: boolean;
  onNext?: () => void;
  autoAdvance?: boolean; // results auto-continue after a short countdown (no button)
  nextLabel?: string; // what the auto-advance is moving toward, e.g. "Rest"
  detector?: ChordDetectorApi;
  onSessionStart?: () => void; // the drill is now live (drives the auto metronome)
}

// Chord Perfect. One chord at a time, held for its own block: place the shape,
// strum it, lift right off, place it again. It is a memory drill for the shape,
// deliberately NOT a changes drill — the target never moves mid-block, so the
// hand keeps rebuilding the same shape from nothing.
//
// Placements are read from the held chord frame by frame rather than from the
// detector's change events. Change events exist to catch a move from one chord
// to another and are gated accordingly; asking them to report a shape being
// replaced by itself is what produced the phantom neighbours in the logs.
export function ChordTrainer({
  config,
  onResult,
  onClose,
  personalBest = 0,
  series = [],
  autoStart = false,
  onNext,
  autoAdvance = false,
  nextLabel = 'Up next',
  detector,
  onSessionStart,
}: Props) {
  const own = useChordDetector();
  const templates = useLearnedTemplates();
  const passive = usePassiveRefine();
  const sharedMic = !!detector;
  const { status, error, start, stop, setHandlers } = detector ?? own;

  const duration = config?.durationSec ?? 60;
  const [pool, setPool] = useState<string[]>(
    config?.chords?.length ? config.chords : DEFAULT_POOL,
  );
  const perChord = Math.max(MIN_CHORD_SECONDS, Math.round(duration / Math.max(1, pool.length)));

  // Coached mode skips setup; start on 'playing' so the chord preselector never
  // flashes for a frame before auto-start kicks in.
  const [view, setView] = useState<View>(autoStart ? 'playing' : 'setup');
  const [slot, setSlot] = useState(0); // which chord of the pool is up
  const [reps, setReps] = useState(0); // placements for the chord on screen
  const [tally, setTally] = useState<number[]>([]); // finished chords' placements
  const [timeLeft, setTimeLeft] = useState(perChord);
  const { quality: signal, push: pushSignal, reset: resetSignal } = useSignalMeter();
  const [result, setResult] = useState<{ value: number; prevBest: number; series: number[] } | null>(null);

  const poolRef = useRef(pool);
  const slotRef = useRef(0);
  const repsRef = useRef(0);
  const tallyRef = useRef<number[]>([]);
  // Placement state machine, all read synchronously from the audio callback.
  const holdRef = useRef(0); // consecutive frames matching the target
  const releaseRef = useRef(RELEASE_FRAMES); // consecutive frames not matching it
  const armedRef = useRef(true); // released since the last counted placement
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const popTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [runningBest, setRunningBest] = useState(personalBest);
  const [runningSeries, setRunningSeries] = useState<number[]>(series);
  // Coached mode auto-continues from results after a brief beat (no tap needed).
  const [advanceLeft, setAdvanceLeft] = useState(AUTO_ADVANCE_SECONDS);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const popHero = () => {
    const el = heroRef.current;
    if (!el) return;
    el.classList.remove('is-hit');
    void el.offsetWidth;
    el.classList.add('is-hit');
    if (popTimer.current) clearTimeout(popTimer.current);
    popTimer.current = setTimeout(() => el.classList.remove('is-hit'), 320);
  };

  const target = () => poolRef.current[slotRef.current] ?? '';

  // One frame of the placement machine. `chord` is what this frame matched, or
  // null for silence / no clean match — which is exactly what a lifted hand
  // looks like, so the same signal drives both halves of the cycle.
  const onFrame = (chord: string | null) => {
    if (chord && chord === target()) {
      releaseRef.current = 0;
      holdRef.current += 1;
      if (armedRef.current && holdRef.current >= CONFIRM_FRAMES) {
        armedRef.current = false;
        repsRef.current += 1;
        setReps(repsRef.current);
        popHero();
        sfx.tick();
        diag.mark(`chord-perfect placed ${target()} (${repsRef.current})`);
      }
      return;
    }
    holdRef.current = 0;
    releaseRef.current += 1;
    if (releaseRef.current >= RELEASE_FRAMES) armedRef.current = true;
  };

  const finish = () => {
    clearTimer();
    const perChordCounts = [...tallyRef.current, repsRef.current];
    const value = perChordCounts.reduce((a, b) => a + b, 0);
    diag.mark(
      `chord-perfect finish: ${value} placements (${poolRef.current
        .map((c, i) => `${c} ${perChordCounts[i] ?? 0}`)
        .join(', ')})`,
    );
    if (sharedMic) setHandlers({});
    else void stop();
    passive.commit();
    setTally(perChordCounts);
    const prevBest = runningBest;
    const celebrate = prevBest === 0 ? value > 0 : value > prevBest;
    if (celebrate) sfx.best();
    else sfx.complete();
    const seriesSnapshot = [...runningSeries, value];
    setResult({ value, prevBest, series: seriesSnapshot });
    setRunningBest(Math.max(prevBest, value));
    setRunningSeries(seriesSnapshot);
    setView('results');
    onResult?.(value);
  };

  // Move to the next chord's block, or end the drill after the last one.
  const nextChord = () => {
    const next = slotRef.current + 1;
    // The block that just ended is banked by whoever ends it: finish() appends
    // the one on screen, so banking it here too would count the last shape twice.
    if (next >= poolRef.current.length) {
      finish();
      return;
    }
    tallyRef.current = [...tallyRef.current, repsRef.current];
    setTally(tallyRef.current);
    slotRef.current = next;
    setSlot(next);
    repsRef.current = 0;
    setReps(0);
    setTimeLeft(perChord);
    // Start the block unarmed: the previous chord can still be ringing, and a
    // half-released shape reads as its neighbour, which would hand over a free
    // placement before the hand has done anything.
    holdRef.current = 0;
    releaseRef.current = 0;
    armedRef.current = false;
    sfx.go();
    diag.mark(`chord-perfect chord: ${target()} (${perChord}s)`);
  };

  const startSession = async () => {
    sfx.go();
    poolRef.current = pool;
    slotRef.current = 0;
    setSlot(0);
    repsRef.current = 0;
    setReps(0);
    tallyRef.current = [];
    setTally([]);
    // Unarmed until a real release, so a shape already under the hand when the
    // drill opens does not score before it has been placed.
    holdRef.current = 0;
    releaseRef.current = 0;
    armedRef.current = false;
    setTimeLeft(perChord);
    resetSignal();
    onSessionStart?.();
    setView('playing');

    // Wait for the mic before starting the clock so the permission prompt
    // doesn't burn the timer, and bail cleanly if access is denied.
    const live = await start(
      {
        onLevel: (ev) => {
          pushSignal(ev);
          onFrame(ev.chord);
          passive.observe(target(), ev);
        },
      },
      // Restricted to the whole pool, not to the one chord on screen: with a
      // single candidate every match wins by default and a wrong shape would
      // score. The neighbours are what make a correct placement mean something.
      { restrictTo: pool, templates },
    );
    if (!live) return;
    diag.mark(`chord-perfect start [${pool.join(', ')}] ${perChord}s each`);
    diag.mark(`chord-perfect chord: ${pool[0]} (${perChord}s)`);
  };


  // Each shape's block runs its own clock. Keyed on the slot, so advancing to
  // the next shape restarts it and the last one ends the drill.
  useEffect(() => {
    if (view !== 'playing' || status !== 'running') return;
    // timeLeft is seeded by whoever moved us here (startSession / nextChord),
    // so the effect only has to run the clock down.
    const deadline = Date.now() + perChord * 1000;
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        nextChord();
      }
    }, 200);
    timerRef.current = id;
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, slot, status]);

  useEffect(() => {
    // Defer the auto-start a tick (keeps setState out of the effect body and is
    // safe across StrictMode's mount/cleanup/mount).
    const t = autoStart ? setTimeout(() => startSession(), 0) : null;
    return () => {
      if (t) clearTimeout(t);
      clearTimer();
      if (popTimer.current) clearTimeout(popTimer.current);
      if (!sharedMic) void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hands-free advance once results land in coached mode.
  useEffect(() => {
    if (view !== 'results' || !autoAdvance || !onNext) return;
    const deadline = Date.now() + AUTO_ADVANCE_SECONDS * 1000;
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setAdvanceLeft(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        onNext();
      }
    }, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, autoAdvance]);

  const toggleChord = (c: string) => {
    setPool((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  };

  if (view === 'setup') {
    return (
      <div className="om-setup">
        {runningBest > 0 && (
          <div className="om-best-badge">
            <Trophy size={16} weight="fill" />
            <span>Best {runningBest}</span>
            {runningSeries.length >= 2 && (
              <Sparkline values={runningSeries} className="om-best-spark" />
            )}
          </div>
        )}
        <p className="om-caption">Pick the shapes to drill — each gets its own {perChord}s</p>
        <div className="ct-chip-grid">
          {ALL_CHORDS.map((c) => (
            <button
              key={c}
              type="button"
              className={pool.includes(c) ? 'ct-chip is-on' : 'ct-chip'}
              onClick={() => toggleChord(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <button
          className="practice-btn primary"
          onClick={startSession}
          disabled={pool.length < 2}
        >
          <Play size={20} weight="fill" /> Start {pool.length * perChord}s
        </button>
        {pool.length < 2 && <p className="om-caption">Pick at least two shapes</p>}
      </div>
    );
  }

  if (view === 'playing') {
    if (status === 'error') {
      return (
        <div className="mic-gate">
          <Microphone size={40} weight="duotone" color="var(--text-secondary)" />
          <p>{error ?? 'Microphone unavailable.'}</p>
          <button className="practice-btn primary" onClick={startSession}>
            <ArrowClockwise size={18} weight="bold" /> Try again
          </button>
        </div>
      );
    }
    if (status !== 'running') {
      return (
        <div className="mic-gate">
          <Microphone size={40} weight="duotone" color="var(--accent-primary)" />
          <p>Allow microphone access to begin…</p>
        </div>
      );
    }
    return (
      <>
        <div className="practice-mode is-chord">place · strum · lift off · place again</div>
        <div ref={heroRef} className="practice-hero ct-target">
          {pool[slot]}
        </div>

        <div className="ct-blocks">
          {pool.map((c, i) => (
            <span
              key={c}
              className={i === slot ? 'ct-block is-now' : i < slot ? 'ct-block is-done' : 'ct-block'}
            >
              {c}
              {i < slot && <b>{tally[i]}</b>}
            </span>
          ))}
        </div>

        <div className="ct-stats">
          <span className="ct-score">{reps} placed</span>
          <span className="om-timer">
            <Hourglass size={22} /> {timeLeft}
          </span>
        </div>
        <SignalMeter quality={signal} />
      </>
    );
  }

  const value = result?.value ?? tally.reduce((a, b) => a + b, 0);
  const prevBest = result?.prevBest ?? personalBest;
  const resultSeries = result?.series ?? [...runningSeries, value];

  const isFirst = prevBest === 0;
  const isNewBest = !isFirst && value > prevBest;
  const celebrate = isNewBest || (isFirst && value > 0);
  const progress = isFirst ? (value > 0 ? 1 : 0) : value / Math.max(prevBest, 1);

  let context: string;
  if (isFirst) context = value > 0 ? 'First benchmark set' : 'No shapes detected';
  else if (isNewBest) context = `+${value - prevBest} over your best`;
  else if (value === prevBest) context = 'Matched your best';
  else context = `${prevBest - value} to beat your best`;

  return (
    <motion.div
      className="om-results"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <ProgressRing progress={progress} className={celebrate ? 'om-ring is-pr' : 'om-ring'}>
        <div className="om-ring-value">{value}</div>
        <div className="om-caption">shapes placed</div>
      </ProgressRing>

      <div className={celebrate ? 'om-context is-pr' : 'om-context'}>
        {celebrate && <Trophy size={16} weight="fill" />}
        <span>{context}</span>
      </div>

      {/* Per shape, because the total hides the one that needs the work. */}
      <div className="ct-breakdown">
        {pool.map((c, i) => (
          <span key={c} className="ct-breakdown-item">
            <b>{tally[i] ?? 0}</b> {c}
          </span>
        ))}
      </div>

      {resultSeries.length >= 2 && (
        <Sparkline values={resultSeries} className="om-result-spark" width={120} />
      )}

      <div className="om-saved-hint">Saved automatically</div>

      {autoAdvance ? (
        <div className="coach-advance">
          <span className="coach-advance-label">{nextLabel} in</span>
          <span className="coach-advance-count">{advanceLeft}</span>
        </div>
      ) : (
        <div className="om-actions">
          <button className="practice-btn ghost" onClick={() => onClose?.()}>
            {onNext ? 'End session' : 'Done'}
          </button>
          <button
            className="practice-btn primary"
            onClick={onNext ?? (() => setView('setup'))}
            autoFocus
          >
            {onNext ? 'Next drill' : 'Next'} <ArrowRight size={18} weight="bold" />
          </button>
        </div>
      )}
    </motion.div>
  );
}
