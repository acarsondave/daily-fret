import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { CloseIcon } from '../icons';
import { useStore, getTodayString } from '../../store';
import { pairKey } from '../../lib/pairs';
import { taskDrillHistory } from '../../lib/drillStats';
import { drillSeries, planTempo, fixedTempo, type TempoPlan } from '../../lib/tempo';
import { timedBlocks } from '../../lib/coached';
import { useSongs } from '../../hooks/useSongs';
import { findSong } from '../../lib/songCatalog';
import type { Task } from '../../types';
import { OneMinuteChanges } from './OneMinuteChanges';
import { ChordTrainer } from './ChordTrainer';
import { ChordRotation } from './ChordRotation';
import { SongPlayer } from './SongPlayer';
import { TimedSegment } from './TimedSegment';
import { Metronome } from './Metronome';
import { CapoBadge } from './CapoBadge';
import './practice.css';

interface Props {
  task: Task;
  onClose: () => void;
}

export function PracticeOverlay({ task, onClose }: Props) {
  const recordMeasurement = useStore((s) => s.recordMeasurement);
  const recordTime = useStore((s) => s.recordTime);
  const settleTask = useStore((s) => s.settleTask);
  const setLastPair = useStore((s) => s.setLastPair);
  const lastPair = useStore((s) => s.accounts[s.currentAccountId]?.lastPair);
  const songs = useSongs();
  const drill = task.drill;

  // Snapshot history once at mount so the in-session result can be compared
  // against the pre-session best (recording mutates the store live).
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

  // A task with no drill is a timer: its blocks, run one after another, exactly
  // as the coached session would run them. This is what makes every task on the
  // day's list runnable, and it is why the list no longer has to ask.
  const blocks = useMemo(() => (drill ? [] : timedBlocks(task)), [drill, task]);
  const [blockIdx, setBlockIdx] = useState(0);
  const block = blocks[Math.min(blockIdx, Math.max(0, blocks.length - 1))];

  // When the run on screen began, so leaving half-way can say how long it ran.
  const runStartedAt = useRef(0);
  const songFinished = useRef(false);

  const today = getTodayString();
  const duration = drill?.durationSec ?? 60;
  const tempoKey = !drill
    ? `block-${blockIdx}`
    : drill.kind === 'one-minute-changes'
      ? explicitPairs.length
        ? `pair-${Math.min(pairIdx, explicitPairs.length - 1)}`
        : livePair
          ? pairKey(livePair.from, livePair.to)
          : 'no-pair'
      : task.id;

  // Same prescription the coached session uses, so a drill run from the task
  // list is the same practice, not a looser version of it.
  const tempoPlan = useMemo<TempoPlan | null>(() => {
    if (!drill) return fixedTempo(block?.bpm);
    const logs = useStore.getState().accounts[useStore.getState().currentAccountId]?.dailyLogs ?? {};
    if (drill.kind === 'one-minute-changes') {
      const pair = explicitPairs.length
        ? explicitPairs[Math.min(pairIdx, explicitPairs.length - 1)]
        : livePair;
      if (!pair) return fixedTempo(undefined);
      return planTempo(drillSeries(logs, pairKey(pair.from, pair.to), duration), today);
    }
    if (drill.kind === 'chord-trainer' || drill.kind === 'chord-rotation') {
      return planTempo(drillSeries(logs, task.id, duration), today);
    }
    const song = findSong(songs, drill.songId);
    return fixedTempo(
      song?.bpm,
      song?.bpm ? `${song.title} runs at about ${song.bpm} BPM. Tap start if you want it.` : undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tempoKey]);

  // Leaving is a thing that happened, and the record says so. A drill walked out
  // of half-way through was still time at the instrument; it is written as the
  // time it was, and it earns no completion, because nothing was measured.
  const leave = () => {
    const ranFor = runStartedAt.current ? (Date.now() - runStartedAt.current) / 1000 : 0;
    if (drill?.kind === 'song') {
      recordTime(today, task.id, {
        elapsedSeconds: ranFor,
        reachedEnd: songFinished.current,
        done: songFinished.current,
      });
      settleTask(today, task.id);
    } else if (drillLive) {
      recordTime(today, task.id, { elapsedSeconds: ranFor, reachedEnd: false, done: false });
    }
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') leave();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drillLive, blockIdx, pairIdx]);

  // The song player has no clock of its own; the overlay times it instead.
  useEffect(() => {
    if (drill?.kind === 'song') runStartedAt.current = Date.now();
  }, [drill?.kind]);

  // Stamped in an effect rather than in the handler, so the clock is read
  // outside render exactly like every other timer in this app.
  useEffect(() => {
    if (drillLive) runStartedAt.current = Date.now();
  }, [drillLive]);

  const beginDrill = () => setDrillLive(true);

  // One measured run has landed. Recording and settling are separate calls on
  // purpose: a task prescribing several pairs keeps every pair's number but is
  // only judged once, when its last pair is done.
  const measured = (value: number, resultKey?: string) => {
    recordMeasurement(today, task.id, value, resultKey);
    setDrillLive(false);
  };

  const finishBlock = (outcome: { elapsedSeconds: number; reachedEnd: boolean; done: boolean }) => {
    recordTime(today, task.id, outcome);
    if (blockIdx >= blocks.length - 1) {
      settleTask(today, task.id);
      onClose();
      return;
    }
    setBlockIdx((i) => i + 1);
  };

  if (!drill && !block) return null;

  return createPortal(
    <motion.div
      className="practice-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="practice-topbar">
        <span className="practice-eyebrow">
          {task.title}
          {blocks.length > 1 && ` · ${blockIdx + 1} / ${blocks.length}`}
        </span>
        <CapoBadge />
        <div className="practice-topbar-actions">
          <Metronome
            plan={tempoPlan}
            planKey={tempoKey}
            autoPlay={drill ? drillLive && drill.kind !== 'song' : true}
          />
          <button className="practice-close" onClick={leave} title="Exit (Esc)" aria-label="Exit this drill">
            <CloseIcon size={20} />
          </button>
        </div>
      </div>

      <div className="practice-body">
        {!drill && block && (
          <TimedSegment
            key={`block-${blockIdx}`}
            title={block.label}
            description={block.note}
            seconds={block.durationSec}
            pattern={block.pattern}
            nextLabel={blockIdx >= blocks.length - 1 ? 'Closing' : 'Next block'}
            onDone={finishBlock}
            onLeave={(outcome) => recordTime(today, task.id, outcome)}
          />
        )}

        {drill?.kind === 'one-minute-changes' && explicitPairs.length > 0 && (() => {
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
                beginDrill();
              }}
              onResult={(cpm, f, t) => {
                measured(cpm, pairKey(f, t));
                setLastPair(f, t);
              }}
              onNext={() => {
                if (!isLastPair) {
                  setPairIdx((i) => i + 1);
                  return;
                }
                settleTask(today, task.id);
                onClose();
              }}
              onClose={leave}
            />
          );
        })()}
        {drill?.kind === 'one-minute-changes' && explicitPairs.length === 0 && (
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
              beginDrill();
            }}
            onResult={(cpm, f, t) => {
              measured(cpm, pairKey(f, t));
              setLastPair(f, t);
              settleTask(today, task.id);
            }}
            onClose={leave}
          />
        )}
        {drill?.kind === 'chord-rotation' && (
          <ChordRotation
            config={drill}
            personalBest={personalBest}
            onSessionStart={beginDrill}
            onResult={(score) => {
              measured(score);
              settleTask(today, task.id);
            }}
            onClose={leave}
          />
        )}
        {drill?.kind === 'chord-trainer' && (
          <ChordTrainer
            config={drill}
            personalBest={personalBest}
            series={series}
            onSessionStart={beginDrill}
            onResult={(score) => {
              measured(score);
              settleTask(today, task.id);
            }}
            onClose={leave}
          />
        )}
        {drill?.kind === 'song' && drill.songId && (
          <SongPlayer
            songId={drill.songId}
            onFinish={() => {
              songFinished.current = true;
            }}
            onClose={leave}
          />
        )}
      </div>
    </motion.div>,
    document.body,
  );
}
