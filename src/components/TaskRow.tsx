import { useState, useRef, useEffect, useMemo, memo } from 'react';
import { useUndoStore } from '../store/undo';
import { useStore, getTodayString } from '../store';
import {
  CheckIcon,
  CircleIcon,
  TrashIcon,
  PencilIcon,
  CloseIcon,
  PlectrumIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  PlusIcon,
} from './icons';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { chordPairs, pairKey } from '../lib/pairs';
import { sanitizeMinutes, formatDuration } from '../lib/coached';
import { looksLikeTab } from '../lib/tab';
// One definition of what each drill's number means, shared with Progress.
import { DRILL_UNIT, DRILL_LABEL } from '../lib/drills';
import { SONGS } from '../data/songs';
import { StrumPatternSelect } from './StrumPatternSelect';
import type { DrillConfig, DrillKind, Task, TimedBlock } from '../types';
import './TaskRow.css';
import './drill-fields.css';

const DRILL_CHORDS = ['A', 'C', 'D', 'E', 'G', 'Am', 'Dm', 'Em', 'F'];

// Pull the bare minute digits out of a (possibly legacy) duration label.
const durationDigits = (d?: string) => (d ? d.match(/\d+/)?.[0] ?? '' : '');

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
  onLaunchDrill?: (task: Task) => void;
}

