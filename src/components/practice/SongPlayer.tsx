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
import { StrumRow } from './StrumRow';
import { useSignalMeter } from './signalQuality';
import { sfx } from '../../audio/sfx';
import { getSong, songTimeline, songBars, type SongCell } from '../../data/songs';

const AUTO_ADVANCE_SECONDS = 5;
const BEATS_PER_BAR = 4;
const BPM_MIN = 50;
const BPM_MAX = 170;
const BPM_STEP = 4;
const STRIDE = 92; // px between cell centers (cell width + gaps); matches CSS

type Phase = 'intro' | 'learn' | 'countin' | 'play' | 'results';

interface Props {
  songId: string;
  onClose?: () => void;
  autoStart?: boolean;
  onNext?: () => void;
  autoAdvance?: boolean;
  nextLabel?: string;
  detector?: ChordDetectorApi;
  onFinish?: () => void;
}

const clampBpm = (n: number) => Math.max(BPM_MIN, Math.min(BPM_MAX, n));

interface Segment {
  label: string;
  startFrac: number;
  widthFrac: number;
}

function buildSegments(cells: SongCell[]): Segment[] {
  if (!cells.length) return [];
  const segs: Segment[] = [];
  let start = 0;
  for (let i = 1; i <= cells.length; i++) {
    if (i === cells.length || cells[i].sectionStart) {
      segs.push({
        label: cells[start].section,
        startFrac: start / cells.length,
        widthFrac: (i - start) / cells.length,
      });
      start = i;
    }
  }
  return segs;
}

