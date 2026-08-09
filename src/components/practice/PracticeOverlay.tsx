import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { CloseIcon } from '../icons';
import { useStore, getTodayString } from '../../store';
import { pairKey } from '../../lib/pairs';
import { taskDrillHistory } from '../../lib/drillStats';
import { drillSeries, planTempo, fixedTempo, type TempoPlan } from '../../lib/tempo';
import { getSong } from '../../data/songs';
import type { Task } from '../../types';
import { OneMinuteChanges } from './OneMinuteChanges';
import { ChordTrainer } from './ChordTrainer';
import { ChordRotation } from './ChordRotation';
import { SongPlayer } from './SongPlayer';
import { Metronome } from './Metronome';
import { CapoBadge } from './CapoBadge';
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
  // The click only runs while a drill is actually under way, never over the
  // setup screen or the results card.
  const [drillLive, setDrillLive] = useState(false);
  // Which pair the free picker settled on, so its tempo comes from that pair's
  // own history rather than a guess.
  const [livePair, setLivePair] = useState(lastPair);

  const duration = drill?.durationSec ?? 60;
  const tempoKey =
    drill?.kind === 'one-minute-changes'
      ? explicitPairs.length
        ? `pair-${Math.min(pairIdx, explicitPairs.length - 1)}`
        : livePair
          ? pairKey(livePair.from, livePair.to)
          : 'no-pair'
      : task.id;

  // Same prescription the coached session uses, so a drill run from the task
  // list is the same practice, not a looser version of it.
  const tempoPlan = useMemo<TempoPlan | null>(() => {
    if (!drill) return null;
    const logs = useStore.getState().accounts[useStore.getState().currentAccountId]?.dailyLogs ?? {};
    if (drill.kind === 'one-minute-changes') {
      const pair = explicitPairs.length
        ? explicitPairs[Math.min(pairIdx, explicitPairs.length - 1)]
        : livePair;
      if (!pair) return fixedTempo(undefined);
      return planTempo(drillSeries(logs, pairKey(pair.from, pair.to), duration), getTodayString());
    }
    if (drill.kind === 'chord-trainer' || drill.kind === 'chord-rotation') {
      return planTempo(drillSeries(logs, task.id, duration), getTodayString());
    }
    const song = getSong(drill.songId);
    return fixedTempo(
      song?.bpm,
      song?.bpm ? `${song.title} runs at about ${song.bpm} BPM. Tap start if you want it.` : undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tempoKey]);

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
        <CapoBadge />
        <div className="practice-topbar-actions">
          <Metronome
            plan={tempoPlan}
            planKey={tempoKey}
            autoPlay={drillLive && drill.kind !== 'song'}
          />
          <button className="practice-close" onClick={onClose} title="Exit (Esc)" aria-label="Exit this drill">
            <CloseIcon size={20} />
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
              onSessionStart={(f, t) => {
                setLastPair(f, t);
                setDrillLive(true);
              }}
              onResult={(cpm, f, t) => {
                recordDrillResult(getTodayString(), task.id, cpm, pairKey(f, t));
                setLastPair(f, t);
                setDrillLive(false);
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
            onSessionStart={(f, t) => {
              setLastPair(f, t);
              setLivePair({ from: f, to: t });
              setDrillLive(true);
            }}
            onResult={(cpm, f, t) => {
              recordDrillResult(getTodayString(), task.id, cpm, pairKey(f, t));
              setLastPair(f, t);
              setDrillLive(false);
            }}
            onClose={onClose}
          />
        )}
        {drill.kind === 'chord-rotation' && (
          <ChordRotation
            config={drill}
            personalBest={personalBest}
            onSessionStart={() => setDrillLive(true)}
            onResult={(score) => {
              recordDrillResult(getTodayString(), task.id, score);
              setDrillLive(false);
            }}
            onClose={onClose}
          />
        )}
        {drill.kind === 'chord-trainer' && (
          <ChordTrainer
            config={drill}
            personalBest={personalBest}
            series={series}
            onSessionStart={() => setDrillLive(true)}
            onResult={(score) => {
              recordDrillResult(getTodayString(), task.id, score);
              setDrillLive(false);
            }}
            onClose={onClose}
          />
        )}
        {drill.kind === 'song' && drill.songId && (
          <SongPlayer songId={drill.songId} onClose={onClose} />
        )}
      </div>
    </motion.div>,
    document.body,
  );
}
