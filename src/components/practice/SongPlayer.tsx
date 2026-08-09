import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRightIcon, CheckCircleIcon, MusicNoteIcon, PlayIcon } from '../icons';
import { YoutubeLogo } from '@phosphor-icons/react';
import { useStore } from '../../store';
import { YouTubePlayer } from './YouTubePlayer';
import { sfx } from '../../audio/sfx';
import { useSong } from '../../hooks/useSongs';

const AUTO_ADVANCE_SECONDS = 5;

type Phase = 'intro' | 'play' | 'results';

interface Props {
  songId: string;
  onClose?: () => void;
  autoStart?: boolean;
  onNext?: () => void;
  autoAdvance?: boolean;
  nextLabel?: string;
  onFinish?: () => void;
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

// Play along to the real recording, with the chords named up front. There is no
// mic here: playing in time with a record is the skill, and a detector listening
// through the speakers can only get in the way of it.
export function SongPlayer({
  songId,
  onClose,
  autoStart = false,
  onNext,
  autoAdvance = false,
  nextLabel = 'Up next',
  onFinish,
}: Props) {
  const song = useSong(songId);

  const storedLink = useStore((st) => (song ? st.accounts[st.currentAccountId]?.songLinks?.[song.id] : undefined));
  const setSongLink = useStore((st) => st.setSongLink);

  const [phase, setPhase] = useState<Phase>(autoStart ? 'play' : 'intro');
  const [advanceLeft, setAdvanceLeft] = useState(AUTO_ADVANCE_SECONDS);
  const [linkDraft, setLinkDraft] = useState('');
  const [editingLink, setEditingLink] = useState(false);

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

  if (!song) {
    return (
      <div className="mic-gate">
        <MusicNoteIcon size={40} color="var(--text-secondary)" />
        <p>That song isn't in the catalog.</p>
        <button className="practice-btn primary" onClick={() => onClose?.()}>Done</button>
      </div>
    );
  }

  if (phase === 'intro') {
    return (
      <div className="om-setup">
        <div className="song-intro-head">
          <MusicNoteIcon size={22} />
          <div>
            <div className="song-intro-title">{song.title}</div>
            <div className="om-caption">{song.artist}</div>
          </div>
        </div>
        <p className="om-caption">Play along with the record. Strum {song.strum}.</p>
        <div className="song-chip-row">
          {song.chords.map((c) => (
            <span key={c} className="song-chip">{c}</span>
          ))}
        </div>
        <button className="practice-btn primary" onClick={() => { sfx.go(); setPhase('play'); }}>
          <PlayIcon size={20} /> Start play-along
        </button>
      </div>
    );
  }

  if (phase === 'play') {
    const videoId = (storedLink ? youtubeId(storedLink) : null) ?? song.youtubeId ?? null;
    // Nothing else is on screen during playback, so when there is a video to
    // show it takes the whole stage instead of sitting in a 640px column.
    const theater = !!videoId && !editingLink;
    return (
      <motion.div
        className={theater ? 'song-real is-theater' : 'song-real'}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="song-topline">
          <span className="song-pass is-play">{song.chords.join(' · ')}</span>
          <span className="song-section-tag">{song.title}</span>
        </div>

        {theater ? (
          <YouTubePlayer
            videoId={videoId}
            onEnded={finish}
            // A stored link is the user's own pick and may not share the
            // catalogue recording's intro, so only skip ahead on ours.
            startSeconds={storedLink ? undefined : song.startSeconds}
          />
        ) : (
          <div className="song-real-link">
            <YoutubeLogo size={32} color="#ff5252" />
            <p className="om-caption">Paste a YouTube link for {song.title} to play along to the real recording.</p>
            <div className="song-real-link-row">
              <input
                className="task-input"
                aria-label={`YouTube link for ${song.title}`}
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
          {theater && (
            <button className="song-skip" onClick={() => { setLinkDraft(storedLink ?? ''); setEditingLink(true); }}>
              <YoutubeLogo size={16} /> Change link
            </button>
          )}
          <button className="practice-btn primary" onClick={finish}>
            Done <ArrowRightIcon size={18} />
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div className="om-results" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
      <CheckCircleIcon size={48} className="coach-summary-check" />
      <div className="coach-intro-title">{song.title}</div>
      <div className="om-caption">Nice playing.</div>
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
          <button className="practice-btn primary" onClick={onNext ?? (() => setPhase('play'))} autoFocus>
            {onNext ? 'Next drill' : 'Play again'} <ArrowRightIcon size={18} />
          </button>
        </div>
      )}
    </motion.div>
  );
}
