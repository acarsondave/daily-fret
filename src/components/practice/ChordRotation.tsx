import { Fragment, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { ArrowRightIcon, HourglassIcon, MicIcon, PlayIcon, SweepIcon, TrophyIcon } from '../icons';
import { MicGate, TimerRunEnded, UncountedNotice } from './MicGate';
import type { TimedOutcome } from '../../store/completion';
import { rotationRing } from '../../lib/drillKeys';
import { sweepStep } from '../../lib/sweep';
import { useChordDetector, type ChordDetectorApi } from '../../hooks/useChordDetector';
import { useLearnedTemplates } from '../../hooks/useLearnedTemplates';
import { useCapoOffset } from '../../hooks/useCapo';
import { ProgressRing } from './ProgressRing';
import { SignalMeter } from './SignalMeter';
import { ChordDiagram } from './ChordDiagram';
import { useSignalMeter } from './signalQuality';
import { sfx } from '../../audio/sfx';
import { diag } from '../../audio/diagnostics';
import type { DrillConfig } from '../../types';

const AUTO_ADVANCE_SECONDS = 5;
// A human can't genuinely move to the next chord faster than this; anything
// quicker is a detection wobble mid-transition, not a real change.
const MIN_CHANGE_MS = 130;

type View = 'setup' | 'playing' | 'results';

/**
 * What one turn of the rotation produced.
 *
 * The ring comes back with the count because the ring is what the count is
 * about: a rotation is only comparable with another turn of the same loop, and
 * the caller cannot assume its own config was the ring that ran (a rotation with
 * no ring of its own falls back to the classic set here).
 */
export interface ChordRotationResult {
  ring: string[];
  changes: number;
}

interface Props {
  config?: DrillConfig;
  onResult?: (result: ChordRotationResult) => void;
  onClose?: () => void;
  personalBest?: number;
  autoStart?: boolean;
  onNext?: () => void;
  autoAdvance?: boolean;
  nextLabel?: string;
  detector?: ChordDetectorApi;
  onSessionStart?: () => void; // the drill is now live (drives the auto metronome)
  // A run the microphone could not hear, timed instead. Kept separate from
  // onResult because it carries elapsed time and no measurement.
  onTimedRun?: (outcome: TimedOutcome) => void;
}

// Anchor-changes drill: sweep back and forth along a path of chords at your own
// pace, one change counted each time you land the chord being cued. Unlike the
// two-chord one-minute drill this reinforces the *anchor-finger* moves across a
// small set of chords.
//
// Back and forth rather than round in a loop: D → A → E → A → D → A → E, turning
// at each end instead of jumping from the last chord to the first. A loop only
// ever drills each transition one way and adds one long jump that no piece of
// music asks for. Sweeping drills both directions of every neighbouring pair and
// asks for nothing else, which is what an anchor-finger exercise is for. Its
// results are keyed separately from the old loop's (`sweep:` rather than
// `ring:`) so a change in the exercise is never read as a change in the player.
export function ChordRotation({
  config,
  onResult,
  onClose,
  personalBest = 0,
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
  const sharedMic = !!detector;
  const { status, route, error, start, stop, setHandlers } = detector ?? own;

  // The ordered ring to cycle. Falls back to the classic anchor set.
  const ring = rotationRing(config?.chords);
  const duration = config?.durationSec ?? 60;

  const [view, setView] = useState<View>(autoStart ? 'playing' : 'setup');
  const [changes, setChanges] = useState(0);
  const [timeLeft, setTimeLeft] = useState(duration);
  // Which chord in the ring we're cueing the player to land next. The lit name
  // always means "play this now".
  const [targetIdx, setTargetIdx] = useState(0);
  // Mirrored into state as well as a ref: the ref is what the detector callback
  // reads between renders, and this is what the cue is drawn from.
  const [dir, setDir] = useState(1);
  const { quality: signal, push: pushSignal, reset: resetSignal } = useSignalMeter(route);
  const [result, setResult] = useState<{ value: number; prevBest: number } | null>(null);
  const [advanceLeft, setAdvanceLeft] = useState(AUTO_ADVANCE_SECONDS);
  // Running blind: the clock runs, the path is on screen, nothing is counted.
  const [onTimer, setOnTimer] = useState(false);
  const onTimerRef = useRef(false);

  const targetIdxRef = useRef(0);
  // Which way along the path we are travelling. Flips at each end, so the cue
  // turns round rather than wrapping to the far side.
  const dirRef = useRef(1);
  const lastChordRef = useRef('');
  const lastCountAtRef = useRef(0);
  const changesRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countRef = useRef<HTMLDivElement>(null);
  const prevBestRef = useRef(0);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const popCount = () => {
    const el = countRef.current;
    if (!el) return;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  };

  const handleChord = (chord: string) => {
    // A ring has no beginning. Before the first landing, take whichever chord of
    // the ring the player actually plays and cue on from there. Insisting they
    // start on the one the drill happened to list first is a rule with no
    // musical reason behind it, and a diagnostics export (2026-08-10) shows what
    // it costs: the player opened on A, the cue sat on D, and the drill counted
    // nothing at all for the first 8.7 seconds of a 60-second run while they
    // were playing the whole time.
    if (lastChordRef.current === '') {
      const at = ring.indexOf(chord);
      if (at < 0) return;
      lastChordRef.current = chord;
      lastCountAtRef.current = Date.now();
      // Opening on the last chord of the path means the only way on is
      // backwards, so the first step sets the direction as well as the target.
      const opened = sweepStep(at, at >= ring.length - 1 ? -1 : 1, ring.length);
      dirRef.current = opened.dir;
      targetIdxRef.current = opened.next;
      setTargetIdx(opened.next);
      setDir(opened.dir);
      return;
    }

    if (chord !== ring[targetIdxRef.current]) return;
    const t = Date.now();
    if (t - lastCountAtRef.current >= MIN_CHANGE_MS) {
      changesRef.current += 1;
      setChanges(changesRef.current);
      popCount();
      lastCountAtRef.current = t;
    }
    lastChordRef.current = chord;
    const moved = sweepStep(targetIdxRef.current, dirRef.current, ring.length);
    dirRef.current = moved.dir;
    targetIdxRef.current = moved.next;
    setTargetIdx(moved.next);
    setDir(moved.dir);
  };


  const finish = () => {
    clearTimer();
    if (onTimerRef.current) {
      sfx.complete();
      onTimedRun?.({ elapsedSeconds: duration, reachedEnd: true, done: true });
      setView('results');
      return;
    }
    diag.mark(`rotation finish ${ring.join('>')}: counted ${changesRef.current}`);
    if (sharedMic) setHandlers({});
    else void stop();
    const value = changesRef.current;
    const prev = prevBestRef.current;
    const celebrate = prev === 0 ? value > 0 : value > prev;
    if (celebrate) sfx.best();
    else sfx.complete();
    setResult({ value, prevBest: prev });
    setView('results');
    onResult?.({ ring, changes: value });
  };

  const startSession = async (blind = false) => {
    sfx.go();
    onTimerRef.current = blind;
    setOnTimer(blind);
    changesRef.current = 0;
    lastChordRef.current = '';
    lastCountAtRef.current = 0;
    targetIdxRef.current = 0;
    dirRef.current = 1;
    setChanges(0);
    setTargetIdx(0);
    setDir(1);
    setTimeLeft(duration);
    resetSignal();
    prevBestRef.current = personalBest;
    onSessionStart?.();
    setView('playing');

    if (!blind) {
      const live = await start(
        {
          onChord: (ev) => handleChord(ev.chord),
          onLevel: (ev) => pushSignal(ev),
        },
        { restrictTo: ring, templates, offset: capo },
      );
      if (!live) return;
      diag.mark(`rotation start ${ring.join('>')} (${duration}s)`);
    }

    clearTimer();
    const deadline = Date.now() + duration * 1000;
    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) finish();
    }, 200);
  };

  useEffect(() => {
    const t = autoStart ? setTimeout(() => startSession(), 0) : null;
    return () => {
      if (t) clearTimeout(t);
      clearTimer();
      if (!sharedMic) void stop();
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

  if (view === 'setup') {
    return (
      <div className="om-setup">
        {personalBest > 0 && (
          <div className="om-best-badge">
            <TrophyIcon size={16} />
            <span>Best {personalBest}</span>
          </div>
        )}
        <div className="rot-ring">
          {ring.map((c, i) => (
            <span key={`${c}-${i}`} className="rot-chord">
              {c}
              {i < ring.length - 1 && <SweepIcon size={16} className="rot-sep" />}
            </span>
          ))}
        </div>
        <p className="om-caption">One clean change at a time</p>
        <button className="practice-btn primary" onClick={() => void startSession()}>
          <PlayIcon size={20} /> Start {duration}s
        </button>
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
        {/* The ring with the chord to play *next* lit, so a lit name always reads
            as "play this now" through the whole rotation. */}
        <div className="rot-ring rot-ring-live">
          {ring.map((c, i) => (
            <Fragment key={`${c}-${i}`}>
              {/* Nothing is lit on a timer: the cue only advances on a heard
                  chord, and a name left lit for a whole minute would be telling
                  the player to play one chord and never move on. */}
              <span className={!onTimer && i === targetIdx ? 'rot-chord is-live' : 'rot-chord'}>
                <span className="rot-chord-name">{c}</span>
                <ChordDiagram chord={c} size={76} showFingers={false} className="rot-chord-shape" />
              </span>
              {i < ring.length - 1 && (
                // Which way the sweep is travelling right now, drawn on the one
                // separator the hand is crossing. The head it is heading towards
                // is lit and the other is dimmed, so the turn at each end is
                // something you watch happen rather than something you are told
                // about.
                <SweepIcon
                  size={16}
                  className={clsx(
                    'rot-sep',
                    (i === targetIdx || i === targetIdx - 1) && 'is-crossing',
                    dir < 0 && 'is-back',
                  )}
                />
              )}
            </Fragment>
          ))}
        </div>
        {onTimer ? (
          <UncountedNotice />
        ) : (
          <>
            <div ref={countRef} className="om-count">
              {changes}
            </div>
            <div className="om-caption">changes</div>
          </>
        )}
        <div className="om-timer">
          <HourglassIcon size={26} /> {timeLeft}
        </div>
        {!onTimer && <SignalMeter quality={signal} />}
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

  const value = result?.value ?? changes;
  const prevBest = result?.prevBest ?? 0;
  const isFirst = prevBest === 0;
  const isNewBest = !isFirst && value > prevBest;
  const isMatch = !isFirst && value === prevBest;
  const celebrate = isNewBest || (isFirst && value > 0);
  const progress = isFirst ? (value > 0 ? 1 : 0) : value / prevBest;

  let context: string;
  if (isFirst) context = value > 0 ? 'First benchmark set' : 'No changes detected';
  else if (isNewBest) context = `+${value - prevBest} over your best`;
  else if (isMatch) context = 'Matched your best';
  else context = `${prevBest - value} to beat your best`;

  return (
    <motion.div className="om-results" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
      <ProgressRing progress={progress} className={celebrate ? 'om-ring is-pr' : 'om-ring'}>
        <div className="om-ring-value">{value}</div>
        <div className="om-caption">changes</div>
      </ProgressRing>

      <div className={celebrate ? 'om-context is-pr' : 'om-context'}>
        {celebrate && <TrophyIcon size={16} />}
        <span>{context}</span>
      </div>

      <div className="om-result-meta">
        <div className="rot-ring">
          {ring.map((c, i) => (
            <span key={`${c}-${i}`} className="rot-chord target">
              {c}
              {i < ring.length - 1 && <SweepIcon size={12} className="rot-sep" />}
            </span>
          ))}
        </div>
      </div>

      <div className="om-saved-hint">Saved automatically · see Progress for trends</div>

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
          <button className="practice-btn primary" onClick={onNext ?? (() => setView('setup'))} autoFocus>
            {onNext ? 'Next drill' : 'Again'} <ArrowRightIcon size={18} />
          </button>
        </div>
      )}
    </motion.div>
  );
}
