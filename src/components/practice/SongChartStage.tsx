import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { MetronomeIcon } from '../icons';
import { SyncedChart } from './SyncedChart';
import { PlaybackControls } from './PlaybackControls';
import { SongPaceBar } from './SongPaceBar';
import { SongClock } from '../../lib/songClock';
import { SongBacking, buildBackingPlan } from '../../audio/songBacking';
import { onOutputAudioChange, isOutputAudioReady, unlockOutputAudio } from '../../audio/outputContext';
import { COUNT_IN_BEATS } from '../../audio/metronome';
import { secondsPerBeat, sectionIndexAt, type SongTimeline } from '../../lib/songTiming';
import type { SongPace } from '../../lib/songTempo';
import type { Song } from '../../data/songs';
import './songChartStage.css';

// Play the song on the app's own clock.
//
// Not the degraded version of the record stage. The chart has never once run for
// a shipped song, because every one of them returns no-anchors, and a mode that
// generates its own grid needs no anchoring: all eight light up the day it
// lands. It also does what the record cannot. The tempo is ours, so any pace
// plays cleanly with nothing to time-stretch; the loop is exact, with no seek
// latency to lead; the count-in is real; and none of it needs a connection.
//
// What it does not do is pretend to be the record. There is no score, no
// accuracy and no streak inside a song, which is a rule older than this mode.

/**
 * Paces offered, as a fraction of the song's own.
 *
 * Wider and finer at the bottom than YouTube's set, which is the point: its slow
 * rates are unusable because there is a recording to stretch, and here there is
 * not. Nothing above the record's own pace, because the thing being practised is
 * this song at this tempo.
 */
const RATES = [0.5, 0.6, 0.7, 0.8, 0.9, 1];

interface Props {
  song: Song;
  timeline: SongTimeline;
  /** The tempo the timeline was laid out at, and whose number it is. */
  pace: SongPace;
  /** Where the clamp is, so the backing sounds at the pitch the chart asks for. */
  capo: number;
  onEnded: () => void;
  topline?: React.ReactNode;
  foot: React.ReactNode;
}

export function SongChartStage({ song, timeline, pace, capo, onEnded, topline, foot }: Props) {
  const [rate, setRate] = useState(1);
  const [sectionIndex, setSectionIndex] = useState(-1);
  const [loopIndex, setLoopIndex] = useState<number | null>(null);
  const [click, setClick] = useState(false);
  const [audible, setAudible] = useState(isOutputAudioReady());

  // Created once and held, so the object the chart animates against is the same
  // one on every render and its loop is never torn down mid-song.
  const [engine] = useState(() => {
    const clock = new SongClock();
    return { clock, backing: new SongBacking(clock) };
  });

  const plan = useMemo(() => buildBackingPlan(timeline, COUNT_IN_BEATS), [timeline]);
  const leadIn = COUNT_IN_BEATS * secondsPerBeat(timeline.bars[0]);

  useEffect(() => {
    const { clock, backing } = engine;
    backing.setPlan(plan);
    backing.setCapo(capo);
    // A song starting is a user gesture away at most: the mode was picked by
    // tapping a card, and that is the moment a browser will free audio.
    unlockOutputAudio();
    clock.start(-leadIn);
    backing.start();
    return () => {
      backing.stop();
      clock.pause();
    };
  }, [engine, plan, capo, leadIn]);

  useEffect(() => onOutputAudioChange(setAudible), []);

  useEffect(() => {
    engine.backing.setClick(click);
  }, [engine, click]);

  const endedRef = useRef(false);
  const loopRef = useRef<number | null>(null);
  const sectionRef = useRef(-1);
  useEffect(() => {
    loopRef.current = loopIndex;
  }, [loopIndex]);

  // Runs on every animation frame and must never cause a render, so everything
  // it consults is a ref and everything it publishes is compared first.
  const onFrame = useCallback((seconds: number) => {
    const index = sectionIndexAt(timeline, seconds);
    if (index !== sectionRef.current) {
      sectionRef.current = index;
      setSectionIndex(index);
    }

    const loop = loopRef.current;
    if (loop !== null) {
      const section = timeline.sections[loop];
      // Exact, and back to the downbeat itself. The recording needed a lead
      // because a seek lands late; our own clock arrives where it is sent.
      if (section && seconds >= section.endSeconds) {
        engine.clock.seek(section.startSeconds);
        return;
      }
      return;
    }

    if (!endedRef.current && seconds >= timeline.endSeconds) {
      endedRef.current = true;
      engine.backing.stop();
      engine.clock.pause();
      onEnded();
    }
  }, [engine, timeline, onEnded]);

  const section = sectionIndex >= 0 ? timeline.sections[sectionIndex] ?? null : null;

  return (
    <motion.div
      className="song-real is-chartmode"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="song-topline">
        <span className="song-pass is-play">{section ? section.label : song.chords.join(' · ')}</span>
        <span className="song-section-tag">{song.title}</span>
        {topline}
      </div>

      <SyncedChart timeline={timeline} time={engine.clock} onFrame={onFrame} />

      <div className="song-chart-controls">
        <SongPaceBar pace={pace} rate={rate} audible={audible} />
        {/* One control, no label. Under a backing that is already strumming the
            rhythm a click fights it, so it starts off; the count-in sounds
            either way, because that is what leads the player in. */}
        <button
          className={click ? 'song-click is-on' : 'song-click'}
          onClick={() => setClick((on) => !on)}
          aria-pressed={click}
          aria-label={click ? 'Turn the click off' : 'Turn the click on'}
        >
          <MetronomeIcon size={18} />
        </button>
      </div>

      <PlaybackControls
        rate={rate}
        rates={RATES}
        onRate={(next) => {
          setRate(next);
          engine.clock.setRate(next);
        }}
        sectionLabel={section?.label ?? null}
        looping={loopIndex !== null}
        onToggleLoop={() => setLoopIndex((current) => (current === null ? sectionIndex : null))}
      />

      <div className="song-real-foot">{foot}</div>
    </motion.div>
  );
}
