import { useState, useRef, useEffect, useMemo } from 'react';
import { useStore, getTodayString } from '../store';
import { Check, Circle, Trash, PencilSimple, X, Waveform, ArrowUp, ArrowDown } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { chordPairs, pairKey } from '../lib/pairs';
import { sanitizeMinutes, formatDuration } from '../lib/coached';
import type { DrillConfig, DrillKind } from '../types';
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
  index: number;
  total: number;
  onLaunchDrill?: () => void;
}

export function TaskRow({ routineId, taskId, title, description, duration, drill, index, total, onLaunchDrill }: TaskRowProps) {
  const today = getTodayString();
  const { toggleTaskCompletion, deleteTask, updateTask, moveTask } = useStore();

  // Subscribe narrowly to just this task's completion and best result so one
  // task toggling doesn't re-render every other row (these return primitives,
  // so unrelated mutations don't trigger a render here).
  const isCompleted = useStore(
    (s) => s.accounts[s.currentAccountId]?.dailyLogs?.[today]?.completedTaskIds?.includes(taskId) ?? false,
  );

  // The storage keys this task's results live under: chord-trainer writes to the
  // taskId, one-minute-changes writes per chord pair. Best is read across *all*
  // days so the badge reflects history, not just whether it was done today.
  const resultKeys = useMemo(() => {
    if (!drill) return [] as string[];
    if (drill.kind === 'chord-trainer') return [taskId];
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

  const titleInputRef = useRef<HTMLInputElement>(null);
  const taskRef = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isEditing && titleInputRef.current) {
      titleInputRef.current.focus();
    }
  }, [isEditing]);

  const handleDelete = () => {
    deleteTask(routineId, taskId);
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
      };
    } else if (editDrillKind === 'chord-trainer') {
      nextDrill = {
        kind: 'chord-trainer',
        chords: editTrainerChords.length >= 2 ? editTrainerChords : ['A', 'D', 'E', 'G', 'C'],
        durationSec: drill?.durationSec ?? 60,
      };
    }

    updateTask(routineId, taskId, {
      title: editDraft.title.trim(),
      description: editDraft.description.trim() || undefined,
      duration: editDraft.duration.trim() || undefined,
      drill: nextDrill,
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
            value={editDraft.title}
            onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))}
            placeholder="Task Title"
            maxLength={60}
          />
          <div className="task-duration-field">
            <input
              className="task-edit-input"
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
            value={editDraft.description}
            onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))}
            placeholder="Description (optional)"
            rows={2}
            maxLength={300}
          />

          <div className="drill-edit">
            <span className="drill-edit-label">Live drill</span>
            <div className="drill-segment">
              {([
                ['none', 'None'],
                ['one-minute-changes', '1-Min Changes'],
                ['chord-trainer', 'Chord Trainer'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
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
                <span className="drill-hint">Chords to reinforce</span>
                <div className="drill-chip-grid">
                  {DRILL_CHORDS.map(c => (
                    <button
                      key={c}
                      type="button"
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
          </div>

          <div className="task-edit-actions">
            <button className="icon-btn" onClick={cancelEdit}><X size={18} /></button>
            <button className="icon-btn success" onClick={saveEdit} disabled={!editDraft.title.trim()}><Check size={18} /></button>
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
            <PencilSimple size={16} /> Edit Task
          </ContextMenuItem>
          <ContextMenuItem onClick={() => moveTask(routineId, taskId, 'up')} disabled={index === 0}>
            <ArrowUp size={16} /> Move Up
          </ContextMenuItem>
          <ContextMenuItem onClick={() => moveTask(routineId, taskId, 'down')} disabled={index >= total - 1}>
            <ArrowDown size={16} /> Move Down
          </ContextMenuItem>
          <ContextMenuItem className="danger" onClick={handleDelete}>
            <Trash size={16} /> Delete Task
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
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        className={clsx('task-row', isCompleted && 'completed')}
        onClick={() => toggleTaskCompletion(today, taskId)}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
      >
        <div className="task-checkbox">
          <motion.div 
            className="check-bg"
            animate={{
              scale: isCompleted ? 1 : 0,
              opacity: isCompleted ? 1 : 0
            }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
          >
            <Check weight="bold" color="var(--bg-color)" size={14} />
          </motion.div>
          {!isCompleted && <Circle className="uncheck-icon" weight="regular" size={24} color="var(--text-secondary)" />}
        </div>
        
        <div className="task-content">
          <span className="task-title">{title}</span>
          {description && <p className="task-desc">{description}</p>}
        </div>

        <div className="task-aside">
          {(typeof bestResult === 'number' || duration) && (
            <div className="task-meta">
              {typeof bestResult === 'number' && (
                <span className="task-drill-result" title="Your best so far">
                  {bestResult} {drill?.kind === 'chord-trainer' ? 'nailed' : 'cpm'}
                </span>
              )}
              {formatDuration(duration) && <span className="task-duration">{formatDuration(duration)}</span>}
            </div>
          )}
          {drill && (
            <button
              type="button"
              className="task-drill-btn"
              title={drill.kind === 'chord-trainer' ? 'Chord trainer' : '1-minute changes'}
              onClick={(e) => {
                e.stopPropagation();
                onLaunchDrill?.();
              }}
            >
              <Waveform size={15} weight="bold" />
              <span>Practice</span>
            </button>
          )}
        </div>
      </motion.div>
    </ContextMenu>
  );
}
