import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import clsx from 'clsx';
import { ArrowRightIcon, HourglassIcon, MicIcon, TallyIcon } from './icons';
import { Headstock } from './practice/Headstock';
import { usePitchDetector } from '../hooks/usePitchDetector';
import { DEFAULT_TUNING_ID, getTuning, nearestString, readPitch } from '../audio/tuning';
import { useStore } from '../store';
import type { FirstRunPlan } from './onboarding/plan';
import './Onboarding.css';

/**
 * First run.
 *
 * This was a seven-screen wizard: an intro, a course picker, a module picker, a
 * self-report chord grid, a microphone ask, a camera ask and a summary. Four
 * questions, five hundred words and nine taps before a single note was counted,
 * and the proof that the app could hear the guitar at all arrived on screen five
 * as a line of text reading "Heard G. That is the microphone working."
 *
 * Three things were wrong with it, and none of them were the words.
 *
 * 1. It asked for what it could derive. The module question existed only to seed
 *    chord ticks and set the current lesson, and both of those are a lookup from
 *    the chords themselves (see moduleForChords). The app asked a question to
 *    produce a guess it then asked the player to confirm.
 * 2. It described the mechanism instead of running it. The one thing this
 *    product does that a checklist cannot is hear the instrument, and the flow
 *    spent five screens talking about that before doing it once.
 * 3. It bought the curriculum before it had earned the attention: choosing a
 *    grade pulled 68.5 kB gzipped of course data to render eight module titles,
 *    sitting directly in front of the first note.
 *
 * So: three screens, no questions. Play a string and watch the headstock answer.
 * Play the chords you have and watch them light. Then the session that was built
 * out of what the app just heard. The course data is not fetched until the
 * second screen, which is after the moment that makes it worth fetching.
 */

const SAVE_KEY = 'daily-fret-onboarding';

// Screen two owns the chord detector and the whole curriculum. Split out so the
// first screen costs a microphone and a drawing, and nothing else.
const ChordsScreen = lazy(() =>
  import('./onboarding/ChordsScreen').then((m) => ({ default: m.ChordsScreen })),
);

const prefetchChords = () => {
  void import('./onboarding/ChordsScreen');
};

type Screen = 'note' | 'chords' | 'ready';

interface Saved {
  screen: Screen;
  known: string[];
}

/**
 * First run survives a reload.
 *
 * A first session is exactly the kind that gets interrupted, and restarting a
 * stranger at the beginning because their phone locked is the cheapest possible
 * way to lose them. The built routine is deliberately not saved: it is derived
 * from the chords in a few milliseconds, and a stale one restored against a
 * rebuilt curriculum would be worse than rebuilding it.
 */
function readSaved(): Saved | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const value = parsed as Record<string, unknown>;
    const known = Array.isArray(value.known)
      ? value.known.filter((c): c is string => typeof c === 'string')
      : [];
    // Only the chord screen is worth resuming onto. The note screen is eight
    // seconds and the summary is built from a routine this never stored.
    return { screen: known.length || value.screen === 'chords' ? 'chords' : 'note', known };
  } catch {
    return null;
  }
}

function writeSaved(saved: Saved | null): void {
  try {
    if (saved) localStorage.setItem(SAVE_KEY, JSON.stringify(saved));
    else localStorage.removeItem(SAVE_KEY);
  } catch {
    /* storage disabled; the flow still works, it just will not resume */
  }
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  onDone: (options?: { startCoached?: boolean }) => void;
}

