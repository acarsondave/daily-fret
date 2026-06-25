import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Pause, Play, ArrowRight, SkipForward } from '@phosphor-icons/react';
import { ProgressRing } from './ProgressRing';

interface Props {
  title: string;
  description?: string;
  seconds: number;
  onDone: () => void; // advance to the next segment
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

// A plain timed practice block used inside Coached mode for tasks that aren't
// interactive drills (e.g. "Spider Exercises", a lesson). Counts down, can be
// paused/skipped, and reports done so the session advances.
export function TimedSegment({ title, description, seconds, onDone }: Props) {
  const [left, setLeft] = useState(seconds);
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
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
        <div className="om-actions">
          <button className="practice-btn primary" onClick={onDone} autoFocus>
            Next <ArrowRight size={18} weight="bold" />
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <>
      <div className="practice-mode is-chord">{title}</div>
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
