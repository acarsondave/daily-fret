import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useChordDetector, type ChordDetectorApi } from '../../hooks/useChordDetector';
import { ProgressRing } from './ProgressRing';
import { Sparkline } from './Sparkline';
import { SignalMeter } from './SignalMeter';
import { useSignalMeter } from './signalQuality';
import { useStore } from '../../store';
import { pairKey } from '../../lib/pairs';
import type { DrillConfig } from '../../types';

const CHORDS = ['A', 'C', 'D', 'E', 'G', 'Am', 'Dm', 'Em', 'F'];
const EMPTY_LOGS = {};

type View = 'setup' | 'playing' | 'results';

interface Props {
  config?: DrillConfig;
  onResult?: (cpm: number, from: string, to: string) => void;
  onClose?: () => void;
  autoStart?: boolean; // skip the setup screen and begin immediately (coached)
  onNext?: () => void; // when set, the results "Next" advances a sequence
  defaultPair?: { from: string; to: string }; // reopen on the last pair played
  onSessionStart?: (from: string, to: string) => void; // remember the pair
  detector?: ChordDetectorApi; // shared mic (Coached) so it isn't restarted per drill
  chordPool?: string[]; // the chords this task practises switching between
}

export function OneMinuteChanges({
  config,
  onResult,
  onClose,
  autoStart = false,
  onNext,
  defaultPair,
  onSessionStart,
  detector,
  chordPool,
}: Props) {
  const own = useChordDetector();
  const sharedMic = !!detector;
  const { status, error, start, stop, setHandlers } = detector ?? own;

  // Selectable chords for this drill — the task's comfortable set, falling back
  // to the full list. The initial pair prefers the remembered pair when it fits.
  const pool = chordPool && chordPool.length >= 2 ? chordPool : CHORDS;
  const duration = config?.durationSec ?? 60;
  const initFrom = config?.chordFrom ?? (defaultPair && pool.includes(defaultPair.from) ? defaultPair.from : pool[0]);
  const initTo =
    config?.chordTo ??
    (defaultPair && pool.includes(defaultPair.to) && defaultPair.to !== initFrom
      ? defaultPair.to
      : pool.find((c) => c !== initFrom) ?? pool[1]);
  const [from, setFrom] = useState(initFrom);
  const [to, setTo] = useState(initTo);

  // Per-pair history, sourced straight from the store so each pair keeps its own
  // benchmark and the setup badge reflects whatever pair is currently selected.
  const dailyLogs = useStore((s) => s.accounts[s.currentAccountId]?.dailyLogs ?? EMPTY_LOGS);
  const { pairBest, pairSeries } = useMemo(() => {
    const key = pairKey(from, to);
    const points = Object.values(dailyLogs)
      .filter((l) => typeof l.drillResults?.[key] === 'number')
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((l) => l.drillResults![key]);
    return {
      pairBest: points.reduce((m, v) => Math.max(m, v), 0),
      pairSeries: points,
    };
  }, [dailyLogs, from, to]);

  const [view, setView] = useState<View>('setup');
  const [transitions, setTransitions] = useState(0);
  const [timeLeft, setTimeLeft] = useState(duration);
  const [detected, setDetected] = useState('listening...');
  const { quality: signal, push: pushSignal, reset: resetSignal } = useSignalMeter();
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
  // Best for the current pair captured at the moment a session starts, so the
  // results screen compares against the pre-session best (the store already
  // holds the new result by the time results render).
  const prevBestRef = useRef(0);

  // A human can't genuinely alternate two chords faster than this; anything
  // quicker is a detection wobble, not a real change, so we ignore it. ~130ms
  // still allows well over 200 changes/min.
  const MIN_CHANGE_MS = 130;

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
    // Shared mic stays live for the next segment, but detach our handlers so a
    // ringing chord during the results screen / rest can't drive this drill.
    if (sharedMic) setHandlers({});
    else void stop();
    const value = transitionsRef.current;
    setResult({ value, prevBest: prevBestRef.current, series: [] });
    setView('results');
    onResult?.(value, from, to);
  };

  const startSession = async () => {
    transitionsRef.current = 0;
    lastChordRef.current = '';
    lastCountAtRef.current = 0;
    setTransitions(0);
    setTimeLeft(duration);
    setDetected('listening...');
    resetSignal();
    prevBestRef.current = pairBest;
    onSessionStart?.(from, to);
    setView('playing');

    // Restrict detection to just the two target chords — removes third-chord
    // misdetections and makes counting far more accurate. Wait for the mic to
    // actually be live before starting the clock so the permission prompt
    // doesn't eat into the timer (and we bail cleanly if it's denied).
    const live = await start(
      {
        onChord: (ev) => handleChord(ev.chord),
        onLevel: (ev) => pushSignal(ev),
      },
      { restrictTo: [from, to] },
    );
    if (!live) return; // denied / failed — the mic gate view takes over

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
      if (!sharedMic) void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (view === 'setup') {
    return (
      <div className="om-setup">
        {pairBest > 0 && (
          <div className="om-best-badge">
            <Trophy size={16} weight="fill" />
            <span>Best {pairBest}</span>
            {pairSeries.length >= 2 && (
              <Sparkline values={pairSeries} className="om-best-spark" />
            )}
          </div>
        )}
        <div className="om-selects">
          <select
            className="om-select"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          >
            {pool.map((c) => (
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
            {pool.map((c) => (
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
    if (status === 'error') {
      return (
        <div className="mic-gate">
          <Microphone size={40} weight="duotone" color="var(--text-secondary)" />
          <p>{error ?? 'Microphone unavailable.'}</p>
          <button className="practice-btn primary" onClick={startSession}>
            <ArrowClockwise size={18} weight="bold" /> Try again
          </button>
        </div>
      );
    }
    if (status !== 'running') {
      return (
        <div className="mic-gate">
          <Microphone size={40} weight="duotone" color="var(--accent-primary)" />
          <p>Allow microphone access to begin…</p>
        </div>
      );
    }
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
        <div className="om-detected">{detected}</div>
        <SignalMeter quality={signal} />
      </>
    );
  }

  const value = result?.value ?? transitions;
  const prevBest = result?.prevBest ?? 0;

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
      </div>

      <div className="om-saved-hint">Saved automatically · see Progress for trends</div>

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
