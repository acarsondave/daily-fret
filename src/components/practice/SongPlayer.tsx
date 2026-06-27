import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Play,
  ArrowRight,
  Microphone,
  ArrowClockwise,
  SkipForward,
  MusicNotes,
  CheckCircle,
} from '@phosphor-icons/react';
import { useChordDetector, type ChordDetectorApi } from '../../hooks/useChordDetector';
import { SignalMeter } from './SignalMeter';
import { MicPicker } from './MicPicker';
import { useSignalMeter } from './signalQuality';
import { sfx } from '../../audio/sfx';
import { getSong, songTimeline, type SongStep } from '../../data/songs';

const AUTO_ADVANCE_SECONDS = 5;

type View = 'intro' | 'playing' | 'results';

interface Props {
  songId: string;
  onClose?: () => void;
  autoStart?: boolean;
  onNext?: () => void;
  autoAdvance?: boolean; // coached: roll into the next segment hands-free
  nextLabel?: string;
  detector?: ChordDetectorApi;
  onFinish?: () => void; // fired the moment the song completes (coach "done" cue)
}

// Self-paced chord play-along. Shows the current chord and what's next, and
// advances the moment you land the right chord — rhythm and strumming are yours.
// It only follows the chord timeline, so however a song is strummed it still
// tracks. Reuses the shared detector in coached mode so the mic isn't re-opened.
export function SongPlayer({
  songId,
  onClose,
  autoStart = false,
  onNext,
  autoAdvance = false,
  nextLabel = 'Up next',
  detector,
  onFinish,
}: Props) {
  const own = useChordDetector();
  const sharedMic = !!detector;
  const { status, error, start, stop, setHandlers, switchDevice } = detector ?? own;

  const song = getSong(songId);
  const timeline = useMemo<SongStep[]>(() => (song ? songTimeline(song) : []), [song]);
  const total = timeline.length;

  const [view, setView] = useState<View>(autoStart ? 'playing' : 'intro');
  const [idx, setIdx] = useState(0);
  const { quality: signal, push: pushSignal, reset: resetSignal } = useSignalMeter();
  const [advanceLeft, setAdvanceLeft] = useState(AUTO_ADVANCE_SECONDS);
  const [elapsed, setElapsed] = useState(0);

  const idxRef = useRef(0);
  const heroRef = useRef<HTMLDivElement>(null);
  const startedAtRef = useRef(0);

  const popHero = () => {
    const el = heroRef.current;
    if (!el) return;
    el.classList.remove('is-hit');
    void el.offsetWidth;
    el.classList.add('is-hit');
  };

  const finish = () => {
    setElapsed(Math.round((Date.now() - startedAtRef.current) / 1000));
    if (sharedMic) setHandlers({});
    else void stop();
    sfx.sessionComplete();
    onFinish?.();
    setView('results');
  };

  const bump = () => {
    const next = idxRef.current + 1;
    idxRef.current = next;
    popHero();
    sfx.tick();
    if (next >= total) {
      finish();
      return;
    }
    setIdx(next);
  };

  const handleChord = (chord: string) => {
    if (idxRef.current >= total) return;
    if (chord !== timeline[idxRef.current].chord) return;
    bump();
  };

  const startSession = async () => {
    if (!song) return;
    sfx.go();
    idxRef.current = 0;
    setIdx(0);
    resetSignal();
    startedAtRef.current = Date.now();
    setView('playing');

    const live = await start(
      {
        onChord: (ev) => handleChord(ev.chord),
        onLevel: (ev) => pushSignal(ev),
      },
      { restrictTo: song.chords },
    );
    if (!live) return;
  };

  useEffect(() => {
    const t = autoStart ? setTimeout(() => startSession(), 0) : null;
    return () => {
      if (t) clearTimeout(t);
      if (!sharedMic) void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hands-free advance once the song completes in coached mode.
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

  if (!song) {
    return (
      <div className="mic-gate">
        <MusicNotes size={40} weight="duotone" color="var(--text-secondary)" />
        <p>That song isn't in the catalog.</p>
        <button className="practice-btn primary" onClick={() => onClose?.()}>Done</button>
      </div>
    );
  }

  if (view === 'intro') {
    return (
      <div className="om-setup">
        <div className="song-intro-head">
          <MusicNotes size={22} weight="fill" />
          <div>
            <div className="song-intro-title">{song.title}</div>
            <div className="om-caption">{song.artist}</div>
          </div>
        </div>
        <p className="om-caption">Play the chords in order at your own pace</p>
        <div className="song-chip-row">
          {song.chords.map((c) => (
            <span key={c} className="song-chip">{c}</span>
          ))}
        </div>
        <button className="practice-btn primary" onClick={startSession}>
          <Play size={20} weight="fill" /> Start play-along
        </button>
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

    const step = timeline[Math.min(idx, total - 1)];
    const next = idx + 1 < total ? timeline[idx + 1] : null;
    const progress = total > 0 ? idx / total : 0;

    return (
      <>
        <div className="practice-mode is-chord">{step.section} · play this chord</div>
        <div ref={heroRef} className="practice-hero ct-target">
          {step.chord}
        </div>
        <div className="song-next">
          {next ? <>next <strong>{next.chord}</strong></> : 'last chord'}
        </div>

        <div className="song-progress">
          <div className="song-progress-bar">
            <div className="song-progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <span className="song-progress-count">{idx} / {total}</span>
        </div>

        <div className="signal-cluster">
          <SignalMeter quality={signal} />
          <MicPicker onSwitch={switchDevice} />
        </div>

        <button className="song-skip" onClick={bump}>
          <SkipForward size={16} weight="fill" /> Skip chord
        </button>
      </>
    );
  }

  // results
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  return (
    <motion.div className="om-results" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
      <CheckCircle size={48} weight="fill" className="coach-summary-check" />
      <div className="coach-intro-title">{song.title}</div>
      <div className="om-caption">
        Played through · {mins}:{String(secs).padStart(2, '0')}
      </div>

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
            onClick={onNext ?? (() => startSession())}
            autoFocus
          >
            {onNext ? 'Next drill' : 'Play again'} <ArrowRight size={18} weight="bold" />
          </button>
        </div>
      )}
    </motion.div>
  );
}
