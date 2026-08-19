import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  CloseIcon,
  CheckCircleIcon,
  CircleIcon,
  SpeakerIcon,
  SpeakerOffIcon,
  SkipIcon,
} from '../icons';
import { useStore, getTodayString, drillLogsOf, type CoachStepResult } from '../../store';
import { pairKey } from '../../lib/pairs';
import { chordKey, patternKey, poolKey, rotationRing, sweepKey, timingKey, trainerPool } from '../../lib/drillKeys';
import { deckOf, patternRuns } from '../../lib/patternDeck';
import { buildSegments, isResumable, restIsSpoken, restSecondsAfter } from '../../lib/coached';
import { keyDrillHistory } from '../../lib/drillStats';
import { DRILL_UNIT, trainerBlockSeconds } from '../../lib/drills';
import { drillSeries, planTempo, fixedTempo, DEFAULT_PRACTICE_BPM, type TempoPlan } from '../../lib/tempo';
import { useSongs } from '../../hooks/useSongs';
import { findSong } from '../../lib/songCatalog';
import { sfx } from '../../audio/sfx';
import { diag } from '../../audio/diagnostics';
import { speak, announceDrill, preloadCoachVoice, stopVoice, isCoachVoiceEnabled, setCoachVoiceEnabled } from '../../audio/coachVoice';
import { useChordDetector } from '../../hooks/useChordDetector';
import type { Routine } from '../../types';
import { OneMinuteChanges } from './OneMinuteChanges';
import { ChordTrainer } from './ChordTrainer';
import { ChordRotation } from './ChordRotation';
import { StrumTiming } from './StrumTiming';
import { StrumPatterns } from './StrumPatterns';
import { SongPlayer } from './SongPlayer';
import { TimedSegment } from './TimedSegment';
import { MicPermissionHint } from './MicPermissionHint';
import { Metronome } from './Metronome';
import { SegmentRail } from './SegmentRail';
import { SegmentCue, CountIn } from './CoachCue';
import { ProgressRing } from './ProgressRing';
import { CapoBadge } from './CapoBadge';
import { RecordingIndicator } from './RecordingIndicator';
import { useSessionRecording, type ActiveClip } from '../../media/useSessionRecording';
import './practice.css';

type Phase = 'resume' | 'intro' | 'rest' | 'segment' | 'summary';

// Visual count-in length used only as a *silent fallback* — when the coach voice
// is on, the spoken count-in drives the timing instead (see the intro effect).
const COUNT_IN_SECONDS = 3;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Props {
  routine: Routine;
  onClose: () => void;
}

function mins(seconds: number): string {
  const m = Math.round(seconds / 60);
  return `${m} min${m === 1 ? '' : 's'}`;
}

