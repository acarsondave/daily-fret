import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CameraIcon,
  CheckIcon,
  HourglassIcon,
  MicIcon,
  TallyIcon,
} from './icons';
import { openCameraPreview } from '../media/cameraDevice';
import { RecordingError, recoveryFor } from '../media/failure';
import { presetFor } from '../media/quality';
import { useRecordingStore } from '../media/recordingStore';
import { ChordDiagram } from './practice/ChordDiagram';
import { SignalMeter } from './practice/SignalMeter';
import { useSignalMeter } from './practice/signalQuality';
import { useChordDetector } from '../hooks/useChordDetector';
import { NO_CHORD } from '../audio/detector';
import { useStore, useUserData } from '../store';
import { BEGINNER_GRADES, beginnerGrade } from '../lib/beginnerCourse';
import {
  HEARABLE_CHORDS,
  buildRoutine,
  chordsInModule,
  chordsTaughtBy,
  measuredTaskCount,
  routineMinutes,
} from '../lib/routineBuilder';
import './Onboarding.css';

/**
 * First run.
 *
 * The app used to open on an empty list and one button reading "start your first
 * routine", which asks a beginner to design their own practice before they have
 * played anything. This asks the questions it can act on and builds the routine
 * itself.
 *
 * Three things this screen is answerable for, in order of how much they cost to
 * get wrong:
 *
 * 1. Saying what the app is before showing anyone else's course. The first
 *    screen used to be a picker of three JustinGuitar grades, unattributed, so a
 *    stranger's first impression was a catalogue they had not asked for from a
 *    site this app does not own.
 * 2. The microphone. Every measured drill depends on it, and it was previously
 *    requested mid-drill with a countdown already running. It is asked for here,
 *    with a live meter, because a permission granted while nothing is at stake
 *    is the difference between a measured product and a checklist.
 * 3. Not claiming coverage the data does not have. The routine's own description
 *    says what it was built from, and this screen repeats it rather than
 *    promising a fit with a module the app has no drills for.
 *
 * Nothing here is required. The exit is on every step and lands on the same
 * empty list as before.
 */

type Step = 'intro' | 'course' | 'module' | 'chords' | 'mic' | 'camera' | 'ready';

const ALL_STEPS: readonly Step[] = ['intro', 'course', 'module', 'chords', 'mic', 'camera', 'ready'];

const SAVE_KEY = 'daily-fret-onboarding';

interface Saved {
  step: Step;
  track: string | null;
  module: number | null;
  known: string[];
}

const isStep = (value: unknown): value is Step =>
  typeof value === 'string' && (ALL_STEPS as readonly string[]).includes(value);

