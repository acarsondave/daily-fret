import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { ArrowRightIcon, CheckCircleIcon, CloseIcon, MicIcon, PlectrumIcon, RetryIcon, SkipIcon } from '../icons';
import { useChordDetector } from '../../hooks/useChordDetector';
import type { LevelEvent } from '../../audio/detector';
import { matchChordAmong } from '../../audio/chords';
import { ProgressRing } from './ProgressRing';
import { SignalMeter } from './SignalMeter';
import { useSignalMeter } from './signalQuality';
import { sfx } from '../../audio/sfx';
import { useStore, useUserData } from '../../store';
import { pushOverlay } from '../overlayStack';
import { activeProfileOf } from '../../lib/chordProfiles';
import { useCapoOffset } from '../../hooks/useCapo';
import {
  CalibrationCollector,
  fitTemplates,
  separationReport,
  MIN_SAMPLES,
} from '../../audio/calibration';
import './practice.css';

// The chords we learn. A spread wider than the drilled core sharpens the
// discriminative fit (a richer shared "grand mean" to subtract), while still
// covering everything coached mode and the songs use.
// Dm is here because a drill can only count what the detector was taught. With
// Dm missing, a Dm/Am drill matches Dm against a built-in template while its
// partner uses a learned one, and the two are fitted on different scales, so
// the built-in one wins too often and the count is fiction.
const CALIBRATION_CHORDS = ['A', 'D', 'E', 'Am', 'Dm', 'Em', 'C', 'G'];

// Frames to gather per chord. Above MIN_SAMPLES so a fit stays trustworthy even
// if a couple of frames are junk; ~1-2 seconds of held strumming.
const CAPTURE_TARGET = 40;

// A short breather when advancing to the next chord so the previous chord's ring
// out is not captured under the new label.
const SETTLE_MS = 1300;

// Mirror the detector's strum-arming gate: only genuinely loud frames are real
// playing. Deliberately no tonal-salience gate here — low chords (A, E) are
// low-salience by nature and that is exactly what we need to learn, so gating on
// salience would stall the flow on the hardest chords.
const STRUM_RMS_RATIO = 3;
const MIN_STRUM_RMS = 0.02;

type Phase = 'intro' | 'capturing' | 'done';

interface Props {
  onClose: () => void;
}

