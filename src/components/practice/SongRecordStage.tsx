import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { YoutubeLogo } from '@phosphor-icons/react';
import { useStore } from '../../store';
import { YouTubePlayer, type PlaybackPhase } from './YouTubePlayer';
import { SyncedChart, ChartStandIn } from './SyncedChart';
import { PlaybackControls } from './PlaybackControls';
import { usePlayerClock } from '../../hooks/usePlayerClock';
import { buildTimeline, loopTarget, sectionIndexAt, type SongTimeline } from '../../lib/songTiming';
import { seekPlayerTo, setPlayerRate, type YTPlayer } from '../../lib/youtube';
import type { Song } from '../../data/songs';

// Play along to the real recording. Lifted out of SongPlayer unchanged when the
// second engine arrived, because one component holding two playback engines, a
// link editor, a chart and a results card is a god component and this file is
// the seam that was already there.
//
// There is no mic here: playing in time with a record is the skill, and a
// detector listening through the speakers can only get in the way of it. That is
// also why nothing on this stage is scored. The microphone would hear the record
// through the speakers, so any accuracy number would be measuring the band and
// reporting it as the player's. It is not that grading was too hard to build; it
// is that the number would be a lie.

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

interface Props {
  song: Song;
  onEnded: () => void;
  /** Rendered into the stage's own top line, so the mode switch rides with it. */
  topline?: React.ReactNode;
  foot: React.ReactNode;
}

export function SongRecordStage({ song, onEnded, topline, foot }: Props) {
  const storedLink = useStore((st) => st.accounts[st.currentAccountId]?.songLinks?.[song.id]);
  const setSongLink = useStore((st) => st.setSongLink);

  const [linkDraft, setLinkDraft] = useState('');
  const [editingLink, setEditingLink] = useState(false);
  const [player, setPlayer] = useState<YTPlayer | null>(null);
  const [playback, setPlayback] = useState<PlaybackPhase>('idle');
  const [playerError, setPlayerError] = useState<number | null>(null);
  const [sectionIndex, setSectionIndex] = useState(-1);
  const [loopIndex, setLoopIndex] = useState<number | null>(null);

  const clock = usePlayerClock(player, playback);

  // A chart only follows the recording it was timed against. If the player is
  // watching a different upload of the song, its anchors are for someone else's
  // video and would put the chart confidently in the wrong place.
  const timed = useMemo(() => buildTimeline(song), [song]);
  const timeline = timed.ok && !storedLink ? timed.timeline : null;

  // The frame callback runs sixty times a second and must never cause a render,
  // so everything it consults is a ref and everything it publishes is compared
  // first. In practice that is one setState per section and one seek per loop.
  const playerRef = useRef<YTPlayer | null>(null);
  const timelineRef = useRef<SongTimeline | null>(null);
  const loopRef = useRef<number | null>(null);
  const sectionRef = useRef(-1);
  const loopPending = useRef(false);
  useEffect(() => {
    playerRef.current = player;
    timelineRef.current = timeline;
    loopRef.current = loopIndex;
  }, [player, timeline, loopIndex]);

  const onFrame = useCallback((seconds: number) => {
    const line = timelineRef.current;
    if (!line) return;

    const index = sectionIndexAt(line, seconds);
    if (index !== sectionRef.current) {
      sectionRef.current = index;
      setSectionIndex(index);
    }

    const loop = loopRef.current;
    if (loop === null) return;
    const section = line.sections[loop];
    if (!section) return;
    if (seconds < section.endSeconds) {
      loopPending.current = false;
      return;
    }
    // One seek per lap. Until the player reports a time inside the section
    // again, every frame still reads as past the end and would re-seek.
    if (loopPending.current) return;
    loopPending.current = true;
    const target = playerRef.current;
    if (target) seekPlayerTo(target, loopTarget(line, loop));
  }, []);

  const videoId = (storedLink ? youtubeId(storedLink) : null) ?? song.youtubeId ?? null;
  // The video stays on screen at a real size whatever else is showing: it is
  // the performance, people want to watch it, and YouTube's terms are clear
  // that the player is not a hidden audio source for something else.
  const theater = !!videoId && !editingLink;
  const section = sectionIndex >= 0 ? timeline?.sections[sectionIndex] ?? null : null;
  const chartLive = !!timeline && clock.ready && !playerError;

  return (
    <motion.div
      className={`song-real${theater ? ' is-theater' : ''}${timeline ? ' has-chart' : ''}`}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="song-topline">
        <span className="song-pass is-play">{section ? section.label : song.chords.join(' · ')}</span>
        <span className="song-section-tag">{song.title}</span>
        {playback === 'buffering' && <span className="song-buffering">buffering</span>}
        {topline}
      </div>

      {theater ? (
        <YouTubePlayer
          videoId={videoId}
          onEnded={onEnded}
          // A stored link is the user's own pick and may not share the
          // catalogue recording's intro, so only skip ahead on ours.
          startSeconds={storedLink ? undefined : song.startSeconds}
          onPlayer={setPlayer}
          onPhase={setPlayback}
          onError={setPlayerError}
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

      {theater && playerError !== null && (
        <p className="song-untimed">
          This recording will not play here. Change the link to another upload of the song.
        </p>
      )}

      {theater && playerError === null && timeline && (
        chartLive ? (
          <>
            <SyncedChart timeline={timeline} time={clock.time} onFrame={onFrame} />
            <PlaybackControls
              rate={clock.rate}
              rates={clock.rates}
              onRate={(rate) => {
                if (player) setPlayerRate(player, rate);
              }}
              sectionLabel={section?.label ?? null}
              looping={loopIndex !== null}
              onToggleLoop={() =>
                setLoopIndex((current) => (current === null ? sectionIndex : null))
              }
            />
          </>
        ) : (
          <ChartStandIn note="Getting the recording's clock." />
        )
      )}

      {/* Stated, never hidden. A chart with no timing is not shown scrolling
          approximately: it says it has none, and the play-along runs the way
          it always did. */}
      {theater && playerError === null && !timeline && (
        <p className="song-untimed">
          {storedLink
            ? 'The chart is timed to the catalogue recording, so it stays off for your own link.'
            : `${timed.ok ? 'This chart has no timing yet.' : timed.gap.message} Play along with the chords above.`}
        </p>
      )}

      <div className="song-real-foot">
        {theater && (
          <button className="song-skip" onClick={() => { setLinkDraft(storedLink ?? ''); setEditingLink(true); }}>
            <YoutubeLogo size={16} /> Change link
          </button>
        )}
        {foot}
      </div>
    </motion.div>
  );
}
