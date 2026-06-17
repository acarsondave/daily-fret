import { useStore, useUserData, getTodayString } from '../store';
import { Check, Circle } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import './TaskRow.css';

interface TaskRowProps {
  taskId: string;
  title: string;
  description?: string;
  duration?: string;
}

export function TaskRow({ taskId, title, description, duration }: TaskRowProps) {
  const today = getTodayString();
  const toggleTaskCompletion = useStore((state) => state.toggleTaskCompletion);
  const userData = useUserData();
  const log = userData?.dailyLogs?.[today];
  
  const isCompleted = log?.completedTaskIds?.includes(taskId) || false;

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={clsx('task-row', isCompleted && 'completed')}
      onClick={() => toggleTaskCompletion(today, taskId)}
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
  );
}
