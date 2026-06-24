import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Play,
  ArrowsLeftRight,
  Hourglass,
  CheckCircle,
  ArrowCounterClockwise,
  Check,
  Microphone,
  ArrowClockwise,
} from '@phosphor-icons/react';
import { useChordDetector } from '../../hooks/useChordDetector';
import type { DrillConfig } from '../../types';

const CHORDS = ['A', 'C', 'D', 'E', 'G', 'Am', 'Dm', 'Em', 'F'];

type View = 'setup' | 'playing' | 'results';

interface Props {
  config?: DrillConfig;
  onResult?: (cpm: number) => void;
  onClose?: () => void;
}

export function OneMinuteChanges({ config, onResult, onClose }: Props) {
  const { status, error, start, stop } = useChordDetector();

  const duration = config?.durationSec ?? 60;
  const [from, setFrom] = useState(config?.chordFrom ?? 'D');
  const [to, setTo] = useState(config?.chordTo ?? 'A');

  const [view, setView] = useState<View>('setup');
  const [transitions, setTransitions] = useState(0);
  const [timeLeft, setTimeLeft] = useState(duration);
  const [detected, setDetected] = useState('listening...');

  const lastChordRef = useRef('');
  const transitionsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countRef = useRef<HTMLDivElement>(null);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const popCount = () => {
    const el = countRef.current;
    if (!el) return;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  };

  const handleChord = (chord: string) => {
    setDetected(chord);
    const isTarget = chord === from || chord === to;
    if (!isTarget) return;
    if (lastChordRef.current !== '' && chord !== lastChordRef.current) {
      transitionsRef.current += 1;
      setTransitions(transitionsRef.current);
      popCount();
    }
    lastChordRef.current = chord;
  };

  const finish = () => {
    clearTimer();
    void stop();
    setView('results');
    onResult?.(transitionsRef.current);
  };

  const startSession = () => {
    transitionsRef.current = 0;
    lastChordRef.current = '';
    setTransitions(0);
    setTimeLeft(duration);
    setDetected('listening...');
    setView('playing');

    void start({ onChord: (ev) => handleChord(ev.chord) });

    clearTimer();
    const deadline = Date.now() + duration * 1000;
    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) finish();
    }, 200);
  };

  useEffect(() => {
    return () => {
      clearTimer();
      void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (view === 'setup') {
    return (
      <div className="om-setup">
        <div className="om-selects">
          <select
            className="om-select"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          >
            {CHORDS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <ArrowsLeftRight className="om-arrow" size={28} />
          <select
            className="om-select"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          >
            {CHORDS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <button
          className="practice-btn primary"
          onClick={startSession}
          disabled={from === to}
        >
          <Play size={20} weight="fill" /> Start {duration}s
        </button>
        {from === to && <p className="om-caption">Pick two different chords</p>}
      </div>
    );
  }

  if (view === 'playing') {
    const micFailed = status === 'error';
    return (
      <>
        <div className="om-pair">
          <span className={detected === from ? 'target' : ''}>{from}</span>
          <ArrowsLeftRight size={16} />
          <span className={detected === to ? 'target' : ''}>{to}</span>
        </div>
        <div ref={countRef} className="om-count">
          {transitions}
        </div>
        <div className="om-caption">transitions</div>
        <div className="om-timer">
          <Hourglass size={26} /> {timeLeft}
        </div>
        {micFailed ? (
          <div className="mic-gate">
            <Microphone size={32} weight="duotone" color="var(--text-secondary)" />
            <p>{error ?? 'Microphone unavailable.'}</p>
            <button className="practice-btn ghost" onClick={startSession}>
              <ArrowClockwise size={16} weight="bold" /> Retry
            </button>
          </div>
        ) : (
          <div className="om-detected">{detected}</div>
        )}
      </>
    );
  }

  return (
    <motion.div
      className="om-results"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--success-color)' }}>
        <CheckCircle size={32} weight="fill" />
        <h2 style={{ margin: 0 }}>Done</h2>
      </div>
      <div className="om-count" style={{ fontSize: 'clamp(4rem, 16vw, 8rem)' }}>
        {transitions}
      </div>
      <div className="om-caption">changes per minute</div>
      <div className="om-pair">
        <span className="target">{from}</span>
        <ArrowsLeftRight size={16} />
        <span className="target">{to}</span>
      </div>
      <div className="om-actions">
        <button className="practice-btn ghost" onClick={() => setView('setup')}>
          <ArrowCounterClockwise size={18} /> Retry
        </button>
        <button
          className="practice-btn primary"
          onClick={() => {
            onResult?.(transitionsRef.current);
            onClose?.();
          }}
        >
          <Check size={18} weight="bold" /> Save
        </button>
      </div>
    </motion.div>
  );
}
