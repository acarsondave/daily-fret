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
import { chordKey, findKey, patternKey, poolKey, rotationRing, sweepKey, timingKey, trainerPool } from '../../lib/drillKeys';
import { deckOf, patternRuns } from '../../lib/patternDeck';
import { buildSegments, isResumable, restIsSpoken, restSecondsAfter } from '../../lib/coached';
import { keyDrillHistory } from '../../lib/drillStats';
import { DRILL_UNIT, trainerBlockSeconds } from '../../lib/drills';
import { drillSeries, planTempo, fixedTempo, DEFAULT_PRACTICE_BPM, type TempoPlan } from '../../lib/tempo';
import { isRunUnheard, recentBaseline } from '../../lib/unheardRun';
import { perMinute } from '../../lib/drillWindow';
import { useSongs } from '../../hooks/useSongs';
import { findSong } from '../../lib/songCatalog';
import { sfx } from '../../audio/sfx';
import { diag } from '../../audio/diagnostics';
import { speak, announceDrill, preloadCoachVoice, stopVoice, isCoachVoiceEnabled, setCoachVoiceEnabled } from '../../audio/coachVoice';
import { useChordDetector } from '../../hooks/useChordDetector';
import type { Routine } from '../../types';
import type { TimedOutcome } from '../../store/completion';
import { OneMinuteChanges } from './OneMinuteChanges';
import { ChordTrainer } from './ChordTrainer';
import { ChordRotation } from './ChordRotation';
import { StrumTiming } from './StrumTiming';
import { StrumPatterns } from './StrumPatterns';
import { NoteFinder } from './NoteFinder';
import { finderHistory } from '../../lib/finderHistory';
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
import { FilmNotice } from './FilmNotice';
import './practice.css';

type Phase = 'resume' | 'intro' | 'rest' | 'segment' | 'summary';

// Visual count-in length used only as a *silent fallback* — when the coach voice
// is on, the spoken count-in drives the timing instead (see the intro effect).
const COUNT_IN_SECONDS = 3;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * A finished run, held on the results screen rather than written on the spot.
 *
 * The write used to happen the instant a drill ended, which made both of the
 * results screen's new controls impossible to honour. Again cannot keep the
 * better of two takes if the worse one is already in the day's record, and Skip
 * cannot advance without recording something the store was told about five
 * seconds earlier.
 *
 * So a run is a proposal until the session leaves the segment. Nothing is lost
 * by waiting: the same commit runs when the countdown expires, when Again's
 * replacement lands, and when the player exits the overlay mid-hand-off.
 */
interface PendingRun {
  /** Tells the day's record what happened. Runs exactly once, or never. */
  commit: () => void;
  /** The row this run puts in the session summary. */
  row: CoachStepResult;
  /**
   * What the run scored, for choosing between takes of one segment. Null for a
   * run that produced no number at all, which never displaces one that did.
   */
  value: number | null;
}

/** A run that leaves nothing in the day's record, because it was skipped. */
const RECORD_NOTHING = () => {};

interface Props {
  routine: Routine;
  onClose: () => void;
}

