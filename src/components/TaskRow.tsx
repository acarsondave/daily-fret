import { useState, useRef, useEffect, useMemo, memo } from 'react';
import { useUndoStore } from '../store/undo';
import { useStore, getTodayString, drillLogsOf, useDrillLogs } from '../store';
import {
  CheckIcon,
  CircleIcon,
  TrashIcon,
  PencilIcon,
  CloseIcon,
  MicIcon,
  PlayIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  PlusIcon,
} from './icons';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { chordPairs, pairKey } from '../lib/pairs';
import { findKey, poolKey, rotationRing, sweepKey, trainerPool } from '../lib/drillKeys';
import { bestAcrossDays, bestOnDay, runsOnDay } from '../lib/drillStats';
import { finderHistory } from '../lib/finderHistory';
import { currentRung } from '../lib/noteFinder';
import { sanitizeMinutes, formatDuration } from '../lib/coached';
import { looksLikeTab } from '../lib/tab';
// One definition of what each drill's number means, shared with Progress.
import { DRILL_UNIT, DRILL_LABEL } from '../lib/drills';
import { SongPicker } from './SongPicker';
import { useSongs } from '../hooks/useSongs';
import { StrumPatternSelect } from './StrumPatternSelect';
import type { DrillConfig, DrillKind, Task, TaskRecord, TimedBlock } from '../types';
import './TaskRow.css';
import './drill-fields.css';

const DRILL_CHORDS = ['A', 'C', 'D', 'E', 'G', 'Am', 'Dm', 'Em', 'F'];

// Pull the bare minute digits out of a (possibly legacy) duration label.
const durationDigits = (d?: string) => (d ? d.match(/\d+/)?.[0] ?? '' : '');

const clock = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** A timed task that earned its completion by running its own clock out. */
function clockRanOut(record: TaskRecord | undefined, isCompleted: boolean): boolean {
  return isCompleted && record?.evidence === 'timed' && record.ranToEnd === true;
}

/**
 * The task's planned time, for the trailing chip.
 *
 * A multi-block task carries its minutes in the blocks rather than in a duration
 * label, and the chip is where a timed task's state is now read, so it has to be
 * derivable either way or a block task would complete with nothing on the row
 * saying by what.
 */
function plannedTime(duration: string | undefined, blocks: TimedBlock[] | undefined): string | null {
  const stated = formatDuration(duration);
  if (stated) return stated;
  const seconds = blocks?.reduce((total, block) => total + block.durationSec, 0) ?? 0;
  if (seconds <= 0) return null;
  if (seconds < 60) return clock(seconds);
  const minutes = Math.round(seconds / 60);
  return `${minutes} min${minutes === 1 ? '' : 's'}`;
}

/**
 * What the app can say about this task today, in the app's own voice.
 *
 * There is one rule running through all of it: never say more than was
 * witnessed. A measurement names its number, a timer names its minutes, and the
 * user's own word is attributed to them rather than folded in with the rest.
 * Returns null when the app has nothing to report, which is not the same as
 * reporting that nothing happened.
 */
function evidenceLine(
  record: TaskRecord | undefined,
  isCompleted: boolean,
  todayValue: number | null,
  unit: string,
  runs: number,
): string | null {
  if (!record) return null;
  if (record.evidence === 'measured') {
    const measure = todayValue === null ? 'Heard' : `${todayValue}${unit ? ` ${unit}` : ''}`;
    const when = isCompleted ? `${measure} today` : `${measure} so far`;
    // Two runs at the same number is a different fact from one, and it is the
    // one that says the playing is repeatable rather than lucky.
    return runs > 1 ? `${when} · ${runs} runs` : when;
  }
  if (record.evidence === 'timed') {
    const spent = clock(record.seconds ?? 0);
    // Part-way through, the clock and the plan are different numbers, and the
    // difference is the whole point of saying it.
    if (!isCompleted) return `${spent} so far`;
    // Once the clock has run out they are the same number, and the row was
    // printing it twice: "5:00 practised" on the left against a planned "5 mins"
    // on the right. Running to the end *is* the completion condition, so the
    // planned time carries it, marked as spent. See the trailing chip below.
    if (record.ranToEnd) return null;
    // Not the same fact. The clock stopped short and the player counted the
    // block anyway, so both the time it really ran and whose word it rests on
    // have to stay on the row.
    return `${spent} practised, counted by you`;
  }
  if (record.evidence === 'silent') return 'Ran, nothing heard';
  return record.stated ? 'Marked done by you' : null;
}

