import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { CloseIcon } from '../icons';
import { useStore, getTodayString, drillLogsOf } from '../../store';
import { pairKey } from '../../lib/pairs';
import { chordKey, findKey, patternKey, poolKey, rotationRing, sweepKey, timingKey, trainerPool } from '../../lib/drillKeys';
import { deckOf, patternRuns } from '../../lib/patternDeck';
import { finderHistory } from '../../lib/finderHistory';
import { keyDrillHistory } from '../../lib/drillStats';
import { trainerBlockSeconds } from '../../lib/drills';
import { drillSeries, planTempo, fixedTempo, DEFAULT_PRACTICE_BPM, type TempoPlan } from '../../lib/tempo';
import { timedBlocks } from '../../lib/coached';
import type { DrillMeasurement, TimedOutcome } from '../../store/completion';
import { useSongs } from '../../hooks/useSongs';
import { findSong } from '../../lib/songCatalog';
import type { Task } from '../../types';
import { OneMinuteChanges } from './OneMinuteChanges';
import { ChordTrainer } from './ChordTrainer';
import { ChordRotation } from './ChordRotation';
import { StrumTiming } from './StrumTiming';
import { StrumPatterns } from './StrumPatterns';
import { NoteFinder } from './NoteFinder';
import { SongPlayer } from './SongPlayer';
import { TimedSegment } from './TimedSegment';
import { Metronome } from './Metronome';
import { CapoBadge } from './CapoBadge';
import { RecordingIndicator } from './RecordingIndicator';
import { useSessionRecording, type ActiveClip } from '../../media/useSessionRecording';
import './practice.css';

interface Props {
  task: Task;
  onClose: () => void;
}

