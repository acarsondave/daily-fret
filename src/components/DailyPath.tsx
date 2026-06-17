import { useState, useMemo, useRef, useEffect } from 'react';
import { useStore, useUserData, getTodayString } from '../store';
import { TaskRow } from './TaskRow';
import { Modal } from './Modal';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightning, Plus, CaretDown, TextAa } from '@phosphor-icons/react';
import clsx from 'clsx';
import './DailyPath.css';

export function DailyPath() {
  const today = getTodayString();
  const userData = useUserData();
  
  const routines = userData?.routines || [];
  const activeRoutineId = userData?.activeRoutineId;
  const dailyLogs = userData?.dailyLogs || {};
  
  const setActiveRoutine = useStore(state => state.setActiveRoutine);
  const log = dailyLogs[today];

  const [isRoutineDropdownOpen, setIsRoutineDropdownOpen] = useState(false);
  const [isJotterOpen, setIsJotterOpen] = useState(false);
  const [inlineDraft, setInlineDraft] = useState({ title: '', duration: '' });
  const [inlineStep, setInlineStep] = useState<'title'|'duration'|null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const durationInputRef = useRef<HTMLInputElement>(null);

  const activeRoutine = useMemo(() => {
    return routines.find(r => r.id === activeRoutineId) || routines[0];
  }, [routines, activeRoutineId]);

  const tasks = activeRoutine?.tasks || [];
  const isEmpty = tasks.length === 0;

  const allCompleted = !isEmpty && tasks.every(t => log?.completedTaskIds?.includes(t.id));

  // Automatically open jotter when all completed (only once per session ideally, but for now just open it)
  useEffect(() => {
    if (allCompleted && log?.feedback === undefined) {
      setIsJotterOpen(true);
    }
  }, [allCompleted, log?.feedback]);

  const handleInlineKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (inlineStep === 'title' && inlineDraft.title.trim()) {
        setInlineStep('duration');
        setTimeout(() => durationInputRef.current?.focus(), 50);
      } else if (inlineStep === 'duration') {
        submitInlineTask();
      }
    } else if (e.key === 'Escape') {
      setInlineStep(null);
      setInlineDraft({ title: '', duration: '' });
    }
  };

  const submitInlineTask = () => {
    if (!inlineDraft.title.trim()) return;
    if (tasks.length >= 100) {
      alert("Maximum limit of 100 tasks per routine reached.");
      return;
    }
    const newTask = {
      id: crypto.randomUUID(),
      title: inlineDraft.title.trim(),
      duration: inlineDraft.duration.trim() || undefined
    };
    // Update store (we need an action to add task to routine)
    // For now we'll do it via a quick patch to the store state.
    useStore.setState(state => {
      const acc = state.accounts[state.currentAccountId];
      const rIdx = acc.routines.findIndex(r => r.id === activeRoutineId);
      if (rIdx >= 0) {
        acc.routines[rIdx].tasks.push(newTask);
      }
      return { accounts: { ...state.accounts, [state.currentAccountId]: acc } };
    });
    setInlineStep(null);
    setInlineDraft({ title: '', duration: '' });
  };

  if (!activeRoutine) return null;

  return (
    <div className="daily-path">
      <div className="path-header-center">
        <div className="routine-selector-container">
          <button 
            className="routine-selector glass-panel"
            onClick={() => setIsRoutineDropdownOpen(!isRoutineDropdownOpen)}
          >
            <Lightning weight="fill" color="var(--accent-primary)" />
            <span>{activeRoutine.name}</span>
            <CaretDown size={16} color="var(--text-secondary)" />
          </button>
          
          <AnimatePresence>
            {isRoutineDropdownOpen && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: -10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -10 }}
                className="routine-dropdown glass-panel"
              >
                {routines.map(r => (
                  <button 
                    key={r.id} 
                    className={clsx('dropdown-item', r.id === activeRoutineId && 'active')}
                    onClick={() => {
                      setActiveRoutine(r.id);
                      setIsRoutineDropdownOpen(false);
                    }}
                  >
                    {r.name}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="task-container-wrapper">
        <div className="task-container glass-panel">
          <div className="task-list-scrollable">
            <AnimatePresence mode="popLayout">
              {tasks.map((task, idx) => (
                <motion.div
                  layout
                  key={task.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                >
                  <TaskRow taskId={task.id} title={task.title} description={task.description} duration={task.duration} />
                </motion.div>
              ))}

              {isEmpty && !inlineStep && (
                <motion.div 
                  initial={{ opacity: 0 }} 
                  animate={{ opacity: 1 }} 
                  className="empty-state-placeholder"
                  onClick={() => setInlineStep('title')}
                >
                  <span className="placeholder-text">Click to add your first task...</span>
                </motion.div>
              )}

              {inlineStep && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="inline-task-creator"
                >
                  {inlineStep === 'title' ? (
                    <div className="inline-input-wrapper">
                      <TextAa size={20} color="var(--text-secondary)" />
                      <input 
                        ref={titleInputRef}
                        autoFocus
                        placeholder="What's the task? (e.g. Spider Walk)"
                        value={inlineDraft.title}
                        onChange={e => setInlineDraft(d => ({ ...d, title: e.target.value }))}
                        onKeyDown={handleInlineKeyDown}
                        className="inline-input"
                      />
                    </div>
                  ) : (
                    <div className="inline-input-wrapper">
                      <Lightning size={20} color="var(--text-secondary)" />
                      <input 
                        ref={durationInputRef}
                        placeholder="Duration? (e.g. 5m) - Optional"
                        value={inlineDraft.duration}
                        onChange={e => setInlineDraft(d => ({ ...d, duration: e.target.value }))}
                        onKeyDown={handleInlineKeyDown}
                        className="inline-input"
                      />
                    </div>
                  )}
                  <span className="hint">Press Enter ⏎</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {!isEmpty && (
            <div className="task-container-footer">
               <button 
                className="add-task-btn"
                onClick={() => setInlineStep('title')}
               >
                 <Plus size={16} />
                 <span>Add quick task</span>
               </button>
            </div>
          )}
        </div>
      </div>

      <Modal 
        isOpen={isJotterOpen} 
        onClose={() => setIsJotterOpen(false)}
        position="bottom"
      >
        <div className="jotter-content">
          <h3 className="jotter-title">Routine Complete.</h3>
          <p className="jotter-subtitle">Thoughts on today's session?</p>
          <textarea 
            className="jotter-input"
            autoFocus
            placeholder="Felt great on the transitions..."
            value={log?.feedback || ''}
            onChange={(e) => useStore.getState().saveFeedback(today, e.target.value)}
          />
          <button className="jotter-done-btn" onClick={() => setIsJotterOpen(false)}>
            Done
          </button>
        </div>
      </Modal>
    </div>
  );
}
