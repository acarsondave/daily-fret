import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Play,
  Hourglass,
  ArrowRight,
  Microphone,
  ArrowClockwise,
  Trophy,
} from '@phosphor-icons/react';
import { useChordDetector, type ChordDetectorApi } from '../../hooks/useChordDetector';
import { useLearnedTemplates } from '../../hooks/useLearnedTemplates';
import { usePassiveRefine } from '../../hooks/usePassiveRefine';
import { ProgressRing } from './ProgressRing';
import { Sparkline } from './Sparkline';
import { SignalMeter } from './SignalMeter';
import { useSignalMeter } from './signalQuality';
import { sfx } from '../../audio/sfx';
import { diag } from '../../audio/diagnostics';
import type { DrillConfig } from '../../types';

const ALL_CHORDS = ['A', 'C', 'D', 'E', 'G', 'Am', 'Dm', 'Em', 'F'];
const DEFAULT_POOL = ['A', 'D', 'E', 'G', 'C'];
const AUTO_ADVANCE_SECONDS = 5;

type View = 'setup' | 'playing' | 'results';

interface Props {
  config?: DrillConfig;
  onResult?: (score: number) => void;
  onClose?: () => void;
  personalBest?: number;
  series?: number[];
  autoStart?: boolean;
  onNext?: () => void;
  autoAdvance?: boolean; // results auto-continue after a short countdown (no button)
  nextLabel?: string; // what the auto-advance is moving toward, e.g. "Rest"
  detector?: ChordDetectorApi;
}

