import { useState, useMemo, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useStore, useUserData, getTodayString } from '../store';
import { useDrillStats } from '../lib/drillStats';
import { TaskRow } from './TaskRow';
import { Modal } from './Modal';
import { Loader } from './Loader';
import { TaskCreatorModal } from './TaskCreatorModal';
import { RoutineManagerModal } from './RoutineManagerModal';
import { ProgressPanel } from './practice/ProgressPanel';
import { sanitizeMinutes } from '../lib/coached';
import type { Task } from '../types';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightning, Plus, CaretDown, Gear, ChartLineUp, PlayCircle } from '@phosphor-icons/react';
import clsx from 'clsx';
import './DailyPath.css';

// Code-split the audio/practice path: it pulls in the DSP + worklet glue and is
// only needed once a user actually starts a drill, keeping first paint light.
const PracticeOverlay = lazy(() =>
  import('./practice/PracticeOverlay').then((m) => ({ default: m.PracticeOverlay })),
);
const CoachedSession = lazy(() =>
  import('./practice/CoachedSession').then((m) => ({ default: m.CoachedSession })),
);

export function DailyPath() {
  const today = getTodayString();
  const userData = useUserData();
  
  const routines = useMemo(() => userData?.routines || [], [userData]);
  const activeRoutineId = userData?.activeRoutineId;
  const dailyLogs = userData?.dailyLogs || {};
  
  const setActiveRoutine = useStore(state => state.setActiveRoutine);
  const log = dailyLogs[today];

  const [isRoutineDropdownOpen, setIsRoutineDropdownOpen] = useState(false);
  const [isJotterOpen, setIsJotterOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isRoutineModalOpen, setIsRoutineModalOpen] = useState(false);
  const [isProgressOpen, setIsProgressOpen] = useState(false);
  const [isCoachedOpen, setIsCoachedOpen] = useState(false);
  const [practiceTask, setPracticeTask] = useState<Task | null>(null);
  const [prevAllCompleted, setPrevAllCompleted] = useState(false);

  const drillStats = useDrillStats();
  const hasProgress = drillStats.some((s) => s.series.length > 0);

  // Stable across renders so memoized TaskRows don't re-render when the list
  // does (e.g. when another task is toggled). The row passes its own task back.
  const launchDrill = useCallback((task: Task) => setPracticeTask(task), []);

  const routineDropdownRef = useRef<HTMLDivElement>(null);

  const [inlineDraft, setInlineDraft] = useState({ title: '', description: '', duration: '' });
  const [inlineStep, setInlineStep] = useState<'title'|'description'|'duration'|null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const descInputRef = useRef<HTMLInputElement>(null);
  const durationInputRef = useRef<HTMLInputElement>(null);

  const activeRoutine = useMemo(() => {
    return routines.find(r => r.id === activeRoutineId) || routines[0];
  }, [routines, activeRoutineId]);

  const tasks = activeRoutine?.tasks || [];
  const isEmpty = tasks.length === 0;

  // Coached mode runs every task in order (drills + timed blocks).
  const hasCoachable = tasks.length > 0;

  const allCompleted = !isEmpty && tasks.every(t => log?.completedTaskIds?.includes(t.id));

  // Open the jotter on the rising edge of completion (when no feedback yet),
  // adjusting state during render rather than in an effect. Hold off while a
  // guided session or a drill is on screen — completing the last task there
  // shouldn't pop the note sheet *under* the overlay; we surface it once the
  // coached session closes instead (see CoachedSession onClose below).
  if (allCompleted !== prevAllCompleted) {
    setPrevAllCompleted(allCompleted);
    if (allCompleted && log?.feedback === undefined && !isCoachedOpen && !practiceTask) {
      setIsJotterOpen(true);
    }
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (routineDropdownRef.current && !routineDropdownRef.current.contains(e.target as Node)) {
        setIsRoutineDropdownOpen(false);
      }
    };
    if (isRoutineDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isRoutineDropdownOpen]);

  const handleInlineKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (inlineStep === 'title' && inlineDraft.title.trim()) {
        setInlineStep('description');
        setTimeout(() => descInputRef.current?.focus(), 50);
      } else if (inlineStep === 'description') {
        setInlineStep('duration');
        setTimeout(() => durationInputRef.current?.focus(), 50);
      } else if (inlineStep === 'duration') {
        submitInlineTask();
      }
    } else if (e.key === 'Escape') {
      setInlineStep(null);
      setInlineDraft({ title: '', description: '', duration: '' });
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
      description: inlineDraft.description.trim() || undefined,
      duration: inlineDraft.duration.trim() || undefined
    };
    useStore.getState().addTask(activeRoutine.id, newTask);
    setInlineStep(null);
    setInlineDraft({ title: '', description: '', duration: '' });
  };

  if (!activeRoutine) {
    return (
      <div className="daily-path">
        <div className="task-container-wrapper">
          <div className="task-container glass-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px' }}>
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              className="empty-state-placeholder"
              onClick={() => {
                const newId = crypto.randomUUID();
                useStore.getState().addRoutine({
                  id: newId,
                  name: 'My First Routine',
                  description: '',
                  isDefault: true,
                  tasks: []
                });
                setActiveRoutine(newId);
              }}
            >
              <span className="placeholder-text">Click to create your first routine...</span>
            </motion.div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="daily-path">
      <div className="path-header-center">
        <div className="routine-selector-container" ref={routineDropdownRef}>
          <button 
            className="routine-selector"
            onClick={() => setIsRoutineDropdownOpen(prev => !prev)}
          >
            <Lightning weight="duotone" className="routine-icon" />
            <span className="routine-name">{activeRoutine.name}</span>
            <CaretDown weight="bold" className="routine-caret" />
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
                <div className="dropdown-divider" />
                <button 
                  className="dropdown-item manage-action"
                  onClick={() => {
                    setIsRoutineDropdownOpen(false);
                    setIsRoutineModalOpen(true);
                  }}
                >
                  <Gear size={16} /> Manage Routines
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {hasCoachable && (
          <button
            className="progress-launch"
            onClick={() => setIsCoachedOpen(true)}
            title="Run this whole routine, guided"
          >
            <PlayCircle weight="duotone" className="progress-launch-icon" />
            <span>Coached</span>
          </button>
        )}

        {hasProgress && (
          <button
            className="progress-launch"
            onClick={() => setIsProgressOpen(true)}
            title="Your change-speed progress"
          >
            <ChartLineUp weight="duotone" className="progress-launch-icon" />
            <span>Progress</span>
          </button>
        )}
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
                  <TaskRow routineId={activeRoutine.id} taskId={task.id} title={task.title} description={task.description} duration={task.duration} drill={task.drill} index={idx} total={tasks.length} onLaunchDrill={launchDrill} />
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
                  {inlineStep === 'title' && (
                    <>
                      <span className="inline-tooltip">Name your task & press Enter</span>
                      <div className="inline-input-wrapper">
                        <input 
                          ref={titleInputRef}
                          autoFocus
                          placeholder="e.g. Spider Walk"
                          value={inlineDraft.title}
                          onChange={e => setInlineDraft(d => ({ ...d, title: e.target.value }))}
                          onKeyDown={handleInlineKeyDown}
                          className="inline-input fluid-input"
                          maxLength={60}
                        />
                      </div>
                    </>
                  )}
                  {inlineStep === 'description' && (
                    <>
                      <span className="inline-tooltip">What is this task for? (Optional)</span>
                      <div className="inline-input-wrapper">
                        <input 
                          ref={descInputRef}
                          autoFocus
                          placeholder="e.g. Start at 1st fret, alternate picking."
                          value={inlineDraft.description}
                          onChange={e => setInlineDraft(d => ({ ...d, description: e.target.value }))}
                          onKeyDown={handleInlineKeyDown}
                          className="inline-input fluid-input"
                          maxLength={300}
                        />
                      </div>
                    </>
                  )}
                  {inlineStep === 'duration' && (
                    <>
                      <span className="inline-tooltip">How many minutes? (Optional)</span>
                      <div className="inline-input-wrapper">
                        <input
                          ref={durationInputRef}
                          autoFocus
                          placeholder="e.g. 5"
                          value={inlineDraft.duration}
                          onChange={e => setInlineDraft(d => ({ ...d, duration: sanitizeMinutes(e.target.value) }))}
                          onKeyDown={handleInlineKeyDown}
                          className="inline-input fluid-input"
                          inputMode="numeric"
                          pattern="[0-9]*"
                        />
                      </div>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {!isEmpty && (
            <div className="task-container-footer">
               <button 
                className="add-task-btn"
                onClick={() => setIsTaskModalOpen(true)}
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
        onClose={() => {
          setIsJotterOpen(false);
        }}
        position="bottom"
      >
        <div className="jotter-content">
          <h2 className="jotter-title">You've completed today's rounds.</h2>
          <p className="jotter-subtitle">Well done.</p>
          <textarea 
            className="jotter-input"
            placeholder="Have any thoughts or notes about today's experience?"
            value={log?.feedback || ''}
            onChange={(e) => useStore.getState().saveFeedback(today, e.target.value)}
            rows={4}
            maxLength={1000}
          />
          <button 
            className="jotter-done-btn" 
            onClick={() => setIsJotterOpen(false)}
          >
            Done
          </button>
        </div>
      </Modal>

      <TaskCreatorModal 
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
        routineId={activeRoutine.id}
      />
      
      <RoutineManagerModal 
        isOpen={isRoutineModalOpen}
        onClose={() => setIsRoutineModalOpen(false)}
      />

      <Modal
        isOpen={isProgressOpen}
        onClose={() => setIsProgressOpen(false)}
        title="Progress"
      >
        <ProgressPanel
          onPracticePair={(from, to) => {
            useStore.getState().setLastPair(from, to);
            const existing = tasks.find((t) => t.drill?.kind === 'one-minute-changes');
            const base: Task = existing ?? {
              id: '__changes__',
              title: 'Chord Changes',
              drill: { kind: 'one-minute-changes', durationSec: 60 },
            };
            setIsProgressOpen(false);
            setPracticeTask({
              ...base,
              drill: { kind: 'one-minute-changes', chordFrom: from, chordTo: to, durationSec: 60 },
            });
          }}
        />
      </Modal>

      <Suspense fallback={practiceTask ? <Loader overlay label="Tuning up…" /> : null}>
        <AnimatePresence>
          {practiceTask && (
            <PracticeOverlay
              key={practiceTask.id}
              task={practiceTask}
              onClose={() => setPracticeTask(null)}
            />
          )}
        </AnimatePresence>
      </Suspense>

      <Suspense fallback={isCoachedOpen ? <Loader overlay label="Tuning up…" /> : null}>
        <AnimatePresence>
          {isCoachedOpen && activeRoutine && (
            <CoachedSession
              key="coached"
              routine={activeRoutine}
              onClose={() => {
                setIsCoachedOpen(false);
                // If the guided run finished the whole routine, invite a
                // reflection note now (read fresh state — `log` is stale here).
                const acc = useStore.getState().accounts[useStore.getState().currentAccountId];
                const freshLog = acc?.dailyLogs?.[today];
                const done = tasks.length > 0 && tasks.every((t) => freshLog?.completedTaskIds?.includes(t.id));
                if (done && freshLog?.feedback === undefined) {
                  setIsJotterOpen(true);
                }
              }}
            />
          )}
        </AnimatePresence>
      </Suspense>
    </div>
  );
}
