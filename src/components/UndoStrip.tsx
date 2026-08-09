import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { RetryIcon } from './icons';
import { useStore } from '../store';
import { useUndoStore, UNDO_WINDOW_MS, type Deletion } from '../store/undo';
import './UndoStrip.css';

/**
 * The offer to put a deleted thing back.
 *
 * Not a toast. A toast appears somewhere else on the screen and takes the place
 * of the thing it is talking about with a sentence about it; this sits in the
 * gap the deletion left, so the answer to "what did I just remove, and from
 * where" is the strip's own position. It also means no new overlay layer, no
 * stacking rules, and no fight with the footer.
 */
export function UndoStrip({ deletion }: { deletion: Deletion }) {
  const restoreTask = useStore((s) => s.restoreTask);
  const restoreRoutine = useStore((s) => s.restoreRoutine);
  const take = useUndoStore((s) => s.take);
  const dismiss = useUndoStore((s) => s.dismiss);
  const [leaving, setLeaving] = useState(false);

  // The store's actions are stable, so this can depend on `dismiss` directly and
  // the timer is set exactly once per offer.
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(deletion.id), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [deletion.id, dismiss]);

  const undo = () => {
    const taken = take(deletion.id);
    if (!taken) return;
    setLeaving(true);
    if (taken.kind === 'task') restoreTask(taken.routineId, taken.task, taken.index);
    else restoreRoutine(taken.routine, taken.index);
  };

  return (
    <motion.div
      className="undo-strip"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: leaving ? 0 : 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <span className="undo-strip-text">
        Removed <strong>{deletion.label}</strong>
      </span>
      {/* The window is visible rather than implied: a countdown the user can see
          is the difference between "I have a moment" and "did I miss it". */}
      <span className="undo-strip-track" aria-hidden="true">
        <span className="undo-strip-fill" style={{ animationDuration: `${UNDO_WINDOW_MS}ms` }} />
      </span>
      <button type="button" className="undo-strip-action" onClick={undo}>
        <RetryIcon size={15} />
        <span>Undo</span>
      </button>
    </motion.div>
  );
}