// Two-pass karaoke play-along. Learn (self-paced) then Play (tempo-led). The lane
// is a single transform-animated track so motion is GPU-driven, not per-frame
// React — only discrete bar changes hit state. Detection is advisory in Play.
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
  const { status, error, start, stop, setHandlers } = detector ?? own;

  const song = getSong(songId);
  const timeline = useMemo<SongCell[]>(() => (song ? songTimeline(song) : []), [song]);
  const bars = useMemo<SongCell[]>(() => (song ? songBars(song) : []), [song]);
  const learnTotal = timeline.length;
  const playTotal = bars.length;

  const [phase, setPhase] = useState<Phase>(autoStart ? 'learn' : 'intro');
  const [learnIdx, setLearnIdx] = useState(0);
  const [barIdx, setBarIdx] = useState(0);
  const [countIn, setCountIn] = useState(BEATS_PER_BAR);
  const [bpm, setBpm] = useState(song?.bpm ?? 100);
  const [detected, setDetected] = useState('');
  const { quality: signal, push: pushSignal, reset: resetSignal } = useSignalMeter();
  const [advanceLeft, setAdvanceLeft] = useState(AUTO_ADVANCE_SECONDS);

  const learnIdxRef = useRef(0);
  const barIdxRef = useRef(0);
  const detectedRef = useRef('');

  const isPlay = phase === 'play';
  const cells = isPlay || phase === 'countin' ? bars : timeline;
  const current = isPlay || phase === 'countin' ? barIdx : learnIdx;
  const total = cells === bars ? playTotal : learnTotal;
  const segments = useMemo(() => buildSegments(cells), [cells]);

  const finish = () => {
    if (sharedMic) setHandlers({});
    else void stop();
    sfx.sessionComplete();
    onFinish?.();
    setPhase('results');
  };

  const handleLearnChord = (chord: string) => {
    if (learnIdxRef.current >= learnTotal) return;
    if (chord !== timeline[learnIdxRef.current].chord) return;
    const next = learnIdxRef.current + 1;
    learnIdxRef.current = next;
    sfx.tick();
    if (next >= learnTotal) {
      barIdxRef.current = 0;
      detectedRef.current = '';
      setBarIdx(0);
      setDetected('');
      setCountIn(BEATS_PER_BAR);
      setPhase('countin');
      return;
    }
    setLearnIdx(next);
  };

  const handlePlayChord = (chord: string) => {
    detectedRef.current = chord;
    setDetected(chord);
  };

  const startSession = async () => {
    if (!song) return;
    sfx.go();
    learnIdxRef.current = 0;
    barIdxRef.current = 0;
    detectedRef.current = '';
    setLearnIdx(0);
    setBarIdx(0);
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

  useEffect(() => {
    if (phase !== 'countin') return;
    setHandlers({ onChord: (ev) => handlePlayChord(ev.chord), onLevel: (ev) => pushSignal(ev) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Count-in: BEATS_PER_BAR metronome beats before the lane starts moving.
  useEffect(() => {
    if (phase !== 'countin') return;
    sfx.tick();
    const beatMs = 60000 / bpm;
    let n = BEATS_PER_BAR;
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

  // Metronome: beats drive audio + the CSS pulse (steady, in CSS); only a bar
  // boundary advances the lane in React. Polls a moving deadline to stay on time.
  useEffect(() => {
    if (phase !== 'play') return;
    const beatMs = 60000 / bpm;
    let beat = 0; // beats elapsed since play start of the current run
    let nextAt = Date.now() + beatMs;
    const id = setInterval(() => {
      if (Date.now() < nextAt) return;
      nextAt += beatMs;
      sfx.tick();
      beat += 1;
      if (beat % BEATS_PER_BAR === 0) {
        const b = barIdxRef.current + 1;
        barIdxRef.current = b;
        if (b >= playTotal) {
          clearInterval(id);
          finish();
          return;
        }
        setBarIdx(b);
      }
    }, 16);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, bpm, playTotal]);

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

  if (phase === 'results') {
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

  // --- Karaoke lane (learn / countin / play) ---
  const cur = cells[Math.min(current, total - 1)];
  // Active lyric: the current cell's, or the most recent one (so a phrase holds
  // across instrumental bars instead of blinking out).
  let activeLyric = cur.lyric;
  for (let i = Math.min(current, total - 1); i >= 0 && !activeLyric; i--) activeLyric = cells[i].lyric;
  const counting = phase === 'countin';
  const laneTransition = isPlay ? 'transform 0.2s ease-out' : 'transform 0.26s cubic-bezier(0.16,1,0.3,1)';
  const playheadFrac = total > 1 ? current / (total - 1) : 0;

  return (
    <div className="song-stage">
      <div className="song-topline">
        <span className={counting ? 'song-pass' : isPlay ? 'song-pass is-play' : 'song-pass'}>
          {isPlay ? 'Play · to the beat' : counting ? 'Play · get ready' : 'Learn · your pace'}
        </span>
        <span className="song-section-tag">{cur.section}</span>
      </div>

      <div className="song-lane">
        <div className={isPlay ? 'song-now-marker is-pulsing' : 'song-now-marker'} style={{ ['--beat-ms' as string]: `${60000 / bpm}ms` }} />
        <div
          className="song-track"
          style={{ transform: `translateX(${-(Math.min(current, total - 1) + 0.5) * STRIDE}px)`, transition: laneTransition }}
        >
          {cells.map((cell, i) => {
            const rel = i - current;
            const correct = isPlay && i === current && detected === cell.chord;
            const cls = [
              'song-cell',
              i === current ? 'is-now' : i < current ? 'is-past' : '',
              correct ? 'is-correct' : '',
            ].join(' ').trim();
            return (
              <div key={i} className={cls} aria-hidden={Math.abs(rel) > 4}>
                <div className="song-cell-chord">{cell.chord}</div>
                <StrumRow strum={cell.strum} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="song-lyric-line">
        {counting ? <span className="song-countin-num">{countIn}</span> : <span>{activeLyric ?? ' '}</span>}
      </div>

      <div className="song-parts">
        {segments.map((seg, i) => (
          <div key={i} className="song-part" style={{ width: `${seg.widthFrac * 100}%` }} title={seg.label}>
            <span className="song-part-label">{seg.label}</span>
          </div>
        ))}
        <div className="song-parts-head" style={{ left: `${playheadFrac * 100}%`, transition: laneTransition.replace('transform', 'left') }} />
      </div>

      <div className="song-stage-foot">
        {isPlay || counting ? TempoControl : (
          <button className="song-skip" onClick={() => handleLearnChord(timeline[learnIdxRef.current]?.chord ?? '')}>
            <SkipForward size={16} weight="fill" /> Skip chord
          </button>
        )}
        <SignalMeter quality={signal} />
      </div>
    </div>
  );
}
