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
  Metronome,
  Minus,
  Plus,
} from '@phosphor-icons/react';
import { useChordDetector, type ChordDetectorApi } from '../../hooks/useChordDetector';
import { SignalMeter } from './SignalMeter';
import { MicPicker } from './MicPicker';
import { StrumRow } from './StrumRow';
import { useSignalMeter } from './signalQuality';
import { sfx } from '../../audio/sfx';
import { getSong, songTimeline, songBars, parseStrum, type SongStep } from '../../data/songs';

const AUTO_ADVANCE_SECONDS = 5;
const BPM_MIN = 50;
const BPM_MAX = 170;
const BPM_STEP = 4;

type Phase = 'intro' | 'learn' | 'countin' | 'play' | 'results';

interface Props {
  songId: string;
  onClose?: () => void;
  autoStart?: boolean;
  onNext?: () => void;
  autoAdvance?: boolean; // coached: roll into the next segment hands-free
  nextLabel?: string;
  detector?: ChordDetectorApi;
  onFinish?: () => void; // fired the moment both passes complete (coach "done" cue)
}

const clampBpm = (n: number) => Math.max(BPM_MIN, Math.min(BPM_MAX, n));

// Two-pass chord play-along. Pass 1 (Learn) is self-paced: advance by playing
// the chord. Pass 2 (Play) is tempo-led: a metronome sweeps the strum pattern
// and bars auto-advance, with detection only lighting the chord when you hit it
// (no grading). Reuses the shared detector in coached mode.
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
  const bars = useMemo<SongStep[]>(() => (song ? songBars(song) : []), [song]);
  const strumSlots = useMemo(() => (song ? parseStrum(song.strum) : []), [song]);
  const learnTotal = timeline.length;
  const playTotal = bars.length;

  const [phase, setPhase] = useState<Phase>(autoStart ? 'learn' : 'intro');
  const [learnIdx, setLearnIdx] = useState(0);
  const [barIdx, setBarIdx] = useState(0);
  const [eighth, setEighth] = useState(-1);
  const [countIn, setCountIn] = useState(4);
  const [bpm, setBpm] = useState(song?.bpm ?? 100);
  const [detected, setDetected] = useState('');
  const { quality: signal, push: pushSignal, reset: resetSignal } = useSignalMeter();
  const [advanceLeft, setAdvanceLeft] = useState(AUTO_ADVANCE_SECONDS);

  const learnIdxRef = useRef(0);
  const barIdxRef = useRef(0);
  const eighthRef = useRef(-1);
  const detectedRef = useRef('');
  const heroRef = useRef<HTMLDivElement>(null);

  const popHero = () => {
    const el = heroRef.current;
    if (!el) return;
    el.classList.remove('is-hit');
    void el.offsetWidth;
    el.classList.add('is-hit');
  };

  const finish = () => {
    if (sharedMic) setHandlers({});
    else void stop();
    sfx.sessionComplete();
    onFinish?.();
    setPhase('results');
  };

  // --- Learn pass (self-paced) ---
  const handleLearnChord = (chord: string) => {
    if (learnIdxRef.current >= learnTotal) return;
    if (chord !== timeline[learnIdxRef.current].chord) return;
    const next = learnIdxRef.current + 1;
    learnIdxRef.current = next;
    popHero();
    sfx.tick();
    if (next >= learnTotal) {
      // Hand off to the tempo pass.
      barIdxRef.current = 0;
      eighthRef.current = -1;
      setBarIdx(0);
      setEighth(-1);
      setDetected('');
      detectedRef.current = '';
      setCountIn(4);
      setPhase('countin');
      return;
    }
    setLearnIdx(next);
  };

  // --- Play pass (tempo-led) — detection only lights the matching chord ---
  const handlePlayChord = (chord: string) => {
    detectedRef.current = chord;
    setDetected(chord);
    if (bars[barIdxRef.current] && chord === bars[barIdxRef.current].chord) popHero();
  };

  const startSession = async () => {
    if (!song) return;
    sfx.go();
    learnIdxRef.current = 0;
    barIdxRef.current = 0;
    eighthRef.current = -1;
    detectedRef.current = '';
    setLearnIdx(0);
    setBarIdx(0);
    setEighth(-1);
    setDetected('');
    setBpm(song.bpm);
    resetSignal();
    setPhase('learn');

    await start(
      { onChord: (ev) => handleLearnChord(ev.chord), onLevel: (ev) => pushSignal(ev) },
      { restrictTo: song.chords },
    );
  };

  useEffect(() => {
    const t = autoStart ? setTimeout(() => startSession(), 0) : null;
    return () => {
      if (t) clearTimeout(t);
      if (!sharedMic) void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap to advisory handlers once we leave the Learn pass.
  useEffect(() => {
    if (phase !== 'countin') return;
    setHandlers({ onChord: (ev) => handlePlayChord(ev.chord), onLevel: (ev) => pushSignal(ev) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Count-in: four metronome beats before the bars start moving.
  useEffect(() => {
    if (phase !== 'countin') return;
    sfx.tick();
    const beatMs = 60000 / bpm;
    let n = 4;
    const id = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(id);
        setPhase('play');
        return;
      }
      setCountIn(n);
      sfx.tick();
    }, beatMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Metronome: sweep the eighth-note cursor; a bar (8 eighths) per chord. Polls
  // a moving deadline so it stays on time, and restarts cleanly on tempo change.
  useEffect(() => {
    if (phase !== 'play') return;
    const eighthMs = 60000 / bpm / 2;
    let nextAt = Date.now() + eighthMs;
    const id = setInterval(() => {
      if (Date.now() < nextAt) return;
      nextAt += eighthMs;
      let e = eighthRef.current + 1;
      if (e >= 8) {
        e = 0;
        const b = barIdxRef.current + 1;
        barIdxRef.current = b;
        if (b >= playTotal) {
          clearInterval(id);
          finish();
          return;
        }
        setBarIdx(b);
      }
      eighthRef.current = e;
      setEighth(e);
      if (e % 2 === 0) sfx.tick(); // click on the four beats
    }, 15);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, bpm, playTotal]);

  // Hands-free advance once both passes complete in coached mode.
  useEffect(() => {
    if (phase !== 'results' || !autoAdvance || !onNext) return;
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
  }, [phase, autoAdvance]);

  if (!song || learnTotal === 0) {
    return (
      <div className="mic-gate">
        <MusicNotes size={40} weight="duotone" color="var(--text-secondary)" />
        <p>{song ? 'This song has no chords to play yet.' : "That song isn't in the catalog."}</p>
        <button className="practice-btn primary" onClick={() => onClose?.()}>Done</button>
      </div>
    );
  }

  const TempoControl = (
    <div className="song-tempo">
      <button className="song-tempo-btn" onClick={() => setBpm((b) => clampBpm(b - BPM_STEP))} title="Slower">
        <Minus size={14} weight="bold" />
      </button>
      <span className="song-tempo-val"><Metronome size={14} weight="fill" /> {bpm}</span>
      <button className="song-tempo-btn" onClick={() => setBpm((b) => clampBpm(b + BPM_STEP))} title="Faster">
        <Plus size={14} weight="bold" />
      </button>
    </div>
  );

  if (phase === 'intro') {
    return (
      <div className="om-setup">
        <div className="song-intro-head">
          <MusicNotes size={22} weight="fill" />
          <div>
            <div className="song-intro-title">{song.title}</div>
            <div className="om-caption">{song.artist}</div>
          </div>
        </div>
        <p className="om-caption">Two passes: learn it at your pace, then play it to the beat</p>
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

  if (phase === 'learn') {
    const step = timeline[Math.min(learnIdx, learnTotal - 1)];
    const next = learnIdx + 1 < learnTotal ? timeline[learnIdx + 1] : null;
    const progress = learnTotal > 0 ? learnIdx / learnTotal : 0;
    return (
      <>
        <div className="song-pass">Learn · your pace</div>
        <div className="practice-mode is-chord">{step.section}</div>
        <div ref={heroRef} className="practice-hero ct-target">{step.chord}</div>
        <div className="song-next">{next ? <>next <strong>{next.chord}</strong></> : 'last chord'}</div>
        <StrumRow slots={strumSlots} />
        {step.lyric && <p className="song-lyric">{step.lyric}</p>}
        <div className="song-progress">
          <div className="song-progress-bar"><div className="song-progress-fill" style={{ width: `${progress * 100}%` }} /></div>
          <span className="song-progress-count">{learnIdx} / {learnTotal}</span>
        </div>
        <div className="signal-cluster">
          <SignalMeter quality={signal} />
          <MicPicker onSwitch={switchDevice} />
        </div>
        <button className="song-skip" onClick={() => handleLearnChord(timeline[learnIdxRef.current]?.chord ?? '')}>
          <SkipForward size={16} weight="fill" /> Skip chord
        </button>
      </>
    );
  }

  if (phase === 'countin') {
    const first = bars[0];
    return (
      <motion.div className="song-countin" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="song-pass">Play · get ready</div>
        <div className="song-countin-num">{countIn}</div>
        <div className="om-caption">Starting on {first?.chord}</div>
        <StrumRow slots={strumSlots} />
        {TempoControl}
      </motion.div>
    );
  }

  if (phase === 'play') {
    const bar = bars[Math.min(barIdx, playTotal - 1)];
    const next = barIdx + 1 < playTotal ? bars[barIdx + 1] : null;
    const onChord = detected !== '' && detected === bar.chord;
    const progress = playTotal > 0 ? barIdx / playTotal : 0;
    return (
      <>
        <div className="song-pass is-play">Play · to the beat</div>
        <div className="practice-mode is-chord">{bar.section}</div>
        <div className={onChord ? 'practice-hero ct-target is-hit' : 'practice-hero ct-target'}>{bar.chord}</div>
        <div className="song-next">{next ? <>next <strong>{next.chord}</strong></> : 'last bar'}</div>
        <StrumRow slots={strumSlots} activeSlot={eighth} />
        {bar.lyric && <p className="song-lyric">{bar.lyric}</p>}
        <div className="song-progress">
          <div className="song-progress-bar"><div className="song-progress-fill" style={{ width: `${progress * 100}%` }} /></div>
          <span className="song-progress-count">{barIdx} / {playTotal}</span>
        </div>
        {TempoControl}
        <div className="signal-cluster">
          <SignalMeter quality={signal} />
          <MicPicker onSwitch={switchDevice} />
        </div>
      </>
    );
  }

  // results
  return (
    <motion.div className="om-results" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
      <CheckCircle size={48} weight="fill" className="coach-summary-check" />
      <div className="coach-intro-title">{song.title}</div>
      <div className="om-caption">Learned and played</div>
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
          <button className="practice-btn primary" onClick={onNext ?? (() => startSession())} autoFocus>
            {onNext ? 'Next drill' : 'Play again'} <ArrowRight size={18} weight="bold" />
          </button>
        </div>
      )}
    </motion.div>
  );
}
