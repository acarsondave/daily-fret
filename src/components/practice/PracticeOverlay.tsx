import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X } from '@phosphor-icons/react';
import { useStore, getTodayString } from '../../store';
import { pairKey } from '../../lib/pairs';
import { taskDrillHistory } from '../../lib/drillStats';
import type { Task } from '../../types';
import { OneMinuteChanges } from './OneMinuteChanges';
import { ChordTrainer } from './ChordTrainer';
import { ChordRotation } from './ChordRotation';
import { SongPlayer } from './SongPlayer';
import { Metronome } from './Metronome';
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
  const { best: personalBest, series } = useMemo(() => {
    const acc = useStore.getState().accounts[useStore.getState().currentAccountId];
    return taskDrillHistory(acc?.dailyLogs ?? {}, task.id);
  }, [task.id]);

  // A changes drill can prescribe exact pairs (Justin's Module 3 set). When it
  // does, walk them in order here — the same experience as Coached mode — instead
  // of the free pair-picker. Position in that walk:
  const explicitPairs = useMemo(
    () =>
      drill?.kind === 'one-minute-changes'
        ? (drill.pairs ?? []).filter((p) => p.from && p.to && p.from !== p.to)
        : [],
    [drill],
  );
  const [pairIdx, setPairIdx] = useState(0);

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
        <div className="practice-topbar-actions">
          <Metronome />
          <button className="practice-close" onClick={onClose} title="Exit (Esc)">
            <X size={20} weight="bold" />
          </button>
        </div>
      </div>

      <div className="practice-body">
        {drill.kind === 'one-minute-changes' && explicitPairs.length > 0 && (() => {
          const idx = Math.min(pairIdx, explicitPairs.length - 1);
          const pair = explicitPairs[idx];
          const isLastPair = idx >= explicitPairs.length - 1;
          return (
            <OneMinuteChanges
              key={`pair-${idx}`}
              config={{ kind: 'one-minute-changes', chordFrom: pair.from, chordTo: pair.to, durationSec: drill.durationSec }}
              autoStart
              autoAdvance
              nextLabel={isLastPair ? 'Done' : 'Next pair'}
              onSessionStart={(f, t) => setLastPair(f, t)}
              onResult={(cpm, f, t) => {
                recordDrillResult(getTodayString(), task.id, cpm, pairKey(f, t));
                setLastPair(f, t);
              }}
              onNext={() => (isLastPair ? onClose() : setPairIdx((i) => i + 1))}
              onClose={onClose}
            />
          );
        })()}
        {drill.kind === 'one-minute-changes' && explicitPairs.length === 0 && (
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
        {drill.kind === 'chord-rotation' && (
          <ChordRotation
            config={drill}
            personalBest={personalBest}
            onResult={(score) => recordDrillResult(getTodayString(), task.id, score)}
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
          <SongPlayer songId={drill.songId} playOnly={drill.playOnly} onClose={onClose} />
        )}
      </div>
    </motion.div>,
    document.body,
  );
}
