import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Play,
  ArrowsLeftRight,
  Hourglass,
  ArrowRight,
  Microphone,
  ArrowClockwise,
  Trophy,
} from '@phosphor-icons/react';
import { useChordDetector } from '../../hooks/useChordDetector';
import { ProgressRing } from './ProgressRing';
import { Sparkline } from './Sparkline';
import { SignalMeter } from './SignalMeter';
import { classifyLevel, type SignalQuality } from './signalQuality';
import type { DrillConfig } from '../../types';

const CHORDS = ['A', 'C', 'D', 'E', 'G', 'Am', 'Dm', 'Em', 'F'];

type View = 'setup' | 'playing' | 'results';

interface Props {
  config?: DrillConfig;
  onResult?: (cpm: number) => void;
  onClose?: () => void;
  personalBest?: number; // best cpm before this session
  series?: number[]; // chronological cpm history before this session
  autoStart?: boolean; // skip the setup screen and begin immediately (coached)
  onNext?: () => void; // when set, the results "Next" advances a sequence
}

export function OneMinuteChanges({
  config,
  onResult,
  onClose,
  personalBest = 0,
  series = [],
  autoStart = false,
  onNext,
}: Props) {
  const { status, error, start, stop } = useChordDetector();

  const duration = config?.durationSec ?? 60;
  const [from, setFrom] = useState(config?.chordFrom ?? 'D');
  const [to, setTo] = useState(config?.chordTo ?? 'A');

  const [view, setView] = useState<View>('setup');
  const [transitions, setTransitions] = useState(0);
  const [timeLeft, setTimeLeft] = useState(duration);
  const [detected, setDetected] = useState('listening...');
  const [signal, setSignal] = useState<SignalQuality>('silent');
  const signalRef = useRef<SignalQuality>('silent');
  const [result, setResult] = useState<{
    value: number;
    prevBest: number;
    series: number[];
  } | null>(null);

  const lastChordRef = useRef('');
  const lastCountAtRef = useRef(0);
  const transitionsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countRef = useRef<HTMLDivElement>(null);

  // A human can't genuinely alternate two chords faster than this; anything
  // quicker is a detection wobble, not a real change, so we ignore it. ~130ms
  // still allows well over 200 changes/min.
  const MIN_CHANGE_MS = 130;
  // Running best/history that folds in each session completed in this overlay so
  // retries compare against the true best, not just the pre-open snapshot. State
  // (not a ref) so the setup view re-renders with updated values after a retry.
  const [runningBest, setRunningBest] = useState(personalBest);
  const [runningSeries, setRunningSeries] = useState<number[]>(series);

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
      // Reject impossibly-fast flips between the two targets — those are
      // detection wobble during a transition, not real changes.
      const t = Date.now();
      if (t - lastCountAtRef.current >= MIN_CHANGE_MS) {
        transitionsRef.current += 1;
        setTransitions(transitionsRef.current);
        popCount();
        lastCountAtRef.current = t;
      }
    }
    lastChordRef.current = chord;
  };

  const finish = () => {
    clearTimer();
    void stop();
    const value = transitionsRef.current;
    const prevBest = runningBest;
    const seriesSnapshot = [...runningSeries, value];
    setResult({ value, prevBest, series: seriesSnapshot });
    setRunningBest(Math.max(prevBest, value));
    setRunningSeries(seriesSnapshot);
    setView('results');
    onResult?.(value);
  };

  const startSession = () => {
    transitionsRef.current = 0;
    lastChordRef.current = '';
    lastCountAtRef.current = 0;
    setTransitions(0);
    setTimeLeft(duration);
    setDetected('listening...');
    setSignal('silent');
    signalRef.current = 'silent';
    setView('playing');

    // Restrict detection to just the two target chords — removes third-chord
    // misdetections and makes counting far more accurate.
    void start(
      {
        onChord: (ev) => handleChord(ev.chord),
        onLevel: (ev) => {
          const quality = classifyLevel(ev);
          if (quality !== signalRef.current) {
            signalRef.current = quality;
            setSignal(quality);
          }
        },
      },
      { restrictTo: [from, to] },
    );

    clearTimer();
    const deadline = Date.now() + duration * 1000;
    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) finish();
    }, 200);
  };

  useEffect(() => {
    // Defer the auto-start a tick so it runs after mount (keeps setState out of
    // the effect body and is safe across StrictMode's mount/cleanup/mount).
    const t = autoStart ? setTimeout(() => startSession(), 0) : null;
    return () => {
      if (t) clearTimeout(t);
      clearTimer();
      void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (view === 'setup') {
    return (
      <div className="om-setup">
        {runningBest > 0 && (
          <div className="om-best-badge">
            <Trophy size={16} weight="fill" />
            <span>Best {runningBest}</span>
            {runningSeries.length >= 2 && (
              <Sparkline values={runningSeries} className="om-best-spark" />
            )}
          </div>
        )}
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
          <>
            <div className="om-detected">{detected}</div>
            <SignalMeter quality={signal} />
          </>
        )}
      </>
    );
  }

  const value = result?.value ?? transitions;
  const prevBest = result?.prevBest ?? personalBest;
  const resultSeries = result?.series ?? [...runningSeries, value];

  const isFirst = prevBest === 0;
  const isNewBest = !isFirst && value > prevBest;
  const isMatch = !isFirst && value === prevBest;
  const celebrate = isNewBest || (isFirst && value > 0);
  const progress = isFirst ? (value > 0 ? 1 : 0) : value / prevBest;

  let context: string;
  if (isFirst) context = value > 0 ? 'First benchmark set' : 'No changes detected';
  else if (isNewBest) context = `+${value - prevBest} over your best`;
  else if (isMatch) context = 'Matched your best';
  else context = `${prevBest - value} to beat your best`;

  return (
    <motion.div
      className="om-results"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {celebrate && (
        <div className="om-sparkles" aria-hidden="true">
          {Array.from({ length: 10 }).map((_, i) => (
            <motion.span
              key={i}
              className="om-sparkle"
              initial={{ opacity: 0, x: 0, y: 0, scale: 0 }}
              animate={{
                opacity: [0, 1, 0],
                x: Math.cos((i / 10) * Math.PI * 2) * 120,
                y: Math.sin((i / 10) * Math.PI * 2) * 120,
                scale: [0, 1, 0.6],
              }}
              transition={{ duration: 1.1, delay: 0.15 + i * 0.02, ease: 'easeOut' }}
            />
          ))}
        </div>
      )}

      <ProgressRing
        progress={progress}
        className={celebrate ? 'om-ring is-pr' : 'om-ring'}
      >
        <div className="om-ring-value">{value}</div>
        <div className="om-caption">changes / min</div>
      </ProgressRing>

      <div className={celebrate ? 'om-context is-pr' : 'om-context'}>
        {celebrate && <Trophy size={16} weight="fill" />}
        <span>{context}</span>
      </div>

      <div className="om-result-meta">
        <div className="om-pair">
          <span className="target">{from}</span>
          <ArrowsLeftRight size={14} />
          <span className="target">{to}</span>
        </div>
        {resultSeries.length >= 2 && (
          <Sparkline values={resultSeries} className="om-result-spark" width={120} />
        )}
      </div>

      <div className="om-saved-hint">Saved automatically</div>

      <div className="om-actions">
        <button className="practice-btn ghost" onClick={() => onClose?.()}>
          {onNext ? 'End session' : 'Done'}
        </button>
        <button
          className="practice-btn primary"
          onClick={onNext ?? (() => setView('setup'))}
          autoFocus
        >
          {onNext ? 'Next drill' : 'Next'} <ArrowRight size={18} weight="bold" />
        </button>
      </div>
    </motion.div>
  );
}
