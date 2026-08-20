// Finding a named note on the neck, measured by hearing it.
//
// THE ARGUMENT. src/data/skills.ts used to file note names as knowledge on the
// grounds that "a naming quiz would work; listening would not". Reciting the
// names is not the skill. Putting a finger on a named note quickly is, and from
// Grade 1 chord roots through barre shapes, CAGED, scales and keys it is the one
// piece of theory a hand actually has to do at speed. It is a playing action,
// and a playing action has a pitch on the end of it, so the app can hear it.
//
// SHOWN, THEN RECALLED. The first version of this drew a letter, a blank neck
// and a clock, which is an exam for anyone who has not already learnt where the
// naturals live, and it was one. So a position the player has never recalled is
// lit on the board and simply played; only once it has come back from memory is
// it asked with nothing drawn, and a recall that does not arrive lights it again
// and waits for the note anyway. Every question ends with the note played, which
// is the whole difference between a drill and a test. The two kinds of answer
// are never counted together (src/lib/noteFinder.ts): one is what the player
// knows and the other is what the app just told them.
//
// THE FIGURE. One letter and one neck, and the neck is only as much neck as the
// rung is asking about, so a fret is the size of a fingertip rather than four
// millimetres of a propped laptop. Everything the drill has to say happens on
// it: the answer lights there, a wrong note lands there beside it, and this
// run's answers stay there as the board fills in.
//
// WHAT IS BEING CLAIMED. The prompt named a position, the note that position
// makes came back, and inside the frets this rung asks about only that fret on
// that string makes it. Not "you played it there" — a frequency does not carry
// the string it came off, and C at the third fret of the A string and C at the
// eighth fret of the low E are the same 130.81 Hz forever.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import clsx from 'clsx';
import { ArrowRightIcon, HourglassIcon, MicIcon, PlayIcon, TapFretIcon } from '../icons';
import { MicGate, TimerRunEnded, UncountedNotice } from './MicGate';
import { usePitchDetector } from '../../hooks/usePitchDetector';
import { DEFAULT_TUNING_ID, getTuning, midiToName, readPitch } from '../../audio/tuning';
import { ProgressRing } from './ProgressRing';
import { ringScale } from '../../lib/ringScale';
import { NeckMap, type NeckMark } from './NeckMap';
import { STRING_STACK, neckLayout, neckWindow, positionBox } from './neckGeometry';
import { CoachAdvance } from './CoachAdvance';
import { sfx } from '../../audio/sfx';
import { diag } from '../../audio/diagnostics';
import { flatName, sharpName } from '../../lib/noteCircle';
import {
  RUNGS,
  currentRung,
  fretOn,
  getRung,
  isShown,
  judge,
  medianFindMs,
  midiAt,
  namesString,
  nextPrompt,
  positionKey,
  rungNumber,
  rungPositions,
  rungStanding,
  rungWindow,
  type FinderPrompt,
  type FinderRung,
  type FinderRunRecord,
  type NoteMap,
} from '../../lib/noteFinder';
import type { NoteFindReport } from '../../store';
import type { DrillConfig } from '../../types';
import type { TimedOutcome } from '../../store/completion';
import './noteFinder.css';

const AUTO_ADVANCE_SECONDS = 5;
/** How long a recalled answer stays lit on the neck before the next question. */
const CONFIRM_MS = 900;
/** A placement holds a little longer: the point of it was to be looked at. */
const PLACED_MS = 1300;
/** How long one demonstrated position holds on the setup screen. */
const DEMO_MS = 1600;

const STRINGS = getTuning(DEFAULT_TUNING_ID).strings;
/** What a person calls each string out loud. Two of them are E. */
const STRING_LABEL = new Map(STRINGS.map((s) => [s.position, s.label]));

const stringLabel = (position: number): string => {
  const label = STRING_LABEL.get(position);
  if (!label) throw new Error(`Standard tuning has no string at position ${position}.`);
  return label;
};

