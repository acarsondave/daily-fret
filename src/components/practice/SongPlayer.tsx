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
  YoutubeLogo,
} from '@phosphor-icons/react';
import { useChordDetector, type ChordDetectorApi } from '../../hooks/useChordDetector';
import { useStore } from '../../store';
import { SignalMeter } from './SignalMeter';
import { StrumRow } from './StrumRow';
import { YouTubePlayer } from './YouTubePlayer';
import { useSignalMeter } from './signalQuality';
import { sfx } from '../../audio/sfx';
import { getSong, songBars, type SongCell } from '../../data/songs';

const AUTO_ADVANCE_SECONDS = 5;
const CELL_W = 76; // cell width in px (matches CSS)
const STRIDE = CELL_W + 16; // cell width + flex gap; matches CSS

type Phase = 'intro' | 'learn' | 'realplay' | 'results';

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

// Pull a YouTube video id out of any common link shape (or a bare id).
function youtubeId(raw: string): string | null {
  const url = raw.trim();
  const patterns = [
    /youtu\.be\/([\w-]{11})/,
    /[?&]v=([\w-]{11})/,
    /\/embed\/([\w-]{11})/,
    /\/shorts\/([\w-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return /^[\w-]{11}$/.test(url) ? url : null;
}

// Two-pass play-along. Learn: self-paced, the lane walks the whole song bar by
// bar and advances when you strum the right chord (a strum = an onset on the
// expected chord, so repeated chords and the riff-then-A figure both work). Then
// Real play: the actual recording streams from YouTube with the lyrics on screen.
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
  const bars = useMemo<SongCell[]>(() => (song ? songBars(song) : []), [song]);
  const total = bars.length;
  const segments = useMemo(() => buildSegments(bars), [bars]);

  const storedLink = useStore((st) => (song ? st.accounts[st.currentAccountId]?.songLinks?.[song.id] : undefined));
  const setSongLink = useStore((st) => st.setSongLink);

  const [phase, setPhase] = useState<Phase>(autoStart ? 'learn' : 'intro');
  const [barIdx, setBarIdx] = useState(0);
  const [detected, setDetected] = useState('');
  const { quality: signal, push: pushSignal, reset: resetSignal } = useSignalMeter();
  const [advanceLeft, setAdvanceLeft] = useState(AUTO_ADVANCE_SECONDS);
  const [linkDraft, setLinkDraft] = useState('');
  const [editingLink, setEditingLink] = useState(false);

  const barIdxRef = useRef(0);
  const lastChordRef = useRef(''); // most recent detected chord
  const pendingOnsetRef = useRef(false); // a strum is waiting for its chord to match

  const releaseMic = () => {
    if (sharedMic) setHandlers({});
    else void stop();
  };

  const advanceTo = (next: number) => {
    barIdxRef.current = next;
    pendingOnsetRef.current = false;
    sfx.tick();
    if (next >= total) {
      releaseMic();
      setPhase('realplay');
      return;
    }
    setBarIdx(next);
  };

  // Advance the current bar when a strum (onset) lands on the expected chord.
  const tryAdvance = () => {
    const idx = barIdxRef.current;
    if (idx >= total) return;
    if (lastChordRef.current !== bars[idx].chord) return;
    advanceTo(idx + 1);
  };

  const onLearnChord = (chord: string) => {
    lastChordRef.current = chord;
    setDetected(chord);
    if (pendingOnsetRef.current) tryAdvance();
  };

  const onLearnOnset = () => {
    pendingOnsetRef.current = true;
    tryAdvance(); // repeated chord: it already matches, advance on the strum itself
  };

  const startSession = async () => {
    if (!song) return;
    sfx.go();
    barIdxRef.current = 0;
    lastChordRef.current = '';
    pendingOnsetRef.current = false;
    setBarIdx(0);
    setDetected('');
    resetSignal();
    setPhase('learn');
    await start(
      {
        onChord: (ev) => onLearnChord(ev.chord),
        onOnset: () => onLearnOnset(),
        onLevel: (ev) => pushSignal(ev),
      },
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

  const finish = () => {
    sfx.sessionComplete();
    onFinish?.();
    setPhase('results');
  };

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

  if (!song || total === 0) {
    return (
      <div className="mic-gate">
        <MusicNotes size={40} weight="duotone" color="var(--text-secondary)" />
        <p>{song ? 'This song has no chords to play yet.' : "That song isn't in the catalog."}</p>
        <button className="practice-btn primary" onClick={() => onClose?.()}>Done</button>
      </div>
    );
  }

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
        <p className="om-caption">Two passes: learn the chords at your pace, then play along to the real song</p>
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

  // Mic gates only apply to the Learn pass — Real play uses YouTube, no mic.
  if (phase === 'learn' && status === 'error') {
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
  if (phase === 'learn' && status !== 'running') {
    return (
      <div className="mic-gate">
        <Microphone size={40} weight="duotone" color="var(--accent-primary)" />
        <p>Allow microphone access to begin…</p>
      </div>
    );
  }

  if (phase === 'realplay') {
    const videoId = (storedLink ? youtubeId(storedLink) : null) ?? song.youtubeId ?? null;
    return (
      <div className="song-real">
        <div className="song-topline">
          <span className="song-pass is-play">Play · the real song</span>
          <span className="song-section-tag">{song.title}</span>
        </div>

        {videoId && !editingLink ? (
          <YouTubePlayer videoId={videoId} onEnded={finish} />
        ) : (
          <div className="song-real-link">
            <YoutubeLogo size={32} weight="fill" color="#ff5252" />
            <p className="om-caption">Paste a YouTube link for {song.title} to play along to the real recording.</p>
            <div className="song-real-link-row">
              <input
                className="task-input"
                placeholder="https://youtu.be/…"
                value={linkDraft}
                onChange={(e) => setLinkDraft(e.target.value)}
                autoFocus
              />
              <button
                className="practice-btn primary"
                disabled={!youtubeId(linkDraft)}
                onClick={() => {
                  setSongLink(song.id, linkDraft.trim());
                  setLinkDraft('');
                  setEditingLink(false);
                }}
              >
                Load
              </button>
            </div>
          </div>
        )}

        <div className="song-real-foot">
          {videoId && !editingLink && (
            <button className="song-skip" onClick={() => { setLinkDraft(storedLink ?? ''); setEditingLink(true); }}>
              <YoutubeLogo size={16} weight="fill" /> Change link
            </button>
          )}
          <button className="practice-btn primary" onClick={finish}>
            Done <ArrowRight size={18} weight="bold" />
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'results') {
    return (
      <motion.div className="om-results" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <CheckCircle size={48} weight="fill" className="coach-summary-check" />
        <div className="coach-intro-title">{song.title}</div>
        <div className="om-caption">Nice playing. Both passes done.</div>
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

  // --- Learn lane ---
  const current = Math.min(barIdx, total - 1);
  const cur = bars[current];
  // Active lyric: the current cell's, or the most recent one, so a phrase holds
  // across instrumental bars instead of blinking out.
  let activeLyric = cur.lyric;
  for (let i = current; i >= 0 && !activeLyric; i--) activeLyric = bars[i].lyric;
  const playheadFrac = total > 1 ? current / (total - 1) : 0;

  return (
    <div className="song-stage">
      <div className="song-topline">
        <span className="song-pass">Learn · your pace</span>
        <span className="song-section-tag">{cur.section}</span>
      </div>

      <div className="song-lane">
        <div className="song-now-marker" />
        <div
          className="song-track"
          style={{ transform: `translateX(${-(current * STRIDE + CELL_W / 2)}px)`, transition: 'transform 0.26s cubic-bezier(0.16,1,0.3,1)' }}
        >
          {bars.map((cell, i) => {
            const correct = i === current && detected === cell.chord;
            const cls = [
              'song-cell',
              i === current ? 'is-now' : i < current ? 'is-past' : '',
              correct ? 'is-correct' : '',
            ].join(' ').trim();
            return (
              <div key={i} className={cls} aria-hidden={Math.abs(i - current) > 4}>
                {cell.tag && <div className="song-cell-tag">{cell.tag}</div>}
                <div className="song-cell-chord">{cell.chord}</div>
                <StrumRow strum={cell.strum} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="song-lyric-line">
        <span>{activeLyric ?? ' '}</span>
      </div>

      <div className="song-parts">
        {segments.map((seg, i) => (
          <div key={i} className="song-part" style={{ width: `${seg.widthFrac * 100}%` }} title={seg.label}>
            <span className="song-part-label">{seg.label}</span>
          </div>
        ))}
        <div className="song-parts-head" style={{ left: `${playheadFrac * 100}%`, transition: 'left 0.26s cubic-bezier(0.16,1,0.3,1)' }} />
      </div>

      <div className="song-stage-foot">
        <button className="song-skip" onClick={() => advanceTo(barIdxRef.current + 1)}>
          <SkipForward size={16} weight="fill" /> Skip chord
        </button>
        <SignalMeter quality={signal} />
      </div>
    </div>
  );
}
