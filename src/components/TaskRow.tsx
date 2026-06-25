import { useState, useRef, useEffect } from 'react';
import { useStore, useUserData, getTodayString } from '../store';
import { Check, Circle, Trash, PencilSimple, X, Waveform, ArrowsLeftRight } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import type { DrillConfig, DrillKind } from '../types';
import './TaskRow.css';
import './drill-fields.css';

const DRILL_CHORDS = ['A', 'C', 'D', 'E', 'G', 'Am', 'Dm', 'Em', 'F'];

interface TaskRowProps {
  routineId: string;
  taskId: string;
  title: string;
  description?: string;
  duration?: string;
  drill?: DrillConfig;
  onLaunchDrill?: () => void;
}

export function TaskRow({ routineId, taskId, title, description, duration, drill, onLaunchDrill }: TaskRowProps) {
  const today = getTodayString();
  const { toggleTaskCompletion, deleteTask, updateTask } = useStore();
  const userData = useUserData();
  const log = userData?.dailyLogs?.[today];
  
  const isCompleted = log?.completedTaskIds?.includes(taskId) || false;
  const todayResult = log?.drillResults?.[taskId];

  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState({ title, description: description || '', duration: duration || '' });
  const [editDrillKind, setEditDrillKind] = useState<DrillKind | 'none'>(drill?.kind ?? 'none');
  const [editChords, setEditChords] = useState({ from: drill?.chordFrom ?? 'A', to: drill?.chordTo ?? 'D' });

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
        chordFrom: editChords.from,
        chordTo: editChords.to,
        durationSec: drill?.durationSec ?? 60,
      };
    } else if (editDrillKind === 'free-play') {
      nextDrill = { kind: 'free-play' };
    } else if (editDrillKind === 'chord-trainer') {
      // Preserve the configured pool (the edit form has no chip picker); fall
      // back to a sensible default if switching a task into this drill.
      nextDrill = {
        kind: 'chord-trainer',
        chords: drill?.chords?.length ? drill.chords : ['A', 'D', 'E', 'G', 'C'],
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
    setEditDraft({ title, description: description || '', duration: duration || '' });
    setEditDrillKind(drill?.kind ?? 'none');
    setEditChords({ from: drill?.chordFrom ?? 'A', to: drill?.chordTo ?? 'D' });
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
          <input 
            className="task-edit-input" 
            value={editDraft.duration}
            onChange={e => setEditDraft(d => ({ ...d, duration: e.target.value }))}
            placeholder="Duration (e.g. 5m)"
            maxLength={30}
          />
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
                ['free-play', 'Free Play'],
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
              <div className="drill-chords">
                <select
                  className="drill-select"
                  value={editChords.from}
                  onChange={e => setEditChords(c => ({ ...c, from: e.target.value }))}
                >
                  {DRILL_CHORDS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <ArrowsLeftRight size={16} color="var(--text-secondary)" />
                <select
                  className="drill-select"
                  value={editChords.to}
                  onChange={e => setEditChords(c => ({ ...c, to: e.target.value }))}
                >
                  {DRILL_CHORDS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
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
          <div className="task-header">
            <span className="task-title">{title}</span>
            <div className="task-meta">
              {typeof todayResult === 'number' && (
                <span className="task-drill-result">
                  {todayResult} {drill?.kind === 'chord-trainer' ? 'nailed' : 'cpm'}
                </span>
              )}
              {duration && <span className="task-duration">{duration}</span>}
            </div>
          </div>
          {description && <p className="task-desc">{description}</p>}
        </div>

        {drill && (
          <button
            type="button"
            className="task-drill-btn"
            title={
              drill.kind === 'free-play'
                ? 'Free play'
                : drill.kind === 'chord-trainer'
                  ? 'Chord trainer'
                  : '1-minute changes'
            }
            onClick={(e) => {
              e.stopPropagation();
              onLaunchDrill?.();
            }}
          >
            <Waveform size={15} weight="bold" />
            <span>Practice</span>
          </button>
        )}
      </motion.div>
    </ContextMenu>
  );
}
