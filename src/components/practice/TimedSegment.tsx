import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Pause, Play, SkipForward } from '@phosphor-icons/react';
import { ProgressRing } from './ProgressRing';
import { StrumRow } from './StrumRow';
import { sfx } from '../../audio/sfx';

const AUTO_ADVANCE_SECONDS = 5;

interface Props {
  title: string;
  description?: string;
  seconds: number;
  pattern?: string; // optional strum pattern to show as arrow art
  onDone: () => void; // advance to the next segment
  onFinish?: () => void; // fired once the moment the block completes
  nextLabel?: string; // what comes after, e.g. "Rest" or "Finishing"
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

// A plain timed practice block used inside Coached mode for tasks that aren't
// interactive drills (e.g. "Spider Exercises", a lesson). Counts down, can be
// paused/skipped, and reports done so the session advances.
export function TimedSegment({ title, description, seconds, pattern, onDone, onFinish, nextLabel = 'Up next' }: Props) {
  const [left, setLeft] = useState(seconds);
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const [advanceLeft, setAdvanceLeft] = useState(AUTO_ADVANCE_SECONDS);
  const leftRef = useRef(seconds);

  useEffect(() => {
    if (paused || finished) return;
    // Recompute the deadline each (re)start from the remaining time so pausing
    // and resuming works. Date.now() lives in the effect, never in render.
    const deadline = Date.now() + leftRef.current * 1000;
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      leftRef.current = remaining;
      setLeft(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        setFinished(true);
      }
    }, 250);
    return () => clearInterval(id);
  }, [paused, finished]);

  // Once the block is done, roll into the next segment hands-free.
  useEffect(() => {
    if (!finished) return;
    sfx.complete();
    onFinish?.();
    const deadline = Date.now() + AUTO_ADVANCE_SECONDS * 1000;
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setAdvanceLeft(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        onDone();
      }
    }, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  const togglePause = () => setPaused((p) => !p);

  const progress = seconds > 0 ? (seconds - left) / seconds : 1;

  if (finished) {
    return (
      <motion.div
        className="om-results"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="coach-intro-title">{title}</div>
        <div className="om-caption">Block complete</div>
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
      {description && <p className="timed-desc">{description}</p>}
      <ProgressRing progress={progress} className="om-ring">
        <div className="om-ring-value">{fmt(left)}</div>
        <div className="om-caption">remaining</div>
      </ProgressRing>
      <div className="om-actions">
        <button className="practice-btn ghost" onClick={togglePause}>
          {paused ? <Play size={18} weight="fill" /> : <Pause size={18} weight="fill" />}
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button className="practice-btn primary" onClick={() => setFinished(true)}>
          <SkipForward size={18} weight="fill" /> Skip
        </button>
      </div>
    </>
  );
}
