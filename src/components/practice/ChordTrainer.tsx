import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRightIcon, HourglassIcon, MicIcon, PlayIcon, TrophyIcon } from '../icons';
import { MicGate, TimerRunEnded, UncountedNotice } from './MicGate';
import type { TimedOutcome } from '../../store/completion';
import { useDrillLogs } from '../../store';
import { poolKey, trainerPool } from '../../lib/drillKeys';
import { trainerChordSeconds } from '../../lib/drills';
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
import { CoachAdvance, WITHHELD_ADVANCE_SECONDS } from './CoachAdvance';
import { ChordDiagram } from './ChordDiagram';
import { useMicLoss, useSignalMeter } from './signalQuality';
import { useUnheardShare } from './runSignal';
import { sfx } from '../../audio/sfx';
import { diag } from '../../audio/diagnostics';
import { PlacementCounter } from '../../audio/placement';
import type { LevelEvent } from '../../audio/detector';
import type { DrillConfig } from '../../types';

const ALL_CHORDS = ['A', 'C', 'D', 'E', 'G', 'Am', 'Dm', 'Em', 'F'];
const AUTO_ADVANCE_SECONDS = 5;

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
  /**
   * How much of the block the microphone read weak, unreadable or lost, 0..1.
   * The caller needs it to tell a bad block apart from one it could not hear;
   * see lib/unheardRun.ts.
   */
  unheardShare: number;
}

interface Props {
  config?: DrillConfig;
  onResult?: (result: ChordTrainerResult) => void;
  onClose?: () => void;
  autoStart?: boolean;
  onNext?: () => void;
  autoAdvance?: boolean; // results auto-continue after a short countdown (no button)
  nextLabel?: string; // what the auto-advance is moving toward, e.g. "Rest"
  // Steering, in a coached session only. Again re-runs this segment; Skip leaves
  // it out of the record entirely. Absent when the drill is opened on its own,
  // where the results screen already has its own two buttons.
  onAgain?: () => void;
  onSkip?: () => void;
  /**
   * This block was not written to the day's record, because the score fell far
   * below what these shapes are recently worth and the microphone was unreadable
   * for a meaningful part of it. The caller decides that; the drill only has to
   * stop drawing the number as if it were a result.
   */
  withheld?: boolean;
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
  onAgain,
  onSkip,
  withheld = false,
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
  // Shared with lib/tempo.ts's callers, which need the block's real length to
  // turn a score into a rate. Two copies of this arithmetic is how the click
  // came to prescribe from a block eleven per cent shorter than the one played.
  const perChord = trainerChordSeconds(duration, pool.length);

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
  // Remembers what the meter above only draws, for as long as this block lasts.
  const unheard = useUnheardShare(signal, view === 'playing');
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
  // Null until the hand-off's first tick, so the very first frame shows the full
  // length without an effect having to write it. The length is not known at
  // mount: a run that turns out to be unfilable holds the screen for longer, and
  // that verdict only arrives with the results.
  const [advanceTick, setAdvanceTick] = useState<number | null>(null);
  // Running blind: the blocks still run their clocks, nothing is counted.
  const [onTimer, setOnTimer] = useState(false);
  const onTimerRef = useRef(false);
  /** Wall clock at the block's start, so a run cut short can say how long it ran. */
  const startedAtRef = useRef(0);

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

  /**
   * See useMicLoss. Unlike the other drills this one's clock is per shape, so
   * the seconds played are counted from the block's own start rather than from
   * what is left of the current chord's turn.
   */
  const endOnMicLoss = () => {
    clearTimer();
    if (sharedMic) setHandlers({});
    else void stop();
    const played = Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000));
    diag.mark(`chord perfect: microphone lost after ${played}s, filed as time played`);
    onTimerRef.current = true;
    setOnTimer(true);
    onTimedRun?.({ elapsedSeconds: played, reachedEnd: false, done: true });
    setView('results');
  };

  useMicLoss(signal, view === 'playing' && !onTimer, endOnMicLoss);

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
      // Read before the view changes, so the span the meter was holding when the
      // last block ran out is part of the answer.
      unheardShare: unheard.share(),
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
    startedAtRef.current = Date.now();
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
    unheard.reset();
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

  // Hands-free advance once results land in coached mode. A block that was not
  // filed holds longer, because Again is the point of that screen.
  const advanceSeconds = withheld ? WITHHELD_ADVANCE_SECONDS : AUTO_ADVANCE_SECONDS;
  const advanceLeft = advanceTick ?? advanceSeconds;
  useEffect(() => {
    if (view !== 'results' || !autoAdvance || !onNext) return;
    const deadline = Date.now() + advanceSeconds * 1000;
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setAdvanceTick(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        onNext();
      }
    }, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, autoAdvance, advanceSeconds]);

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
        {/* A grid of nine shapes with some of them lit is already the whole of
            "pick the shapes to drill", and the button already carries the total.
            All that was left of the sentence is the one number neither of them
            says: how long each shape gets. */}
        <p className="om-caption">{perChord}s each</p>
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

  // First block of a pool this player has never scored on. After that the drill
  // has already shown what it wants and the line is repetition.
  const showMotionHint = slot === 0 && poolBest === 0 && reps === 0;

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
      /* Cue and readout as two halves, side by side on a propped laptop. Stacked,
         the meter sat on the fold of a 572-pixel window and the timer with it. */
      <div className="drill-stage">
        <div className="drill-cue">
          {/* The motion the drill asks for, said once and then gone. It is four
              words describing a thing the screen demonstrates a second later
              (the shape turns green under the hand, the count moves), so it
              belongs to the first block a player ever runs on these shapes and
              to no other. Text that survives past first use is furniture. */}
          {showMotionHint && (
            <div className="practice-mode is-chord ct-motion-hint">
              place · strum · lift off · place again
            </div>
          )}
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
        </div>

        <div className="drill-read">
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
        </div>
      </div>
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
        onAgain={onAgain}
        onSkip={onSkip}
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
  // Nothing is celebrated on a block that is not going into the record. A best
  // that is not being kept is not a best.
  const celebrate = !withheld && (isNewBest || (isFirst && value > 0));
  // Which way the microphone failed, for the meter to say in its own words.
  const failure = withheld ? unheard.verdict() : null;

  return (
    <motion.div
      className="om-results"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {celebrate && <PersonalBestSparkle />}

      {/* A number that is not being kept is drawn as one: off the accent, with
          the claim under it changed. See .om-ring.is-unfiled. */}
      <ProgressRing
        {...ringScale(value, prevBest)}
        className={withheld ? 'om-ring is-unfiled' : 'om-ring'}
      >
        <div className="om-ring-value">{value}</div>
        <div className="om-caption">{withheld ? 'not counted' : 'shapes placed'}</div>
      </ProgressRing>

      {/* Why, in the meter's own vocabulary: the reading this block was taken
          through, and the whole reason the number above is not being kept. */}
      {failure && <SignalMeter quality={failure} />}

      {/* Nothing placed and nothing heard look the same on the ring. */}
      {!withheld && value === 0 && <p className="om-context">No shapes detected</p>}

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
        <CoachAdvance
          nextLabel={nextLabel}
          advanceLeft={advanceLeft}
          onAgain={onAgain}
          onSkip={onSkip}
        />
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
