import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckIcon, PauseIcon, PlayIcon, SkipIcon } from '../icons';
import { ProgressRing } from './ProgressRing';
import { StrumRow } from './StrumRow';
import { TabStaff } from './TabStaff';
import { looksLikeTab } from '../../lib/tab';
import { sfx } from '../../audio/sfx';
import type { TimedOutcome } from '../../store/completion';

const AUTO_ADVANCE_SECONDS = 5;

interface Props {
  title: string;
  description?: string;
  seconds: number;
  pattern?: string; // optional strum pattern to show as arrow art
  onDone: (outcome: TimedOutcome) => void; // advance, carrying what happened
  // Fired instead of onDone when the block is left before it ends (the session
  // closed, the overlay exited). Walking out is a thing that happened too, and
  // the time it ran for is the only honest thing to say about it.
  onLeave?: (outcome: TimedOutcome) => void;
  onFinish?: () => void; // fired once the moment the block runs out
  nextLabel?: string; // what comes after, e.g. "Rest" or "Finishing"
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

// A plain timed practice block, used both inside Coached mode and when a task is
// started straight from the day's list. It is the whole basis on which a task
// the microphone cannot hear gets recorded: the app cannot know a spider walk
// was good, but it can honestly witness that its clock ran, and for how long.
//
// Skipping is not doing. A skipped block still records the seconds it really
// ran, and offers to be counted anyway rather than assuming either way.
export function TimedSegment({ title, description, seconds, pattern, onDone, onLeave, onFinish, nextLabel = 'Up next' }: Props) {
  const [left, setLeft] = useState(seconds);
  const [paused, setPaused] = useState(false);
  // null while the block is still running; set once, and it holds the truth
  // about how the block ended for the rest of this component's life.
  const [ended, setEnded] = useState<{ elapsed: number; reachedEnd: boolean } | null>(null);
  const [counted, setCounted] = useState(false);
  const [advanceLeft, setAdvanceLeft] = useState(AUTO_ADVANCE_SECONDS);
  const leftRef = useRef(seconds);
  // Set the instant the block ends, by any route. The unmount cleanup below
  // reads it to tell "handed over" apart from "walked out of".
  const endedRef = useRef(false);
  // Read at the moment the block hands over rather than closed over, so tapping
  // "Count it" during the countdown lands without restarting the countdown.
  const countedRef = useRef(false);

  useEffect(() => {
    if (paused || ended) return;
    // Recompute the deadline each (re)start from the remaining time so pausing
    // and resuming works. Date.now() lives in the effect, never in render.
    const deadline = Date.now() + leftRef.current * 1000;
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      leftRef.current = remaining;
      setLeft(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        endedRef.current = true;
        setEnded({ elapsed: seconds, reachedEnd: true });
      }
    }, 250);
    return () => clearInterval(id);
  }, [paused, ended, seconds]);

  // Once the block is over, roll into the next segment hands-free. A skipped
  // block advances on the same clock rather than stopping to ask: the record
  // already says what happened, and "count it" is an offer, not a question.
  useEffect(() => {
    if (!ended) return;
    if (ended.reachedEnd) {
      sfx.complete();
      onFinish?.();
    }
    const deadline = Date.now() + AUTO_ADVANCE_SECONDS * 1000;
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setAdvanceLeft(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        onDone({
          elapsedSeconds: ended.elapsed,
          reachedEnd: ended.reachedEnd,
          done: ended.reachedEnd || countedRef.current,
        });
      }
    }, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended]);

  const countItAnyway = () => {
    countedRef.current = true;
    setCounted(true);
  };

  // Report the time the clock really ran if this block is torn down before it
  // ends. Held in a ref so the cleanup reads the latest handler rather than the
  // one this effect closed over on mount.
  const leaveRef = useRef(onLeave);
  useEffect(() => {
    leaveRef.current = onLeave;
  });
  useEffect(() => {
    return () => {
      if (endedRef.current) return;
      leaveRef.current?.({
        elapsedSeconds: Math.max(0, seconds - leftRef.current),
        reachedEnd: false,
        done: false,
      });
    };
  }, [seconds]);

  const endBlock = (next: { elapsed: number; reachedEnd: boolean }) => {
    endedRef.current = true;
    setEnded(next);
  };

  const skip = () => endBlock({ elapsed: Math.max(0, seconds - leftRef.current), reachedEnd: false });
  const togglePause = () => setPaused((p) => !p);

  const progress = seconds > 0 ? (seconds - left) / seconds : 1;

  if (ended) {
    return (
      <motion.div
        className="om-results"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="coach-intro-title">{title}</div>
        {ended.reachedEnd ? (
          <div className="om-caption">Block complete · {fmt(ended.elapsed)}</div>
        ) : (
          <>
            <div className="om-caption">
              {fmt(ended.elapsed)} of {fmt(seconds)}
            </div>
            {counted ? (
              <div className="timed-counted">
                <CheckIcon size={16} strokeWidth={2.6} /> Counted as done
              </div>
            ) : (
              <button className="practice-btn ghost timed-count-btn" onClick={countItAnyway}>
                Count it as done
              </button>
            )}
          </>
        )}
        <div className="coach-advance">
          <span className="coach-advance-label">{nextLabel} in</span>
          <span className="coach-advance-count">{advanceLeft}</span>
        </div>
      </motion.div>
    );
  }

  return (
    <>
      <div className="practice-mode is-chord">{title}</div>
      {pattern && <StrumRow strum={pattern} size={18} />}
      {/* A riff's note is a tab staff and gets rendered as one. The old test was
          `description.includes('|')`, which also fired on any prose containing a
          pipe; looksLikeTab needs two actual staff lines. */}
      {description &&
        (looksLikeTab(description) ? (
          <TabStaff source={description} />
        ) : (
          <p className="timed-desc">{description}</p>
        ))}
      <ProgressRing progress={progress} className="om-ring">
        <div className="om-ring-value">{fmt(left)}</div>
        <div className="om-caption">remaining</div>
      </ProgressRing>
      <div className="om-actions">
        <button className="practice-btn ghost" onClick={togglePause}>
          {paused ? <PlayIcon size={18} /> : <PauseIcon size={18} />}
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button className="practice-btn primary" onClick={skip}>
          <SkipIcon size={18} /> Skip
        </button>
      </div>
    </>
  );
}