export function ChordTrainer({
  config,
  onResult,
  onClose,
  personalBest = 0,
  series = [],
  autoStart = false,
  onNext,
  autoAdvance = false,
  nextLabel = 'Up next',
  detector,
}: Props) {
  const own = useChordDetector();
  const templates = useLearnedTemplates();
  const passive = usePassiveRefine();
  const sharedMic = !!detector;
  const { status, error, start, stop, setHandlers } = detector ?? own;

  const duration = config?.durationSec ?? 60;
  const [pool, setPool] = useState<string[]>(
    config?.chords?.length ? config.chords : DEFAULT_POOL,
  );

  // Coached mode skips setup; start on 'playing' so the chord preselector never
  // flashes for a frame before auto-start kicks in.
  const [view, setView] = useState<View>(autoStart ? 'playing' : 'setup');
  const [target, setTarget] = useState('');
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(duration);
  const { quality: signal, push: pushSignal, reset: resetSignal } = useSignalMeter();
  const [result, setResult] = useState<{ value: number; prevBest: number; series: number[] } | null>(null);

  const targetRef = useRef('');
  const scoreRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const popTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [runningBest, setRunningBest] = useState(personalBest);
  const [runningSeries, setRunningSeries] = useState<number[]>(series);
  // Coached mode auto-continues from results after a brief beat (no tap needed).
  const [advanceLeft, setAdvanceLeft] = useState(AUTO_ADVANCE_SECONDS);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const pickTarget = (exclude: string) => {
    const choices = pool.filter((c) => c !== exclude);
    const next = choices.length ? choices : pool;
    return next[Math.floor(Math.random() * next.length)];
  };

  const popHero = () => {
    const el = heroRef.current;
    if (!el) return;
    el.classList.remove('is-hit');
    void el.offsetWidth;
    el.classList.add('is-hit');
    if (popTimer.current) clearTimeout(popTimer.current);
    popTimer.current = setTimeout(() => el.classList.remove('is-hit'), 320);
  };

  const handleChord = (chord: string) => {
    if (chord !== targetRef.current) return;
    scoreRef.current += 1;
    setScore(scoreRef.current);
    popHero();
    const next = pickTarget(targetRef.current);
    targetRef.current = next;
    setTarget(next);
    // Records what the drill is asking for, so exported frames can be read as
    // "target was X, detector said Y".
    diag.mark(`trainer target: ${next}`);
  };

  const finish = () => {
    clearTimer();
    diag.mark(`trainer finish: nailed ${scoreRef.current}`);
    if (sharedMic) setHandlers({});
    else void stop();
    passive.commit();
    const value = scoreRef.current;
    const prevBest = runningBest;
    const celebrate = prevBest === 0 ? value > 0 : value > prevBest;
    if (celebrate) sfx.best();
    else sfx.complete();
    const seriesSnapshot = [...runningSeries, value];
    setResult({ value, prevBest, series: seriesSnapshot });
    setRunningBest(Math.max(prevBest, value));
    setRunningSeries(seriesSnapshot);
    setView('results');
    onResult?.(value);
  };

  const startSession = async () => {
    sfx.go();
    scoreRef.current = 0;
    setScore(0);
    setTimeLeft(duration);
    resetSignal();
    const first = pool[Math.floor(Math.random() * pool.length)] ?? pool[0];
    targetRef.current = first;
    setTarget(first);
    setView('playing');

    // Wait for the mic before starting the clock so the permission prompt
    // doesn't burn the timer, and bail cleanly if access is denied.
    const live = await start(
      {
        onChord: (ev) => handleChord(ev.chord),
        onLevel: (ev) => {
          pushSignal(ev);
          passive.observe(targetRef.current, ev);
        },
      },
      { restrictTo: pool, templates },
    );
    if (!live) return;
    diag.mark(`trainer start [${pool.join(', ')}] (${duration}s), target: ${first}`);

    clearTimer();
    const deadline = Date.now() + duration * 1000;
    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) finish();
    }, 200);
  };

  useEffect(() => {
    // Defer the auto-start a tick (keeps setState out of the effect body and is
    // safe across StrictMode's mount/cleanup/mount).
    const t = autoStart ? setTimeout(() => startSession(), 0) : null;
    return () => {
      if (t) clearTimeout(t);
      clearTimer();
      if (popTimer.current) clearTimeout(popTimer.current);
      if (!sharedMic) void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hands-free advance once results land in coached mode.
  useEffect(() => {
    if (view !== 'results' || !autoAdvance || !onNext) return;
    const deadline = Date.now() + AUTO_ADVANCE_SECONDS * 1000;
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setAdvanceLeft(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        onNext();
      }
    }, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, autoAdvance]);

  const toggleChord = (c: string) => {
    setPool((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  };

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
        <p className="om-caption">Pick the chords to drill</p>
        <div className="ct-chip-grid">
          {ALL_CHORDS.map((c) => (
            <button
              key={c}
              type="button"
              className={pool.includes(c) ? 'ct-chip is-on' : 'ct-chip'}
              onClick={() => toggleChord(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <button
          className="practice-btn primary"
          onClick={startSession}
          disabled={pool.length < 2}
        >
          <Play size={20} weight="fill" /> Start {duration}s
        </button>
        {pool.length < 2 && <p className="om-caption">Pick at least two chords</p>}
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
        <div className="practice-mode is-chord">play this chord</div>
        <div ref={heroRef} className="practice-hero ct-target">
          {target}
        </div>
        <div className="ct-stats">
          <span className="ct-score">{score} nailed</span>
          <span className="om-timer">
            <Hourglass size={22} /> {timeLeft}
          </span>
        </div>
        <SignalMeter quality={signal} />
      </>
    );
  }

  const value = result?.value ?? score;
  const prevBest = result?.prevBest ?? personalBest;
  const resultSeries = result?.series ?? [...runningSeries, value];

  const isFirst = prevBest === 0;
  const isNewBest = !isFirst && value > prevBest;
  const celebrate = isNewBest || (isFirst && value > 0);
  const progress = isFirst ? (value > 0 ? 1 : 0) : value / Math.max(prevBest, 1);

  let context: string;
  if (isFirst) context = value > 0 ? 'First benchmark set' : 'No chords detected';
  else if (isNewBest) context = `+${value - prevBest} over your best`;
  else if (value === prevBest) context = 'Matched your best';
  else context = `${prevBest - value} to beat your best`;

  return (
    <motion.div
      className="om-results"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <ProgressRing progress={progress} className={celebrate ? 'om-ring is-pr' : 'om-ring'}>
        <div className="om-ring-value">{value}</div>
        <div className="om-caption">chords nailed</div>
      </ProgressRing>

      <div className={celebrate ? 'om-context is-pr' : 'om-context'}>
        {celebrate && <Trophy size={16} weight="fill" />}
        <span>{context}</span>
      </div>

      {resultSeries.length >= 2 && (
        <Sparkline values={resultSeries} className="om-result-spark" width={120} />
      )}

      <div className="om-saved-hint">Saved automatically</div>

      {autoAdvance ? (
        <div className="coach-advance">
          <span className="coach-advance-label">{nextLabel} in</span>
          <span className="coach-advance-count">{advanceLeft}</span>
        </div>
      ) : (
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
      )}
    </motion.div>
  );
}
