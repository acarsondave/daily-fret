import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { NoteScreen } from './onboarding/NoteScreen';
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
 *
 * This file is the shell: the panel, the focus trap, the resume, and the handoff
 * into the coached session. Each screen owns its own file and its own cost.
 */

const SAVE_KEY = 'daily-fret-onboarding';

// Screen two owns the chord detector and the whole curriculum; screen three owns
// the chord engraver. Both are split out so the first screen costs a microphone
// and a drawing, and nothing else.
const ChordsScreen = lazy(() =>
  import('./onboarding/ChordsScreen').then((m) => ({ default: m.ChordsScreen })),
);
const ReadyScreen = lazy(() =>
  import('./onboarding/ReadyScreen').then((m) => ({ default: m.ReadyScreen })),
);

const prefetchChords = () => {
  void import('./onboarding/ChordsScreen');
};
const prefetchReady = () => {
  void import('./onboarding/ReadyScreen');
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
                onReady={prefetchReady}
                onNext={(next) => {
                  setPlan(next);
                  setScreen('ready');
                }}
              />
            </Suspense>
          )}

          {screen === 'ready' && plan && (
            <Suspense fallback={<p className="onboarding-waiting">Building the session</p>}>
              <ReadyScreen headingRef={headingRef} plan={plan} micLive={micLive} onStart={finish} />
            </Suspense>
          )}
        </motion.section>
      </div>
    </motion.div>,
    document.body,
  );
}
