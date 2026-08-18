import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRightIcon, HourglassIcon, MicIcon, PlayIcon, TrophyIcon } from '../icons';
import { MicGate, TimerRunEnded, UncountedNotice } from './MicGate';
import type { TimedOutcome } from '../../store/completion';
import { useDrillLogs } from '../../store';
import { poolKey, trainerPool } from '../../lib/drillKeys';
import { keyDrillHistory } from '../../lib/drillStats';
import { useChordDetector, type ChordDetectorApi } from '../../hooks/useChordDetector';
import { useLearnedTemplates } from '../../hooks/useLearnedTemplates';
import { useCapoOffset } from '../../hooks/useCapo';
import { usePassiveRefine } from '../../hooks/usePassiveRefine';
import { PersonalBestSparkle } from './PersonalBestSparkle';
import { ProgressRing } from './ProgressRing';
import { ringScale } from '../../lib/ringScale';
import { Sparkline } from './Sparkline';
import { SignalMeter } from './SignalMeter';
import { ChordDiagram } from './ChordDiagram';
import { useSignalMeter } from './signalQuality';
import { sfx } from '../../audio/sfx';
import { diag } from '../../audio/diagnostics';
import { PlacementCounter } from '../../audio/placement';
import type { LevelEvent } from '../../audio/detector';
import type { DrillConfig } from '../../types';

const ALL_CHORDS = ['A', 'C', 'D', 'E', 'G', 'Am', 'Dm', 'Em', 'F'];
const AUTO_ADVANCE_SECONDS = 5;
// Shortest sensible block. Below this a chord gets a couple of placements and
// nothing sticks, which is the whole point of the drill.
const MIN_CHORD_SECONDS = 20;

type View = 'setup' | 'playing' | 'results';

/**
 * What one Chord Perfect block produced.
 *
 * Both halves are reported because both are worth keeping and neither can be
 * recovered from the other. The total is the block's score, comparable to
 * another block over the same shapes. The per-shape counts are the answer to the
 * question the drill could never answer before: which shape is the one holding
 * the number down.
 */
export interface ChordTrainerResult {
  perChord: Array<{ chord: string; placements: number }>;
  total: number;
}

interface Props {
  config?: DrillConfig;
  onResult?: (result: ChordTrainerResult) => void;
  onClose?: () => void;
  autoStart?: boolean;
  onNext?: () => void;
  autoAdvance?: boolean; // results auto-continue after a short countdown (no button)
  nextLabel?: string; // what the auto-advance is moving toward, e.g. "Rest"
  detector?: ChordDetectorApi;
  onSessionStart?: () => void; // the drill is now live (drives the auto metronome)
  // A run the microphone could not hear, timed instead. Kept separate from
  // onResult because it carries elapsed time and no measurement.
  onTimedRun?: (outcome: TimedOutcome) => void;
}