export function PracticeOverlay({ task, onClose }: Props) {
  const recordMeasurements = useStore((s) => s.recordMeasurements);
  const recordNoteFinds = useStore((s) => s.recordNoteFinds);
  const recordTime = useStore((s) => s.recordTime);
  const settleTask = useStore((s) => s.settleTask);
  const setLastPair = useStore((s) => s.setLastPair);
  const lastPair = useStore((s) => s.accounts[s.currentAccountId]?.lastPair);
  const activeRoutineId = useStore((s) => s.accounts[s.currentAccountId]?.activeRoutineId ?? null);
  const songs = useSongs();
  const drill = task.drill;

  // The ring this rotation will actually turn, resolved once so the key the
  // result is filed under and the ring the drill cues are the same list.
  const ring = useMemo(
    () => (drill?.kind === 'chord-rotation' ? rotationRing(drill.chords) : null),
    [drill],
  );

  // Snapshot history once at mount so the in-session result can be compared
  // against the pre-session best (recording mutates the store live). Chord
  // Perfect reads its own, per pool, because its pool is editable on screen.
  const rotationBest = useMemo(() => {
    if (!ring) return 0;
    const state = useStore.getState();
    const acc = state.accounts[state.currentAccountId];
    if (!acc) return 0;
    return keyDrillHistory(drillLogsOf(acc), sweepKey(ring)).best;
  }, [ring]);

  // Same snapshot, for the tempo this timing block will run at. Keyed by the
  // bucketed BPM, so a series survives the small adjustments a player makes on
  // the slider (src/lib/drillKeys.ts).
  const timingBest = useMemo(() => {
    if (drill?.kind !== 'strum-timing') return 0;
    const state = useStore.getState();
    const acc = state.accounts[state.currentAccountId];
    if (!acc) return 0;
    return keyDrillHistory(drillLogsOf(acc), timingKey(drill.bpm ?? DEFAULT_PRACTICE_BPM)).best;
  }, [drill]);

  // The deck this task deals from, and what the player's own history says about
  // each card in it. Snapshotted at mount, before this run is recorded, so a
  // standing on the deck cannot move under the player mid-session.
  const patternDeck = useMemo(() => {
    if (drill?.kind !== 'strum-pattern') return [];
    const state = useStore.getState();
    const acc = state.accounts[state.currentAccountId];
    return deckOf(drill.patterns, {
      dailyLogs: acc ? drillLogsOf(acc) : {},
      bpm: drill.bpm ?? DEFAULT_PRACTICE_BPM,
    });
  }, [drill]);
  const patternHistory = useMemo(() => {
    if (drill?.kind !== 'strum-pattern') return {};
    const state = useStore.getState();
    const acc = state.accounts[state.currentAccountId];
    const logs = acc ? drillLogsOf(acc) : {};
    const at = drill.bpm ?? DEFAULT_PRACTICE_BPM;
    return Object.fromEntries(patternDeck.map((p) => [p, patternRuns(logs, p, at)]));
  }, [drill, patternDeck]);

  // The neck as it stands, and every run behind each rung of the ladder.
  // Snapshotted at mount, before this run is recorded, so neither the ladder nor
  // the wear on the neck can move under the player mid-session.
  const noteMap = useMemo(() => {
    if (drill?.kind !== 'note-finder') return {};
    const state = useStore.getState();
    return state.accounts[state.currentAccountId]?.noteMap ?? {};
  }, [drill]);
  const finderRuns = useMemo(() => {
    if (drill?.kind !== 'note-finder') return {};
    const state = useStore.getState();
    const acc = state.accounts[state.currentAccountId];
    return finderHistory(acc ? drillLogsOf(acc) : {});
  }, [drill]);

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
  // How the play-along ended, or null while it is still running. The record
  // running out and the player tapping Done both finish it, and only the first
  // is a clock the app watched reach its end.
  const songOutcome = useRef<'ended' | 'stopped' | null>(null);

  // The date this run records under, decided when the overlay opens and never
  // recomputed. Read on every render, a drill started at 23:59 measured against
  // one date and settled against the next after a re-render, and `settle` on a
  // day with no measurement returns the log unchanged: the run was never
  // recorded anywhere. A run belongs to the date it started.
  const [today] = useState(getTodayString);
  const duration = drill?.durationSec ?? 60;
  // The key this drill's history sits under, which is also what the prescribed
  // tempo has to be read from. Null for anything with no single series of its
  // own (a changes task fans out per pair, a song is never measured).
  const drillKey = useMemo(() => {
    if (drill?.kind === 'chord-trainer') return poolKey(trainerPool(drill.chords));
    if (ring) return sweepKey(ring);
    return null;
  }, [drill, ring]);
  // How long the drill on screen really runs for, which is what turns a stored
  // score into a per-minute rate. Chord Perfect is the one that differs from its
  // configured length: every shape gets a floor of its own, so a 90-second task
  // over five shapes runs 100 seconds, and reading its score against 90 had the
  // click asking for a pace eleven per cent above anything the player had done.
  const measuredSeconds = useMemo(() => {
    if (drill?.kind !== 'chord-trainer') return duration;
    return trainerBlockSeconds(duration, trainerPool(drill.chords).length);
  }, [drill, duration]);

  const tempoKey = !drill
    ? `block-${blockIdx}`
    : drill.kind === 'strum-timing'
      ? `timing-${drill.bpm ?? 'default'}`
      : drill.kind === 'strum-pattern'
      ? `pattern-${drill.bpm ?? 'default'}`
      : drill.kind === 'note-finder'
      ? `finder-${drill.rungId ?? 'auto'}`
      : drill.kind === 'one-minute-changes'
      ? explicitPairs.length
        ? `pair-${Math.min(pairIdx, explicitPairs.length - 1)}`
        : livePair
          ? pairKey(livePair.from, livePair.to)
          : 'no-pair'
      : drillKey ?? 'song';

  // Same prescription the coached session uses, so a drill run from the task
  // list is the same practice, not a looser version of it.
  const tempoPlan = useMemo<TempoPlan | null>(() => {
    if (!drill) return fixedTempo(block?.bpm);
    const state = useStore.getState();
    const acc = state.accounts[state.currentAccountId];
    const logs = acc ? drillLogsOf(acc) : {};
    // A timing drill's number is a percentage, not a change rate, so there is
    // nothing in its history that implies a next tempo. It states one, or takes
    // the standard practice click, and the player moves it when they are ready.
    if (drill.kind === 'strum-timing') {
      return fixedTempo(
        drill.bpm,
        `Hold ${drill.bpm ?? DEFAULT_PRACTICE_BPM} in 4/4. One down strum on every click.`,
      );
    }
    // The note finder has no tempo of its own and does not want one: a click
    // running under a question about where C is would be metronome practice
    // happening at the same time as note practice, and neither would get done.
    if (drill.kind === 'note-finder') {
      return fixedTempo(undefined, 'No click. This one is a question, not a pace.');
    }
    // Patterns state their tempo too. The click has to run unbroken through the
    // whole block, which is the thing the drill is about.
    if (drill.kind === 'strum-pattern') {
      return fixedTempo(
        drill.bpm,
        `Hold ${drill.bpm ?? DEFAULT_PRACTICE_BPM} in 4/4. The arm keeps moving through every slot.`,
      );
    }
    if (drill.kind === 'one-minute-changes') {
      const pair = explicitPairs.length
        ? explicitPairs[Math.min(pairIdx, explicitPairs.length - 1)]
        : livePair;
      if (!pair) return fixedTempo(undefined);
      return planTempo(drillSeries(logs, pairKey(pair.from, pair.to), duration), today);
    }
    if (drillKey) {
      return planTempo(drillSeries(logs, drillKey, measuredSeconds), today);
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
        reachedEnd: songOutcome.current === 'ended',
        done: songOutcome.current !== null,
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

  // What the camera should be filming right now, if the user has recording on.
  //
  // Stated as a value rather than driven by start/stop calls in each drill's
  // callbacks: this surface already knows exactly what is being played, and
  // deriving the clip from that is what stops a camera being left running over
  // the results card. Null means nothing is under way and nothing is filmed.
  const clip = useMemo<ActiveClip | null>(() => {
    const base = { date: today, taskId: task.id, routineId: activeRoutineId, label: task.title };
    if (!drill) return block ? { ...base, key: `block-${blockIdx}`, label: `${task.title} · ${block.label}` } : null;
    // The play-along has no start button of its own; the record runs from the
    // moment the surface opens, and so does the camera.
    if (drill.kind === 'song') return { ...base, key: 'song' };
    return drillLive ? { ...base, key: `drill-${tempoKey}` } : null;
  }, [drill, drillLive, block, blockIdx, tempoKey, task.id, task.title, today, activeRoutineId]);

  const recording = useSessionRecording(clip);

  const beginDrill = () => setDrillLive(true);

  // One measured run has landed. Recording and settling are separate calls on
  // purpose: a task prescribing several pairs keeps every pair's number but is
  // only judged once, when its last pair is done.
  const measured = (results: readonly DrillMeasurement[]) => {
    recordMeasurements(today, task.id, results);
    setDrillLive(false);
  };

  // A drill that ran with no microphone. It produced no number, so nothing goes
  // to drillResults; it produced a block of practice that ran to the end, which
  // is exactly what a timed task records, and that is what settles it.
  const timedRun = (outcome: TimedOutcome) => {
    recordTime(today, task.id, outcome);
    setDrillLive(false);
    settleTask(today, task.id);
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
          <RecordingIndicator
            rolling={recording.rolling}
            elapsedMs={recording.elapsedMs}
            failure={recording.failure}
            onDismissFailure={recording.dismissFailure}
          />
          <Metronome
            plan={tempoPlan}
            planKey={tempoKey}
            // Neither the play-along nor the note finder has a pace of its own:
            // one runs to a record and the other is a question. The panel is
            // still there for a player who wants a click; it just does not start
            // one over them.
            autoPlay={drill ? drillLive && drill.kind !== 'song' && drill.kind !== 'note-finder' : true}
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
                measured([{ key: pairKey(f, t), value: cpm }]);
                setLastPair(f, t);
              }}
              onTimedRun={(outcome) => {
                recordTime(today, task.id, outcome);
                setDrillLive(false);
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
              measured([{ key: pairKey(f, t), value: cpm }]);
              setLastPair(f, t);
              settleTask(today, task.id);
            }}
            onTimedRun={timedRun}
            onClose={leave}
          />
        )}
        {drill?.kind === 'chord-rotation' && ring && (
          <ChordRotation
            config={{ ...drill, chords: ring }}
            personalBest={rotationBest}
            onSessionStart={beginDrill}
            onResult={({ ring: turned, changes }) => {
              measured([{ key: sweepKey(turned), value: changes }]);
              settleTask(today, task.id);
            }}
            onTimedRun={timedRun}
            onClose={leave}
          />
        )}
        {drill?.kind === 'chord-trainer' && (
          <ChordTrainer
            config={drill}
            onSessionStart={beginDrill}
            onResult={({ perChord, total }) => {
              // The pool's total and each shape's own count. Both are written,
              // because a day's best per shape and a day's best block score come
              // from different runs and neither can be recovered from the other.
              measured([
                { key: poolKey(perChord.map((p) => p.chord)), value: total },
                ...perChord.map((p) => ({ key: chordKey(p.chord), value: p.placements })),
              ]);
              settleTask(today, task.id);
            }}
            onTimedRun={timedRun}
            onClose={leave}
          />
        )}
        {drill?.kind === 'strum-timing' && (
          <StrumTiming
            config={drill}
            bpm={tempoPlan?.bpm ?? DEFAULT_PRACTICE_BPM}
            personalBest={timingBest}
            onSessionStart={beginDrill}
            onResult={({ bpm, summary }) => {
              // A run that could not be measured still reports, with a score of
              // zero, so the day records that the drill ran and heard nothing
              // rather than looking as though it was never opened.
              measured([{ key: timingKey(bpm), value: summary.score }]);
              settleTask(today, task.id);
            }}
            onClose={leave}
          />
        )}
        {drill?.kind === 'strum-pattern' && (
          <StrumPatterns
            config={drill}
            bpm={tempoPlan?.bpm ?? DEFAULT_PRACTICE_BPM}
            deck={patternDeck}
            history={patternHistory}
            onSessionStart={beginDrill}
            onResult={({ bpm, deals }) => {
              // One measurement per deal, each under the pattern it was played
              // on. A block with nothing in it still reports, under the first
              // card of the deck and at zero, so the day records that the drill
              // ran and heard nothing rather than looking unopened.
              measured(
                deals.length
                  ? deals.map((d) => ({
                      key: patternKey(d.pattern, bpm),
                      value: d.score,
                      settledBar: d.settledBar,
                    }))
                  : [{ key: patternKey(patternDeck[0] ?? 'D-D-D-D-', bpm), value: 0 }],
              );
              settleTask(today, task.id);
            }}
            onClose={leave}
          />
        )}
        {drill?.kind === 'note-finder' && (
          <NoteFinder
            config={drill}
            map={noteMap}
            history={finderRuns}
            onSessionStart={beginDrill}
            onResult={(run) => {
              // The count and the neck are written together: one run produced
              // both, and a neck that filled in without a result behind it would
              // be a record of practice the day cannot show.
              measured([
                {
                  key: findKey(run.rungId),
                  value: run.finds,
                  durationSec: duration,
                  findMs: run.findMs,
                  // Answers played to an answer the drill had lit. Never part of
                  // the count; they are how the day tells a run that recalled
                  // nothing from a microphone that heard nothing.
                  uncounted: run.shown,
                },
              ]);
              recordNoteFinds(run.found);
              settleTask(today, task.id);
            }}
            onTimedRun={timedRun}
            onClose={leave}
          />
        )}
        {drill?.kind === 'song' && drill.songId && (
          <SongPlayer
            songId={drill.songId}
            onFinish={(reachedEnd) => {
              songOutcome.current = reachedEnd ? 'ended' : 'stopped';
            }}
            onClose={leave}
          />
        )}
      </div>
    </motion.div>,
    document.body,
  );
}
