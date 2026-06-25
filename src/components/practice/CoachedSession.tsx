import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X, CheckCircle, Trophy } from '@phosphor-icons/react';
import { useStore, getTodayString } from '../../store';
import type { Task } from '../../types';
import { OneMinuteChanges } from './OneMinuteChanges';
import { ChordTrainer } from './ChordTrainer';
import './practice.css';

type Phase = 'intro' | 'drill' | 'summary';

interface Props {
  tasks: Task[]; // scored drill tasks, in order
  onClose: () => void;
}

interface StepResult {
  taskId: string;
  title: string;
  value: number;
  unit: string;
}

function snapshot(taskId: string): { personalBest: number; series: number[] } {
  const state = useStore.getState();
  const acc = state.accounts[state.currentAccountId];
  const points = Object.values(acc?.dailyLogs ?? {})
    .filter((l) => typeof l.drillResults?.[taskId] === 'number')
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((l) => l.drillResults![taskId]);
  return { personalBest: points.reduce((m, v) => Math.max(m, v), 0), series: points };
}

export function CoachedSession({ tasks, onClose }: Props) {
  const recordDrillResult = useStore((s) => s.recordDrillResult);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('intro');
  const [countdown, setCountdown] = useState(3);
  const [results, setResults] = useState<StepResult[]>([]);

  const task = tasks[index];
  const snap = useMemo(() => snapshot(task?.id ?? ''), [task?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // Get-ready countdown before each drill.
  useEffect(() => {
    if (phase !== 'intro') return;
    const started = Date.now();
    const id = setInterval(() => {
      const remaining = 3 - Math.floor((Date.now() - started) / 1000);
      if (remaining <= 0) {
        clearInterval(id);
        setPhase('drill');
      } else {
        setCountdown(remaining);
      }
    }, 200);
    return () => clearInterval(id);
  }, [phase, index]);

  if (!task) return null;

  const advance = () => {
    if (index < tasks.length - 1) {
      setCountdown(3);
      setIndex((i) => i + 1);
      setPhase('intro');
    } else {
      setPhase('summary');
    }
  };

  const handleResult = (value: number) => {
    recordDrillResult(getTodayString(), task.id, value);
    setResults((prev) => [
      ...prev,
      {
        taskId: task.id,
        title: task.title,
        value,
        unit: task.drill?.kind === 'chord-trainer' ? 'nailed' : 'cpm',
      },
    ]);
  };

  const drillLabel =
    task.drill?.kind === 'chord-trainer' ? 'Chord Trainer' : '1-Minute Changes';

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
          Coached · {Math.min(index + 1, tasks.length)} / {tasks.length}
        </span>
        <button className="practice-close" onClick={onClose} title="Exit (Esc)">
          <X size={20} weight="bold" />
        </button>
      </div>

      <div className="practice-body">
        {phase === 'intro' && (
          <motion.div
            key={`intro-${index}`}
            className="coach-intro"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <span className="coach-up-next">Up next</span>
            <div className="coach-intro-title">{task.title}</div>
            <div className="om-caption">{drillLabel}</div>
            <div className="coach-countdown">{countdown}</div>
          </motion.div>
        )}

        {phase === 'drill' && task.drill?.kind === 'one-minute-changes' && (
          <OneMinuteChanges
            key={`drill-${index}`}
            config={task.drill}
            personalBest={snap.personalBest}
            series={snap.series}
            autoStart
            onResult={handleResult}
            onNext={advance}
            onClose={onClose}
          />
        )}

        {phase === 'drill' && task.drill?.kind === 'chord-trainer' && (
          <ChordTrainer
            key={`drill-${index}`}
            config={task.drill}
            personalBest={snap.personalBest}
            series={snap.series}
            autoStart
            onResult={handleResult}
            onNext={advance}
            onClose={onClose}
          />
        )}

        {phase === 'summary' && (
          <motion.div
            className="coach-summary"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Trophy size={40} weight="fill" className="coach-summary-trophy" />
            <h2 className="coach-summary-title">Session complete</h2>
            <div className="coach-summary-list">
              {results.map((r, i) => (
                <div key={`${r.taskId}-${i}`} className="coach-summary-row">
                  <CheckCircle size={18} weight="fill" className="coach-summary-check" />
                  <span className="coach-summary-name">{r.title}</span>
                  <span className="coach-summary-val">
                    {r.value} <span className="coach-summary-unit">{r.unit}</span>
                  </span>
                </div>
              ))}
            </div>
            <button className="practice-btn primary" onClick={onClose} autoFocus>
              Done
            </button>
          </motion.div>
        )}
      </div>
    </motion.div>,
    document.body,
  );
}