export const TaskRow = memo(function TaskRow({ routineId, taskId, title, description, duration, drill, blocks, index, total, onLaunchDrill }: TaskRowProps) {
  const today = getTodayString();
  // Select each action on its own — Zustand returns the *same* function
  // reference every render, so this row no longer subscribes to the whole store
  // (a bare `useStore()` did, re-rendering every row on any state change).
  const toggleTaskCompletion = useStore((s) => s.toggleTaskCompletion);
  const deleteTask = useStore((s) => s.deleteTask);
  const updateTask = useStore((s) => s.updateTask);
  const moveTask = useStore((s) => s.moveTask);

  // Subscribe narrowly to just this task's completion and best result so one
  // task toggling doesn't re-render every other row (these return primitives,
  // so unrelated mutations don't trigger a render here).
  const isCompleted = useStore(
    (s) => s.accounts[s.currentAccountId]?.dailyLogs?.[today]?.completedTaskIds?.includes(taskId) ?? false,
  );

  // The storage keys this task's results live under. Chord Perfect and the
  // anchor rotation both write to the taskId; only the changes drill splits per
  // chord pair. Rotation used to derive pair keys here and so could never find
  // its own result, which is why its best badge never appeared.
  const resultKeys = useMemo(() => {
    if (!drill) return [] as string[];
    if (drill.kind === 'chord-trainer' || drill.kind === 'chord-rotation') return [taskId];
    if (drill.kind === 'song') return [] as string[];
    const chords = drill.chords?.length
      ? drill.chords
      : drill.chordFrom && drill.chordTo
        ? [drill.chordFrom, drill.chordTo]
        : [];
    return chordPairs(chords).map((p) => pairKey(p.from, p.to));
  }, [drill, taskId]);

  const bestResult = useStore((s) => {
    if (resultKeys.length === 0) return null;
    const logs = s.accounts[s.currentAccountId]?.dailyLogs;
    if (!logs) return null;
    let best = -1;
    for (const dayLog of Object.values(logs)) {
      const dr = dayLog.drillResults;
      if (!dr) continue;
      for (const k of resultKeys) {
        const v = dr[k];
        if (typeof v === 'number' && v > best) best = v;
      }
    }
    return best >= 0 ? best : null;
  });

  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState({ title, description: description || '', duration: durationDigits(duration) });
  const [editDrillKind, setEditDrillKind] = useState<DrillKind | 'none'>(drill?.kind ?? 'none');
  const initialDrillChords =
    drill?.chords?.length
      ? drill.chords
      : drill?.chordFrom && drill?.chordTo
        ? [drill.chordFrom, drill.chordTo]
        : ['A', 'D', 'E'];
  const [editChords, setEditChords] = useState<string[]>(initialDrillChords);
  const [editTrainerChords, setEditTrainerChords] = useState<string[]>(
    drill?.kind === 'chord-trainer' && drill.chords?.length ? drill.chords : ['A', 'D', 'E', 'G', 'C'],
  );
  const [editSongId, setEditSongId] = useState<string>(drill?.songId ?? SONGS[0].id);
  const [editBlocks, setEditBlocks] = useState<TimedBlock[]>(blocks ?? []);

  const addEditBlock = () =>
    setEditBlocks(prev => [...prev, { id: crypto.randomUUID(), label: '', durationSec: 60 }]);
  const updateEditBlock = (id: string, patch: Partial<TimedBlock>) =>
    setEditBlocks(prev => prev.map(b => (b.id === id ? { ...b, ...patch } : b)));
  const removeEditBlock = (id: string) => setEditBlocks(prev => prev.filter(b => b.id !== id));

  const titleInputRef = useRef<HTMLInputElement>(null);
  const taskRef = useRef<HTMLDivElement>(null);
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
    setEditSongId(drill?.songId ?? SONGS[0].id);
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
            {editDrillKind === 'song' && (
              <>
                <span className="drill-hint">Play along to the chords at your own pace</span>
                <select
                  className="task-input drill-song-select"
                  aria-label="Song"
                  value={editSongId}
                  onChange={e => setEditSongId(e.target.value)}
                >
                  {SONGS.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.title} · {s.artist} ({s.chords.join(' ')})
                    </option>
                  ))}
                </select>
              </>
            )}
            {editDrillKind === 'none' && (
              <>
                <span className="drill-hint">Timed blocks (optional) — one per pattern, each with its own minutes</span>
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

  return (
    <ContextMenu
      content={
        <>
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
      <motion.div
        ref={taskRef}
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        className={clsx('task-row', isCompleted && 'completed')}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
      >
        {/* The row was a div with an onClick, so a task could not be ticked
            without a mouse. This is a real toggle button, and it is a sibling of
            the Practice control rather than its parent, so neither is nested
            inside the other. */}
        <button
          type="button"
          className="task-main"
          aria-pressed={isCompleted}
          onClick={() => toggleTaskCompletion(today, taskId)}
        >
          <span className="task-checkbox">
            <motion.span
              className="check-bg"
              animate={{
                scale: isCompleted ? 1 : 0,
                opacity: isCompleted ? 1 : 0,
              }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            >
              <CheckIcon size={14} strokeWidth={2.6} />
            </motion.span>
            {!isCompleted && <CircleIcon size={24} className="uncheck-icon" />}
          </span>

          <span className="task-content">
            <span className="task-title">{title}</span>
            {/* A riff's note is a tab staff. Collapsing it into the row's two
                lines of prose produced a scramble of dashes and pipes, so the
                row says what it is and the staff renders where it is played. */}
            {description &&
              (looksLikeTab(description) ? (
                <span className="task-desc is-tab-note">Tab</span>
              ) : (
                <span className="task-desc">{description}</span>
              ))}
          </span>
        </button>

        <div className="task-aside">
          {(typeof bestResult === 'number' || duration) && (
            <div className="task-meta">
              {typeof bestResult === 'number' && drill && (
                <span className="task-drill-result" title="Your best so far">
                  {bestResult} {DRILL_UNIT[drill.kind]}
                </span>
              )}
              {formatDuration(duration) && <span className="task-duration">{formatDuration(duration)}</span>}
            </div>
          )}
          {drill && (
            <button
              type="button"
              className="task-drill-btn"
              aria-label={`${DRILL_LABEL[drill.kind]}: ${title}`}
              title={DRILL_LABEL[drill.kind]}
              onClick={(e) => {
                e.stopPropagation();
                onLaunchDrill?.({ id: taskId, title, description, duration, drill });
              }}
            >
              <PlectrumIcon size={15} />
              <span>Practice</span>
            </button>
          )}
        </div>
      </motion.div>
    </ContextMenu>
  );
});
