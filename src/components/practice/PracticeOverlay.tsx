import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X } from '@phosphor-icons/react';
import { useStore, getTodayString } from '../../store';
import type { Task } from '../../types';
import { FreePlay } from './FreePlay';
import { OneMinuteChanges } from './OneMinuteChanges';
import './practice.css';

interface Props {
  task: Task;
  onClose: () => void;
}

export function PracticeOverlay({ task, onClose }: Props) {
  const recordDrillResult = useStore((s) => s.recordDrillResult);
  const drill = task.drill;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  if (!drill) return null;

  const label = drill.kind === 'free-play' ? 'Free Play' : '1-Minute Changes';

  return createPortal(
    <motion.div
      className="practice-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="practice-topbar">
        <span className="practice-eyebrow">{task.title} · {label}</span>
        <button className="practice-close" onClick={onClose} title="Exit (Esc)">
          <X size={20} weight="bold" />
        </button>
      </div>

      <div className="practice-body">
        {drill.kind === 'free-play' ? (
          <FreePlay />
        ) : (
          <OneMinuteChanges
            config={drill}
            onResult={(cpm) => recordDrillResult(getTodayString(), task.id, cpm)}
            onClose={onClose}
          />
        )}
      </div>
    </motion.div>,
    document.body,
  );
}
