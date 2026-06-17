import { useState, useMemo } from 'react';
import { useStore, useUserData, getTodayString } from '../store';
import { TaskRow } from './TaskRow';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightning, DotsThreeCircle, Plus } from '@phosphor-icons/react';
import './DailyPath.css';

export function DailyPath() {
  const today = getTodayString();
  const userData = useUserData();
  const { routines, activeRoutineId, dailyLogs } = userData;
  const setActiveRoutine = useStore(state => state.setActiveRoutine);
  const log = dailyLogs[today];

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const activeRoutine = useMemo(() => {
    return routines.find(r => r.id === activeRoutineId) || routines[0];
  }, [routines, activeRoutineId]);

  const allCompleted = activeRoutine && activeRoutine.tasks.length > 0 && 
    activeRoutine.tasks.every(t => log?.completedTaskIds.includes(t.id));

  const displayDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });

  if (!activeRoutine) return null;

  return (
    <div className="daily-path">
      <header className="path-header">
        <div className="date-display">
          <motion.h1 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="today-title"
          >
            {displayDate}
          </motion.h1>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="routine-selector-container"
          >
            <button 
              className="routine-selector"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            >
              <Lightning weight="fill" color="var(--accent-primary)" />
              <span>{activeRoutine.name}</span>
              <DotsThreeCircle size={20} color="var(--text-secondary)" />
            </button>
            
            <AnimatePresence>
              {isDropdownOpen && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -10 }}
                  className="routine-dropdown glass-panel"
                >
                  {routines.map(r => (
                    <button 
                      key={r.id} 
                      className={`dropdown-item ${r.id === activeRoutineId ? 'active' : ''}`}
                      onClick={() => {
                        setActiveRoutine(r.id);
                        setIsDropdownOpen(false);
                      }}
                    >
                      {r.name}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </header>

      <div className="task-list">
        <AnimatePresence mode="popLayout">
          {activeRoutine.tasks.map((task, idx) => (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <TaskRow taskId={task.id} title={task.title} description={task.description} duration={task.duration} />
            </motion.div>
          ))}
        </AnimatePresence>

        <motion.button 
          className="add-task-btn"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Plus size={16} />
          <span>Add Quick Task</span>
        </motion.button>
      </div>

      <AnimatePresence>
        {allCompleted && (
          <motion.div 
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            className="jotter-container glass-panel"
          >
            <h3 className="jotter-title">Routine Complete.</h3>
            <p className="jotter-subtitle">Thoughts on today's session? Where are you at now?</p>
            <textarea 
              className="jotter-input"
              placeholder="Felt great on the spider exercises, transitions were smooth..."
              value={log?.feedback || ''}
              onChange={(e) => useStore.getState().saveFeedback(today, e.target.value)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