export function CoachedSession({ routine, onClose }: Props) {
  const recordMeasurements = useStore((s) => s.recordMeasurements);
  const recordTime = useStore((s) => s.recordTime);
  const settleTask = useStore((s) => s.settleTask);
  const setLastPair = useStore((s) => s.setLastPair);
  const saveCoachProgress = useStore((s) => s.saveCoachProgress);
  const clearCoachProgress = useStore((s) => s.clearCoachProgress);

  const songs = useSongs();
  const segments = useMemo(() => buildSegments(routine), [routine]);
  // Only nudge about the mic if this routine actually listens. Songs used to be
  // in this list, but the play-along has had no mic since the learn pass was
  // retired, so a song-only routine was asking for a permission it never uses.
  const needsMic = useMemo(
    () =>
      segments.some(
        (s) =>
          s.kind === 'changes' ||
          s.kind === 'trainer' ||
          s.kind === 'rotation' ||
          s.kind === 'timing' ||
          s.kind === 'patterns',
      ),
    [segments],
  );
  // One mic for the whole session — segments share it via the `detector` prop so
  // we don't re-request permission (and re-spin the audio graph) per drill.
  const detector = useChordDetector();

  // Resume support: pick up a saved, unfinished session for this routine.
  const [resumeData] = useState(() => {
    const s = useStore.getState();
    const cp = s.accounts[s.currentAccountId]?.coachProgress;
    if (!cp || cp.routineId !== routine.id) return null;
    if (!isResumable(cp, Date.now(), getTodayString())) return null;
    if (cp.index <= 0 || cp.index >= segments.length) return null;
    return cp;
  });

  // The date this session records under, decided once when it opens and never
  // recomputed.
  //
  // It used to be read on every render, so a session running through midnight
  // measured a drill against one date and settled it against the next. `settle`
  // finds nothing to settle on a day with no measurement, returns the log
  // unchanged, and the day the practice actually happened on ends up with no
  // record of it at all. The clock is not allowed to move under a session in
  // progress: a session belongs to the date it started, and a resumed one keeps
  // the date of the sitting it is continuing.
  const [today, setToday] = useState(() => resumeData?.date ?? getTodayString());
  // When this sitting began, which is what decides whether it is still the same
  // sitting later. A resumed session inherits it rather than restarting it, so
  // resuming cannot keep a session alive across days one pause at a time.
  const [startedAt, setStartedAt] = useState(() => resumeData?.startedAt ?? Date.now());

  const [index, setIndex] = useState(() => resumeData?.index ?? 0);
  const [results, setResults] = useState<CoachStepResult[]>(() => resumeData?.results ?? []);
  const [phase, setPhase] = useState<Phase>(() => (resumeData ? 'resume' : 'intro'));
  // 0 → the coach is announcing ("Get ready…"); >0 → silent visual count-in.
  const [countdown, setCountdown] = useState(0);
  // The break now running: how long it was prescribed for, and what is left of
  // it. The whole length is state rather than a constant because it is decided
  // by the segment that just ended, and the ring has to draw a share of it.
  const [restTotal, setRestTotal] = useState(0);
  const [restLeft, setRestLeft] = useState(0);
  const [voiceOn, setVoiceOn] = useState(isCoachVoiceEnabled());
  const restLeftRef = useRef(0);
  const lastValueRef = useRef<number | null>(null);
  // Wall clock for the segment currently on screen. Only the song play-along
  // reads it: it is the one segment with no clock of its own, and time spent
  // with the record playing is the only thing the app can honestly witness there.
  const segmentStartRef = useRef(0);
  // Whether the record itself ran out, as opposed to the player tapping Done.
  // Both end the play-along; only one of them is a clock the app watched reach
  // its end, and the day's record draws that distinction on the task row.
  const songReachedEndRef = useRef(false);

  const seg = segments[index];
  const isLastSegment = index >= segments.length - 1;
  // The ring this rotation will turn, so the drill and the key it is filed under
  // agree on which loop ran.
  const ring = seg?.kind === 'rotation' ? rotationRing(seg.chords) : null;
  // The rotation compares against its own history. Snapshot it when the segment
  // opens, before this run is recorded, so "First benchmark" only shows when
  // there genuinely is no prior turn of this ring. Chord Perfect reads its own,
  // per pool, because the pool is part of its key.
  // The tempo this timing block will run at, so its best is read from the same
  // series the result will be filed under.
  const timingBest = useMemo(() => {
    if (seg?.kind !== 'timing') return 0;
    const state = useStore.getState();
    const acc = state.accounts[state.currentAccountId];
    if (!acc) return 0;
    return keyDrillHistory(drillLogsOf(acc), timingKey(seg.bpm ?? DEFAULT_PRACTICE_BPM)).best;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);
  // The deck this block will deal, and what the player's own history says about
  // each card in it. Snapshotted when the segment opens, before this run is
  // recorded, so a standing cannot move under the player mid-block.
  const patternDeck = useMemo(
    () => (seg?.kind === 'patterns' ? deckOf(seg.patterns) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index],
  );
  const patternHistory = useMemo(() => {
    if (seg?.kind !== 'patterns') return {};
    const state = useStore.getState();
    const acc = state.accounts[state.currentAccountId];
    const logs = acc ? drillLogsOf(acc) : {};
    const at = seg.bpm ?? DEFAULT_PRACTICE_BPM;
    return Object.fromEntries(patternDeck.map((p) => [p, patternRuns(logs, p, at)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, patternDeck]);
  const rotationBest = useMemo(() => {
    if (!ring) return 0;
    const state = useStore.getState();
    const acc = state.accounts[state.currentAccountId];
    if (!acc) return 0;
    return keyDrillHistory(drillLogsOf(acc), sweepKey(ring)).best;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);
  // The tempo this segment should run at, read from the player's own results for
  // this exact drill. Snapshotted per segment (like trainerHistory) so recording
  // today's result mid-session can't move the click under the player's fingers.
  const tempoPlan = useMemo<TempoPlan | null>(() => {
    if (!seg) return null;
    const state = useStore.getState();
    const acc = state.accounts[state.currentAccountId];
    const logs = acc ? drillLogsOf(acc) : {};
    if (seg.kind === 'changes') {
      return planTempo(drillSeries(logs, pairKey(seg.from, seg.to), seg.seconds), today);
    }
    if (seg.kind === 'trainer') {
      const pool = trainerPool(seg.chords);
      // The block's real length, not the length the task asked for: Chord
      // Perfect gives every shape a floor of its own, so a 90-second task over
      // five shapes runs 100 seconds. Reading the score against 90 made the
      // player look eleven per cent faster than they were, and the click asked
      // for a pace they had never reached.
      return planTempo(
        drillSeries(logs, poolKey(pool), trainerBlockSeconds(seg.seconds, pool.length)),
        today,
      );
    }
    if (seg.kind === 'rotation') {
      return planTempo(drillSeries(logs, sweepKey(rotationRing(seg.chords)), seg.seconds), today);
    }
    if (seg.kind === 'timed') return fixedTempo(seg.bpm);
    // Timing states its tempo rather than deriving one: its result is a
    // percentage, and a percentage implies nothing about how fast to go next.
    if (seg.kind === 'timing') {
      return fixedTempo(seg.bpm, `Hold ${seg.bpm ?? DEFAULT_PRACTICE_BPM} in 4/4. One down strum on every click.`);
    }
    // Patterns state theirs too, and for the same reason. The click also has to
    // run unbroken through the whole block, which is what the drill is about.
    if (seg.kind === 'patterns') {
      return fixedTempo(
        seg.bpm,
        `Hold ${seg.bpm ?? DEFAULT_PRACTICE_BPM} in 4/4. The arm keeps moving through every slot.`,
      );
    }
    // Songs are played to the record, not to a click. The tempo is still loaded
    // so one tap gives the right click if the player wants it while learning.
    const song = findSong(songs, seg.songId);
    return fixedTempo(
      song?.bpm,
      song?.bpm ? `${song.title} runs at about ${song.bpm} BPM. Tap start if you want it.` : undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // The camera follows the segments rather than the session.
  //
  // One clip per drill, filed under the task it belongs to, which is what makes
  // "show me the last time I played this" answerable later. It also means the
  // rests are not filmed: thirty seconds of an empty chair, eight times a
  // session, is storage spent on nothing and footage nobody will scrub past.
  const clip = useMemo<ActiveClip | null>(
    () =>
      phase === 'segment' && seg
        ? {
            key: `seg-${index}`,
            date: today,
            taskId: seg.taskId,
            routineId: routine.id,
            label: seg.title,
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase, index, seg?.taskId, seg?.title],
  );
  const recording = useSessionRecording(clip);

  // A task can fan out into several segments (e.g. one-minute-changes → one per
  // chord pair). It only counts as "done" once its *final* segment is finished,
  // so checking off after a single pair no longer fires early.
  const isFinalSegmentOfTask = (i: number) =>
    !!segments[i] && segments[i + 1]?.taskId !== segments[i].taskId;

  const exit = () => {
    if (phase !== 'summary' && index > 0) {
      saveCoachProgress({ routineId: routine.id, date: today, startedAt, index, results });
    }
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exit();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index, results]);

  // Warm the voice pack so the first line doesn't lag.
  useEffect(() => {
    preloadCoachVoice();
  }, []);

  // Release the shared mic and silence the coach when the session unmounts.
  useEffect(() => {
    return () => {
      void detector.stop();
      stopVoice();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the mic for segments that don't listen. Mic drills only hand their
  // handlers back at the end, so without this the capture graph stayed open
  // through every timed block and every song — running FFTs on the recording
  // coming out of the speakers, filling the diagnostics with frames from audio
  // nobody played, and holding an input audio session against playback.
  useEffect(() => {
    if (!seg) return;
    // Timing is in this list even though it does listen, because it listens
    // through its own capture: it needs millisecond attack times and a band
    // split, not a chromagram. Leaving the shared one open would hold two input
    // audio sessions at once, which is the thing Safari is least forgiving
    // about, and would run a chord matcher over a drill that never asks it
    // anything.
    if (
      seg.kind === 'timed' ||
      seg.kind === 'song' ||
      seg.kind === 'timing' ||
      seg.kind === 'patterns'
    ) {
      void detector.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Announce → count-in → start, before *every* drill. The drill only starts
  // once the coach has finished talking, so the voice never overlaps the drill.
  // When the voice is off/unavailable, a silent 3·2·1 visual count-in stands in.
  useEffect(() => {
    if (phase !== 'intro' || !seg) return;
    let cancelled = false;
    (async () => {
      setCountdown(0); // show "Get ready…" while the coach talks
      // A task can fan into several segments (one per chord pair). Speak the
      // name only on its first segment; later pairs get a short generic lead-in
      // so we don't repeat "Chord Speed Training" before every pair.
      // Announce the name when the title changes from the previous segment. A
      // task that fans into same-titled segments (changes → one per pair) is
      // announced once; distinct-titled segments (blocks, songs) each get named.
      const isNewTitle = index === 0 || segments[index - 1]?.title !== seg.title;
      const announced = isNewTitle
        ? await announceDrill(seg.title) // "Up next, <drill name>"
        : await speak('up-next');
      if (cancelled) return;
      const counted = announced ? await speak('count-in') : false; // spoken 3·2·1
      if (cancelled) return;
      if (!counted) {
        // Silent fallback: tick a visible 3·2·1 so the start never feels abrupt.
        for (let n = COUNT_IN_SECONDS; n >= 1; n--) {
          if (cancelled) return;
          setCountdown(n);
          sfx.tick();
          await delay(1000);
        }
      }
      if (cancelled) return;
      diag.mark(`coached segment ${index + 1}/${segments.length}: ${seg.title}`);
      segmentStartRef.current = Date.now();
      setPhase('segment');
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, index, seg, segments]);

  // Rest timer between segments (gym-style). It counts itself down and rolls
  // into the next drill, so a hands-free session needs nothing tapped. Skipping
  // is there for the days the break is not needed: the longest of them is a full
  // minute, because the drill it follows earns one.
  const skipRest = () => {
    stopVoice();
    restLeftRef.current = 0;
    setRestLeft(0);
    setPhase('intro');
  };

  useEffect(() => {
    if (phase !== 'rest') return;
    // A second, encouraging line partway through the rest (stretch reminders
    // etc.), on the breaks long enough to hold it.
    const tip = restIsSpoken(restTotal)
      ? setTimeout(() => void speak('rest-tip', false), 6000)
      : null;
    const deadline = Date.now() + restLeftRef.current * 1000;
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      restLeftRef.current = remaining;
      setRestLeft(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        setPhase('intro'); // announce + count-in the next drill before it starts
      }
    }, 250);
    return () => {
      clearInterval(id);
      if (tip !== null) clearTimeout(tip);
    };
  }, [phase, restTotal]);

  if (!seg) {
    return createPortal(
      <motion.div className="practice-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div className="practice-topbar">
          <span className="practice-eyebrow">Coached</span>
          <button className="practice-close" onClick={onClose} aria-label="Close"><CloseIcon size={20} /></button>
        </div>
        <div className="practice-body">
          <p className="om-caption">This routine has no drills or timed tasks yet.</p>
          <button className="practice-btn primary" onClick={onClose}>Done</button>
        </div>
      </motion.div>,
      document.body,
    );
  }

  const advance = (result?: CoachStepResult) => {
    // The segment on screen is over, so its number is over with it.
    //
    // This ref used to survive into the next segment, and every measured drill
    // reads it to build its own summary row. A drill that produced no number at
    // all still calls advance: a run on the timer after the microphone was
    // refused mid-session ends on `TimerRunEnded`, which advances without ever
    // calling onResult. The next row then carried the previous drill's figure
    // and a tick beside it, so the summary reported a measurement of a pair the
    // app had not heard a single note of. Callers read this before advance runs,
    // so clearing it here is the moment nothing is left to read.
    lastValueRef.current = null;
    songReachedEndRef.current = false;
    // Settle the underlying task only when this was its last segment, so a
    // multi-pair changes task is judged once, on everything it produced, rather
    // than on whichever pair happened to come last. Settling does not assume a
    // completion: it grants one only where the evidence carries it.
    if (isFinalSegmentOfTask(index)) {
      settleTask(today, seg.taskId);
    }
    const nextResults = result ? [...results, result] : results;
    setResults(nextResults);
    const nextIndex = index + 1;
    if (nextIndex < segments.length) {
      saveCoachProgress({ routineId: routine.id, date: today, startedAt, index: nextIndex, results: nextResults });
      setIndex(nextIndex);
      // How long the break is depends on the work that just finished, and it can
      // be nothing at all: two timed blocks of one task run straight on.
      const rest = restSecondsAfter(seg, segments[nextIndex]);
      restLeftRef.current = rest;
      setRestTotal(rest);
      setRestLeft(rest);
      if (rest === 0) {
        setPhase('intro');
      } else {
        setPhase('rest');
        sfx.rest();
        void speak('rest-start');
      }
    } else {
      clearCoachProgress();
      void detector.stop();
      setPhase('summary');
      sfx.sessionComplete();
      void speak('session');
    }
  };

  const startOver = () => {
    setIndex(0);
    setResults([]);
    lastValueRef.current = null;
    clearCoachProgress();
    // Starting over is a new session, so it belongs to now rather than to the
    // date of the sitting it just discarded.
    setToday(getTodayString());
    setStartedAt(Date.now());
    setPhase('intro');
  };

  const subLabel =
    seg.kind === 'changes'
      ? `${seg.from} ↔ ${seg.to}`
      : seg.kind === 'trainer'
        ? `Chord Trainer · ${seg.chords.join(' ')}`
        : seg.kind === 'rotation'
          ? seg.chords.join(' → ')
          : seg.kind === 'song'
            ? 'Play along with the real song'
            : seg.kind === 'timing'
              ? 'One down strum on every click'
              : seg.kind === 'patterns'
                ? 'Patterns dealt against a click that never stops'
                : mins(seg.seconds);

  return createPortal(
    <motion.div
      className="practice-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="practice-topbar">
        <SegmentRail
          total={segments.length}
          index={index}
          complete={phase === 'summary'}
        />
        <CapoBadge />
        <div className="practice-topbar-actions">
          <RecordingIndicator
            rolling={recording.rolling}
            elapsedMs={recording.elapsedMs}
            failure={recording.failure}
            onDismissFailure={recording.dismissFailure}
          />
          <Metronome
            plan={tempoPlan}
            planKey={`${index}`}
            // Only while the drill is actually running: a click under the coach's
            // announcement or through a rest is noise, and over a recording it
            // fights the track.
            autoPlay={phase === 'segment' && seg.kind !== 'song'}
          />
          {/* The muted state changes the mark, not just its opacity: a dimmed
              icon is indistinguishable from a disabled one at practice distance. */}
          <button
            className={voiceOn ? 'practice-close' : 'practice-close is-off'}
            onClick={() => {
              const next = !voiceOn;
              setCoachVoiceEnabled(next);
              setVoiceOn(next);
            }}
            title={voiceOn ? 'Coach voice on' : 'Coach voice off'}
            aria-label={voiceOn ? 'Turn the coach voice off' : 'Turn the coach voice on'}
            aria-pressed={voiceOn}
          >
            {voiceOn ? <SpeakerIcon size={20} /> : <SpeakerOffIcon size={20} />}
          </button>
          <button
            className="practice-close"
            onClick={exit}
            title="Exit (Esc). Your place is saved."
            aria-label="Exit the session. Your place is saved."
          >
            <CloseIcon size={20} />
          </button>
        </div>
      </div>

      <div className="practice-body">
        {phase === 'resume' && (
          <motion.div className="coach-intro" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="coach-intro-title">{routine.name}</div>
            {/* Where the session stopped, on the same neck the topbar draws it
                on, so "resume" is a place rather than a fraction to work out. */}
            <SegmentRail total={segments.length} index={index} className="is-summary" />
            <SegmentCue segment={seg} className="is-quiet" />
            <div className="om-actions">
              <button className="practice-btn ghost" onClick={startOver}>Start over</button>
              <button className="practice-btn primary" onClick={() => setPhase('intro')} autoFocus>
                Resume
              </button>
            </div>
          </motion.div>
        )}

        {phase === 'intro' && (
          <motion.div key={`intro-${index}`} className="coach-intro" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="coach-intro-title">{seg.title}</div>
            {/* The shapes, not their names. This is the last quiet moment before
                the drill and the only one where a hand is free to find them. */}
            <SegmentCue segment={seg} fallback={<div className="om-caption">{subLabel}</div>} />
            <CountIn at={countdown} />
            {needsMic && <MicPermissionHint />}
          </motion.div>
        )}

        {phase === 'rest' && (
          <motion.div key={`rest-${index}`} className="coach-intro" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            {/* The rest, as the length it is, twice over. The arc is how much of
                this break is left, and the ring's own diameter is how long the
                break is: the minute owed after a counted minute is drawn nearly
                twice the width of the eight seconds owed after a stretch, so two
                different rests never look like the same rest counting faster. */}
            <ProgressRing
              progress={restTotal > 0 ? 1 - restLeft / restTotal : 1}
              stroke={8}
              className="coach-rest-ring"
              style={{ '--rest-seconds': restTotal } as CSSProperties}
            >
              <div className="coach-rest-count">{restLeft}</div>
            </ProgressRing>
            <div className="coach-intro-title is-next">{seg.title}</div>
            <SegmentCue
              segment={seg}
              size={72}
              className="is-quiet"
              fallback={<div className="om-caption">{subLabel}</div>}
            />
            <button className="practice-btn ghost coach-skip-rest" onClick={skipRest}>
              <SkipIcon size={16} /> Skip the rest
            </button>
            {needsMic && <MicPermissionHint />}
          </motion.div>
        )}

        {phase === 'segment' && seg.kind === 'changes' && (
          <OneMinuteChanges
            key={`seg-${index}`}
            config={{ kind: 'one-minute-changes', chordFrom: seg.from, chordTo: seg.to, durationSec: seg.seconds }}
            autoStart
            autoAdvance
            nextLabel={isLastSegment ? 'Finishing' : 'Rest'}
            detector={detector}
            onResult={(cpm, f, t) => {
              // Records what was heard; it does not complete anything. The task
              // is settled once, after its last pair (see advance).
              recordMeasurements(today, seg.taskId, [{ key: pairKey(f, t), value: cpm }]);
              setLastPair(f, t);
              lastValueRef.current = cpm;
              void speak('done');
            }}
            onTimedRun={(outcome) => recordTime(today, seg.taskId, outcome)}
            onNext={() => advance({
              title: `${seg.from} ↔ ${seg.to}`,
              value: lastValueRef.current,
              unit: 'cpm',
              done: (lastValueRef.current ?? 0) > 0,
            })}
            onClose={exit}
          />
        )}

        {phase === 'segment' && seg.kind === 'trainer' && (
          <ChordTrainer
            key={`seg-${index}`}
            config={{ kind: 'chord-trainer', chords: seg.chords, durationSec: seg.seconds }}
            autoStart
            autoAdvance
            nextLabel={isLastSegment ? 'Finishing' : 'Rest'}
            detector={detector}
            onResult={({ perChord, total }) => {
              // The block's score and each shape's own count, from one run.
              recordMeasurements(today, seg.taskId, [
                { key: poolKey(perChord.map((p) => p.chord)), value: total },
                ...perChord.map((p) => ({ key: chordKey(p.chord), value: p.placements })),
              ]);
              lastValueRef.current = total;
              void speak('done');
            }}
            onTimedRun={(outcome) => recordTime(today, seg.taskId, outcome)}
            onNext={() => advance({
              title: seg.title,
              value: lastValueRef.current,
              unit: DRILL_UNIT['chord-trainer'],
              done: (lastValueRef.current ?? 0) > 0,
            })}
            onClose={exit}
          />
        )}

        {phase === 'segment' && seg.kind === 'rotation' && ring && (
          <ChordRotation
            key={`seg-${index}`}
            config={{ kind: 'chord-rotation', chords: ring, durationSec: seg.seconds }}
            personalBest={rotationBest}
            autoStart
            autoAdvance
            nextLabel={isLastSegment ? 'Finishing' : 'Rest'}
            detector={detector}
            onResult={({ ring: turned, changes }) => {
              recordMeasurements(today, seg.taskId, [{ key: sweepKey(turned), value: changes }]);
              lastValueRef.current = changes;
              void speak('done');
            }}
            onTimedRun={(outcome) => recordTime(today, seg.taskId, outcome)}
            onNext={() => advance({
              title: seg.title,
              value: lastValueRef.current,
              unit: 'changes',
              done: (lastValueRef.current ?? 0) > 0,
            })}
            onClose={exit}
          />
        )}

        {phase === 'segment' && seg.kind === 'timing' && (
          <StrumTiming
            key={`seg-${index}`}
            config={{ kind: 'strum-timing', durationSec: seg.seconds, bpm: seg.bpm }}
            bpm={tempoPlan?.bpm ?? DEFAULT_PRACTICE_BPM}
            personalBest={timingBest}
            autoStart
            autoAdvance
            nextLabel={isLastSegment ? 'Finishing' : 'Rest'}
            onResult={({ bpm, summary }) => {
              recordMeasurements(today, seg.taskId, [{ key: timingKey(bpm), value: summary.score }]);
              lastValueRef.current = summary.score;
              void speak('done');
            }}
            onNext={() => advance({
              title: seg.title,
              value: lastValueRef.current,
              unit: '% in time',
              done: (lastValueRef.current ?? 0) > 0,
            })}
            onClose={exit}
          />
        )}

        {phase === 'segment' && seg.kind === 'patterns' && (
          <StrumPatterns
            key={`seg-${index}`}
            config={{ kind: 'strum-pattern', durationSec: seg.seconds, bpm: seg.bpm, bars: seg.bars }}
            bpm={tempoPlan?.bpm ?? DEFAULT_PRACTICE_BPM}
            deck={patternDeck}
            history={patternHistory}
            autoStart
            autoAdvance
            nextLabel={isLastSegment ? 'Finishing' : 'Rest'}
            onResult={({ bpm, deals }) => {
              // One measurement per deal, each under the pattern it was played
              // on. A block with nothing in it still reports, under the first
              // card of the deck and at zero, so the day records that the drill
              // ran and heard nothing rather than looking unopened.
              const results = deals.length
                ? deals.map((d) => ({
                    key: patternKey(d.pattern, bpm),
                    value: d.score,
                    settledBar: d.settledBar,
                  }))
                : [{ key: patternKey(patternDeck[0] ?? 'D-D-D-D-', bpm), value: 0 }];
              recordMeasurements(today, seg.taskId, results);
              lastValueRef.current = deals.length
                ? Math.max(...deals.map((d) => d.score))
                : 0;
              void speak('done');
            }}
            onNext={() => advance({
              title: seg.title,
              value: lastValueRef.current,
              unit: '% in time',
              done: (lastValueRef.current ?? 0) > 0,
            })}
            onClose={exit}
          />
        )}

        {phase === 'segment' && seg.kind === 'song' && (
          <SongPlayer
            key={`seg-${index}`}
            songId={seg.songId}
            autoStart
            autoAdvance
            nextLabel={isLastSegment ? 'Finishing' : 'Rest'}
            onFinish={(reachedEnd) => {
              songReachedEndRef.current = reachedEnd;
              void speak('done');
            }}
            onNext={() => {
              // The play-along has no clock of its own and no microphone, so the
              // time it was on screen is all the app can witness. Whether it ran
              // to the end is a separate claim, and it used to be made
              // unconditionally: tapping Done ten seconds in filed the segment as
              // a clock that had run out, which the task row then printed as one.
              const elapsed = (Date.now() - segmentStartRef.current) / 1000;
              recordTime(today, seg.taskId, {
                elapsedSeconds: elapsed,
                reachedEnd: songReachedEndRef.current,
                done: true,
              });
              advance({ title: seg.title, value: null, unit: '', done: true });
            }}
            onClose={exit}
          />
        )}

        {phase === 'segment' && seg.kind === 'timed' && (
          <TimedSegment
            key={`seg-${index}`}
            title={seg.title}
            description={seg.description}
            seconds={seg.seconds}
            pattern={seg.pattern}
            nextLabel={isLastSegment ? 'Finishing' : 'Rest'}
            onFinish={() => void speak('done')}
            onDone={(outcome) => {
              recordTime(today, seg.taskId, outcome);
              advance({ title: seg.title, value: null, unit: '', done: outcome.done });
            }}
            onLeave={(outcome) => recordTime(today, seg.taskId, outcome)}
          />
        )}

        {phase === 'summary' && (
          <motion.div className="coach-summary" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="coach-summary-head">
              {/* The neck, run through. It has been on screen for the whole
                  session and this is the frame where it is finally full, which
                  is what "complete" looks like without a trophy on top of it. */}
              <SegmentRail
                total={segments.length}
                index={segments.length}
                complete
                className="is-summary"
              />
              <h2 className="coach-summary-title">{routine.name}</h2>
            </div>
            {/* A summary that checks off every step it walked past would be the
                same lie the day's list used to tell. A step that produced
                nothing says so here. */}
            <div className="coach-summary-list">
              {results.map((r, i) => (
                <div
                  key={i}
                  className={r.done === false ? 'coach-summary-row is-open' : 'coach-summary-row'}
                >
                  {r.done === false ? (
                    <CircleIcon size={18} className="coach-summary-open" />
                  ) : (
                    <CheckCircleIcon size={18} className="coach-summary-check" />
                  )}
                  <span className="coach-summary-name">{r.title}</span>
                  {r.value !== null ? (
                    <span className="coach-summary-val">
                      {r.value} <span className="coach-summary-unit">{r.unit}</span>
                    </span>
                  ) : (
                    r.done === false && <span className="coach-summary-unit">not counted</span>
                  )}
                </div>
              ))}
            </div>
            <button className="practice-btn primary coach-summary-done" onClick={onClose} autoFocus>
              Done
            </button>
          </motion.div>
        )}
      </div>
    </motion.div>,
    document.body,
  );
}
