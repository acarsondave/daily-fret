import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRightIcon, CapoIcon, CheckCircleIcon, MusicNoteIcon, PlayIcon } from '../icons';
import { YoutubeLogo } from '@phosphor-icons/react';
import { useStore } from '../../store';
import { YouTubePlayer, type PlaybackPhase } from './YouTubePlayer';
import { SyncedChart, ChartStandIn } from './SyncedChart';
import { PlaybackControls } from './PlaybackControls';
import { ChordDiagram } from './ChordDiagram';
import { StrumRow } from './StrumRow';
import { PatternBar } from './PatternBar';
import { sfx } from '../../audio/sfx';
import { useSong } from '../../hooks/useSongs';
import { usePlayerClock } from '../../hooks/usePlayerClock';
import { useCapoOffset } from '../../hooks/useCapo';
import { buildTimeline, loopTarget, sectionIndexAt, type SongTimeline } from '../../lib/songTiming';
import { parsePattern } from '../../lib/strumPattern';
import { describePattern } from '../../lib/patternDeck';
import { songStrumPatterns } from '../../lib/songStrum';
import { seekPlayerTo, setPlayerRate, type YTPlayer } from '../../lib/youtube';

const AUTO_ADVANCE_SECONDS = 5;

type Phase = 'intro' | 'play' | 'results';

interface Props {
  songId: string;
  onClose?: () => void;
  autoStart?: boolean;
  onNext?: () => void;
  autoAdvance?: boolean;
  nextLabel?: string;
  /**
   * The play-along is over. `reachedEnd` is true only when the recording itself
   * ran out: the Done button is the player's word that they are finished, and
   * filing the two identically had the day's record claim a clock had run to its
   * end when someone had tapped Done ten seconds in.
   */
  onFinish?: (reachedEnd: boolean) => void;
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
//
// The same reasoning is why nothing on this screen is scored. The microphone
// would hear the record through the speakers, so any accuracy number would be
// measuring the band and reporting it as the player's. It is not that grading
// was too hard to build; it is that the number would be a lie. The screen says
// so in as many words, and there is no streak, no miss count and no fail state
// anywhere in it.
//
// What replaced grading is the chart moving with the record, plus the two
// controls that actually teach a song: slow it down, and loop the section you
// cannot play yet.
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
  // Where the clamp actually is, as against where this chart wants it.
  const accountCapo = useCapoOffset();

  const storedLink = useStore((st) => (song ? st.accounts[st.currentAccountId]?.songLinks?.[song.id] : undefined));
  const setSongLink = useStore((st) => st.setSongLink);

  const [phase, setPhase] = useState<Phase>(autoStart ? 'play' : 'intro');
  const [advanceLeft, setAdvanceLeft] = useState(AUTO_ADVANCE_SECONDS);
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
  const timed = useMemo(() => (song ? buildTimeline(song) : null), [song]);
  // The phrase the strum block drills, for the last look at it before the record
  // starts. Null for a song whose strum is only chart shorthand.
  const phrase = useMemo(() => parsePattern(songStrumPatterns(song)[0] ?? ''), [song]);
  const timeline = timed?.ok && !storedLink ? timed.timeline : null;

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

  const finish = (reachedEnd: boolean) => {
    sfx.sessionComplete();
    onFinish?.(reachedEnd);
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
        {/* The hand, not the sentence. "Strum DDUUDU" is a code a beginner has to
            decode before it means anything; the arrows are the movement. The
            chords were three initials, and this screen is the last look at them
            before a record starts and does not wait.

            Where the song has a written phrase, it is drawn in the drill's own
            notation rather than as a row of arrows, and drawn whole. Two reasons,
            and neither is decoration. It is the same picture the strum block
            before this one just spent ninety seconds on, so the screen is
            reminding rather than introducing. And a row of arrows cannot say
            where the bar line falls or which way the arm is travelling through
            the slots that do not sound, both of which this phrase turns on.
            Songs whose strum is chart shorthand — two downs held across a bar —
            keep the arrows, because that is all their strum actually is. */}
        {phrase ? (
          <PatternBar pattern={phrase} size="card" label={describePattern(phrase)} />
        ) : (
          <StrumRow strum={song.strum} size={24} />
        )}
        {/* The capo is drawn on every shape rather than written once beside
            them, because it is a fact about how each of these is fretted. Get
            Lucky is charted in A minor against a record in B minor: without the
            capo the shapes are a whole tone under the recording and clash on
            every chord, and nothing on this screen said so. */}
        <div className="song-shape-row">
          {song.chords.map((c) => (
            <span key={c} className="song-shape">
              <ChordDiagram chord={c} size={78} showFingers={false} capo={song.capo ?? 0} />
              <span className="song-shape-name">{c}</span>
            </span>
          ))}
        </div>
        {/* The one case a picture cannot carry: the drills before this one were
            listening through a capo setting that is not the one this chart wants,
            and only the player can move the actual clamp. Shown only when the two
            disagree, so it is news rather than a label. */}
        {song.capo !== undefined && song.capo !== accountCapo && (
          <p className="song-capo-note" role="status">
            <CapoIcon size={15} />
            {accountCapo === 0
              ? `Put a capo on ${song.capo} to play with the record.`
              : `Your capo is set to ${accountCapo}. This one wants ${song.capo}.`}
          </p>
        )}
        <button className="practice-btn primary" onClick={() => { sfx.go(); setPhase('play'); }}>
          <PlayIcon size={20} /> Start play-along
        </button>
      </div>
    );
  }

  if (phase === 'play') {
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
        </div>

        {theater ? (
          <YouTubePlayer
            videoId={videoId}
            onEnded={() => finish(true)}
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
              : `${timed?.ok ? 'This chart has no timing yet.' : timed?.gap.message ?? 'This chart has no timing yet.'} Play along with the chords above.`}
          </p>
        )}

        <div className="song-real-foot">
          {theater && (
            <button className="song-skip" onClick={() => { setLinkDraft(storedLink ?? ''); setEditingLink(true); }}>
              <YoutubeLogo size={16} /> Change link
            </button>
          )}
          <span className="song-honest is-inline">Not graded, just play.</span>
          <button className="practice-btn primary" onClick={() => finish(false)}>
            Done <ArrowRightIcon size={18} />
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div className="om-results" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
      {/* The record ran to its end with the player on it, which is the only
          thing this drill can honestly witness, so that is all the card says.
          "Nice playing" was the app congratulating someone for showing up,
          which is the one thing its voice is not for. */}
      <CheckCircleIcon size={48} className="coach-summary-check" />
      <div className="coach-intro-title">{song.title}</div>
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
