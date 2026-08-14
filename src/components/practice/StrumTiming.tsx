import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRightIcon,
  HourglassIcon,
  MicIcon,
  OnBeatIcon,
  PlayIcon,
  RetryIcon,
  SpeakerIcon,
  TrophyIcon,
} from '../icons';
import { useStrumTiming } from '../../hooks/useStrumTiming';
import { metronome } from '../../audio/metronome';
import { diag, DIAG_CODE } from '../../audio/diagnostics';
import { sfx } from '../../audio/sfx';
import {
  IN_TIME_MS,
  MIN_MEASURED_BEATS,
  TIMING_RESOLUTION_MS,
  describeTiming,
  fitBeatGrid,
  offsetAt,
  summariseTiming,
  type BeatGrid,
  type TimingSummary,
} from '../../lib/strumTiming';
import { ProgressRing } from './ProgressRing';
import { SignalMeter } from './SignalMeter';
import { useTimingSignalMeter } from './signalQuality';
import { GrooveRail, GrooveTrace } from './GrooveRail';
import type { DrillConfig } from '../../types';
import './strumTiming.css';

const AUTO_ADVANCE_SECONDS = 5;
/** How many strums the live rail carries. Enough to read a drift, few enough to read at all. */
const LIVE_MARKS = 8;
/**
 * How long the drill listens for the click before it says it cannot hear one.
 *
 * Long enough to cover the metronome's own start offset, a browser taking its
 * time to free the audio route, and a player who has not started yet. Short
 * enough that nobody strums for half a minute into a measurement that was never
 * going to happen.
 */
const CLICK_GRACE_SECONDS = 7;

type View = 'setup' | 'playing' | 'results';

export interface StrumTimingResult {
  bpm: number;
  summary: TimingSummary;
}

interface Props {
  config?: DrillConfig;
  /** The tempo the drill opens at, from the shared prescription. */
  bpm: number;
  personalBest?: number;
  onResult?: (result: StrumTimingResult) => void;
  onClose?: () => void;
  autoStart?: boolean;
  onNext?: () => void;
  autoAdvance?: boolean;
  nextLabel?: string;
  onSessionStart?: () => void;
}

/**
 * Strum timing against the metronome.
 *
 * The one drill in the app that grades rhythm, which the product spent a long
 * time refusing to do because a single microphone hears the click and the guitar
 * at once and a wrong verdict on timing costs more trust than no verdict. What
 * changed is that the two are now separable: the click is engineered to sit
 * where a guitar is not, and src/audio/timing.ts splits the microphone into two
 * bands and detects each independently. The beat is read from the click as it
 * arrives in the room rather than from the audio clock, so the number the player
 * sees is their own hands and not the browser's output latency.
 *
 * The consequence is a hard requirement: the click has to reach the microphone.
 * On headphones there is nothing to measure against, and this surface says so
 * rather than inventing a grid.
 */