// A block's length, in the unit that can express it. Rounding to minutes said
// "0 mins" of every block shorter than half a minute, which is a warm-up the
// screen was claiming lasts no time at all.
function blockLength(seconds: number): string {
  if (seconds < 60) {
    const s = Math.round(seconds);
    return `${s} sec${s === 1 ? '' : 's'}`;
  }
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
  const recordNoteFinds = useStore((s) => s.recordNoteFinds);

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
          s.kind === 'patterns' ||
          s.kind === 'finder',
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
  // Which attempt at the current segment is on screen. Again bumps it, which
  // remounts the drill and gives the retake its own recording clip.
  const [take, setTake] = useState(0);
  // The take on screen produced a number the app is not willing to file: far
  // below what this drill is recently worth, through a microphone that was
  // unreadable for a meaningful part of it. Reset with the take, because it is a
  // statement about one attempt.
  const [withheld, setWithheld] = useState(false);
  // What the segment on screen has produced so far, held rather than written.
  // See `propose` below for why the write waits.
  const pendingRef = useRef<PendingRun | null>(null);
  // One departure per take. The auto-advance countdown, Again and Skip can all
  // fire within the same tick, and only the first of them may move the session.
  const departedRef = useRef(false);
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
  // The neck as it stands, and every run behind each rung. Snapshotted when the
  // segment opens, before this run is recorded, so neither the ladder nor the
  // wear on the neck can move under the player mid-block.
  const noteMap = useMemo(() => {
    if (seg?.kind !== 'finder') return {};
    const state = useStore.getState();
    return state.accounts[state.currentAccountId]?.noteMap ?? {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);
  const finderRuns = useMemo(() => {
    if (seg?.kind !== 'finder') return {};
    const state = useStore.getState();
    const acc = state.accounts[state.currentAccountId];
    return finderHistory(acc ? drillLogsOf(acc) : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

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
    // The note finder has no tempo of its own and does not want one: a click
    // running under a question about where C is would be metronome practice
    // happening at the same time as note practice, and neither would get done.
    // The panel is still loaded so the player can start one by hand.
    if (seg.kind === 'finder') {
      return fixedTempo(undefined, 'No click. This one is a question, not a pace.');
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

  /**
   * What this drill has recently been worth, and the window today's run is
   * counted over.
   *
   * Snapshotted with the segment, for the same reason the tempo above is: a run
   * must be judged against the history it started with, not against a history it
   * has itself just moved. Only the three drills that produce a count have one;
   * strum timing and patterns report a percentage, which says nothing about
   * whether the microphone was working.
   */
  const priorRuns = useMemo<{ rates: number[]; windowSec: number } | null>(() => {
    if (!seg) return null;
    const state = useStore.getState();
    const acc = state.accounts[state.currentAccountId];
    const logs = acc ? drillLogsOf(acc) : {};
    if (seg.kind === 'changes') {
      return {
        rates: drillSeries(logs, pairKey(seg.from, seg.to), seg.seconds).map((p) => p.value),
        windowSec: seg.seconds,
      };
    }
    if (seg.kind === 'trainer') {
      const pool = trainerPool(seg.chords);
      const windowSec = trainerBlockSeconds(seg.seconds, pool.length);
      return {
        rates: drillSeries(logs, poolKey(pool), windowSec).map((p) => p.value),
        windowSec,
      };
    }
    if (seg.kind === 'rotation') {
      return {
        rates: drillSeries(logs, sweepKey(rotationRing(seg.chords)), seg.seconds).map((p) => p.value),
        windowSec: seg.seconds,
      };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  /**
   * Whether the run that just ended measured the player or the microphone.
   *
   * Both halves have to hold: see lib/unheardRun.ts for why, and for what this
   * deliberately still lets through.
   */
  const isUnheardRun = (count: number, unheardShare: number): boolean => {
    if (!priorRuns) return false;
    return isRunUnheard({
      rate: perMinute(count, priorRuns.windowSec),
      baseline: recentBaseline(priorRuns.rates),
      unheardShare,
    });
  };

  // The camera follows the segments rather than the session.
  //
  // One clip per drill, filed under the task it belongs to, which is what makes
  // "show me the last time I played this" answerable later. It also means the
  // rests are not filmed: an empty chair, eight times a session, is storage
  // spent on nothing and footage nobody will scrub past.
  //
  // A retake is its own clip. The take is in the key because the footage of an
  // attempt the player chose to redo is a different piece of practice from the
  // one that replaced it, and overwriting either would lose whichever went well.
  const clip = useMemo<ActiveClip | null>(
    () =>
      phase === 'segment' && seg
        ? {
            key: `seg-${index}-${take}`,
            date: today,
            taskId: seg.taskId,
            routineId: routine.id,
            label: seg.title,
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase, index, take, seg?.taskId, seg?.title],
  );
  const recording = useSessionRecording(clip);

  // A task can fan out into several segments (e.g. one-minute-changes → one per
  // chord pair). It only counts as "done" once its *final* segment is finished,
  // so checking off after a single pair no longer fires early.
  const isFinalSegmentOfTask = (i: number) =>
    !!segments[i] && segments[i + 1]?.taskId !== segments[i].taskId;

  /**
   * Offer a finished run as what this segment will be recorded as.
   *
   * Called by every drill the moment it ends, in place of writing to the store.
   * When Again has produced a second take, the better of the two survives: that
   * is what "keeps the better result" has to mean, because the reason to go
   * again is a run the microphone spoiled and the reason not to lose the retake
   * is a run that went better.
   */
  const propose = (run: PendingRun) => {
    const held = pendingRef.current;
    // A run with no number never displaces one that has a number, whichever way
    // round the takes came: a mic that died halfway through the second attempt
    // must not erase the first attempt's count.
    if (held && (run.value ?? -1) <= (held.value ?? -1)) return;
    pendingRef.current = run;
  };

  /**
   * A drill that ran with nothing counted: the microphone was refused, or it
   * went away mid-run. Time played, no number, and the summary row says so.
   */
  const timedProposal = (taskId: string, title: string, outcome: TimedOutcome): PendingRun => ({
    commit: () => recordTime(today, taskId, outcome),
    row: { title, value: null, unit: '', done: false },
    value: null,
  });

  /**
   * A run the microphone could not hear. Nothing is written for it at all.
   *
   * It still holds the segment's place, so ignoring the offer to run it again
   * leaves the summary saying the drill produced nothing rather than dropping it
   * out of the session. Nothing reaches the day's record either way: that is the
   * whole point, because what did reach it was resetting readiness streaks and
   * pulling the next tempo prescription down.
   */
  const unheardProposal = (title: string): PendingRun => ({
    commit: RECORD_NOTHING,
    row: { title, value: null, unit: '', done: false },
    value: null,
  });

  /** Write whatever the segment is holding, once, and let go of it. */
  const commitPending = (): PendingRun | null => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    pending?.commit();
    return pending;
  };

  const exit = () => {
    // Walking out is not skipping. A run held on the results screen was played
    // and heard, so it goes into the day's record on the way out exactly as it
    // would have if the countdown had been allowed to finish.
    commitPending();
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

  // A new segment, or a new attempt at one, is a fresh chance to leave it.
  useEffect(() => {
    departedRef.current = false;
  }, [index, take]);

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
      seg.kind === 'patterns' ||
      // The note finder is in this list for the reason timing is: it listens,
      // but through its own monophonic pitch capture rather than a chromagram.
      // Two input audio sessions at once is the thing Safari is least forgiving
      // about, and a chord matcher would be running over a drill that never asks
      // it anything.
      seg.kind === 'finder'
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

  const advance = () => {
    // Only the first thing to leave this take moves the session. The countdown
    // reaching zero, Again and Skip all race each other by design.
    if (departedRef.current) return;
    departedRef.current = true;
    // The run the segment settled on, written now that no take can replace it.
    // The summary row comes from the same place as the record, so the two can no
    // longer disagree about what the app heard. This is what `lastValueRef` used
    // to do, badly: it survived into the next segment, so a drill that produced
    // nothing at all showed the previous drill's number with a tick beside it.
    const recorded = commitPending();
    songReachedEndRef.current = false;
    // The verdict belonged to the attempt that has just ended.
    setWithheld(false);
    // Settle the underlying task only when this was its last segment, so a
    // multi-pair changes task is judged once, on everything it produced, rather
    // than on whichever pair happened to come last. Settling does not assume a
    // completion: it grants one only where the evidence carries it.
    if (isFinalSegmentOfTask(index)) {
      settleTask(today, seg.taskId);
    }
    const nextResults = recorded ? [...results, recorded.row] : results;
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

  /**
   * Run the segment on screen again, from the top.
   *
   * No announcement and no rest first: the player has just asked for it with the
   * guitar already in their hands, and the whole reason this control exists is
   * that the cost of another go used to be quitting the session and reopening
   * it. Whatever the previous take produced stays held, so the better of the two
   * is what the day ends up with.
   */
  const runAgain = () => {
    if (departedRef.current) return;
    departedRef.current = true;
    stopVoice();
    diag.mark(`coached segment ${index + 1}/${segments.length}: ${seg.title}, running again`);
    setWithheld(false);
    setTake((t) => t + 1);
  };

  /**
   * Move on, recording nothing for this segment.
   *
   * Everything the segment produced is dropped, including a take an earlier
   * Again had banked: Skip means this drill does not go into the day, and a
   * version of it that quietly filed the best attempt anyway would be the app
   * recording practice the player just told it not to.
   */
  const skipSegment = () => {
    if (departedRef.current) return;
    diag.mark(`coached segment ${index + 1}/${segments.length}: ${seg.title}, skipped`);
    // The summary still carries the step, with no number and no tick. A session
    // that quietly dropped the row would report nine tasks as eight, which is a
    // different claim from "this one was not counted".
    pendingRef.current = {
      commit: RECORD_NOTHING,
      row: {
        title: seg.kind === 'changes' ? `${seg.from} ↔ ${seg.to}` : seg.title,
        value: null,
        unit: '',
        done: false,
      },
      value: null,
    };
    advance();
  };

  const startOver = () => {
    setIndex(0);
    setTake(0);
    setWithheld(false);
    setResults([]);
    pendingRef.current = null;
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
                : seg.kind === 'finder'
                  ? 'One named note at a time, found and played'
                  : blockLength(seg.seconds);

  // The notice holds the whole session, not only the camera. Filming is already
  // refused upstream until it is answered, but a drill running behind it would
  // be spending the player's practice on a screen they have not read yet.
  const view = recording.noticeDue ? 'notice' : phase;

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
            autoPlay={phase === 'segment' && seg.kind !== 'song' && seg.kind !== 'finder'}
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
        {/* Before anything rolls, on the first session of a filming day.
            Answering writes the day to the store, which is subscribed here, so
            this clears itself and the session picks up where it would have. */}
        {view === 'notice' && <FilmNotice />}
        {view === 'resume' && (
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

        {view === 'intro' && (
          <motion.div key={`intro-${index}`} className="coach-intro" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="coach-intro-title">{seg.title}</div>
            {/* The shapes, not their names. This is the last quiet moment before
                the drill and the only one where a hand is free to find them. */}
            <SegmentCue segment={seg} fallback={<div className="om-caption">{subLabel}</div>} />
            <CountIn at={countdown} />
            {needsMic && <MicPermissionHint />}
          </motion.div>
        )}

        {view === 'rest' && (
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

        {view === 'segment' && seg.kind === 'changes' && (
          <OneMinuteChanges
            key={`seg-${index}-${take}`}
            config={{ kind: 'one-minute-changes', chordFrom: seg.from, chordTo: seg.to, durationSec: seg.seconds }}
            autoStart
            autoAdvance
            nextLabel={isLastSegment ? 'Finishing' : 'Rest'}
            detector={detector}
            onResult={(cpm, f, t, unheardShare) => {
              // Proposes what was heard; it does not complete anything. The task
              // is settled once, after its last pair (see advance).
              setLastPair(f, t);
              if (isUnheardRun(cpm, unheardShare)) {
                diag.mark(
                  `one-minute ${f}->${t}: ${cpm} through a microphone unreadable for ` +
                    `${Math.round(unheardShare * 100)}% of the run, not filed`,
                );
                setWithheld(true);
                propose(unheardProposal(`${seg.from} ↔ ${seg.to}`));
              } else {
                propose({
                  commit: () => recordMeasurements(today, seg.taskId, [{ key: pairKey(f, t), value: cpm }]),
                  row: { title: `${seg.from} ↔ ${seg.to}`, value: cpm, unit: 'cpm', done: cpm > 0 },
                  value: cpm,
                });
              }
              void speak('done');
            }}
            withheld={withheld}
            onTimedRun={(outcome) => propose(timedProposal(seg.taskId, `${seg.from} ↔ ${seg.to}`, outcome))}
            onNext={advance}
            onAgain={runAgain}
            onSkip={skipSegment}
            onClose={exit}
          />
        )}

        {view === 'segment' && seg.kind === 'trainer' && (
          <ChordTrainer
            key={`seg-${index}-${take}`}
            config={{ kind: 'chord-trainer', chords: seg.chords, durationSec: seg.seconds }}
            autoStart
            autoAdvance
            nextLabel={isLastSegment ? 'Finishing' : 'Rest'}
            detector={detector}
            onResult={({ perChord, total, unheardShare }) => {
              // The block's score and each shape's own count, from one run.
              if (isUnheardRun(total, unheardShare)) {
                diag.mark(
                  `chord perfect ${seg.title}: ${total} through a microphone unreadable for ` +
                    `${Math.round(unheardShare * 100)}% of the block, not filed`,
                );
                setWithheld(true);
                propose(unheardProposal(seg.title));
              } else {
                propose({
                  commit: () =>
                    recordMeasurements(today, seg.taskId, [
                      { key: poolKey(perChord.map((p) => p.chord)), value: total },
                      ...perChord.map((p) => ({ key: chordKey(p.chord), value: p.placements })),
                    ]),
                  row: {
                    title: seg.title,
                    value: total,
                    unit: DRILL_UNIT['chord-trainer'],
                    done: total > 0,
                  },
                  value: total,
                });
              }
              void speak('done');
            }}
            withheld={withheld}
            onTimedRun={(outcome) => propose(timedProposal(seg.taskId, seg.title, outcome))}
            onNext={advance}
            onAgain={runAgain}
            onSkip={skipSegment}
            onClose={exit}
          />
        )}

        {view === 'segment' && seg.kind === 'rotation' && ring && (
          <ChordRotation
            key={`seg-${index}-${take}`}
            config={{ kind: 'chord-rotation', chords: ring, durationSec: seg.seconds }}
            personalBest={rotationBest}
            autoStart
            autoAdvance
            nextLabel={isLastSegment ? 'Finishing' : 'Rest'}
            detector={detector}
            onResult={({ ring: turned, changes, unheardShare }) => {
              if (isUnheardRun(changes, unheardShare)) {
                diag.mark(
                  `rotation ${turned.join('-')}: ${changes} through a microphone unreadable for ` +
                    `${Math.round(unheardShare * 100)}% of the run, not filed`,
                );
                setWithheld(true);
                propose(unheardProposal(seg.title));
              } else {
                propose({
                  commit: () => recordMeasurements(today, seg.taskId, [{ key: sweepKey(turned), value: changes }]),
                  row: { title: seg.title, value: changes, unit: 'changes', done: changes > 0 },
                  value: changes,
                });
              }
              void speak('done');
            }}
            withheld={withheld}
            onTimedRun={(outcome) => propose(timedProposal(seg.taskId, seg.title, outcome))}
            onNext={advance}
            onAgain={runAgain}
            onSkip={skipSegment}
            onClose={exit}
          />
        )}

        {view === 'segment' && seg.kind === 'timing' && (
          <StrumTiming
            key={`seg-${index}-${take}`}
            config={{ kind: 'strum-timing', durationSec: seg.seconds, bpm: seg.bpm }}
            bpm={tempoPlan?.bpm ?? DEFAULT_PRACTICE_BPM}
            personalBest={timingBest}
            autoStart
            autoAdvance
            nextLabel={isLastSegment ? 'Finishing' : 'Rest'}
            onResult={({ bpm, summary }) => {
              propose({
                commit: () =>
                  recordMeasurements(today, seg.taskId, [{ key: timingKey(bpm), value: summary.score }]),
                row: { title: seg.title, value: summary.score, unit: '% in time', done: summary.score > 0 },
                value: summary.score,
              });
              void speak('done');
            }}
            onNext={advance}
            onAgain={runAgain}
            onSkip={skipSegment}
            onClose={exit}
          />
        )}

        {view === 'segment' && seg.kind === 'patterns' && (
          <StrumPatterns
            key={`seg-${index}-${take}`}
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
              const measurements = deals.length
                ? deals.map((d) => ({
                    key: patternKey(d.pattern, bpm),
                    value: d.score,
                    settledBar: d.settledBar,
                  }))
                : [{ key: patternKey(patternDeck[0] ?? 'D-D-D-D-', bpm), value: 0 }];
              const best = deals.length ? Math.max(...deals.map((d) => d.score)) : 0;
              propose({
                commit: () => recordMeasurements(today, seg.taskId, measurements),
                row: { title: seg.title, value: best, unit: '% in time', done: best > 0 },
                value: best,
              });
              void speak('done');
            }}
            onNext={advance}
            onAgain={runAgain}
            onSkip={skipSegment}
            onClose={exit}
          />
        )}

        {view === 'segment' && seg.kind === 'finder' && (
          <NoteFinder
            key={`seg-${index}-${take}`}
            config={{ kind: 'note-finder', durationSec: seg.seconds, rungId: seg.rungId }}
            map={noteMap}
            history={finderRuns}
            autoStart
            autoAdvance
            nextLabel={isLastSegment ? 'Finishing' : 'Rest'}
            onResult={(run) => {
              // The count and the neck are written together and only when the
              // run is committed: an Again that replaces this attempt must not
              // leave the neck holding finds from the take it discarded.
              propose({
                commit: () => {
                  recordMeasurements(today, seg.taskId, [
                    {
                      key: findKey(run.rungId),
                      value: run.finds,
                      durationSec: seg.seconds,
                      findMs: run.findMs,
                      // Answers played to an answer the drill had lit. Never
                      // part of the count; they are how the day tells a run that
                      // recalled nothing from a microphone that heard nothing.
                      uncounted: run.shown,
                    },
                  ]);
                  recordNoteFinds(run.found);
                },
                // Recalled, not found: a note played to an answer the drill had
                // lit is a real thing that happened and is not one of these. It
                // still counts as the block having done something, or a first
                // session at a rung would be summarised as not counted while the
                // player was playing all the way through it.
                row: {
                  title: seg.title,
                  value: run.finds,
                  unit: 'recalled',
                  done: run.finds > 0 || run.shown > 0,
                },
                value: run.finds,
              });
              void speak('done');
            }}
            onTimedRun={(outcome) => propose(timedProposal(seg.taskId, seg.title, outcome))}
            onNext={advance}
            onAgain={runAgain}
            onSkip={skipSegment}
            onClose={exit}
          />
        )}

        {view === 'segment' && seg.kind === 'song' && (
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
              const outcome = {
                elapsedSeconds: elapsed,
                reachedEnd: songReachedEndRef.current,
                done: true,
              };
              propose({
                commit: () => recordTime(today, seg.taskId, outcome),
                row: { title: seg.title, value: null, unit: '', done: true },
                value: null,
              });
              advance();
            }}
            onClose={exit}
          />
        )}

        {view === 'segment' && seg.kind === 'timed' && (
          <TimedSegment
            key={`seg-${index}-${take}`}
            title={seg.title}
            description={seg.description}
            seconds={seg.seconds}
            pattern={seg.pattern}
            nextLabel={isLastSegment ? 'Finishing' : 'Rest'}
            onFinish={() => void speak('done')}
            onDone={(outcome) => {
              propose({
                commit: () => recordTime(today, seg.taskId, outcome),
                row: { title: seg.title, value: null, unit: '', done: outcome.done },
                value: null,
              });
              advance();
            }}
            // Walking out of a block mid-clock is not a run to be held and
            // chosen between. It is a teardown, and the seconds it really ran
            // for are written straight away.
            onLeave={(outcome) => recordTime(today, seg.taskId, outcome)}
          />
        )}

        {view === 'summary' && (
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