type View = 'setup' | 'playing' | 'results';
/**
 * Where one question has got to.
 *
 * `asking` draws nothing and is a recall. `showing` has the answer lit and is a
 * placement. The two endings are kept apart all the way to the record, because
 * they are different facts about the player.
 */
type Ask = 'asking' | 'showing' | 'recalled' | 'placed';
/** How a question is being answered: by playing it, or by pointing at it. */
type Channel = 'heard' | 'tapped';

export interface NoteFinderResult {
  rungId: string;
  /** Recalled with nothing on the board. The only number the ladder reads. */
  finds: number;
  /** Played with the answer lit. Never a recall, and never counted as one. */
  shown: number;
  /** Median milliseconds a recall took, or null when nothing was recalled. */
  findMs: number | null;
  /** Every answer at a prompt that named a string, each saying which kind it was. */
  found: NoteFindReport[];
}

interface Props {
  config?: DrillConfig;
  /** The whole neck as it stands, snapshotted before this run moves it. */
  map: NoteMap;
  /** Every recorded run at each rung, oldest first, so the ladder can be drawn. */
  history: Readonly<Record<string, readonly FinderRunRecord[]>>;
  onResult?: (result: NoteFinderResult) => void;
  /** A run the microphone could not hear, or one answered by tapping. No number. */
  onTimedRun?: (outcome: TimedOutcome) => void;
  onClose?: () => void;
  autoStart?: boolean;
  onNext?: () => void;
  autoAdvance?: boolean;
  nextLabel?: string;
  onAgain?: () => void;
  onSkip?: () => void;
  onSessionStart?: () => void;
}

