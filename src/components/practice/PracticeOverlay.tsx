import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X } from '@phosphor-icons/react';
import { useStore, getTodayString } from '../../store';
import { pairKey } from '../../lib/pairs';
import type { Task } from '../../types';
import { OneMinuteChanges } from './OneMinuteChanges';
import { ChordTrainer } from './ChordTrainer';
import { SongPlayer } from './SongPlayer';
import './practice.css';

interface Props {
  task: Task;
  onClose: () => void;
}

export function PracticeOverlay({ task, onClose }: Props) {
  const recordDrillResult = useStore((s) => s.recordDrillResult);
  const setLastPair = useStore((s) => s.setLastPair);
  const lastPair = useStore((s) => s.accounts[s.currentAccountId]?.lastPair);
  const drill = task.drill;

  // Snapshot history once at mount so the in-session result can be compared
  // against the pre-session best (recordDrillResult mutates the store live).
  const { personalBest, series } = useMemo(() => {
    const acc = useStore.getState().accounts[useStore.getState().currentAccountId];
    const logs = Object.values(acc?.dailyLogs ?? {});
    const points = logs
      .filter((l) => typeof l.drillResults?.[task.id] === 'number')
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((l) => l.drillResults![task.id]);
    return {
      personalBest: points.reduce((m, v) => Math.max(m, v), 0),
      series: points,
    };
  }, [task.id]);

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

  return createPortal(
    <motion.div
      className="practice-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="practice-topbar">
        <span className="practice-eyebrow">{task.title}</span>
        <button className="practice-close" onClick={onClose} title="Exit (Esc)">
          <X size={20} weight="bold" />
        </button>
      </div>

      <div className="practice-body">
        {drill.kind === 'one-minute-changes' && (
          <OneMinuteChanges
            config={{ kind: 'one-minute-changes', durationSec: drill.durationSec }}
            chordPool={
              drill.chords?.length
                ? drill.chords
                : drill.chordFrom && drill.chordTo
                  ? [drill.chordFrom, drill.chordTo]
                  : undefined
            }
            defaultPair={
              lastPair ??
              (drill.chordFrom && drill.chordTo
                ? { from: drill.chordFrom, to: drill.chordTo }
                : undefined)
            }
            onSessionStart={(f, t) => setLastPair(f, t)}
            onResult={(cpm, f, t) => {
              recordDrillResult(getTodayString(), task.id, cpm, pairKey(f, t));
              setLastPair(f, t);
            }}
            onClose={onClose}
          />
        )}
        {drill.kind === 'chord-trainer' && (
          <ChordTrainer
            config={drill}
            personalBest={personalBest}
            series={series}
            onResult={(score) => recordDrillResult(getTodayString(), task.id, score)}
            onClose={onClose}
          />
        )}
        {drill.kind === 'song' && drill.songId && (
          <SongPlayer
            songId={drill.songId}
            onClose={onClose}
            onResult={(accuracy) => recordDrillResult(getTodayString(), task.id, accuracy)}
          />
        )}
      </div>
    </motion.div>,
    document.body,
  );
}
