import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X, CheckCircle, Trophy, Megaphone } from '@phosphor-icons/react';
import { useStore, getTodayString, type CoachStepResult } from '../../store';
import { pairKey } from '../../lib/pairs';
import { buildSegments } from '../../lib/coached';
import { sfx } from '../../audio/sfx';
import { speak, preloadCoachVoice, stopVoice, isCoachVoiceEnabled, setCoachVoiceEnabled } from '../../audio/coachVoice';
import { useChordDetector } from '../../hooks/useChordDetector';
import type { Routine } from '../../types';
import { OneMinuteChanges } from './OneMinuteChanges';
import { ChordTrainer } from './ChordTrainer';
import { TimedSegment } from './TimedSegment';
import './practice.css';

type Phase = 'resume' | 'intro' | 'rest' | 'segment' | 'summary';

const INTRO_SECONDS = 3;
const REST_SECONDS = 30;

interface Props {
  routine: Routine;
  onClose: () => void;
}

function mins(seconds: number): string {
  const m = Math.round(seconds / 60);
  return `${m} min${m === 1 ? '' : 's'}`;
}

export function CoachedSession({ routine, onClose }: Props) {
  const recordDrillResult = useStore((s) => s.recordDrillResult);
  const completeTask = useStore((s) => s.completeTask);
  const setLastPair = useStore((s) => s.setLastPair);
  const saveCoachProgress = useStore((s) => s.saveCoachProgress);
  const clearCoachProgress = useStore((s) => s.clearCoachProgress);

  const segments = useMemo(() => buildSegments(routine), [routine]);
  const today = getTodayString();

  // One mic for the whole session — segments share it via the `detector` prop so
  // we don't re-request permission (and re-spin the audio graph) per drill.
  const detector = useChordDetector();

  // Resume support: pick up a saved, unfinished session for this routine/day.
  const [resumeData] = useState(() => {
    const s = useStore.getState();
    const cp = s.accounts[s.currentAccountId]?.coachProgress;
    if (cp && cp.routineId === routine.id && cp.date === today && cp.index > 0 && cp.index < segments.length) {
      return cp;
    }
    return null;
  });

  const [index, setIndex] = useState(() => resumeData?.index ?? 0);
  const [results, setResults] = useState<CoachStepResult[]>(() => resumeData?.results ?? []);
  const [phase, setPhase] = useState<Phase>(() => (resumeData ? 'resume' : 'intro'));
  const [countdown, setCountdown] = useState(INTRO_SECONDS);
  const [restLeft, setRestLeft] = useState(REST_SECONDS);
  const [voiceOn, setVoiceOn] = useState(isCoachVoiceEnabled());
  const restLeftRef = useRef(REST_SECONDS);
  const lastValueRef = useRef<number | null>(null);

  const seg = segments[index];
  const isLastSegment = index >= segments.length - 1;
  // A task can fan out into several segments (e.g. one-minute-changes → one per
  // chord pair). It only counts as "done" once its *final* segment is finished,
  // so checking off after a single pair no longer fires early.
  const isFinalSegmentOfTask = (i: number) =>
    !!segments[i] && segments[i + 1]?.taskId !== segments[i].taskId;

  const exit = () => {
    if (phase !== 'summary' && index > 0) {
      saveCoachProgress({ routineId: routine.id, date: today, index, results });
    }
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exit();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index, results]);

  // Warm the voice pack so the first line doesn't lag.
  useEffect(() => {
    preloadCoachVoice();
  }, []);

  // Release the shared mic and silence the coach when the session unmounts.
  useEffect(() => {
    return () => {
      void detector.stop();
      stopVoice();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Get-ready countdown before a segment.
  useEffect(() => {
    if (phase !== 'intro') return;
    void speak('up-next'); // announce the first drill as the count-in runs
    const started = Date.now();
    let lastShown = -1;
    const id = setInterval(() => {
      const remaining = INTRO_SECONDS - Math.floor((Date.now() - started) / 1000);
      if (remaining <= 0) {
        clearInterval(id);
        setPhase('segment');
      } else if (remaining !== lastShown) {
        lastShown = remaining;
        setCountdown(remaining);
        sfx.tick(); // 3 · 2 · 1 count-in
      }
    }, 200);
    return () => clearInterval(id);
  }, [phase, index]);

  // Rest timer between segments (gym-style). Fully automatic — it counts itself
  // down and rolls into the next drill, so there's nothing to tap during a rest.
  useEffect(() => {
    if (phase !== 'rest') return;
    // A second, encouraging line partway through the rest (stretch reminders etc.).
    const tip = setTimeout(() => void speak('rest-tip', false), 6000);
    const deadline = Date.now() + restLeftRef.current * 1000;
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      restLeftRef.current = remaining;
      setRestLeft(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        setPhase('segment');
      }
    }, 250);
    return () => {
      clearInterval(id);
      clearTimeout(tip);
    };
  }, [phase]);

  if (!seg) {
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

  const advance = (result?: CoachStepResult) => {
    // Tick the underlying task off only when this was its last segment, so a
    // multi-pair changes task isn't marked done after a single pair.
    if (isFinalSegmentOfTask(index)) {
      completeTask(today, seg.taskId);
    }
    const nextResults = result ? [...results, result] : results;
    setResults(nextResults);
    const nextIndex = index + 1;
    if (nextIndex < segments.length) {
      saveCoachProgress({ routineId: routine.id, date: today, index: nextIndex, results: nextResults });
      setIndex(nextIndex);
      restLeftRef.current = REST_SECONDS;
      setRestLeft(REST_SECONDS);
      setPhase('rest');
      sfx.rest();
      void speak('rest-start');
    } else {
      clearCoachProgress();
      void detector.stop();
      setPhase('summary');
      sfx.sessionComplete();
      void speak('session');
    }
  };

  const startOver = () => {
    setIndex(0);
    setResults([]);
    clearCoachProgress();
    setPhase('intro');
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
        <div className="practice-topbar-actions">
          <button
            className={voiceOn ? 'practice-close' : 'practice-close is-off'}
            onClick={() => {
              const next = !voiceOn;
              setCoachVoiceEnabled(next);
              setVoiceOn(next);
            }}
            title={voiceOn ? 'Coach voice on' : 'Coach voice off'}
            aria-pressed={voiceOn}
          >
            <Megaphone size={20} weight={voiceOn ? 'fill' : 'regular'} />
          </button>
          <button className="practice-close" onClick={exit} title="Exit (Esc) — your place is saved">
            <X size={20} weight="bold" />
          </button>
        </div>
      </div>

      <div className="practice-body">
        {phase === 'resume' && (
          <motion.div className="coach-intro" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <span className="coach-up-next">Resume session</span>
            <div className="coach-intro-title">{routine.name}</div>
            <div className="om-caption">You stopped at {index + 1} / {segments.length}</div>
            <div className="om-actions">
              <button className="practice-btn ghost" onClick={startOver}>Start over</button>
              <button className="practice-btn primary" onClick={() => setPhase('intro')} autoFocus>
                Resume
              </button>
            </div>
          </motion.div>
        )}

        {phase === 'intro' && (
          <motion.div key={`intro-${index}`} className="coach-intro" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <span className="coach-up-next">Up next</span>
            <div className="coach-intro-title">{seg.title}</div>
            <div className="om-caption">{subLabel}</div>
            <div className="coach-countdown">{countdown}</div>
          </motion.div>
        )}

        {phase === 'rest' && (
          <motion.div key={`rest-${index}`} className="coach-intro" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <span className="coach-up-next">Rest</span>
            <div className="coach-countdown">{restLeft}</div>
            <div className="om-caption">Next: {seg.title} · {subLabel}</div>
          </motion.div>
        )}

        {phase === 'segment' && seg.kind === 'changes' && (
          <OneMinuteChanges
            key={`seg-${index}`}
            config={{ kind: 'one-minute-changes', chordFrom: seg.from, chordTo: seg.to, durationSec: seg.seconds }}
            autoStart
            autoAdvance
            nextLabel={isLastSegment ? 'Finishing' : 'Rest'}
            detector={detector}
            onResult={(cpm, f, t) => {
              // Don't auto-complete the task here — Coached marks it done only
              // after the last pair (see advance / isFinalSegmentOfTask).
              recordDrillResult(today, seg.taskId, cpm, pairKey(f, t), false);
              setLastPair(f, t);
              lastValueRef.current = cpm;
              void speak('done');
            }}
            onNext={() => advance({ title: `${seg.from} ↔ ${seg.to}`, value: lastValueRef.current, unit: 'cpm' })}
            onClose={exit}
          />
        )}

        {phase === 'segment' && seg.kind === 'trainer' && (
          <ChordTrainer
            key={`seg-${index}`}
            config={{ kind: 'chord-trainer', chords: seg.chords, durationSec: seg.seconds }}
            autoStart
            autoAdvance
            nextLabel={isLastSegment ? 'Finishing' : 'Rest'}
            detector={detector}
            onResult={(score) => {
              recordDrillResult(today, seg.taskId, score, undefined, false);
              lastValueRef.current = score;
              void speak('done');
            }}
            onNext={() => advance({ title: seg.title, value: lastValueRef.current, unit: 'nailed' })}
            onClose={exit}
          />
        )}

        {phase === 'segment' && seg.kind === 'timed' && (
          <TimedSegment
            key={`seg-${index}`}
            title={seg.title}
            description={seg.description}
            seconds={seg.seconds}
            nextLabel={isLastSegment ? 'Finishing' : 'Rest'}
            onFinish={() => void speak('done')}
            onDone={() => advance({ title: seg.title, value: null, unit: '' })}
          />
        )}

        {phase === 'summary' && (
          <motion.div className="coach-summary" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
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
