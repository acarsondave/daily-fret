// Finding a named note on the neck, measured by hearing it.
//
// THE ARGUMENT. src/data/skills.ts used to file note names as knowledge on the
// grounds that "a naming quiz would work; listening would not". Reciting the
// names is not the skill. Putting a finger on a named note quickly is, and from
// Grade 1 chord roots through barre shapes, CAGED, scales and keys it is the one
// piece of theory a hand actually has to do at speed. It is a playing action,
// and a playing action has a pitch on the end of it, so the app can hear it.
//
// THE FIGURE. One neck, one letter. The letter is the question and the neck is
// where the answer lives, and the whole drill is the letter arriving at its
// fret: found, and it lands in the accent; not found in time, and it is shown
// there instead, in a quieter hand, which is the difference between an answer
// and a hint. Nothing is written down. The only sentence on the surface is the
// one about what the microphone did and did not settle, and it earns its place
// because it is the drill's own honesty.
//
// WHAT IS BEING CLAIMED. Exactly this: the prompt named a position, and the
// pitch that position makes came back. Not "you played it there" — a frequency
// does not carry the string it came off, and C at the third fret of the A string
// and C at the eighth fret of the low E are the same 130.81 Hz forever. See
// src/lib/noteFinder.ts, which holds the whole argument and the two prompt forms
// that deliberately record nothing because the app was never told where to look.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import clsx from 'clsx';
import { ArrowRightIcon, HourglassIcon, MicIcon, PlayIcon, TapFretIcon } from '../icons';
import { MicGate, TimerRunEnded, UncountedNotice } from './MicGate';
import { usePitchDetector } from '../../hooks/usePitchDetector';
import { midiToName, readPitch } from '../../audio/tuning';
import { ProgressRing } from './ProgressRing';
import { ringScale } from '../../lib/ringScale';
import { NeckMap, type NeckMark } from './NeckMap';
import { fretColumn } from './neckGeometry';
import { CoachAdvance } from './CoachAdvance';
import { sfx } from '../../audio/sfx';
import { diag } from '../../audio/diagnostics';
import { flatName, sharpName } from '../../lib/noteCircle';
import {
  RUNGS,
  currentRung,
  getRung,
  judge,
  medianFindMs,
  midiAt,
  namesString,
  nextPrompt,
  rungNumber,
  rungStanding,
  TOP_FRET,
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
/** How long the answer stays lit on the neck before the next question. */
const CONFIRM_MS = 900;
/** A reveal is a teaching moment, so it holds longer than a find does. */
const REVEAL_MS = 1800;
/**
 * How far past the rung's own budget a question waits before it gives the answer.
 *
 * Twice, because the budget is the pace the rung is asking for and not a
 * deadline: a player who takes eleven seconds over an eight-second budget has
 * found it, slowly, which is a true and useful thing to record. Past twice it,
 * they are not going to, and a question with no way out of it is the drill
 * spending a minute of practice on one fret.
 */
const REVEAL_AT = 2;

type View = 'setup' | 'playing' | 'results';
/** Where a single question has got to. */
type Ask = 'asking' | 'confirmed' | 'revealed';
/** How a question is being answered: by playing it, or by pointing at it. */
type Channel = 'heard' | 'tapped';

export interface NoteFinderResult {
  rungId: string;
  /** Correct finds, not counting the ones the app had to show. */
  finds: number;
  /** Median milliseconds a find took, or null when nothing was found. */
  findMs: number | null;
  /** Every correct find at a prompt that named a string, for the neck map. */
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
  const [timeLeft, setTimeLeft] = useState(duration);
  /**
   * What arrived that was not the answer, so the screen can say which kind of
   * wrong it was. Cleared by the next question and by a correct answer.
   */
  const [miss, setMiss] = useState<{ midi: number; kind: 'octave' | 'same' | 'other' } | null>(null);
  const [result, setResult] = useState<NoteFinderResult | null>(null);
  const [advanceLeft, setAdvanceLeft] = useState(AUTO_ADVANCE_SECONDS);

  // Everything the run accumulates lives in refs: the timers and the pitch
  // handler run outside React's render and would otherwise close over whatever
  // the state was when they were created.
  const promptRef = useRef<FinderPrompt | null>(null);
  const askedAtRef = useRef(0);
  const askRef = useRef<Ask>('asking');
  const judgedRef = useRef<number | null>(null);
  const timesRef = useRef<number[]>([]);
  const foundRef = useRef<NoteFindReport[]>([]);
  const findsRef = useRef(0);
  const channelRef = useRef<Channel>('heard');
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishedRef = useRef(false);
  const startedAtRef = useRef(0);

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
    askRef.current = 'asking';
    judgedRef.current = null;
    setPrompt(next);
    setAsk('asking');
    setMiss(null);
  }, [rung, map]);

  /** Give the answer away. Nothing is counted for it; it is a lesson, not a find. */
  const reveal = useCallback(() => {
    if (askRef.current !== 'asking') return;
    askRef.current = 'revealed';
    setAsk('revealed');
    setMiss(null);
    clearStep();
    stepRef.current = setTimeout(askNext, REVEAL_MS);
  }, [askNext]);

  /** The right note arrived, or the right fret was pointed at. */
  const land = useCallback(
    () => {
      const asked = promptRef.current;
      if (!asked) return;
      const ms = Date.now() - askedAtRef.current;
      askRef.current = 'confirmed';
      setAsk('confirmed');
      setMiss(null);
      if (channelRef.current === 'heard') {
        findsRef.current += 1;
        setFinds(findsRef.current);
        timesRef.current.push(ms);
        // Only a prompt that named a string can be filed against a position.
        // The other two forms never told the app where to look, so it has
        // nothing true to write about a fret.
        if (namesString(asked.form)) {
          foundRef.current.push({ stringPosition: asked.stringPosition, fret: asked.fret, ms });
        }
        sfx.tick();
      }
      clearStep();
      stepRef.current = setTimeout(askNext, CONFIRM_MS);
    },
    [askNext],
  );

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
      findMs: medianFindMs(timesRef.current),
      found: foundRef.current,
    };
    diag.mark(`note finder ${rung.id}: found ${run.finds}, median ${run.findMs ?? 'none'}ms`);
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
      timesRef.current = [];
      foundRef.current = [];
      promptRef.current = null;
      setFinds(0);
      setTimeLeft(duration);
      setView('playing');
      onSessionStart?.();

      if (!tapped) {
        const live = await start();
        if (!live) return; // the gate takes over
        diag.mark(`note finder start ${rung.id} (${duration}s)`);
      }

      startedAtRef.current = Date.now();
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
    const asked = promptRef.current;
    if (!asked || askRef.current !== 'asking') return;
    if (!pitch || pitch.provisional || pitch.fading) return;
    // Two strings ringing together is one periodic signal whose period belongs
    // to neither of them. The tuner learned this the hard way; nothing may be
    // judged on a reading that is the interval rather than a note.
    if (pitch.secondNoteAt !== null) return;

    const midi = readPitch(pitch.hz).midi;
    if (judgedRef.current === midi) return;
    judgedRef.current = midi;

    const outcome = judge(asked, midi);
    if (outcome.kind === 'right') {
      land();
      return;
    }
    setMiss({ midi, kind: outcome.kind });
  }, [pitch, view, channel, land]);

  // The clock on one question, which is a different clock from the run's.
  useEffect(() => {
    if (view !== 'playing' || ask !== 'asking' || !prompt) return;
    const id = setTimeout(reveal, rung.budgetMs * REVEAL_AT);
    return () => clearTimeout(id);
  }, [view, ask, prompt, reveal, rung.budgetMs]);

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

  const onTapFret = (fret: number) => {
    const asked = promptRef.current;
    if (!asked || askRef.current !== 'asking') return;
    if (fret === asked.fret) {
      land();
      return;
    }
    const midi = midiAt(asked.stringPosition, fret);
    setMiss({ midi, kind: judge(asked, midi).kind === 'octave' ? 'octave' : 'other' });
  };

  // --- The ladder ----------------------------------------------------------

  if (view === 'setup') {
    return (
      <div className="om-setup nf-setup">
        <RungLadder history={history} current={rung} />
        {/* The record, and the reason to come back: on the first run it is a
            plain neck, which is what a plain neck honestly is. */}
        <NeckMap map={map} className="nf-setup-map" />
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

    const answered = ask !== 'asking';
    const told = namesString(prompt.form);
    // An `echo` shows a position instead of a letter, so the position is drawn
    // from the first frame; every other form only ever shows it as the answer.
    const showsPosition = answered || prompt.form === 'echo';
    // One string when the prompt named one, the whole instrument otherwise: a
    // question with no string in it cannot be drawn on a single string without
    // answering half of itself.
    const strings = told ? [prompt.stringPosition] : undefined;
    const marks: NeckMark[] = showsPosition
      ? [{ stringPosition: prompt.stringPosition, fret: prompt.fret }]
      : [];

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

          {/* What arrived instead, as the note it was. The same letter means the
              right note in the wrong octave and a different letter means
              somewhere else entirely, so the letter itself carries which kind of
              wrong this is and nothing has to say it. */}
          {miss && !answered && (
            <motion.p
              className={clsx('nf-miss', miss.kind === 'other' ? 'is-other' : 'is-near')}
              key={`${miss.midi}-${miss.kind}`}
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
              strings={strings}
              litString={told ? prompt.stringPosition : null}
              marks={marks}
              nameMarks={answered}
            />
            {/* Real buttons over the drawing, the way the note circle and the
                headstock do it: a target has to be focusable, named and big
                enough for a thumb, and an SVG rect is none of those. Only the
                tapped channel puts them there; a played answer needs no target. */}
            {channel === 'tapped' && told && (
              <div className="nf-fret-hits" role="group" aria-label="Frets">
                {Array.from({ length: TOP_FRET + 1 }, (_, fret) => (
                  <button
                    key={fret}
                    type="button"
                    className="nf-fret-hit"
                    style={fretColumn(fret)}
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
            <ProgressRing {...ringScale(finds, best)} phase="live" className="om-ring om-ring-live">
              <div className="om-count">{finds}</div>
              <div className="om-caption">found</div>
            </ProgressRing>
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
    run?.found.map((f) => ({ stringPosition: f.stringPosition, fret: f.fret })) ?? [];

  return (
    <motion.div
      className="om-results nf-results"
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <ProgressRing {...ringScale(run?.finds ?? 0, best)} className="om-ring">
        <div className="om-ring-value">{run?.finds ?? 0}</div>
        <div className="om-caption">found</div>
      </ProgressRing>

      {/* Where they landed, on the neck they landed on. The wear underneath is
          every run before this one, so the card is the record growing rather
          than a score standing beside it. */}
      <NeckMap map={map} marks={marks} nameMarks className="nf-results-map" />

      {run && run.finds === 0 && <p className="om-context">Nothing found</p>}

      {/* The one sentence on this surface, and it is the drill's own honesty:
          what the microphone settled, and what no microphone ever can. */}
      <p className="nf-limit">
        The pitch is confirmed, note and octave. Which string it came off is the
        one thing a microphone cannot tell.
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
 * means the hand is on the right note in the wrong octave; a different letter
 * means it is somewhere else entirely. Nothing has to say which of those it is,
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
    ? `on string ${prompt.stringPosition}`
    : 'anywhere on the neck';
  if (ask === 'confirmed') return `${name}, found at fret ${prompt.fret} on string ${prompt.stringPosition}.`;
  if (ask === 'revealed') return `${name} is at fret ${prompt.fret} on string ${prompt.stringPosition}.`;
  if (prompt.form === 'echo') {
    return `Fret ${prompt.fret} on string ${prompt.stringPosition}. Play that same note somewhere else.`;
  }
  return `Find ${name} ${where}.`;
}

/**
 * The ladder, drawn as rungs.
 *
 * Eight strokes stacked, the cleared ones filled, the one being run lit, the
 * ones above still dark. It says three things without a sentence: where the
 * player is, that there is a great deal above them, and that a rung can go dark
 * again — which is the whole of what makes a standing a standing rather than a
 * score. Three clean runs clear a rung and one poor run takes it back.
 */
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

  return (
    <div className="nf-ladder">
      <p className="sr-only">
        {`Rung ${at} of ${RUNGS.length}: ${current.label}.`}
      </p>
      <span className="nf-rungs" aria-hidden="true">
        {[...rows].reverse().map(({ rung, standing }) => (
          <span
            key={rung.id}
            className={clsx('nf-rung', `is-${standing}`, rung.id === current.id && 'is-here')}
          />
        ))}
      </span>
      <span className="nf-rung-name" aria-hidden="true">{current.label}</span>
    </div>
  );
}