export function CalibrationFlow({ onClose }: Props) {
  const { status, error, start, stop } = useChordDetector();
  // Named throughout, because a calibration belongs to one instrument and the
  // whole point of the profile list is that you can tell which.
  const account = useUserData();
  const guitar = activeProfileOf(account)?.label;
  const setChordCalibration = useStore((s) => s.setChordCalibration);
  const clearChordCalibration = useStore((s) => s.clearChordCalibration);
  const { quality: signal, push: pushSignal, reset: resetSignal } = useSignalMeter();

  const capo = useCapoOffset();
  const [phase, setPhase] = useState<Phase>('intro');
  const [idx, setIdx] = useState(0);
  const [count, setCount] = useState(0);
  const [settling, setSettling] = useState(false);
  const [saved, setSaved] = useState<{ chords: number; worst: number | null } | null>(null);

  // onLevel fires from the audio thread against stale closures, so the live
  // capture state is read through refs.
  const phaseRef = useRef<Phase>('intro');
  const idxRef = useRef(0);
  const countRef = useRef(0);
  const readyAtRef = useRef(0);
  const collectorRef = useRef(new CalibrationCollector());

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const releaseMic = () => {
    void stop();
  };

  const finish = () => {
    releaseMic();
    const data = collectorRef.current.toData();
    const eligible = Object.values(data).filter((c) => c.samples >= MIN_SAMPLES).length;
    if (eligible >= 2) {
      const rep = separationReport(fitTemplates(data));
      setChordCalibration(data);
      setSaved({ chords: eligible, worst: rep.worst?.cosine ?? null });
      sfx.complete();
    } else {
      // Not enough clean data to fit anything discriminative; keep the previous
      // calibration (if any) rather than storing something useless.
      setSaved({ chords: eligible, worst: null });
    }
    setPhaseBoth('done');
  };

  const advance = () => {
    const next = idxRef.current + 1;
    if (next >= CALIBRATION_CHORDS.length) {
      finish();
      return;
    }
    idxRef.current = next;
    countRef.current = 0;
    readyAtRef.current = Date.now() + SETTLE_MS;
    setIdx(next);
    setCount(0);
    setSettling(true);
    window.setTimeout(() => setSettling(false), SETTLE_MS);
  };

  const onLevel = (ev: LevelEvent) => {
    pushSignal(ev);
    if (phaseRef.current !== 'capturing') return;
    if (Date.now() < readyAtRef.current) return;
    if (!ev.chroma) return;

    // Must be a real strum, not room tone.
    const armed = ev.rms > Math.max(ev.noiseFloor * STRUM_RMS_RATIO, MIN_STRUM_RMS);
    if (!armed) return;

    // And it must actually sound like the chord we asked for. We match the raw
    // chroma against the built-in templates ourselves (not via the detector's
    // salience-gated path, which would reject the low chords we most need), and
    // only capture when the target chord is the best interpretation. This is what
    // stops talking / background noise from filling the ring: arbitrary sound will
    // not repeatedly best-match the exact target chord at a real correlation.
    const chord = CALIBRATION_CHORDS[idxRef.current];
    const match = matchChordAmong(ev.chroma, CALIBRATION_CHORDS, 0);
    if (!match || match.chord !== chord) return;

    collectorRef.current.add(chord, ev.chroma);
    countRef.current += 1;
    setCount(countRef.current);
    if (countRef.current >= CAPTURE_TARGET) {
      sfx.tick();
      advance();
    }
  };

  const begin = async () => {
    sfx.go();
    collectorRef.current.reset();
    idxRef.current = 0;
    countRef.current = 0;
    readyAtRef.current = Date.now() + SETTLE_MS;
    setIdx(0);
    setCount(0);
    setSettling(true);
    resetSignal();
    setPhaseBoth('capturing');
    window.setTimeout(() => setSettling(false), SETTLE_MS);
    // No templates here: calibration must observe the raw chroma pipeline. We read
    // ev.chroma off onLevel, which is independent of chord matching.
    await start({ onLevel }, {});
  };

  const redo = () => {
    setSaved(null);
    void begin();
  };

  const resetToDefault = () => {
    clearChordCalibration();
    setSaved(null);
    onClose();
  };

  useEffect(() => {
    // Opened from the settings dialog, so it has to claim Escape or both close.
    const overlay = pushOverlay();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && overlay.isTop()) onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      overlay.release();
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chord = CALIBRATION_CHORDS[idx];
  const progress = count / CAPTURE_TARGET;

  const body = () => {
    if (phase === 'intro') {
      // Calibration learns this guitar's chord fingerprints. Through a capo it
      // would learn transposed ones that only work with the capo on, so the flow
      // refuses rather than quietly recording something wrong. This is the one
      // place the capo has to come off.
      if (capo > 0) {
        return (
          <motion.div className="om-results" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <PlectrumIcon size={48} className="coach-summary-check" />
            <div className="coach-intro-title">Take the capo off first</div>
            <div className="om-caption om-cal-blurb">
              Calibration learns how your guitar sounds on open shapes. With the
              capo on fret {capo} it would learn the wrong ones, and every drill
              afterwards would inherit the mistake. Take it off, set the capo back
              to None in settings, then come back.
            </div>
            <button className="practice-btn primary" onClick={onClose} autoFocus>
              Got it
            </button>
          </motion.div>
        );
      }
      return (
        <motion.div className="om-results" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <PlectrumIcon size={48} className="coach-summary-check" />
          <div className="coach-intro-title">
            {guitar ? `Tune the detector to ${guitar}` : 'Tune the detector to your guitar'}
          </div>
          <div className="om-caption om-cal-blurb">
            Play each chord when it appears and hold it steady. This teaches the
            detector how {guitar ?? 'your guitar'} actually sounds, so tricky changes
            like A to D stop getting missed.
          </div>
          <button className="practice-btn primary" onClick={() => void begin()} autoFocus>
            <PlectrumIcon size={20} /> Start calibration
          </button>
        </motion.div>
      );
    }

    if (phase === 'capturing') {
      if (status === 'error') {
        return (
          <div className="mic-gate">
            <MicIcon size={40} color="var(--text-secondary)" />
            <p>{error ?? 'Microphone unavailable.'}</p>
            <button className="practice-btn primary" onClick={() => void begin()}>
              <RetryIcon size={18} /> Try again
            </button>
          </div>
        );
      }
      if (status !== 'running') {
        return (
          <div className="mic-gate">
            <MicIcon size={40} color="var(--accent-primary)" />
            <p>Allow microphone access to begin…</p>
          </div>
        );
      }
      return (
        <motion.div className="om-results" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="practice-mode is-chord">
            {settling ? 'get ready' : 'play and hold'} · {idx + 1}/{CALIBRATION_CHORDS.length}
          </div>
          <ProgressRing progress={settling ? 0 : progress} className="om-ring">
            <div className="practice-hero ct-target om-cal-hero">{chord}</div>
          </ProgressRing>
          <div className="om-caption">
            {settling ? `Switch to ${chord}…` : `Captured ${count}/${CAPTURE_TARGET}`}
          </div>
          <SignalMeter quality={signal} />
          <button className="practice-btn ghost" onClick={advance}>
            <SkipIcon size={18} /> Skip this chord
          </button>
        </motion.div>
      );
    }

    // done
    const ok = !!saved && saved.chords >= 2;
    return (
      <motion.div className="om-results" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <CheckCircleIcon
          size={48}
          className="coach-summary-check"
          color={ok ? 'var(--accent-primary)' : 'var(--text-secondary)'}
        />
        <div className="coach-intro-title">
          {ok ? `Detector tuned to ${guitar ?? 'your guitar'}` : 'Not enough captured'}
        </div>
        <div className="om-caption om-cal-blurb">
          {ok ? (
            <>
              Learned {saved!.chords} chords.{' '}
              {saved!.worst !== null && separationWord(saved!.worst)}
            </>
          ) : (
            'Try again and hold each chord until the ring fills. Your previous calibration is unchanged.'
          )}
        </div>
        <div className="om-actions">
          <button className="practice-btn ghost" onClick={redo}>
            <RetryIcon size={18} /> Redo
          </button>
          {ok ? (
            <button className="practice-btn primary" onClick={onClose} autoFocus>
              Done <ArrowRightIcon size={18} />
            </button>
          ) : (
            <button className="practice-btn primary" onClick={() => void begin()} autoFocus>
              <PlectrumIcon size={18} /> Try again
            </button>
          )}
        </div>
        {ok && (
          <button className="practice-btn ghost om-cal-reset" onClick={resetToDefault}>
            Forget this calibration
          </button>
        )}
      </motion.div>
    );
  };

  return createPortal(
    <motion.div
      className="practice-overlay calibration-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="practice-topbar">
        <span className="practice-eyebrow">Detector calibration</span>
        <button className="practice-close" onClick={onClose} title="Exit (Esc)" aria-label="Exit calibration">
          <CloseIcon size={20} />
        </button>
      </div>
      <div className="practice-body">{body()}</div>
    </motion.div>,
    document.body,
  );
}

// Turn the least-separated pair's cosine (lower is better) into a plain readout.
function separationWord(worstCosine: number): string {
  if (worstCosine < 0.3) return 'Chords are cleanly separated.';
  if (worstCosine < 0.6) return 'Chords are well separated.';
  return 'A couple of chords still look alike; a redo can help.';
}
