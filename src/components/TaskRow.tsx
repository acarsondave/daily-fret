import { useState, useRef, useEffect } from 'react';
import { useStore, useUserData, getTodayString } from '../store';
import { Check, Circle, Trash, PencilSimple, X } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import './TaskRow.css';

interface TaskRowProps {
  routineId: string;
  taskId: string;
  title: string;
  description?: string;
  duration?: string;
}

export function TaskRow({ routineId, taskId, title, description, duration }: TaskRowProps) {
  const today = getTodayString();
  const { toggleTaskCompletion, deleteTask, updateTask } = useStore();
  const userData = useUserData();
  const log = userData?.dailyLogs?.[today];
  
  const isCompleted = log?.completedTaskIds?.includes(taskId) || false;

  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState({ title, description: description || '', duration: duration || '' });

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
    updateTask(routineId, taskId, {
      title: editDraft.title.trim(),
      description: editDraft.description.trim() || undefined,
      duration: editDraft.duration.trim() || undefined
    });
    setIsEditing(false);
  };

  const cancelEdit = () => {
    setEditDraft({ title, description: description || '', duration: duration || '' });
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
            {duration && <span className="task-duration">{duration}</span>}
          </div>
          {description && <p className="task-desc">{description}</p>}
        </div>
      </motion.div>
    </ContextMenu>
  );
}