interface TaskRowProps {
  routineId: string;
  taskId: string;
  title: string;
  description?: string;
  duration?: string;
  drill?: DrillConfig;
  blocks?: TimedBlock[];
  index: number;
  total: number;
  onStart?: (task: Task) => void;
}

export const TaskRow = memo(function TaskRow({ routineId, taskId, title, description, duration, drill, blocks, index, total, onStart }: TaskRowProps) {
  const today = getTodayString();
  // Select each action on its own — Zustand returns the *same* function
  // reference every render, so this row no longer subscribes to the whole store
  // (a bare `useStore()` did, re-rendering every row on any state change).
  const markTaskDone = useStore((s) => s.markTaskDone);
  const clearTaskRecord = useStore((s) => s.clearTaskRecord);
  const deleteTask = useStore((s) => s.deleteTask);
  const updateTask = useStore((s) => s.updateTask);
  const moveTask = useStore((s) => s.moveTask);

  // Subscribe narrowly to just this task's completion and best result so one
  // task toggling doesn't re-render every other row (these return primitives,
  // so unrelated mutations don't trigger a render here).
  const isCompleted = useStore(
    (s) => s.accounts[s.currentAccountId]?.dailyLogs?.[today]?.completedTaskIds?.includes(taskId) ?? false,
  );

  // The storage keys this task's results live under. Every one of them names
  // what the drill plays rather than the row it is played from, so the badge
  // survives a rename or a rebuild (see lib/drillKeys.ts). Chord Perfect reports
  // its block score against the pool it drills; the per-shape counts have their
  // own keys and belong on Progress, not on a row summarising one task.
  // Read whole rather than per day: the rung a note finder task will run at is a
  // question about the last few runs at every rung, not about today.
  const allLogs = useDrillLogs();
  const resultKeys = useMemo(() => {
    if (!drill) return [] as string[];
    if (drill.kind === 'chord-trainer') return [poolKey(trainerPool(drill.chords))];
    if (drill.kind === 'chord-rotation') return [sweepKey(rotationRing(drill.chords))];
    if (drill.kind === 'note-finder') {
      // Whatever rung the task pins, or the one its own history puts it on.
      // Read here rather than guessed, so the row's best is the best at the
      // level it will actually run, not the best at some other level.
      return [findKey(drill.rungId ?? currentRung(finderHistory(allLogs)).id)];
    }
    if (drill.kind === 'song') return [] as string[];
    const chords = drill.chords?.length
      ? drill.chords
      : drill.chordFrom && drill.chordTo
        ? [drill.chordFrom, drill.chordTo]
        : [];
    return chordPairs(chords).map((p) => pairKey(p.from, p.to));
  }, [drill, allLogs]);

  // Read through lib/drillStats rather than by looking each key up in the day.
  // A stored key states the window a count was taken over where the run knew it
  // (lib/drillWindow.ts), so a direct lookup misses everything the note finder
  // has ever recorded: it is the one drill that reports its own block length, so
  // its numbers live under `find:<rung>@60` and the row asking for `find:<rung>`
  // found none of them. That row then said "Heard today" against a run it had
  // the count for, and never showed a best.
  const bestResult = useStore((s) => {
    if (resultKeys.length === 0) return null;
    const acc = s.accounts[s.currentAccountId];
    return acc ? bestAcrossDays(drillLogsOf(acc), resultKeys) : null;
  });

  // Today's number, which is what the row reports back. The chip beside it is
  // the all-time best; conflating the two was how "your best" ended up standing
  // in for "what happened just now".
  const todayResult = useStore((s) => {
    if (resultKeys.length === 0) return null;
    const acc = s.accounts[s.currentAccountId];
    return acc ? bestOnDay(drillLogsOf(acc)[today], resultKeys) : null;
  });

  // The record is a stable object reference until this task's day changes, so
  // subscribing to it does not re-render the row on unrelated store writes.
  const record = useStore(
    (s) => s.accounts[s.currentAccountId]?.dailyLogs?.[today]?.taskRecords?.[taskId],
  );

  const todayRuns = useStore((s) => {
    if (resultKeys.length === 0) return 0;
    const acc = s.accounts[s.currentAccountId];
    return acc ? runsOnDay(drillLogsOf(acc)[today], resultKeys) : 0;
  });

  const line = evidenceLine(
    record,
    isCompleted,
    todayResult,
    drill ? DRILL_UNIT[drill.kind] : '',
    todayRuns,
  );

  // A block the app timed to the end. The planned time on the right reports it,
  // rather than a second line on the left repeating the same number.
  const timeSpent = clockRanOut(record, isCompleted);
  const planned = plannedTime(duration, blocks);
  // Screen readers get the fact in words either way: a chip that carries state
  // through color alone says nothing to a keyboard or a voice.
  const spoken = line ?? (timeSpent && planned ? `${planned} practised` : null);

  // A completion resting on nothing but the player's word. Kept visibly apart
  // from one the app measured, because the two mean different things and the
  // whole point of this is that the app stops pretending they are the same.
  const restsOnWord = isCompleted && !!record?.stated && !record?.evidence;

  // Today's number and the all-time best being the same number does not need
  // saying twice; when they differ, the best is the context.
  const showBest =
    !!drill &&
    typeof bestResult === 'number' &&
    !(record?.evidence === 'measured' && bestResult === todayResult);

  // The moment a task completes itself is worth marking once, then letting go.
  const [justCompleted, setJustCompleted] = useState(false);
  const wasCompleted = useRef(isCompleted);
  useEffect(() => {
    if (isCompleted === wasCompleted.current) return;
    const rising = isCompleted && !wasCompleted.current;
    wasCompleted.current = isCompleted;
    if (!rising) return;
    setJustCompleted(true);
    const id = setTimeout(() => setJustCompleted(false), 1200);
    return () => clearTimeout(id);
  }, [isCompleted]);

  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState({ title, description: description || '', duration: durationDigits(duration) });
  const [editDrillKind, setEditDrillKind] = useState<DrillKind | 'none'>(drill?.kind ?? 'none');
  const initialDrillChords =
    drill?.chords?.length
      ? drill.chords
      : drill?.chordFrom && drill?.chordTo
        ? [drill.chordFrom, drill.chordTo]
        : ['A', 'D', 'E'];
  const songs = useSongs();
  // The catalogue is never empty (the built-ins ship in code), but reading it as
  // if it could be keeps a deleted-chart edge case from crashing the row.
  const firstSongId = songs[0]?.id ?? '';
  const [editChords, setEditChords] = useState<string[]>(initialDrillChords);
  const [editTrainerChords, setEditTrainerChords] = useState<string[]>(
    drill?.kind === 'chord-trainer' && drill.chords?.length ? drill.chords : ['A', 'D', 'E', 'G', 'C'],
  );
  const [editSongId, setEditSongId] = useState<string>(drill?.songId ?? firstSongId);
  const [editBlocks, setEditBlocks] = useState<TimedBlock[]>(blocks ?? []);

  const addEditBlock = () =>
    setEditBlocks(prev => [...prev, { id: crypto.randomUUID(), label: '', durationSec: 60 }]);
  const updateEditBlock = (id: string, patch: Partial<TimedBlock>) =>
    setEditBlocks(prev => prev.map(b => (b.id === id ? { ...b, ...patch } : b)));
  const removeEditBlock = (id: string) => setEditBlocks(prev => prev.filter(b => b.id !== id));

  const titleInputRef = useRef<HTMLInputElement>(null);
  const taskRef = useRef<HTMLButtonElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isEditing && titleInputRef.current) {
      titleInputRef.current.focus();
    }
  }, [isEditing]);

  const handleDelete = () => {
    // Capture the whole task and its position first: once the store has removed
    // it, the only record of what a routine's third task used to be is gone.
    const routine = useStore
      .getState()
      .accounts[useStore.getState().currentAccountId]?.routines.find((r) => r.id === routineId);
    const task = routine?.tasks.find((t) => t.id === taskId);
    const position = routine?.tasks.findIndex((t) => t.id === taskId) ?? -1;
    deleteTask(routineId, taskId);
    if (task && position >= 0) {
      useUndoStore.getState().offer({ kind: 'task', routineId, task, index: position, label: task.title });
    }
  };

  const handleEditClick = () => {
    setIsEditing(true);
  };

  const saveEdit = () => {
    if (!editDraft.title.trim()) return;

    let nextDrill: DrillConfig | undefined;
    if (editDrillKind === 'one-minute-changes') {
      nextDrill = {
        kind: 'one-minute-changes',
        chords: editChords.length >= 2 ? editChords : ['A', 'D'],
        durationSec: drill?.durationSec ?? 60,
        // Carry any prescribed exact pairs through an edit — the chip grid only
        // sets the chord set, so without this a save would silently drop them.
        ...(drill?.pairs?.length ? { pairs: drill.pairs } : {}),
      };
    } else if (editDrillKind === 'chord-rotation') {
      nextDrill = {
        kind: 'chord-rotation',
        chords: editChords.length >= 2 ? editChords : ['D', 'A', 'E'],
        durationSec: drill?.durationSec ?? 60,
      };
    } else if (editDrillKind === 'chord-trainer') {
      nextDrill = {
        kind: 'chord-trainer',
        chords: editTrainerChords.length >= 2 ? editTrainerChords : ['A', 'D', 'E', 'G', 'C'],
        durationSec: drill?.durationSec ?? 60,
      };
    } else if (editDrillKind === 'note-finder') {
      nextDrill = { kind: 'note-finder', durationSec: drill?.durationSec ?? 60, rungId: drill?.rungId };
    } else if (editDrillKind === 'song') {
      nextDrill = { kind: 'song', songId: editSongId };
    }

    const cleanBlocks =
      editDrillKind === 'none'
        ? editBlocks
            .map(b => ({ ...b, label: b.label.trim() }))
            .filter(b => b.label && b.durationSec > 0)
        : [];

    updateTask(routineId, taskId, {
      title: editDraft.title.trim(),
      description: editDraft.description.trim() || undefined,
      duration: editDraft.duration.trim() || undefined,
      drill: nextDrill,
      blocks: cleanBlocks.length ? cleanBlocks : undefined,
    });
    setIsEditing(false);
  };

  const cancelEdit = () => {
    setEditDraft({ title, description: description || '', duration: durationDigits(duration) });
    setEditDrillKind(drill?.kind ?? 'none');
    setEditChords(initialDrillChords);
    setEditTrainerChords(
      drill?.kind === 'chord-trainer' && drill.chords?.length ? drill.chords : ['A', 'D', 'E', 'G', 'C'],
    );
    setEditSongId(drill?.songId ?? firstSongId);
    setEditBlocks(blocks ?? []);
    setIsEditing(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    pressTimer.current = setTimeout(() => {
      if (taskRef.current) {
        // Dispatch synthetic contextmenu event to trigger Radix on mobile
        const event = new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: touch.clientX,
          clientY: touch.clientY,
        });
        taskRef.current.dispatchEvent(event);
      }
    }, 500);
  };

  const handleTouchEnd = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  };

  if (isEditing) {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="task-row editing"
      >
        <div className="task-edit-form">
          <input
            ref={titleInputRef}
            className="task-edit-input"
            aria-label="Task name"
            value={editDraft.title}
            onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))}
            placeholder="Task Title"
            maxLength={60}
          />
          <div className="task-duration-field">
            <input
              className="task-edit-input"
              aria-label="Minutes"
              value={editDraft.duration}
              onChange={e => setEditDraft(d => ({ ...d, duration: sanitizeMinutes(e.target.value) }))}
              placeholder="Minutes"
              inputMode="numeric"
              pattern="[0-9]*"
            />
            <span className="task-duration-suffix">mins</span>
          </div>
          <textarea
            className="task-edit-textarea"
            aria-label="Description"
            value={editDraft.description}
            onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))}
            placeholder="Description (optional)"
            rows={2}
            maxLength={300}
          />

          <div className="drill-edit">
            <span className="drill-edit-label" id={`drill-kind-${taskId}`}>Live drill</span>
            <div className="drill-segment" role="group" aria-labelledby={`drill-kind-${taskId}`}>
              {([
                ['none', 'None'],
                ['one-minute-changes', 'Changes'],
                ['chord-rotation', 'Anchor'],
                ['chord-trainer', 'Perfect'],
                ['note-finder', 'Notes'],
                ['song', 'Song'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={editDrillKind === value}
                  className={clsx('drill-segment-btn', editDrillKind === value && 'active')}
                  onClick={() => setEditDrillKind(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {editDrillKind === 'one-minute-changes' && (
              <>
                <span className="drill-hint">Chords to switch between</span>
                <div className="drill-chip-grid">
                  {DRILL_CHORDS.map(c => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={editChords.includes(c)}
                      className={clsx('drill-chip', editChords.includes(c) && 'active')}
                      onClick={() => setEditChords(prev =>
                        prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c],
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </>
            )}
            {editDrillKind === 'chord-rotation' && (
              <>
                <span className="drill-hint">Chords to rotate through, in the order you tap them</span>
                <div className="drill-chip-grid">
                  {DRILL_CHORDS.map(c => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={editChords.includes(c)}
                      className={clsx('drill-chip', editChords.includes(c) && 'active')}
                      onClick={() => setEditChords(prev =>
                        prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c],
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </>
            )}
            {editDrillKind === 'chord-trainer' && (
              <>
                <span className="drill-hint">Shapes to place, lift off, and place again</span>
                <div className="drill-chip-grid">
                  {DRILL_CHORDS.map(c => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={editTrainerChords.includes(c)}
                      className={clsx('drill-chip', editTrainerChords.includes(c) && 'active')}
                      onClick={() => setEditTrainerChords(prev =>
                        prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c],
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </>
            )}
            {editDrillKind === 'note-finder' && (
              <span className="drill-hint">
                Named notes, found on the neck and played. It picks its own level.
              </span>
            )}
            {editDrillKind === 'song' && (
              <>
                <span className="drill-hint">Play along to the chords at your own pace</span>
                <SongPicker value={editSongId} onChange={setEditSongId} />
              </>
            )}
            {editDrillKind === 'none' && (
              <>
                <span className="drill-hint">Timed blocks (optional). One per pattern, each with its own minutes.</span>
                <div className="drill-blocks">
                  {editBlocks.map(block => (
                    <div key={block.id} className="drill-block">
                      <div className="drill-block-row">
                        <input
                          type="text"
                          className="task-input"
                          aria-label="Block name"
                          placeholder="e.g. Pattern 1"
                          value={block.label}
                          onChange={e => updateEditBlock(block.id, { label: e.target.value })}
                          maxLength={40}
                        />
                        <div className="drill-block-mins">
                          <input
                            type="text"
                            className="task-input"
                            aria-label="Block minutes"
                            placeholder="Min"
                            value={String(Math.round(block.durationSec / 60))}
                            onChange={e => {
                              const m = parseInt(sanitizeMinutes(e.target.value) || '0', 10);
                              updateEditBlock(block.id, { durationSec: Math.max(1, m) * 60 });
                            }}
                            inputMode="numeric"
                          />
                          <span className="task-duration-suffix">min</span>
                        </div>
                        <button
                          type="button"
                          className="drill-block-remove"
                          onClick={() => removeEditBlock(block.id)}
                          aria-label={`Remove block ${block.label || 'untitled'}`}
                        >
                          <TrashIcon size={16} />
                        </button>
                      </div>
                      <StrumPatternSelect
                        value={block.pattern ?? ''}
                        onChange={p => updateEditBlock(block.id, { pattern: p || undefined })}
                      />
                    </div>
                  ))}
                  <button type="button" className="drill-block-add" onClick={addEditBlock}>
                    <PlusIcon size={14} /> Add block
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="task-edit-actions">
            <button className="icon-btn" onClick={cancelEdit} aria-label="Discard changes">
              <CloseIcon size={18} />
            </button>
            <button className="icon-btn success" onClick={saveEdit} disabled={!editDraft.title.trim()} aria-label="Save task">
              <CheckIcon size={18} />
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  const state = isCompleted
    ? 'is-done'
    : record?.evidence === 'silent'
      ? 'is-unheard'
      : record
        ? 'is-underway'
        : 'is-planned';

  const start = () => onStart?.({ id: taskId, title, description, duration, drill, blocks });

  return (
    <ContextMenu
      content={
        <>
          {/* Correction lives here rather than on the row. The app records what
              it witnessed; disagreeing with it is a deliberate, occasional act,
              not something to be swept through at the end of a day. */}
          {!isCompleted && (
            <ContextMenuItem onClick={() => markTaskDone(today, taskId)}>
              <CheckIcon size={16} /> I did this
            </ContextMenuItem>
          )}
          {(isCompleted || record) && (
            <ContextMenuItem onClick={() => clearTaskRecord(today, taskId)}>
              <CloseIcon size={16} /> Clear today's record
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={handleEditClick}>
            <PencilIcon size={16} /> Edit task
          </ContextMenuItem>
          <ContextMenuItem onClick={() => moveTask(routineId, taskId, 'up')} disabled={index === 0}>
            <ArrowUpIcon size={16} /> Move up
          </ContextMenuItem>
          <ContextMenuItem onClick={() => moveTask(routineId, taskId, 'down')} disabled={index >= total - 1}>
            <ArrowDownIcon size={16} /> Move down
          </ContextMenuItem>
          <ContextMenuItem className="danger" onClick={handleDelete}>
            <TrashIcon size={16} /> Delete task
          </ContextMenuItem>
        </>
      }
    >
      {/* One control, one action: the row starts the work. It used to be a
          toggle, which is the app asking to be told what it was already
          listening to. Completion now follows from the run, and the mark on the
          left reports rather than asks. */}
      <motion.button
        ref={taskRef}
        type="button"
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        className={clsx('task-row', state, restsOnWord && 'is-stated', justCompleted && 'is-just-done')}
        aria-label={`Start ${title}${spoken ? `. ${spoken}` : ''}`}
        title={drill ? DRILL_LABEL[drill.kind] : 'Run the timer for this'}
        onClick={start}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
      >
        <span className="task-state" aria-hidden="true">
          {isCompleted ? (
            <motion.span
              className={clsx('state-done', restsOnWord && 'is-word')}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            >
              <CheckIcon size={14} strokeWidth={2.6} />
            </motion.span>
          ) : state === 'is-unheard' ? (
            <span className="state-unheard">
              <MicIcon size={18} />
            </span>
          ) : (
            <>
              <CircleIcon size={24} className="state-ring" />
              {state === 'is-underway' && <span className="state-dot" />}
            </>
          )}
        </span>

        <span className="task-content">
          <span className="task-title">{title}</span>
          {/* Once there is something to report, the row reports it. The
              description is instructions for doing the task; after it has been
              done, what happened is the more useful line, and swapping one for
              the other is what turns the day's plan into the day's record. */}
          {line ? (
            <span className="task-line">{line}</span>
          ) : (
            // A done task does not go back to reading like a plan, so the
            // instructions do not return once the row has something to report.
            !isCompleted &&
            description &&
            (looksLikeTab(description) ? (
              <span className="task-desc is-tab-note">Tab</span>
            ) : (
              <span className="task-desc">{description}</span>
            ))
          )}
        </span>

        {(showBest || planned) && (
          <span className="task-aside">
            {showBest && drill && (
              <span className="task-drill-result" title="Your best so far">
                {bestResult} {DRILL_UNIT[drill.kind]}
              </span>
            )}
            {planned && (
              <span
                className={clsx('task-duration', timeSpent && 'is-spent')}
                title={timeSpent ? 'You ran this block to the end' : undefined}
              >
                {planned}
              </span>
            )}
          </span>
        )}

        <span className="task-go">
          <PlayIcon size={13} />
        </span>
      </motion.button>
    </ContextMenu>
  );
});