export function NoteFinder({
  config,
  map,
  history,
  onResult,
  onTimedRun,
  onClose,
  autoStart = false,
  onNext,
  autoAdvance = false,
  nextLabel = 'Up next',
  onAgain,
  onSkip,
  onSessionStart,
}: Props) {
  const reduceMotion = useReducedMotion();
  const { status, error, pitch, start, stop } = usePitchDetector();
  const duration = config?.durationSec ?? 60;

  // The rung this run is on. A routine may pin one; otherwise it is the lowest
  // the player has not yet cleared, which is the same rule the click applies to
  // tempo: never above a pace already proven. Resolved once, because a rung that
  // moved mid-run would change the key the result is filed under.
  const [rung] = useState<FinderRung>(
    () => (config?.rungId ? getRung(config.rungId) : null) ?? currentRung(history),
  );

  const [view, setView] = useState<View>(autoStart ? 'playing' : 'setup');
  const [channel, setChannel] = useState<Channel>('heard');
  const [prompt, setPrompt] = useState<FinderPrompt | null>(null);
  const [ask, setAsk] = useState<Ask>('asking');
  const [finds, setFinds] = useState(0);
  const [placed, setPlaced] = useState(0);
  const [timeLeft, setTimeLeft] = useState(duration);
  /**
   * What arrived that was not the answer, with where it sits on the string that
   * was named when the string can make it at all. Cleared by the next question
   * and by a correct answer.
   */
  const [miss, setMiss] = useState<{ midi: number; fret: number | null } | null>(null);
  /**
   * What this run has answered so far, for the board to draw.
   *
   * State rather than the ref the result is built from, because the drawing is
   * the count: the player watches the stretch of neck they are working fill in
   * while they work it, and a ref would not repaint when it did.
   */
  const [answers, setAnswers] = useState<readonly NeckMark[]>([]);
  const [result, setResult] = useState<NoteFinderResult | null>(null);
  const [advanceLeft, setAdvanceLeft] = useState(AUTO_ADVANCE_SECONDS);
  /** Which position the setup screen is demonstrating, before anything is known. */
  const [demoAt, setDemoAt] = useState(0);

  // Everything the run accumulates lives in refs: the timers and the pitch
  // handler run outside React's render and would otherwise close over whatever
  // the state was when they were created.
  const promptRef = useRef<FinderPrompt | null>(null);
  const askedAtRef = useRef(0);
  const askRef = useRef<Ask>('asking');
  const judgedRef = useRef<number | null>(null);
  /** The note the microphone is reporting right now, or null in a quiet room. */
  const soundingRef = useRef<number | null>(null);
  const timesRef = useRef<number[]>([]);
  const foundRef = useRef<NoteFindReport[]>([]);
  const findsRef = useRef(0);
  const placedRef = useRef(0);
  /** Positions recalled during this run, which stop being lit for the rest of it. */
  const recalledRef = useRef<Set<string>>(new Set());
  const channelRef = useRef<Channel>('heard');
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishedRef = useRef(false);

  const clearClock = () => {
    if (clockRef.current) clearInterval(clockRef.current);
    clockRef.current = null;
  };
  const clearStep = () => {
    if (stepRef.current) clearTimeout(stepRef.current);
    stepRef.current = null;
  };

  const best = useMemo(() => {
    const runs = history[rung.id] ?? [];
    return runs.reduce((m, r) => Math.max(m, r.findsPerMin), 0);
  }, [history, rung.id]);

  // As much neck as the rung asks about, and one fret either side of it. The
  // drill and its tap targets read the same geometry, so a button can never sit
  // anywhere but over the fret it names.
  const neck = useMemo(() => {
    const { from, to } = rungWindow(rung);
    return neckWindow(from, to);
  }, [rung]);
  const layout = useMemo(() => neckLayout(neck, STRING_STACK.length), [neck]);

  /** Whether this position is still one the drill lights before asking for it. */
  const lightFor = useCallback(
    (stringPosition: number, fret: number) => {
      const key = positionKey(stringPosition, fret);
      if (recalledRef.current.has(key)) return false;
      return isShown(map[key]);
    },
    [map],
  );

  /**
   * Ask the next question.
   *
   * `Math.random` supplies the roll rather than the selection making its own,
   * so the choice is a pure function of the history and one number and can be
   * stated in a test (src/lib/noteFinder.ts).
   */
  const askNext = useCallback(() => {
    clearStep();
    const next = nextPrompt(rung, map, promptRef.current, Math.random());
    if (!next) return;
    promptRef.current = next;
    askedAtRef.current = Date.now();
    // Whatever is ringing now was struck for the question just answered. A
    // plucked note reads confidently for about four seconds, which is longer
    // than the gap between questions, so without this the previous answer
    // arrives as this question's wrong note before the player has moved a
    // finger. Measured, not guessed.
    judgedRef.current = soundingRef.current;
    const lit = namesString(next.form) && lightFor(next.stringPosition, next.fret);
    askRef.current = lit ? 'showing' : 'asking';
    setPrompt(next);
    setAsk(lit ? 'showing' : 'asking');
    setMiss(null);
  }, [rung, map, lightFor]);

  /** The recall did not come. Light the answer and go on waiting for the note. */
  const show = useCallback(() => {
    if (askRef.current !== 'asking') return;
    askRef.current = 'showing';
    setAsk('showing');
    setMiss(null);
  }, []);

  /** The right note arrived, or the right fret was pointed at. */
  const land = useCallback(() => {
    const asked = promptRef.current;
    if (!asked) return;
    const wasLit = askRef.current === 'showing';
    const ms = Date.now() - askedAtRef.current;
    askRef.current = wasLit ? 'placed' : 'recalled';
    setAsk(wasLit ? 'placed' : 'recalled');
    setMiss(null);
    if (channelRef.current === 'heard') {
      if (wasLit) {
        placedRef.current += 1;
        setPlaced(placedRef.current);
      } else {
        findsRef.current += 1;
        setFinds(findsRef.current);
        timesRef.current.push(ms);
        recalledRef.current.add(positionKey(asked.stringPosition, asked.fret));
      }
      // Only a prompt that named a string can be filed against a position. The
      // other two forms never told the app where to look, so it has nothing
      // true to write about a fret.
      if (namesString(asked.form)) {
        foundRef.current.push({
          stringPosition: asked.stringPosition,
          fret: asked.fret,
          ms,
          shown: wasLit,
        });
        setAnswers((was) => [
          ...was,
          {
            stringPosition: asked.stringPosition,
            fret: asked.fret,
            kind: wasLit ? 'shown' : 'found',
          },
        ]);
      }
      sfx.tick();
    }
    clearStep();
    stepRef.current = setTimeout(askNext, wasLit ? PLACED_MS : CONFIRM_MS);
  }, [askNext]);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    clearClock();
    clearStep();
    void stop();
    if (channelRef.current === 'tapped') {
      // The clock reached the end, so the block earns its completion exactly as
      // any timed task does. It earns no number, because a tap is not a played
      // note and nothing was heard.
      sfx.complete();
      onTimedRun?.({ elapsedSeconds: duration, reachedEnd: true, done: true });
      setView('results');
      return;
    }
    const run: NoteFinderResult = {
      rungId: rung.id,
      finds: findsRef.current,
      shown: placedRef.current,
      findMs: medianFindMs(timesRef.current),
      found: foundRef.current,
    };
    diag.mark(
      `note finder ${rung.id}: recalled ${run.finds}, shown ${run.shown}, median ${run.findMs ?? 'none'}ms`,
    );
    if (run.finds > best) sfx.best();
    else sfx.complete();
    setResult(run);
    setView('results');
    onResult?.(run);
  }, [best, duration, onResult, onTimedRun, rung.id, stop]);

  const startSession = useCallback(
    async (tapped = false) => {
      sfx.go();
      finishedRef.current = false;
      channelRef.current = tapped ? 'tapped' : 'heard';
      setChannel(tapped ? 'tapped' : 'heard');
      findsRef.current = 0;
      placedRef.current = 0;
      timesRef.current = [];
      foundRef.current = [];
      recalledRef.current = new Set();
      promptRef.current = null;
      soundingRef.current = null;
      setFinds(0);
      setPlaced(0);
      setAnswers([]);
      setTimeLeft(duration);
      setView('playing');
      onSessionStart?.();

      if (!tapped) {
        const live = await start();
        if (!live) return; // the gate takes over
        diag.mark(`note finder start ${rung.id} (${duration}s)`);
      }

      askNext();
      clearClock();
      const deadline = Date.now() + duration * 1000;
      clockRef.current = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        setTimeLeft(remaining);
        if (remaining <= 0) finish();
      }, 200);
    },
    [askNext, duration, finish, onSessionStart, rung.id, start],
  );

  // What the microphone reported, judged against what was asked.
  //
  // The hook publishes a steady reading rather than an event, so the transition
  // is what matters: one sustained note must be judged once, and the same note
  // played again after a different one must be judged again. `judgedRef` holds
  // the MIDI number this question has already had an answer from.
  useEffect(() => {
    if (view !== 'playing' || channel !== 'heard') return;
    if (!pitch || pitch.provisional || pitch.fading) {
      // The room has gone quiet. Nothing is being carried across from the last
      // question any more, so the next note counts whatever it is.
      soundingRef.current = null;
      return;
    }
    // Two strings ringing together is one periodic signal whose period belongs
    // to neither of them. The tuner learned this the hard way; nothing may be
    // judged on a reading that is the interval rather than a note.
    if (pitch.secondNoteAt !== null) return;

    const midi = readPitch(pitch.hz).midi;
    soundingRef.current = midi;

    const asked = promptRef.current;
    if (!asked) return;
    if (askRef.current !== 'asking' && askRef.current !== 'showing') return;
    if (judgedRef.current === midi) return;
    judgedRef.current = midi;

    if (judge(asked, midi).kind === 'right') {
      land();
      return;
    }
    setMiss({ midi, fret: fretOn(asked.stringPosition, midi) });
  }, [pitch, view, channel, land]);

  // The clock on one question, which is a different clock from the run's. Past
  // the rung's own budget the answer is lit and the question stays open: the
  // note still has to be played, and the record says it was played to a light.
  useEffect(() => {
    if (view !== 'playing' || !prompt) return;
    if (ask === 'asking') {
      const id = setTimeout(show, rung.budgetMs);
      return () => clearTimeout(id);
    }
    if (ask === 'showing') {
      // Lit and still nothing played. Not every silence is a player thinking:
      // move on rather than spending the rest of the minute on one fret.
      const id = setTimeout(askNext, rung.budgetMs);
      return () => clearTimeout(id);
    }
  }, [view, ask, prompt, show, askNext, rung.budgetMs]);

  // The microphone went away mid-run. The run ends where it stands and is filed
  // as the seconds actually played, with no number: a count taken through a dead
  // microphone is not a count.
  useEffect(() => {
    if (view !== 'playing' || channel !== 'heard') return;
    if (status !== 'muted' && status !== 'asleep') return;
    if (finishedRef.current) return;
    finishedRef.current = true;
    clearClock();
    clearStep();
    const played = Math.max(0, duration - timeLeft);
    diag.mark(`note finder ${rung.id}: microphone ${status} after ${played}s, filed as time played`);
    channelRef.current = 'tapped';
    setChannel('tapped');
    onTimedRun?.({ elapsedSeconds: played, reachedEnd: false, done: true });
    setView('results');
  }, [status, view, channel, duration, timeLeft, onTimedRun, rung.id]);

  useEffect(() => {
    // Deferred a tick so the auto-start runs after mount, which keeps setState
    // out of the effect body and is safe across StrictMode's double mount.
    const t = autoStart ? setTimeout(() => void startSession(), 0) : null;
    return () => {
      if (t) clearTimeout(t);
      clearClock();
      clearStep();
      void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hands-free advance, once results land in a coached session.
  useEffect(() => {
    if (view !== 'results' || !autoAdvance || !onNext) return;
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
  }, [view, autoAdvance, onNext]);

  // What the drill is, played out on the setup screen's own neck: a note is
  // named, it lights where it lives, you play it. It runs only while the board
  // is blank, which is the only time anyone needs telling, and stops for good
  // the moment there is a record to look at instead.
  const demoSpots = useMemo(() => rungPositions(rung), [rung]);
  const demonstrating = view === 'setup' && Object.keys(map).length === 0;
  // Reduced motion keeps the demonstration and stops it walking: one position
  // lit and named still says what the drill is, without anything moving.
  useEffect(() => {
    if (!demonstrating || reduceMotion) return;
    const id = setInterval(() => setDemoAt((at) => at + 1), DEMO_MS);
    return () => clearInterval(id);
  }, [demonstrating, reduceMotion]);

  const onTapFret = (fret: number) => {
    const asked = promptRef.current;
    if (!asked) return;
    if (askRef.current !== 'asking' && askRef.current !== 'showing') return;
    if (fret === asked.fret) {
      land();
      return;
    }
    setMiss({ midi: midiAt(asked.stringPosition, fret), fret });
  };

  // --- The ladder ----------------------------------------------------------

  if (view === 'setup') {
    const spot = demonstrating && demoSpots.length ? demoSpots[demoAt % demoSpots.length] : null;
    return (
      <div className="om-setup nf-setup">
        <RungLadder history={history} current={rung} />
        <p className="sr-only">
          A note is named and you play it. Every position you have not yet found
          from memory is lit on the neck for you first.
        </p>
        {/* The rung's own ground: the strings it asks about, the frets it asks
            about, and one position at a time lighting up on a board nothing is
            known about yet. It runs only while there is no record to look at
            instead, which is the only time anyone needs telling. */}
        {spot && (
          <div className="nf-letter is-showing" aria-hidden="true">
            <span className="nf-letter-name">{sharpName(spot.pc)}</span>
          </div>
        )}
        <NeckMap
          map={map}
          from={neck.from}
          to={neck.to}
          litStrings={rung.strings}
          marks={
            spot
              ? [{ stringPosition: spot.stringPosition, fret: spot.fret, kind: 'show', name: true }]
              : []
          }
          className="nf-setup-map"
        />
        <button className="practice-btn primary" onClick={() => void startSession()}>
          <PlayIcon size={20} /> Start {duration}s
        </button>
      </div>
    );
  }

  // --- Playing -------------------------------------------------------------

  if (view === 'playing') {
    if (channel === 'heard' && status === 'error') {
      return (
        <MicGate
          error={error}
          onRetry={() => void startSession()}
          onTimer={() => void startSession(true)}
          timerLabel="Tap the answers instead"
          timerIcon={<TapFretIcon size={18} />}
        />
      );
    }
    if (channel === 'heard' && (status === 'idle' || status === 'requesting')) {
      return (
        <div className="mic-gate">
          <MicIcon size={40} color="var(--accent-primary)" />
          <p>Allow microphone access to begin…</p>
        </div>
      );
    }
    if (!prompt) return null;

    const answered = ask === 'recalled' || ask === 'placed';
    const told = namesString(prompt.form);
    // An `echo` shows a position instead of a letter, so the position is drawn
    // from the first frame; every other form draws it when it is lit or answered.
    const showsPosition = answered || ask === 'showing' || prompt.form === 'echo';

    // This run's answers stay on the board, less whichever position is being
    // asked about right now: one position carries one mark, and the live one
    // wins.
    const marks: NeckMark[] = answers.filter(
      (a) => a.stringPosition !== prompt.stringPosition || a.fret !== prompt.fret,
    );
    // What arrived, drawn where it actually is, so the gap between it and the
    // answer is a distance on the board rather than a sentence about one.
    const missFret = miss?.fret ?? null;
    if (missFret !== null && missFret >= neck.from && missFret <= neck.to) {
      marks.push({ stringPosition: prompt.stringPosition, fret: missFret, kind: 'miss' });
    }
    if (showsPosition) {
      marks.push({
        stringPosition: prompt.stringPosition,
        fret: prompt.fret,
        kind: ask === 'recalled' ? 'found' : 'show',
        name: true,
      });
    }

    return (
      <div className="drill-stage nf-stage">
        <div className="drill-cue nf-cue">
          {/* The question in words, for anyone who cannot see the figure. It is
              the one place on this surface where the ask is said rather than
              drawn, and it is never painted. */}
          <p className="sr-only" aria-live="polite">
            {askedInWords(prompt, ask)}
          </p>

          {/* The letter is the question, except on an `echo`, where the letter
              is the answer and showing it would be the drill answering itself. */}
          {(prompt.form !== 'echo' || answered) && (
            <div className={clsx('nf-letter', `is-${ask}`)} aria-hidden="true">
              <span className="nf-letter-name">{sharpName(prompt.pc)}</span>
              {flatName(prompt.pc) && <span className="nf-letter-alt">{flatName(prompt.pc)}</span>}
            </div>
          )}

          {/* What arrived instead, as the note it was. Every note the room makes
              gets an answer on screen, which is how a player can tell a drill
              that disagrees with them from one that is not listening. */}
          {miss && !answered && (
            <motion.p
              className="nf-miss"
              key={miss.midi}
              initial={reduceMotion ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              aria-hidden="true"
            >
              {noteReading(miss.midi)}
            </motion.p>
          )}

          <div className="nf-neck">
            <NeckMap
              map={map}
              from={neck.from}
              to={neck.to}
              litStrings={told ? [prompt.stringPosition] : undefined}
              marks={marks}
            />
            {/* Real buttons over the drawing, the way the note circle and the
                headstock do it: a target has to be focusable, named and big
                enough for a thumb, and an SVG rect is none of those. They sit on
                the asked string's own row rather than spanning the board, so a
                tap says a position and not just a fret. Only the tapped channel
                puts them there; a played answer needs no target. */}
            {channel === 'tapped' && told && (
              <div
                className="nf-fret-hits"
                role="group"
                aria-label={`Frets on the ${stringLabel(prompt.stringPosition)} string`}
              >
                {neck.frets.map((fret) => (
                  <button
                    key={fret}
                    type="button"
                    className="nf-fret-hit"
                    style={positionBox(
                      neck,
                      layout,
                      fret,
                      STRING_STACK.indexOf(prompt.stringPosition),
                    )}
                    aria-label={`Fret ${fret}`}
                    onClick={() => onTapFret(fret)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="drill-read nf-read">
          {channel === 'tapped' ? (
            <UncountedNotice />
          ) : (
            <>
              <ProgressRing {...ringScale(finds, best)} phase="live" className="om-ring nf-ring">
                <div className="om-count">{finds}</div>
                <div className="om-caption">recalled</div>
              </ProgressRing>
              {placed > 0 && (
                <p className="nf-shown-count" aria-hidden="true">
                  <span className="nf-shown-value">{placed}</span> shown
                </p>
              )}
            </>
          )}
          <div className="om-timer">
            <HourglassIcon size={26} /> {timeLeft}
          </div>
        </div>
      </div>
    );
  }

  // --- Results -------------------------------------------------------------

  if (channel === 'tapped') {
    return (
      <TimerRunEnded
        autoAdvance={autoAdvance}
        advanceLeft={advanceLeft}
        nextLabel={nextLabel}
        onNext={onNext}
        onClose={onClose}
        onAgain={onAgain}
        onSkip={onSkip}
      />
    );
  }

  const run = result;
  const marks: NeckMark[] =
    run?.found.map((f) => ({
      stringPosition: f.stringPosition,
      fret: f.fret,
      kind: f.shown ? ('shown' as const) : ('found' as const),
      name: !f.shown,
    })) ?? [];

  return (
    <motion.div
      className="om-results nf-results"
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <ProgressRing {...ringScale(run?.finds ?? 0, best)} className="om-ring">
        <div className="om-ring-value">{run?.finds ?? 0}</div>
        <div className="om-caption">recalled</div>
      </ProgressRing>

      {run && run.shown > 0 && (
        <p className="nf-shown-count">
          <span className="nf-shown-value">{run.shown}</span> shown, not recalled
        </p>
      )}

      {/* Where they landed, on the neck they landed on. The wear underneath is
          every run before this one, so the card is the record growing rather
          than a score standing beside it. */}
      <NeckMap map={map} marks={marks} className="nf-results-map" />

      {run && run.finds === 0 && run.shown === 0 && <p className="om-context">Nothing played</p>}

      {/* The one sentence on this surface, and it is the drill's own honesty:
          what the microphone settled, and what no microphone ever can. */}
      <p className="nf-limit">
        The note came back, and inside these frets it has one home on the string
        named. Which string it actually came off is the one thing a microphone
        cannot tell.
      </p>

      {autoAdvance ? (
        <CoachAdvance
          nextLabel={nextLabel}
          advanceLeft={advanceLeft}
          onAgain={onAgain}
          onSkip={onSkip}
        />
      ) : (
        <div className="om-actions">
          <button className="practice-btn ghost" onClick={() => onClose?.()}>
            {onNext ? 'End session' : 'Done'}
          </button>
          <button
            className="practice-btn primary"
            onClick={onNext ?? (() => setView('setup'))}
            autoFocus
          >
            {onNext ? 'Next drill' : 'Again'} <ArrowRightIcon size={18} />
          </button>
        </div>
      )}
    </motion.div>
  );
}

/**
 * What arrived, as the note it was.
 *
 * The letter is the whole of the feedback. The same letter as the one asked for
 * means the hand is on the right note somewhere else; a different letter means
 * it is somewhere else entirely. Nothing has to say which of those it is,
 * because the two letters standing beside each other already do, and the octave
 * number is there for the one case where the letters match.
 */
function noteReading(midi: number): string {
  const { name, octave } = midiToName(midi);
  return `${name}${octave}`;
}

/** The question in the words a coach would use, for a screen reader only. */
function askedInWords(prompt: FinderPrompt, ask: Ask): string {
  const name = sharpName(prompt.pc);
  const where = namesString(prompt.form)
    ? `on the ${stringLabel(prompt.stringPosition)} string`
    : 'anywhere on the neck';
  if (ask === 'recalled') return `${name}, found at fret ${prompt.fret} ${where}.`;
  if (ask === 'placed') return `${name}, played at fret ${prompt.fret} ${where}.`;
  if (ask === 'showing') return `${name} is at fret ${prompt.fret} ${where}. Play it.`;
  if (prompt.form === 'echo') {
    return `Fret ${prompt.fret} ${where}. Play that same note somewhere else.`;
  }
  return `Find ${name} ${where}.`;
}

/**
 * The ladder, drawn as a ladder.
 *
 * Rails and rungs, because eight stacked strokes on their own read as a
 * paragraph of lines and the one thing this has to say at a glance is that it is
 * climbed. Cleared rungs are solid, the one being run is lit and reaches past
 * both rails, the ones above are still dark. Which says three things without a
 * sentence: where the player is, that there is a great deal above them, and that
 * a rung can go dark again — the whole of what makes a standing a standing
 * rather than a score. Three clean runs clear a rung; one poor run takes it back.
 */
const LADDER_W = 74;
const LADDER_RAIL = 15;
const LADDER_STEP = 13;
const LADDER_TOP = 7;

function RungLadder({
  history,
  current,
}: {
  history: Readonly<Record<string, readonly FinderRunRecord[]>>;
  current: FinderRung;
}) {
  const rows = RUNGS.map((rung) => ({
    rung,
    standing: rungStanding(history[rung.id] ?? [], rung),
  }));
  const at = rungNumber(current.id);
  const height = LADDER_TOP * 2 + (RUNGS.length - 1) * LADDER_STEP;

  return (
    <div className="nf-ladder">
      <p className="sr-only">{`Rung ${at} of ${RUNGS.length}: ${current.label}.`}</p>
      <svg
        className="nf-rungs"
        viewBox={`0 0 ${LADDER_W} ${height}`}
        width={LADDER_W}
        height={height}
        aria-hidden="true"
        focusable="false"
      >
        <line className="nf-rail" x1={LADDER_RAIL} y1={2} x2={LADDER_RAIL} y2={height - 2} />
        <line
          className="nf-rail"
          x1={LADDER_W - LADDER_RAIL}
          y1={2}
          x2={LADDER_W - LADDER_RAIL}
          y2={height - 2}
        />
        {/* Drawn top down and read bottom up: the first rung of the ladder is
            the lowest one on it. */}
        {[...rows].reverse().map(({ rung, standing }, i) => {
          const here = rung.id === current.id;
          const y = LADDER_TOP + i * LADDER_STEP;
          const inset = here ? LADDER_RAIL - 7 : LADDER_RAIL;
          return (
            <line
              key={rung.id}
              className={clsx('nf-rung', `is-${standing}`, here && 'is-here')}
              x1={inset}
              y1={y}
              x2={LADDER_W - inset}
              y2={y}
            />
          );
        })}
      </svg>
      <span className="nf-rung-name" aria-hidden="true">{current.label}</span>
    </div>
  );
}