export function StrumTiming({
  config,
  bpm,
  personalBest = 0,
  onResult,
  onClose,
  autoStart = false,
  onNext,
  autoAdvance = false,
  nextLabel = 'Up next',
  onSessionStart,
}: Props) {
  const { status, error, start, stop } = useStrumTiming();
  const duration = config?.durationSec ?? 60;

  const [view, setView] = useState<View>(autoStart ? 'playing' : 'setup');
  const [timeLeft, setTimeLeft] = useState(duration);
  const [marks, setMarks] = useState<{ id: number; offsetMs: number }[]>([]);
  const [live, setLive] = useState<TimingSummary | null>(null);
  const [clickPulse, setClickPulse] = useState(0);
  const [clicksHeard, setClicksHeard] = useState(0);
  const [deaf, setDeaf] = useState(false);
  const [tempo, setTempo] = useState(bpm);
  const [result, setResult] = useState<{
    summary: TimingSummary;
    bpm: number;
    prevBest: number;
    /** Whether a beat grid ever existed, which is what separates "you played too
        little" from "the click never reached the microphone". */
    heardTheClick: boolean;
  } | null>(null);
  const [advanceLeft, setAdvanceLeft] = useState(AUTO_ADVANCE_SECONDS);
  const { quality: signal, push: pushSignal, reset: resetSignal } = useTimingSignalMeter();

  // Everything the analyser reports lands in refs. Strums and clicks arrive a
  // few times a second and the grid is refitted on each one; keeping the raw
  // lists out of React state is what stops a re-render per event while the
  // filters are running on the same thread.
  const strumsRef = useRef<number[]>([]);
  const clicksRef = useRef<number[]>([]);
  const gridRef = useRef<BeatGrid | null>(null);
  const periodRef = useRef(60 / bpm);
  const markIdRef = useRef(0);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevBestRef = useRef(0);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  /** Throw away the measurement and start collecting from this moment. */
  const resetMeasurement = (nextBpm: number) => {
    strumsRef.current = [];
    clicksRef.current = [];
    gridRef.current = null;
    periodRef.current = 60 / nextBpm;
    setMarks([]);
    setLive(null);
    setClicksHeard(0);
    setDeaf(false);
  };

  const handleClick = (at: number) => {
    clicksRef.current.push(at);
    setClicksHeard(clicksRef.current.length);
    setClickPulse((n) => n + 1);
    diag.timing(DIAG_CODE.CLICK_HEARD, 0);
    const grid = fitBeatGrid(clicksRef.current, periodRef.current);
    if (grid) {
      gridRef.current = grid;
      setDeaf(false);
    } else if (gridRef.current) {
      // The clicks stopped describing this tempo. Either the click was turned
      // off or the room changed; either way the old grid is no longer a claim
      // that can be made about what is being played now.
      gridRef.current = null;
      diag.timing(DIAG_CODE.GRID_LOST, 0);
    }
  };

  const handleStrum = (at: number) => {
    const grid = gridRef.current;
    if (!grid) {
      diag.timing(DIAG_CODE.STRUM_NO_GRID, 0);
      return;
    }
    strumsRef.current.push(at);
    const { offsetMs } = offsetAt(grid, at);
    diag.timing(DIAG_CODE.STRUM_TIMED, offsetMs);
    markIdRef.current += 1;
    const id = markIdRef.current;
    setMarks((current) => [{ id, offsetMs }, ...current].slice(0, LIVE_MARKS));
    setLive(summariseTiming(strumsRef.current, grid));
  };

  const finish = () => {
    clearTimer();
    void stop();
    const grid = gridRef.current;
    const heardTheClick = grid !== null;
    const settled = heardTheClick
      ? summariseTiming(strumsRef.current, grid)
      : summariseTiming([], { origin: 0, period: periodRef.current, clicks: 0 });
    diag.mark(
      `strum timing finish at ${tempo} BPM: ${settled.beatsInTime}/${settled.expectedBeats} in time,` +
        ` median ${Math.round(settled.medianMs)} ms, spread ${Math.round(settled.spreadMs)} ms`,
    );
    const prev = prevBestRef.current;
    if (settled.enough && (prev === 0 ? settled.score > 0 : settled.score > prev)) sfx.best();
    else sfx.complete();
    setResult({ summary: settled, bpm: tempo, prevBest: prev, heardTheClick });
    setView('results');
    onResult?.({ bpm: tempo, summary: settled });
  };

  const startSession = async () => {
    sfx.go();
    // Whatever the click is actually set to, which is not always the
    // prescription: the player can have moved it on the setup screen, and the
    // Metronome control applies a new plan a tick after this runs. The timer
    // below reconciles either way, and at this point there is nothing collected
    // for a reconciliation to throw away.
    const opening = metronome.getBpm();
    resetMeasurement(opening);
    setTempo(opening);
    setTimeLeft(duration);
    resetSignal();
    prevBestRef.current = personalBest;
    onSessionStart?.();
    setView('playing');

    const running = await start(
      {
        onStrum: (onset) => handleStrum(onset.at),
        onClick: (onset) => handleClick(onset.at),
        onLevel: (level) => pushSignal(level),
      },
      'strum timing',
    );
    if (!running) return; // denied or failed; the mic gate view takes over
    diag.mark(`strum timing start at ${opening} BPM (${duration}s)`);

    clearTimer();
    startedAtRef.current = Date.now();
    const deadline = startedAtRef.current + duration * 1000;
    timerRef.current = setInterval(() => {
      const now = Date.now();
      setTimeLeft(Math.max(0, Math.ceil((deadline - now) / 1000)));

      // The player can move the tempo from the click's own panel at any time.
      // Doing so mid-run makes every offset collected so far a statement about
      // a different exercise, so the measurement restarts rather than blending
      // two tempos into one number.
      const current = metronome.getBpm();
      if (Math.abs(60 / current - periodRef.current) > 1e-9) {
        resetMeasurement(current);
        setTempo(current);
        startedAtRef.current = now;
        diag.mark(`strum timing tempo changed to ${current} BPM; measuring again`);
      }

      if (!gridRef.current && now - startedAtRef.current > CLICK_GRACE_SECONDS * 1000) setDeaf(true);
      if (now >= deadline) finish();
    }, 200);
  };

  useEffect(() => {
    const t = autoStart ? setTimeout(() => startSession(), 0) : null;
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

  // --- Setup ---------------------------------------------------------------

  if (view === 'setup') {
    return (
      <div className="om-setup st-setup">
        {personalBest > 0 && (
          <div className="om-best-badge">
            <TrophyIcon size={16} />
            <span>Best {personalBest}% in time</span>
          </div>
        )}
        <OnBeatIcon size={52} className="st-crest" />
        <div className="st-brief">
          <p className="st-brief-line">One down strum on every click, at {bpm} BPM.</p>
          <p className="om-caption">
            Play through your speakers, not headphones. The drill listens for the click in the room
            and measures your strums against the one you can actually hear.
          </p>
        </div>
        <button className="practice-btn primary" onClick={startSession}>
          <PlayIcon size={20} /> Start {duration}s
        </button>
      </div>
    );
  }

  // --- Playing -------------------------------------------------------------

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
        <div className="mic-gate st-deaf">
          <SpeakerIcon size={40} color="var(--warning-color)" />
          <p className="st-deaf-title">
            {silent ? 'The click is not playing' : 'I cannot hear the click'}
          </p>
          <p>
            {silent
              ? 'Your browser is holding the sound. Turn the click on and this can start measuring.'
              : 'This drill times your strums against the click as it arrives in the room, so the click has to come out of your speakers. On headphones there is nothing for the microphone to measure against.'}
          </p>
          <button
            className="practice-btn primary"
            onClick={() => {
              if (silent) metronome.unlockAndStart(tempo);
              startedAtRef.current = Date.now();
              setDeaf(false);
            }}
          >
            <RetryIcon size={18} /> {silent ? 'Turn the click on' : 'Try again'}
          </button>
        </div>
      );
    }

    const summary = live;
    const measuring = summary !== null && summary.expectedBeats > 0;
    const locked =
      summary !== null &&
      summary.enough &&
      Math.abs(summary.medianMs) <= TIMING_RESOLUTION_MS &&
      summary.spreadMs <= TIMING_RESOLUTION_MS;

    return (
      <div className="st-stage">
        <GrooveRail
          marks={marks}
          centreMs={measuring ? summary.medianMs : null}
          spreadMs={summary?.spreadMs ?? 0}
          locked={locked}
          clickPulse={clickPulse}
        />

        <p className={locked ? 'st-call is-locked' : 'st-call'} aria-live="polite">
          {clicksHeard === 0
            ? 'Listening for the click…'
            : marks.length === 0
              ? 'Strum down on every click.'
              : summary && summary.enough
                ? describeTiming(summary)
                : `${MIN_MEASURED_BEATS - (summary?.expectedBeats ?? 0)} more beats to measure.`}
        </p>

        <div className="st-figures">
          <Figure
            value={measuring && summary.enough ? signedMs(summary.medianMs) : null}
            unit="ms"
            label="off the beat"
          />
          <Figure
            value={measuring && summary.enough ? `±${Math.round(summary.spreadMs)}` : null}
            unit="ms"
            label="spread"
          />
          <Figure
            value={measuring ? `${summary.beatsInTime}/${summary.expectedBeats}` : null}
            label="in time"
          />
        </div>

        <div className="om-timer">
          <HourglassIcon size={26} /> {timeLeft}
        </div>
        <SignalMeter quality={signal} />
      </div>
    );
  }

  // --- Results -------------------------------------------------------------

  const summary = result?.summary ?? null;
  const prevBest = result?.prevBest ?? 0;
  const score = summary?.score ?? 0;
  const isFirst = prevBest === 0;
  const isNewBest = !isFirst && score > prevBest;
  const celebrate = summary?.enough === true && (isNewBest || (isFirst && score > 0));

  let context: string;
  if (result?.heardTheClick === false) context = 'The click never reached the microphone';
  else if (summary?.selfReferential) context = 'The click was not audible, so nothing was measured';
  else if (!summary?.enough) context = 'Too few beats to measure';
  else if (isFirst) context = 'First benchmark set';
  else if (isNewBest) context = `+${score - prevBest} over your best`;
  else if (score === prevBest) context = 'Matched your best';
  else context = `${prevBest - score} to beat your best`;

  return (
    <motion.div className="om-results st-results" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
      <ProgressRing
        progress={summary?.enough ? score / 100 : 0}
        className={celebrate ? 'om-ring is-pr' : 'om-ring'}
      >
        <div className="om-ring-value">{summary?.enough ? score : '--'}</div>
        <div className="om-caption">% in time</div>
      </ProgressRing>

      <div className={celebrate ? 'om-context is-pr' : 'om-context'}>
        {celebrate && <TrophyIcon size={16} />}
        <span>{context}</span>
      </div>

      {summary?.enough && (
        <>
          <p className="st-call">{describeTiming(summary)}</p>
          <GrooveTrace offsets={summary.offsets} />
          <div className="st-figures">
            <Figure value={signedMs(summary.medianMs)} unit="ms" label="off the beat" />
            <Figure value={`±${Math.round(summary.spreadMs)}`} unit="ms" label="spread" />
            <Figure value={`${summary.beatsInTime}/${summary.expectedBeats}`} label="in time" />
          </div>
          <p className="st-footnote">
            In time means within {IN_TIME_MS} ms of the click, at {result?.bpm} BPM. A strum is timed
            when its sound arrives, a few milliseconds after the pick, so leans under{' '}
            {TIMING_RESOLUTION_MS} ms are shown but never named.
          </p>
        </>
      )}

      {!summary?.enough && (
        <p className="st-call">
          {result?.heardTheClick === false
            ? 'This drill measures your strums against the click as the microphone hears it, and no click arrived. Play it through your speakers rather than headphones and run it again.'
            : summary?.selfReferential
              ? 'Everything landed too precisely to have come from a pair of hands, which means the microphone was measuring the guitar against itself rather than against the click. Play the click through your speakers and run it again.'
              : `A measurement needs at least ${MIN_MEASURED_BEATS} beats of playing. Nothing has been saved.`}
        </p>
      )}

      {summary?.enough && <div className="om-saved-hint">Saved automatically · see Progress for trends</div>}

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
          {/* No autoFocus, unlike the other drills' result cards. Focusing a
              button at the bottom scrolls it into view, and this card is the
              tallest in the app: on a small phone that pushes the score itself
              off the top of the screen, which is the one thing the player came
              back to see. */}
          <button className="practice-btn primary" onClick={onNext ?? (() => setView('setup'))}>
            {onNext ? 'Next drill' : 'Again'} <ArrowRightIcon size={18} />
          </button>
        </div>
      )}
    </motion.div>
  );
}

/**
 * One number under the rail.
 *
 * The unit rides with the value at a smaller size rather than sitting in the
 * label, which is what lets every label stay to one line on a 360 pixel phone:
 * "spread, ms" and "beats in time" both wrapped there, and three figures with
 * differently ragged bottoms read as a mistake rather than as a row.
 */
function Figure({ value, unit, label }: { value: string | null; unit?: string; label: string }) {
  return (
    <div className="st-figure">
      <span className="st-figure-value">
        {value ?? <span className="st-figure-waiting" aria-label="not measured yet">·</span>}
        {value !== null && unit && <i className="st-figure-unit">{unit}</i>}
      </span>
      <span className="st-figure-label">{label}</span>
    </div>
  );
}

/**
 * A signed millisecond figure, with the minus sign drawn as a real one.
 *
 * The hyphen a JavaScript number stringifies to is a fifth the width of the plus
 * it sits beside, so a column of these reads as ragged at practice distance.
 * U+2212 is the character the tuner already uses for the same reason.
 */
function signedMs(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return '0';
  return rounded < 0 ? `−${Math.abs(rounded)}` : `+${rounded}`;
}