export function Onboarding({ onDone }: Props) {
  const addRoutine = useStore((s) => s.addRoutine);
  const setActiveRoutine = useStore((s) => s.setActiveRoutine);
  const setCurrentLesson = useStore((s) => s.setCurrentLesson);
  const setSkillClaimed = useStore((s) => s.setSkillClaimed);

  const [restored] = useState<Saved | null>(readSaved);
  const [screen, setScreen] = useState<Screen>(restored?.screen ?? 'note');
  const [known, setKnown] = useState<string[]>(restored?.known ?? []);
  const [plan, setPlan] = useState<FirstRunPlan | null>(null);
  const [micLive, setMicLive] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    writeSaved({ screen, known });
  }, [screen, known]);

  // Focus moves to each new screen, so a screen reader and a keyboard both land
  // where the eye does. Tab stays inside the panel: the app header sits behind
  // this and a keyboard would otherwise reach controls it cannot see.
  useEffect(() => {
    const timer = setTimeout(() => headingRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [screen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const finish = useCallback(() => {
    if (!plan) return;
    addRoutine(plan.routine);
    setActiveRoutine(plan.routine.id);
    // Which part of the course this person is standing in, derived from the
    // shapes they played rather than asked for.
    if (plan.lessonCode) setCurrentLesson(plan.lessonCode);
    // A chord the app heard is evidence; a chord they tapped is a claim. Both
    // are recorded as claims here, and either is overridden the moment a drill
    // produces a real number.
    for (const chord of plan.routine.chords ?? []) setSkillClaimed(`chord.${chord}`, true);
    writeSaved(null);
    onDone({ startCoached: true });
  }, [addRoutine, onDone, plan, setActiveRoutine, setCurrentLesson, setSkillClaimed]);

  const stepIndex = screen === 'note' ? 0 : screen === 'chords' ? 1 : 2;

  return createPortal(
    <motion.div
      className="onboarding"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div
        className="onboarding-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Set up your practice"
      >
        <div className="onboarding-top">
          <p className="onboarding-brand">
            Daily<span>Fret</span>
          </p>
          <p className="sr-only">Step {stepIndex + 1} of 3</p>
        </div>

        <motion.section
          key={screen}
          className="onboarding-body"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
        >
          {screen === 'note' && (
            <NoteScreen
              headingRef={headingRef}
              onReady={prefetchChords}
              onNext={(heard) => {
                setMicLive(heard);
                setScreen('chords');
              }}
            />
          )}

          {screen === 'chords' && (
            <Suspense fallback={<p className="onboarding-waiting">Reading the course</p>}>
              <ChordsScreen
                headingRef={headingRef}
                micLive={micLive}
                known={known}
                onKnownChange={setKnown}
                onNext={(next) => {
                  setPlan(next);
                  setScreen('ready');
                }}
              />
            </Suspense>
          )}

          {screen === 'ready' && plan && (
            <ReadyScreen headingRef={headingRef} plan={plan} micLive={micLive} onStart={finish} />
          )}
        </motion.section>
      </div>
    </motion.div>,
    document.body,
  );
}

/* --- One. The note -------------------------------------------------------- */

/** Marks that unlock the way on. Three is two more than a coincidence. */
const MARKS_NEEDED = 3;
/** How long a live microphone waits before offering a way past it. */
const PATIENCE_MS = 12000;

function NoteScreen({
  headingRef,
  onNext,
  onReady,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onNext: (heard: boolean) => void;
  onReady: () => void;
}) {
  const { status, error, pitch, levelRef, start, stop, wake } = usePitchDetector();
  const reducedMotion = useReducedMotion();
  const tuning = getTuning(DEFAULT_TUNING_ID);

  const [marks, setMarks] = useState<string[]>([]);
  // Whether the note on screen has already left its mark. Cleared when the
  // string dies, so playing the same string twice counts twice.
  const [ringing, setRinging] = useState(false);
  const [impatient, setImpatient] = useState(false);

  const live = status === 'listening';
  const blocked = status === 'error';
  const dozing = status === 'asleep' || status === 'muted';
  const done = marks.length >= MARKS_NEEDED;

  // Reading during render rather than in an effect: this is derived from the
  // detector's own state, and an effect would put the mark a frame behind the
  // note that earned it.
  const showing = pitch ? readPitch(pitch.hz) : null;
  const settled = pitch && !pitch.provisional && !pitch.fading ? readPitch(pitch.hz) : null;
  const onString = pitch ? nearestString(pitch.hz, tuning) : null;

  if (settled && !ringing) {
    setRinging(true);
    setMarks((prev) => (prev.length < MARKS_NEEDED ? [...prev, settled.name] : prev));
  } else if (ringing && (pitch === null || pitch.fading)) {
    setRinging(false);
  }

  // The way past a microphone that is on and hearing nothing. It does not exist
  // until it is needed: someone with a guitar in their hands never sees it, and
  // someone without one is not stuck behind a screen asking them to play.
  useEffect(() => {
    if (!live || done) return;
    const timer = setTimeout(() => setImpatient(true), PATIENCE_MS);
    return () => clearTimeout(timer);
  }, [live, done]);

  useEffect(() => {
    if (done) onReady();
  }, [done, onReady]);

  const listen = async () => {
    await start();
  };

  const goOn = async (heard: boolean) => {
    await stop();
    onNext(heard);
  };

  return (
    <>
      <h1 className="onboarding-title" ref={headingRef} tabIndex={-1}>
        Play a string.
      </h1>

      <div className={clsx('onboarding-stage', live && 'is-live')}>
        <Headstock
          strings={tuning.strings}
          activePosition={onString?.string.position ?? null}
          targetPosition={null}
          pinnedPosition={null}
          settled={[]}
          deaf={!live}
          allSettled={false}
          levelRef={levelRef}
          reducedMotion={Boolean(reducedMotion)}
          interactive={false}
          onSelect={() => {}}
        />

        {/* What the app just heard, at the size of the only thing on screen.
            This is the proof, and it is a note rather than a sentence about a
            note. */}
        <div className="onboarding-heard" aria-live="polite">
          <span className={clsx('onboarding-note', showing && 'is-on')} aria-hidden="true">
            {showing ? showing.name : ''}
          </span>
          {/* The letter is drawn; this is the same fact in words, and it names
              the string as well, which is what a player who cannot see the
              headstock light up actually needs. */}
          <span className="sr-only">
            {showing
              ? `Heard ${showing.name}${onString ? `, your ${onString.string.label} string` : ''}`
              : ''}
          </span>
          <span className="onboarding-marks" aria-hidden="true">
            {marks.map((name, i) => (
              <span key={`${name}-${i}`} className="onboarding-mark" />
            ))}
          </span>
        </div>
      </div>

      {!live && !blocked && !dozing && (
        <div className="onboarding-actions is-start">
          <button
            type="button"
            className="onboarding-next is-primary"
            onClick={() => void listen()}
            disabled={status === 'requesting'}
          >
            <MicIcon size={18} />
            {status === 'requesting' ? 'Waiting for the browser' : 'Listen'}
          </button>
          <p className="onboarding-footnote">Your browser asks first.</p>
        </div>
      )}

      {dozing && (
        <div className="onboarding-actions is-start">
          <button type="button" className="onboarding-next is-primary" onClick={wake}>
            <MicIcon size={18} /> Wake the microphone
          </button>
        </div>
      )}

      {blocked && (
        <div className="onboarding-blocked">
          {/* The browser's own reason on its own line. Some of them are two
              words with no full stop, and running one into the recovery
              sentence produced "Not supported Allow the microphone". */}
          <p className="onboarding-reason" role="status">
            {error ?? 'The microphone did not open.'}
          </p>
          <p className="onboarding-footnote">
            Allow it for this site and try again, or carry on: the drills will run on a timer and
            nothing will be counted.
          </p>
          <div className="onboarding-actions">
            <button type="button" className="onboarding-next" onClick={() => void listen()}>
              <MicIcon size={18} /> Try again
            </button>
            <button type="button" className="onboarding-next is-primary" onClick={() => void goOn(false)}>
              Carry on <ArrowRightIcon size={16} />
            </button>
          </div>
        </div>
      )}

      {live && (done || impatient) && (
        <div className="onboarding-actions is-end">
          {done && (
            <p className="onboarding-lead is-quiet">Everything counted here comes from that.</p>
          )}
          <button
            type="button"
            className="onboarding-next is-primary"
            onClick={() => void goOn(true)}
            autoFocus
          >
            {done ? 'Next' : 'Carry on'} <ArrowRightIcon size={16} />
          </button>
        </div>
      )}
    </>
  );
}

/* --- Three. Tomorrow ------------------------------------------------------ */

function ReadyScreen({
  headingRef,
  plan,
  micLive,
  onStart,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  plan: FirstRunPlan;
  micLive: boolean;
  onStart: () => void;
}) {
  const { routine, minutes, measured } = plan;

  return (
    <>
      <h1 className="onboarding-title" ref={headingRef} tabIndex={-1}>
        Your first session.
      </h1>
      <p className="onboarding-lead">
        About {minutes} minutes.{' '}
        {measured > 0
          ? micLive
            ? `${measured} of these ${routine.tasks.length} are counted through the microphone.`
            : `${measured} of these ${routine.tasks.length} would be counted, once the microphone is on.`
          : 'Nothing here is counted yet.'}
      </p>
      {/* The routine says what it was built from, in its own words. For most of
          Grade 2 and all of Grade 3 the app has no drills mapped to the module,
          and pretending otherwise is the discrepancy this whole flow exists to
          stop repeating. */}
      <p className="onboarding-basis">{routine.description}</p>

      <ol className="onboarding-preview">
        {routine.tasks.map((t, i) => (
          <motion.li
            key={t.id}
            className={clsx('onboarding-preview-item', t.drill && 'is-counted')}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="onboarding-preview-mark" aria-hidden="true">
              {t.drill ? <TallyIcon size={16} /> : <HourglassIcon size={16} />}
            </span>
            <span className="onboarding-preview-text">
              <span className="onboarding-preview-name">
                {t.title}
                <span className="onboarding-preview-kind">
                  {t.drill ? 'counted' : `${t.duration} min`}
                </span>
              </span>
              <span className="onboarding-preview-note">{t.description}</span>
            </span>
          </motion.li>
        ))}
      </ol>

      <div className="onboarding-actions is-end">
        <button type="button" className="onboarding-next is-primary" onClick={onStart} autoFocus>
          Start the session <ArrowRightIcon size={16} />
        </button>
      </div>
    </>
  );
}