// Chord Perfect. One chord at a time, held for its own block: place the shape,
// strum it, lift right off, place it again. It is a memory drill for the shape,
// deliberately NOT a changes drill — the target never moves mid-block, so the
// hand keeps rebuilding the same shape from nothing.
//
// Counting lives in PlacementCounter, not here: one strum of the shape on
// screen is one placement. See src/audio/placement.ts for why it is anchored to
// the strum and not to the chord coming and going.
export function ChordTrainer({
  config,
  onResult,
  onClose,
  autoStart = false,
  onNext,
  autoAdvance = false,
  nextLabel = 'Up next',
  detector,
  onSessionStart,
  onTimedRun,
}: Props) {
  const own = useChordDetector();
  const templates = useLearnedTemplates();
  const capo = useCapoOffset();
  const passive = usePassiveRefine();
  const sharedMic = !!detector;
  const { status, route, error, start, stop, setHandlers } = detector ?? own;

  const duration = config?.durationSec ?? 60;
  const [pool, setPool] = useState<string[]>(() => trainerPool(config?.chords));
  const perChord = Math.max(MIN_CHORD_SECONDS, Math.round(duration / Math.max(1, pool.length)));

  // The block's own history, per pool, straight from the store. The pool is
  // editable on the setup screen and it is part of the key, so a best carried in
  // as a prop would be the previous pool's number sitting under a different set
  // of shapes.
  const dailyLogs = useDrillLogs();
  const { best: poolBest, series: poolSeries } = useMemo(
    () => keyDrillHistory(dailyLogs, poolKey(pool)),
    [dailyLogs, pool],
  );

  // Coached mode skips setup; start on 'playing' so the chord preselector never
  // flashes for a frame before auto-start kicks in.
  const [view, setView] = useState<View>(autoStart ? 'playing' : 'setup');
  const [slot, setSlot] = useState(0); // which chord of the pool is up
  const [reps, setReps] = useState(0); // placements for the chord on screen
  const [tally, setTally] = useState<number[]>([]); // finished chords' placements
  const [timeLeft, setTimeLeft] = useState(perChord);
  const { quality: signal, push: pushSignal, reset: resetSignal } = useSignalMeter(route);
  const [result, setResult] = useState<{ value: number; prevBest: number; series: number[] } | null>(null);

  const poolRef = useRef(pool);
  const slotRef = useRef(0);
  const repsRef = useRef(0);
  const tallyRef = useRef<number[]>([]);
  // Placement machine, driven synchronously from the audio callback.
  const counterRef = useRef(new PlacementCounter());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const shapeRef = useRef<HTMLDivElement>(null);
  const popTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // What the pool stood at when this run began, so the results card compares
  // against the pre-session best rather than against the number this very run
  // has just written into the store.
  const bestAtStart = useRef(0);
  const seriesAtStart = useRef<number[]>([]);
  // Coached mode auto-continues from results after a brief beat (no tap needed).
  const [advanceLeft, setAdvanceLeft] = useState(AUTO_ADVANCE_SECONDS);
  // Running blind: the blocks still run their clocks, nothing is counted.
  const [onTimer, setOnTimer] = useState(false);
  const onTimerRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  // The diagram lights when the shape is actually being held. Driven through the
  // DOM like popHero rather than through state: this flips on every place and
  // release, and re-rendering the whole drill for a colour change would be an
  // absurd price for feedback that is purely visual.
  const markHeld = (held: boolean) => {
    shapeRef.current?.classList.toggle('is-held', held);
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

  // One frame of the placement machine.
  const onFrame = (ev: LevelEvent) => {
    const counted = counterRef.current.frame(ev, Date.now());
    markHeld(counterRef.current.held);
    if (!counted) return;
    repsRef.current = counterRef.current.count;
    setReps(repsRef.current);
    popHero();
    sfx.tick();
    diag.mark(`chord-perfect placed ${target()} (${repsRef.current})`);
  };

  const finish = () => {
    clearTimer();
    if (onTimerRef.current) {
      sfx.complete();
      onTimedRun?.({ elapsedSeconds: duration, reachedEnd: true, done: true });
      setView('results');
      return;
    }
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
    const prevBest = bestAtStart.current;
    const celebrate = prevBest === 0 ? value > 0 : value > prevBest;
    if (celebrate) sfx.best();
    else sfx.complete();
    const seriesSnapshot = [...seriesAtStart.current, value];
    setResult({ value, prevBest, series: seriesSnapshot });
    setView('results');
    onResult?.({
      total: value,
      perChord: poolRef.current.map((chord, i) => ({
        chord,
        placements: perChordCounts[i] ?? 0,
      })),
    });
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
    counterRef.current.begin(poolRef.current[next]);
    sfx.go();
    diag.mark(`chord-perfect chord: ${target()} (${perChord}s)`);
  };

  const startSession = async (blind = false) => {
    sfx.go();
    onTimerRef.current = blind;
    setOnTimer(blind);
    poolRef.current = pool;
    bestAtStart.current = poolBest;
    seriesAtStart.current = poolSeries;
    slotRef.current = 0;
    setSlot(0);
    repsRef.current = 0;
    setReps(0);
    tallyRef.current = [];
    setTally([]);
    counterRef.current.begin(pool[0]);
    setTimeLeft(perChord);
    resetSignal();
    onSessionStart?.();
    setView('playing');

    // Wait for the mic before starting the clock so the permission prompt
    // doesn't burn the timer, and bail cleanly if access is denied.
    if (!blind) {
      const live = await start(
        {
          onLevel: (ev) => {
            pushSignal(ev);
            onFrame(ev);
            passive.observe(target(), ev);
          },
        },
        // Restricted to the whole pool, not to the one chord on screen: with a
        // single candidate every match wins by default and a wrong shape would
        // score. The neighbours are what make a correct placement mean something.
        { restrictTo: pool, templates, offset: capo },
      );
      if (!live) return;
      diag.mark(`chord-perfect start [${pool.join(', ')}] ${perChord}s each`);
      diag.mark(`chord-perfect chord: ${pool[0]} (${perChord}s)`);
    }
  };


  // Each shape's block runs its own clock. Keyed on the slot, so advancing to
  // the next shape restarts it and the last one ends the drill.
  useEffect(() => {
    if (view !== 'playing' || (!onTimer && status !== 'running')) return;
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
  }, [view, slot, status, onTimer]);

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
        {poolBest > 0 && (
          <div className="om-best-badge">
            <TrophyIcon size={16} />
            <span>Best {poolBest}</span>
            {poolSeries.length >= 2 && (
              <Sparkline values={poolSeries} className="om-best-spark" />
            )}
          </div>
        )}
        <p className="om-caption">Pick the shapes to drill. Each gets {perChord}s.</p>
        <div className="ct-chip-grid">
          {ALL_CHORDS.map((c) => (
            <button
              key={c}
              type="button"
              className={pool.includes(c) ? 'ct-chip is-on' : 'ct-chip'}
              aria-pressed={pool.includes(c)}
              onClick={() => toggleChord(c)}
            >
              {/* Chosen by sight, not by name. The point of the setup screen is
                  deciding what to drill, and a shape you cannot picture is
                  exactly the one worth picking. */}
              <ChordDiagram chord={c} size={62} showFingers={false} className="ct-chip-shape" />
              <span className="ct-chip-name">{c}</span>
            </button>
          ))}
        </div>
        <button
          className="practice-btn primary"
          onClick={() => void startSession()}
          disabled={pool.length < 2}
        >
          <PlayIcon size={20} /> Start {pool.length * perChord}s
        </button>
        {pool.length < 2 && <p className="om-caption">Pick at least two shapes</p>}
      </div>
    );
  }

  if (view === 'playing') {
    if (!onTimer && status === 'error') {
      return (
        <MicGate
          error={error}
          onRetry={() => void startSession()}
          onTimer={() => void startSession(true)}
        />
      );
    }
    if (!onTimer && status !== 'running') {
      return (
        <div className="mic-gate">
          <MicIcon size={40} color="var(--accent-primary)" />
          <p>Allow microphone access to begin…</p>
        </div>
      );
    }
    return (
      <>
        <div className="practice-mode is-chord">place · strum · lift off · place again</div>
        <div className="ct-stage">
          <div ref={heroRef} className="practice-hero ct-target">
            {pool[slot]}
          </div>
          {/* The drill's instruction is "place the shape", so the shape is on
              screen. It turns green while the chord is actually being held,
              which closes the loop between the hand and the readout. */}
          <div ref={shapeRef} className="ct-shape">
            <ChordDiagram chord={pool[slot]} size={130} />
          </div>
        </div>

        <div className="ct-blocks">
          {pool.map((c, i) => (
            <span
              key={c}
              className={i === slot ? 'ct-block is-now' : i < slot ? 'ct-block is-done' : 'ct-block'}
            >
              {c}
              {!onTimer && i < slot && <b>{tally[i]}</b>}
            </span>
          ))}
        </div>

        <div className="ct-stats">
          {/* Small, because the shape above it is the drill and this is the
              score. The mark is still the best for this set of shapes, so the
              gap to it is readable without leaving the exercise. */}
          {!onTimer && (
            <ProgressRing
              {...ringScale(reps, poolBest)}
              phase="live"
              size={104}
              stroke={7}
              className="om-ring ct-ring-live"
            >
              <span className="ct-score">{reps}</span>
              <span className="om-caption">placed</span>
            </ProgressRing>
          )}
          <span className="om-timer">
            <HourglassIcon size={22} /> {timeLeft}
          </span>
        </div>
        {onTimer ? <UncountedNotice /> : <SignalMeter quality={signal} />}
      </>
    );
  }

  if (onTimer) {
    return (
      <TimerRunEnded
        autoAdvance={autoAdvance}
        advanceLeft={advanceLeft}
        nextLabel={nextLabel}
        onNext={onNext}
        onClose={onClose}
      />
    );
  }

  // Everything the card shows comes out of the run that just ended, which froze
  // its own comparison at the moment it finished. The store has already moved on
  // by the time this renders, so only the frozen copy can say what this run beat.
  const value = result?.value ?? tally.reduce((a, b) => a + b, 0);
  const prevBest = result?.prevBest ?? poolBest;
  const resultSeries = result?.series ?? poolSeries;

  const isFirst = prevBest === 0;
  const isNewBest = !isFirst && value > prevBest;
  const celebrate = isNewBest || (isFirst && value > 0);

  return (
    <motion.div
      className="om-results"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {celebrate && <PersonalBestSparkle />}

      <ProgressRing {...ringScale(value, prevBest)} className="om-ring">
        <div className="om-ring-value">{value}</div>
        <div className="om-caption">shapes placed</div>
      </ProgressRing>

      {/* Nothing placed and nothing heard look the same on the ring. */}
      {value === 0 && <p className="om-context">No shapes detected</p>}

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
            {onNext ? 'Next drill' : 'Next'} <ArrowRightIcon size={18} />
          </button>
        </div>
      )}
    </motion.div>
  );
}
