import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X, CheckCircle, Trophy } from '@phosphor-icons/react';
import { useStore, getTodayString } from '../../store';
import { pairKey } from '../../lib/pairs';
import { buildSegments } from '../../lib/coached';
import type { Routine } from '../../types';
import { OneMinuteChanges } from './OneMinuteChanges';
import { ChordTrainer } from './ChordTrainer';
import { TimedSegment } from './TimedSegment';
import './practice.css';

type Phase = 'intro' | 'segment' | 'summary';

interface Props {
  routine: Routine;
  onClose: () => void;
}

interface StepResult {
  title: string;
  value: number | null;
  unit: string;
}

function mins(seconds: number): string {
  const m = Math.round(seconds / 60);
  return `${m} min${m === 1 ? '' : 's'}`;
}

export function CoachedSession({ routine, onClose }: Props) {
  const recordDrillResult = useStore((s) => s.recordDrillResult);
  const completeTask = useStore((s) => s.completeTask);
  const setLastPair = useStore((s) => s.setLastPair);

  const segments = useMemo(() => buildSegments(routine), [routine]);

  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('intro');
  const [countdown, setCountdown] = useState(3);
  const [results, setResults] = useState<StepResult[]>([]);
  const lastValueRef = useRef<number | null>(null);

  const seg = segments[index];

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

  // Get-ready countdown before each segment.
  useEffect(() => {
    if (phase !== 'intro') return;
    const started = Date.now();
    const id = setInterval(() => {
      const remaining = 3 - Math.floor((Date.now() - started) / 1000);
      if (remaining <= 0) {
        clearInterval(id);
        setPhase('segment');
      } else {
        setCountdown(remaining);
      }
    }, 200);
    return () => clearInterval(id);
  }, [phase, index]);

  if (!seg) {
    // Routine has no runnable segments.
    return createPortal(
      <motion.div className="practice-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div className="practice-topbar">
          <span className="practice-eyebrow">Coached</span>
          <button className="practice-close" onClick={onClose}><X size={20} weight="bold" /></button>
        </div>
        <div className="practice-body">
          <p className="om-caption">This routine has no drills or timed tasks yet.</p>
          <button className="practice-btn primary" onClick={onClose}>Done</button>
        </div>
      </motion.div>,
      document.body,
    );
  }

  const advance = (result?: StepResult) => {
    if (result) setResults((prev) => [...prev, result]);
    if (index < segments.length - 1) {
      setCountdown(3);
      setIndex((i) => i + 1);
      setPhase('intro');
    } else {
      setPhase('summary');
    }
  };

  const subLabel =
    seg.kind === 'changes'
      ? `${seg.from} ↔ ${seg.to}`
      : seg.kind === 'trainer'
        ? `Chord Trainer · ${seg.chords.join(' ')}`
        : mins(seg.seconds);

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
          Coached · {Math.min(index + 1, segments.length)} / {segments.length}
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
            <div className="coach-intro-title">{seg.title}</div>
            <div className="om-caption">{subLabel}</div>
            <div className="coach-countdown">{countdown}</div>
          </motion.div>
        )}

        {phase === 'segment' && seg.kind === 'changes' && (
          <OneMinuteChanges
            key={`seg-${index}`}
            config={{ kind: 'one-minute-changes', chordFrom: seg.from, chordTo: seg.to, durationSec: 60 }}
            autoStart
            onResult={(cpm, f, t) => {
              recordDrillResult(getTodayString(), seg.taskId, cpm, pairKey(f, t));
              setLastPair(f, t);
              lastValueRef.current = cpm;
            }}
            onNext={() =>
              advance({ title: `${seg.from} ↔ ${seg.to}`, value: lastValueRef.current, unit: 'cpm' })
            }
            onClose={onClose}
          />
        )}

        {phase === 'segment' && seg.kind === 'trainer' && (
          <ChordTrainer
            key={`seg-${index}`}
            config={{ kind: 'chord-trainer', chords: seg.chords, durationSec: 60 }}
            autoStart
            onResult={(score) => {
              recordDrillResult(getTodayString(), seg.taskId, score);
              lastValueRef.current = score;
            }}
            onNext={() => advance({ title: seg.title, value: lastValueRef.current, unit: 'nailed' })}
            onClose={onClose}
          />
        )}

        {phase === 'segment' && seg.kind === 'timed' && (
          <TimedSegment
            key={`seg-${index}`}
            title={seg.title}
            description={seg.description}
            seconds={seg.seconds}
            onDone={() => {
              completeTask(getTodayString(), seg.taskId);
              advance({ title: seg.title, value: null, unit: '' });
            }}
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
                <div key={i} className="coach-summary-row">
                  <CheckCircle size={18} weight="fill" className="coach-summary-check" />
                  <span className="coach-summary-name">{r.title}</span>
                  {r.value !== null && (
                    <span className="coach-summary-val">
                      {r.value} <span className="coach-summary-unit">{r.unit}</span>
                    </span>
                  )}
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