/**
 * Onboarding survives a reload.
 *
 * A first session is exactly the kind that gets interrupted, and restarting a
 * stranger at "what is this app" because their phone locked is the cheapest
 * possible way to lose them. Storage can be unavailable (private mode), in which
 * case there is nothing to restore and nothing to report: the flow simply starts
 * at the beginning.
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
    if (!isStep(value.step)) return null;
    const known = Array.isArray(value.known)
      ? value.known.filter((c): c is string => typeof c === 'string')
      : [];
    return {
      step: value.step,
      track: typeof value.track === 'string' ? value.track : null,
      module: typeof value.module === 'number' ? value.module : null,
      known,
    };
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

export function Onboarding({ onDone }: { onDone: () => void }) {
  const addRoutine = useStore((s) => s.addRoutine);
  const setActiveRoutine = useStore((s) => s.setActiveRoutine);
  const setCurrentLesson = useStore((s) => s.setCurrentLesson);
  const setSkillClaimed = useStore((s) => s.setSkillClaimed);
  const userData = useUserData();

  // Someone with practice logs and no routine is not a new player: they deleted
  // their last routine. Telling them what the app is would be the wrong screen.
  const logs = userData?.dailyLogs;
  const returning = logs ? Object.keys(logs).length > 0 : false;

  // A saved answer is only as good as the curriculum it was saved against. A
  // rebuild can retire a track, and a restored step that points at one would
  // render a question with no answers, so the resume drops back to the last
  // step that still means something.
  const [restored] = useState<Saved | null>(() => {
    const saved = readSaved();
    if (!saved) return null;
    const validTrack = saved.track !== null && beginnerGrade(saved.track) ? saved.track : null;
    const step = saved.step === 'module' && validTrack === null ? 'course' : saved.step;
    return { ...saved, track: validTrack, step };
  });
  const [step, setStep] = useState<Step>(restored?.step ?? 'intro');
  const [track, setTrack] = useState<string | null>(restored?.track ?? null);
  const [module, setModule] = useState<number | null>(restored?.module ?? null);
  const [known, setKnown] = useState<string[]>(restored?.known ?? []);

  const detector = useChordDetector();
  const { quality: signal, push: pushSignal, reset: resetSignal } = useSignalMeter();
  const [heard, setHeard] = useState<string | null>(null);
  const [micGranted, setMicGranted] = useState(false);

  // The camera opt-in. Held here rather than in the media layer's own store
  // until the player says yes, so nothing about this screen turns recording on
  // as a side effect of being looked at.
  const setRecordingEnabled = useRecordingStore((s) => s.setEnabled);
  const recordingOn = useRecordingStore((s) => s.settings.enabled);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraOpening, setCameraOpening] = useState(false);
  const [cameraError, setCameraError] = useState<RecordingError | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const grade = track === null ? null : beginnerGrade(track);
  const modules = grade?.modules ?? [];

  // The path the dots describe. Someone who follows no course we hold never sees
  // a module picker, so counting it against them would overstate what is left.
  // The rail holds its full length until they actually opt out, because a
  // progress indicator that grows by one the moment you answer a question reads
  // as the flow getting longer.
  const path = useMemo(
    () =>
      track === null && step !== 'intro' && step !== 'course'
        ? ALL_STEPS.filter((s) => s !== 'module')
        : ALL_STEPS,
    [track, step],
  );
  const stepIndex = Math.max(0, path.indexOf(step));

  const newChords = useMemo(
    () => (track === null || module === null ? [] : chordsInModule(track, module)),
    [track, module],
  );
  const routine = useMemo(
    () => buildRoutine({ track, module, knownChords: known }),
    [track, module, known],
  );
  const measured = measuredTaskCount(routine);

  useEffect(() => {
    writeSaved({ step, track, module, known });
  }, [step, track, module, known]);

  // Focus moves to the new question, so a screen reader and a keyboard both
  // land where the eye does. Tab stays inside the panel: the app header sits
  // behind this and a keyboard would otherwise reach controls it cannot see.
  //
  // Escape deliberately does nothing. The exit is a visible control on every
  // step, and a stray keypress that drops a first-time player onto an empty
  // list is not user control, it is a trapdoor.
  useEffect(() => {
    const timer = setTimeout(() => headingRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [step]);

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

  const stopListening = useCallback(() => {
    void detector.stop();
    resetSignal();
  }, [detector, resetSignal]);

  const askForMicrophone = useCallback(async () => {
    setHeard(null);
    resetSignal();
    // Open mode rather than restricted to the ticked chords: the point of this
    // moment is that the app names what it hears, and a restricted matcher can
    // only ever agree with a list the player just typed.
    const live = await detector.start({
      onLevel: (ev) => pushSignal(ev),
      onChord: (ev) => {
        if (ev.chord !== NO_CHORD) setHeard(ev.chord);
      },
    });
    if (live) setMicGranted(true);
  }, [detector, pushSignal, resetSignal]);

  // Giving the camera back is unconditional and happens on every route out of
  // this screen. A first-run flow that leaves a webcam light on behind it has
  // said one thing and done another on the first day.
  const closeCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    setCameraStream(null);
  }, []);

  useEffect(() => closeCamera, [closeCamera]);

  useEffect(() => {
    const video = cameraVideoRef.current;
    if (video && video.srcObject !== cameraStream) video.srcObject = cameraStream;
  }, [cameraStream]);

  // Yes is a single act: the browser prompt, the picture, and the setting all
  // land together, so nobody agrees to recording and then finds the browser
  // quietly said no.
  const askForCamera = useCallback(async () => {
    setCameraOpening(true);
    setCameraError(null);
    try {
      const preset = presetFor(useRecordingStore.getState().settings.quality);
      const live = await openCameraPreview(null, preset.width, preset.height);
      cameraStreamRef.current = live;
      setCameraStream(live);
      setRecordingEnabled(true);
    } catch (err) {
      setCameraError(
        err instanceof RecordingError ? err : new RecordingError('failed', 'The camera could not be opened.'),
      );
    } finally {
      setCameraOpening(false);
    }
  }, [setRecordingEnabled]);

  const declineCamera = useCallback(() => {
    closeCamera();
    setRecordingEnabled(false);
  }, [closeCamera, setRecordingEnabled]);

  const leave = useCallback(() => {
    stopListening();
    closeCamera();
    writeSaved(null);
    onDone();
  }, [closeCamera, onDone, stopListening]);

  const chooseCourse = (code: string | null) => {
    setTrack(code);
    setModule(null);
    setKnown([]);
    setStep(code === null ? 'chords' : 'module');
  };

  const chooseModule = (number: number) => {
    setModule(number);
    // Seeded from the course's own order: by the time someone reaches module 10
    // it has taught them eight shapes, and asking a Grade 3 player to tick all
    // of them from scratch is how their generated routine ended up empty. It is
    // a starting point, not a verdict; the next line of copy says so.
    setKnown(chordsTaughtBy(number));
    setStep('chords');
  };

  const finish = () => {
    stopListening();
    closeCamera();
    addRoutine(routine);
    setActiveRoutine(routine.id);
    // The first lesson of the chosen module: enough for the Journey to know
    // which part of the course this person is standing in.
    const first = modules.find((m) => m.number === module)?.firstLessonCode;
    if (first) setCurrentLesson(first);
    // A chord someone says they already have is a claim, and the progression
    // model records it as exactly that: it will be overridden the moment a
    // drill produces a real number.
    for (const chord of known) setSkillClaimed(`chord.${chord}`, true);
    writeSaved(null);
    onDone();
  };

  const back = (to: Step) => () => {
    if (step === 'mic') stopListening();
    if (step === 'camera') closeCamera();
    setStep(to);
  };

  const micBlocked = detector.status === 'error';

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
        {/* The first screen a stranger sees said nothing about what they had
            opened. A wordmark is not decoration here: it is the only thing on
            the screen that answers "what is this". */}
        <div className="onboarding-top">
          <p className="onboarding-brand">
            Daily<span>Fret</span>
          </p>
          <p className="sr-only">
            Step {stepIndex + 1} of {path.length}
          </p>
          <div className="onboarding-steps" aria-hidden="true">
            {path.map((s, i) => (
              <span
                key={s}
                className={clsx(
                  'onboarding-dot',
                  i === stepIndex && 'is-on',
                  i < stepIndex && 'is-done',
                )}
              />
            ))}
          </div>
        </div>

        <motion.section
          key={step}
          className="onboarding-body"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
        >
          {step === 'intro' && (
            <>
              <h1 className="onboarding-title" ref={headingRef} tabIndex={-1}>
                {returning ? 'Let us put a routine back.' : 'Daily Fret listens while you practise.'}
              </h1>
              {returning ? (
                <p className="onboarding-lead">
                  Your practice history is still here. This builds a routine to hang it on.
                </p>
              ) : (
                <>
                  <p className="onboarding-lead">
                    It runs the session out loud so your hands stay on the guitar, counts the chord
                    changes it hears through the microphone, and sets tomorrow&rsquo;s tempo from
                    what you actually played.
                  </p>
                  <p className="onboarding-lead">
                    It does not teach guitar. Bring the lessons you already follow, and this keeps
                    the practice around them honest.
                  </p>
                </>
              )}
              <div className="onboarding-actions is-start">
                <button
                  type="button"
                  className="onboarding-next is-primary"
                  onClick={() => setStep('course')}
                >
                  Set up my practice <ArrowRightIcon size={16} />
                </button>
              </div>
              <p className="onboarding-footnote">
                Under a minute. You can change every answer later.
              </p>
            </>
          )}

          {step === 'course' && (
            <>
              <h1 className="onboarding-title" ref={headingRef} tabIndex={-1}>
                Which lessons are you following?
              </h1>
              <p className="onboarding-lead">
                Daily Fret knows the shape of the free beginner course at justinguitar.com, so it
                can tell which module you are standing in and link you back to the lesson. It does
                not host the lessons or replace them.
              </p>
              <div className="onboarding-choices">
                {BEGINNER_GRADES.map((g) => {
                  const first = g.modules[0].number;
                  const last = g.modules[g.modules.length - 1].number;
                  return (
                    <button
                      key={g.code}
                      type="button"
                      className={clsx('onboarding-choice', track === g.code && 'is-on')}
                      onClick={() => chooseCourse(g.code)}
                    >
                      <span className="onboarding-choice-name">{g.title}</span>
                      {/* Both numbers are counted from the curriculum at render.
                          The count used to include a companion practice diary,
                          which promised a module the next screen did not have. */}
                      <span className="onboarding-choice-note">
                        {g.modules.length} modules, {first} to {last}
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={clsx('onboarding-choice', 'is-other')}
                  onClick={() => chooseCourse(null)}
                >
                  <span className="onboarding-choice-name">Something else</span>
                  <span className="onboarding-choice-note">Your own lessons, or none</span>
                </button>
              </div>
              <p className="onboarding-note">
                Daily Fret is an independent practice app and is not affiliated with JustinGuitar.
                It reads the course&rsquo;s published structure, and nothing else. The drills, the
                measurements and the tempo coaching are its own.
              </p>
            </>
          )}

          {step === 'module' && grade && (
            <>
              <h1 className="onboarding-title" ref={headingRef} tabIndex={-1}>
                Where are you in {grade.title}?
              </h1>
              <p className="onboarding-lead">
                Pick the module you are working through now. You can change it later.
                {modules[0].number > 0 && (
                  <>
                    {' '}
                    The beginner course numbers its modules straight through all three grades, so{' '}
                    {grade.title} starts at {modules[0].number}.
                  </>
                )}
              </p>
              <div className="onboarding-modules">
                {modules.map((m) => (
                  <button
                    key={m.number}
                    type="button"
                    className={clsx('onboarding-module', module === m.number && 'is-on')}
                    onClick={() => chooseModule(m.number)}
                  >
                    <span className="onboarding-module-number">{m.number}</span>
                    <span className="onboarding-module-name">{m.title}</span>
                  </button>
                ))}
              </div>
              <div className="onboarding-actions">
                <button type="button" className="onboarding-back" onClick={back('course')}>
                  <ArrowLeftIcon size={16} /> Back
                </button>
              </div>
            </>
          )}

          {step === 'chords' && (
            <>
              <h1 className="onboarding-title" ref={headingRef} tabIndex={-1}>
                Which of these can you already play?
              </h1>
              <p className="onboarding-lead">
                {/* Counted from the matcher's own templates. These nine are the
                    only chords any listening drill can be built from. */}
                These are the {HEARABLE_CHORDS.length} shapes Daily Fret can hear.{' '}
                {module === null
                  ? 'Tick the ones you can put down without thinking.'
                  : 'Ticked from where you said you are. Untick anything that is not solid yet.'}{' '}
                Nothing is lost by leaving one out: the first time a drill hears it, the app will
                know.
              </p>
              <div className="onboarding-chords">
                {HEARABLE_CHORDS.map((chord) => {
                  const on = known.includes(chord);
                  const isNew = newChords.includes(chord);
                  return (
                    <button
                      key={chord}
                      type="button"
                      aria-pressed={on}
                      className={clsx('onboarding-chord', on && 'is-on')}
                      onClick={() =>
                        setKnown((prev) =>
                          prev.includes(chord)
                            ? prev.filter((c) => c !== chord)
                            : [...prev, chord],
                        )
                      }
                    >
                      <ChordDiagram chord={chord} size={60} showFingers={false} />
                      <span className="onboarding-chord-name">{chord}</span>
                      {isNew && <span className="onboarding-chord-tag">this module</span>}
                    </button>
                  );
                })}
              </div>
              <div className="onboarding-actions">
                <button
                  type="button"
                  className="onboarding-back"
                  onClick={back(track === null ? 'course' : 'module')}
                >
                  <ArrowLeftIcon size={16} /> Back
                </button>
                <button
                  type="button"
                  className="onboarding-next is-primary"
                  onClick={() => setStep('mic')}
                  disabled={!routine.tasks.length}
                >
                  Next <ArrowRightIcon size={16} />
                </button>
              </div>
              {/* The builder can honestly come back with nothing, and padding a
                  routine out so the screen looks full is the move that put "how
                  to hold your guitar" on a daily list. Ask for the one thing
                  that would let it build instead. */}
              {!routine.tasks.length && (
                <p className="onboarding-footnote" role="status">
                  Tick at least one shape. Every drill in Daily Fret listens for a chord, so
                  without one there is nothing it can run.
                </p>
              )}
            </>
          )}

          {step === 'mic' && (
            <>
              <h1 className="onboarding-title" ref={headingRef} tabIndex={-1}>
                Let it hear the guitar.
              </h1>
              <p className="onboarding-lead">
                Counting real chord changes is the whole point of this app, and it needs the
                microphone. Without it the drills still run, on a timer, and nothing is counted.
              </p>

              <div className={clsx('onboarding-mic', micGranted && 'is-live', micBlocked && 'is-blocked')}>
                {detector.status === 'running' ? (
                  <>
                    <SignalMeter quality={signal} />
                    <p className="onboarding-mic-state" role="status">
                      {heard ? (
                        <>
                          <CheckIcon size={16} /> Heard {heard}. That is the microphone working.
                        </>
                      ) : (
                        'Listening. Strum any chord.'
                      )}
                    </p>
                  </>
                ) : micBlocked ? (
                  <>
                    {/* The headline is the state, not the message. A browser can
                        hand back something as terse as "Not supported", and that
                        is a reason, not a sentence to open on. */}
                    <p className="onboarding-mic-state is-problem" role="status">
                      The microphone did not open.
                    </p>
                    {/* The browser's own reason sits on its own line. Some of
                        them are two words with no full stop, and running one
                        into the recovery sentence produced "Not supported Allow
                        the microphone for this site". */}
                    <p className="onboarding-mic-reason">{detector.error}</p>
                    <p className="onboarding-mic-help">
                      Allow the microphone for this site in your browser settings and try again, or
                      carry on without it and turn it on from any drill.
                    </p>
                    <button type="button" className="onboarding-mic-btn" onClick={askForMicrophone}>
                      <MicIcon size={18} /> Try again
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="onboarding-mic-btn"
                    onClick={askForMicrophone}
                    disabled={detector.status === 'requesting'}
                  >
                    <MicIcon size={18} />
                    {detector.status === 'requesting' ? 'Waiting for the browser…' : 'Turn on the microphone'}
                  </button>
                )}
              </div>

              <div className="onboarding-actions">
                <button type="button" className="onboarding-back" onClick={back('chords')}>
                  <ArrowLeftIcon size={16} /> Back
                </button>
                <button
                  type="button"
                  className="onboarding-next is-primary"
                  onClick={() => {
                    stopListening();
                    setStep('camera');
                  }}
                >
                  {micGranted ? 'Next' : 'Skip for now'} <ArrowRightIcon size={16} />
                </button>
              </div>
            </>
          )}

          {/* The camera. Offered once, plainly, with the promise it has to keep
              stated before the browser prompt rather than after it. This is the
              only screen in the app that asks for a camera, and "No" here is a
              complete answer: nothing later nags, and the Technique button does
              not appear on the day's screen at all. */}
          {step === 'camera' && (
            <>
              <h1 className="onboarding-title" ref={headingRef} tabIndex={-1}>
                Let it watch your hands.
              </h1>
              <p className="onboarding-lead">
                The app can hear what you play, but it cannot see how you are playing it, and that
                is the part a teacher would fix. With this on it films each drill as it runs, so
                there is footage of your hands without setting a camera up every day.
              </p>
              <p className="onboarding-lead">
                The video stays on this device. Nothing is uploaded, the screen says so whenever the
                camera is rolling, and one tap in Settings deletes all of it.
              </p>

              <div
                className={clsx(
                  'onboarding-mic',
                  'onboarding-camera',
                  recordingOn && 'is-live',
                  cameraError && 'is-blocked',
                )}
              >
                {cameraStream ? (
                  <>
                    <video
                      ref={cameraVideoRef}
                      className="onboarding-camera-video"
                      autoPlay
                      playsInline
                      muted
                    />
                    <p className="onboarding-mic-state" role="status">
                      <CheckIcon size={16} /> That is the shot. Point it at your hands, not your
                      face.
                    </p>
                  </>
                ) : cameraError ? (
                  <>
                    <p className="onboarding-mic-state is-problem" role="status">
                      The camera did not open.
                    </p>
                    <p className="onboarding-mic-reason">{cameraError.message}</p>
                    <p className="onboarding-mic-help">{recoveryFor(cameraError.kind)}</p>
                    <button type="button" className="onboarding-mic-btn" onClick={() => void askForCamera()}>
                      <CameraIcon size={18} /> Try again
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="onboarding-mic-btn"
                    onClick={() => void askForCamera()}
                    disabled={cameraOpening}
                  >
                    <CameraIcon size={18} />
                    {cameraOpening ? 'Waiting for the browser…' : 'Record my practice'}
                  </button>
                )}
              </div>

              <div className="onboarding-actions">
                <button type="button" className="onboarding-back" onClick={back('mic')}>
                  <ArrowLeftIcon size={16} /> Back
                </button>
                <button
                  type="button"
                  className="onboarding-next is-primary"
                  onClick={() => {
                    closeCamera();
                    setStep('ready');
                  }}
                >
                  Build my routine <ArrowRightIcon size={16} />
                </button>
              </div>
              {!recordingOn && (
                <button
                  type="button"
                  className="onboarding-footnote-btn"
                  onClick={() => {
                    declineCamera();
                    setStep('ready');
                  }}
                >
                  No camera, thanks. Everything else works the same.
                </button>
              )}
            </>
          )}

          {step === 'ready' && (
            <>
              <h1 className="onboarding-title" ref={headingRef} tabIndex={-1}>
                Your first session.
              </h1>
              <p className="onboarding-lead">
                About {routineMinutes(routine)} minutes of playing.{' '}
                {measured > 0
                  ? micGranted
                    ? `${measured} of these ${routine.tasks.length} are counted through the microphone.`
                    : `${measured} of these ${routine.tasks.length} would be counted, once the microphone is on.`
                  : 'Nothing here is counted yet.'}
              </p>
              {/* The routine says what it was built from, and this repeats it
                  rather than restating a fit with the module. For most of Grade
                  2 and all of Grade 3 the app has no drills mapped to the
                  module, and pretending otherwise is the discrepancy that made
                  this whole screen worth rewriting. */}
              <p className="onboarding-basis">{routine.description}</p>
              <ol className="onboarding-preview">
                {routine.tasks.map((t) => (
                  <li
                    key={t.id}
                    className={clsx('onboarding-preview-item', t.drill && 'is-counted')}
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
                  </li>
                ))}
              </ol>
              <div className="onboarding-actions">
                <button type="button" className="onboarding-back" onClick={back('camera')}>
                  <ArrowLeftIcon size={16} /> Back
                </button>
                <button type="button" className="onboarding-next is-primary" onClick={finish}>
                  Start practising <ArrowRightIcon size={16} />
                </button>
              </div>
              <p className="onboarding-footnote">
                It is your routine now, not a template. Change anything in it.
              </p>
            </>
          )}
        </motion.section>

        {step !== 'ready' && (
          <button type="button" className="onboarding-skip" onClick={leave}>
            I will set it up myself
          </button>
        )}
      </div>
    </motion.div>,
    document.body,
  );
}
