import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRightIcon, CapoIcon, ChartModeIcon, CheckCircleIcon, MusicNoteIcon, RecordModeIcon } from '../icons';
import { SongRecordStage } from './SongRecordStage';
import { SongChartStage } from './SongChartStage';
import { SongModeChoice, type SongMode } from './SongModeChoice';
import { ChordDiagram } from './ChordDiagram';
import { StrumRow } from './StrumRow';
import { sfx } from '../../audio/sfx';
import { useSong } from '../../hooks/useSongs';
import { useCapoOffset } from '../../hooks/useCapo';
import { useOnline } from '../../lib/offline';
import { buildTempoTimeline, songPace } from '../../lib/songTempo';

const AUTO_ADVANCE_SECONDS = 5;

type Phase = 'intro' | 'play' | 'results';

interface Props {
  songId: string;
  onClose?: () => void;
  onNext?: () => void;
  autoAdvance?: boolean;
  nextLabel?: string;
  /**
   * The play-along is over. `reachedEnd` is true only when the song itself ran
   * out: the Done button is the player's word that they are finished, and filing
   * the two identically had the day's record claim a clock had run to its end
   * when someone had tapped Done ten seconds in.
   */
  onFinish?: (reachedEnd: boolean) => void;
}

// A song, two ways.
//
// **Record mode: play with the band. Chart mode: play the song.** They are not a
// good one and a degraded one. Playing to a record is where you find out whether
// you have it; playing the chart at seventy percent with the chords under you is
// where you get it. Neither is the fallback for the other, and the app never
// switches between them on its own: a connection dying mid-song leaves the
// record stage stalled where it always stalled, with the chart card there.
//
// Nothing on either stage is scored. The microphone would hear the record
// through the speakers, so any accuracy number would be grading the band and
// reporting it as the player's, and a generated backing would be worse: it would
// be grading the app. There is no streak, no miss count and no fail state
// anywhere inside a song, and that rule is older than chart mode.
//
// This component keeps the phases, the chords, the choice and the results. The
// two engines live in their own files, and neither knows the other exists.
export function SongPlayer({
  songId,
  onClose,
  onNext,
  autoAdvance = false,
  nextLabel = 'Up next',
  onFinish,
}: Props) {
  const song = useSong(songId);
  // Where the clamp actually is, as against where this chart wants it.
  const accountCapo = useCapoOffset();
  const online = useOnline();

  const [phase, setPhase] = useState<Phase>('intro');
  const [mode, setMode] = useState<SongMode>('chart');
  const [advanceLeft, setAdvanceLeft] = useState(AUTO_ADVANCE_SECONDS);

  // Chart mode needs no anchoring, so this is available for every song that has
  // bars, which is every song in the catalogue.
  const pace = useMemo(() => (song ? songPace(song, null) : null), [song]);
  const charted = useMemo(
    () => (song && pace ? buildTempoTimeline(song, pace.bpm) : null),
    [song, pace],
  );
  const chartTimeline = charted?.ok ? charted.timeline : null;

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
            before the song starts and does not wait. */}
        <StrumRow strum={song.strum} size={24} />
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
        {/* The way in, and the whole of it. There is no separate start button,
            because starting and choosing how to play are one decision, and a
            screen that starts one mode by default is a screen on which the other
            mode does not exist. */}
        <SongModeChoice
          timeline={chartTimeline}
          online={online}
          onPick={(picked) => {
            sfx.go();
            setMode(picked);
            setPhase('play');
          }}
        />
      </div>
    );
  }

  if (phase === 'play') {
    const foot = (
      <>
        <span className="song-honest is-inline">Not graded, just play.</span>
        <button className="practice-btn primary" onClick={() => finish(false)}>
          Done <ArrowRightIcon size={18} />
        </button>
      </>
    );

    // The other mode, one tap away, drawn and not written. Someone who landed on
    // the video and wanted the chart should not have to go back to find it.
    const other: SongMode = mode === 'chart' ? 'record' : 'chart';
    const canSwitch = other === 'chart' ? !!chartTimeline : online;
    const swap = canSwitch ? (
      <button
        className="song-mode-swap"
        onClick={() => setMode(other)}
        aria-label={other === 'chart' ? 'Play the song from the chart' : 'Play along with the recording'}
      >
        {other === 'chart' ? <ChartModeIcon size={18} /> : <RecordModeIcon size={18} />}
      </button>
    ) : null;

    if (mode === 'chart' && chartTimeline && pace) {
      return (
        <SongChartStage
          song={song}
          timeline={chartTimeline}
          pace={pace}
          capo={song.capo ?? 0}
          onEnded={() => finish(true)}
          topline={swap}
          foot={foot}
        />
      );
    }

    return (
      <SongRecordStage
        song={song}
        onEnded={() => finish(true)}
        topline={swap}
        foot={foot}
      />
    );
  }

  return (
    <motion.div className="om-results" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
      {/* The song ran to its end with the player on it, which is the only thing
          this drill can honestly witness, so that is all the card says. "Nice
          playing" was the app congratulating someone for showing up, which is
          the one thing its voice is not for. */}
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
