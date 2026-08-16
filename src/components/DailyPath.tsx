import {
  useState, useMemo, useEffect, useRef, useCallback, lazy, Suspense,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useStore, useUserData, getTodayString } from '../store';
import { useAuthStore } from '../lib/auth';
import { TaskRow } from './TaskRow';
import { Modal } from './Modal';
import { Loader } from './Loader';
import { SurfaceBoundary } from './SurfaceBoundary';
import { TaskCreatorModal } from './TaskCreatorModal';
import { UndoStrip } from './UndoStrip';
import { PracticeNudge } from './PracticeNudge';
import { useUndoStore, type TaskDeletion } from '../store/undo';
import { RoutineManagerModal } from './RoutineManagerModal';
import { ProgressPanel } from './practice/ProgressPanel';
import { TunerLauncher } from './practice/TunerLauncher';
import { preloadTuner } from './practice/tunerChunk';
import { sanitizeMinutes } from '../lib/coached';
import { useRecordingStore } from '../media/recordingStore';
import type { Task } from '../types';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BoltIcon,
  PlusIcon,
  CaretDownIcon,
  SlidersIcon,
  ChartIcon,
  FramingIcon,
  CameraIcon,
  SessionIcon,
  TuningForkIcon,
} from './icons';
import clsx from 'clsx';
import './DailyPath.css';

// Code-split the audio/practice path: it pulls in the DSP + worklet glue and is
// only needed once a user actually starts a drill, keeping first paint light.
const PracticeOverlay = lazy(() =>
  import('./practice/PracticeOverlay').then((m) => ({ default: m.PracticeOverlay })),
);
const CoachedSession = lazy(() =>
  import('./practice/CoachedSession').then((m) => ({ default: m.CoachedSession })),
);
// The tuner is fetched by TunerLauncher rather than by lazy()/Suspense, which
// has no timeout and no retry: see the note at the top of that file.

// The Journey pulls the whole curriculum (650 lessons) and the Awards panel
// pulls the achievement set. Neither is needed to paint the day's tasks, and
// eagerly importing them put 40 kB gzipped in front of every first load for a
// panel most sessions never open.
const JourneyPanel = lazy(() =>
  import('./practice/JourneyPanel').then((m) => ({ default: m.JourneyPanel })),
);
const AchievementsPanel = lazy(() =>
  import('./practice/AchievementsPanel').then((m) => ({ default: m.AchievementsPanel })),
);
const HistoryPanel = lazy(() =>
  import('./practice/HistoryPanel').then((m) => ({ default: m.HistoryPanel })),
);
// First run only, and it reaches the curriculum through the routine builder.
const Onboarding = lazy(() => import('./Onboarding').then((m) => ({ default: m.Onboarding })));
// The camera surface. Split out because it pulls the whole media layer, and
// the majority of visits never open a camera at all.
// Split for the same reason as the camera surface: the review library pulls the
// media layer, and most visits never open it.
const RecordingLibrary = lazy(() =>
  import('./practice/RecordingLibrary').then((m) => ({ default: m.RecordingLibrary })),
);

const TechniqueCheck = lazy(() =>
  import('./practice/TechniqueCheck').then((m) => ({ default: m.TechniqueCheck })),
);

type ProgressView = 'journey' | 'numbers' | 'awards' | 'history';

const PROGRESS_VIEWS: ReadonlyArray<{ id: ProgressView; label: string }> = [
  { id: 'journey', label: 'Journey' },
  { id: 'numbers', label: 'Numbers' },
  { id: 'awards', label: 'Awards' },
  { id: 'history', label: 'History' },
];

const INLINE_STEPS = ['title', 'description', 'duration'] as const;
const INLINE_HINTS: Record<(typeof INLINE_STEPS)[number], string> = {
  title: 'Name your task',
  description: 'What is this task for? (Optional)',
  duration: 'How many minutes? (Optional)',
};
const MAX_TASKS = 100;

export function DailyPath() {
  const today = getTodayString();
  const userData = useUserData();
  // Whether the cloud copy of this account is still on its way. A signed-in
  // player opening the app on a second device has no local routine yet, which
  // is indistinguishable from being new if nothing asks this question: the
  // first run wizard used to open over data already in flight and get yanked
  // away mid-question when the sync landed.
  const syncing = useAuthStore((s) => s.syncing);

  const routines = useMemo(() => userData?.routines || [], [userData]);
  const activeRoutineId = userData?.activeRoutineId;
  const dailyLogs = userData?.dailyLogs || {};

  const setActiveRoutine = useStore(state => state.setActiveRoutine);
  const log = dailyLogs[today];

  const [isRoutineDropdownOpen, setIsRoutineDropdownOpen] = useState(false);
  const [isJotterOpen, setIsJotterOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isRoutineModalOpen, setIsRoutineModalOpen] = useState(false);
  const [isProgressOpen, setIsProgressOpen] = useState(false);
  // Progress answers "how fast", Journey answers "where am I". They are two
  // views of the same question and live behind one button rather than adding a
  // fourth thing to the header.
  const [progressView, setProgressView] = useState<ProgressView>('journey');
  const tabRefs = useRef<Partial<Record<ProgressView, HTMLButtonElement | null>>>({});

  // A tablist owes the keyboard arrow keys; without them the roving tabindex
  // below would leave three of the four tabs unreachable.
  const onTabKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const at = PROGRESS_VIEWS.findIndex((v) => v.id === progressView);
    const next = step !== 0
      ? PROGRESS_VIEWS[(at + step + PROGRESS_VIEWS.length) % PROGRESS_VIEWS.length]
      : e.key === 'Home' ? PROGRESS_VIEWS[0]
      : e.key === 'End' ? PROGRESS_VIEWS[PROGRESS_VIEWS.length - 1]
      : null;
    if (!next) return;
    e.preventDefault();
    setProgressView(next.id);
    tabRefs.current[next.id]?.focus();
  };
  const [isCoachedOpen, setIsCoachedOpen] = useState(false);
  const [isTunerOpen, setIsTunerOpen] = useState(false);
  const [isTechniqueOpen, setIsTechniqueOpen] = useState(false);
  const [isFootageOpen, setIsFootageOpen] = useState(false);
  // The camera entry point appears only for someone who has opted in. Offering
  // it to a player who has declined recording would be advertising a camera at
  // them on the screen they open every day.
  const recordingOn = useRecordingStore((s) => s.settings.enabled);
  const hasFootage = useRecordingStore((s) => s.recordings.length > 0);
  const [practiceTask, setPracticeTask] = useState<Task | null>(null);
  const [prevAllCompleted, setPrevAllCompleted] = useState(false);
  const [limitNotice, setLimitNotice] = useState(false);
  const [onboardingSkipped, setOnboardingSkipped] = useState(false);

  // Deleted tasks wait here in the list, in the gap they left, until the offer
  // expires. Routine deletions have their own strip inside the manager.
  const pendingUndo = useUndoStore((s) => s.pending);
  const taskUndo = useMemo(
    () =>
      pendingUndo.filter(
        (d): d is TaskDeletion => d.kind === 'task' && d.routineId === activeRoutineId,
      ),
    [pendingUndo, activeRoutineId],
  );

  // Stable across renders so memoized TaskRows don't re-render when the list
  // does. The row passes its own task back. Every task is startable now, not
  // only the ones with a live drill: a task nobody can run inside the app is a
  // task the app can only ever be told about.
  const startTask = useCallback((task: Task) => setPracticeTask(task), []);

  const routineDropdownRef = useRef<HTMLDivElement>(null);
  const routineTriggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [inlineDraft, setInlineDraft] = useState({ title: '', description: '', duration: '' });
  const [inlineStep, setInlineStep] = useState<'title'|'description'|'duration'|null>(null);
  // Which edges of the task list actually have more content past them. Drives
  // the fade: the old mask faded the top and bottom unconditionally, so with
  // two tasks the first one sat permanently half-dissolved for no reason.
  const [listEdges, setListEdges] = useState({ up: false, down: false });

  const titleInputRef = useRef<HTMLInputElement>(null);
  const descInputRef = useRef<HTMLInputElement>(null);
  const durationInputRef = useRef<HTMLInputElement>(null);
  const inlineFormRef = useRef<HTMLFormElement>(null);

  const activeRoutine = useMemo(() => {
    return routines.find(r => r.id === activeRoutineId) || routines[0];
  }, [routines, activeRoutineId]);

  const tasks = useMemo(() => activeRoutine?.tasks || [], [activeRoutine]);
  const isEmpty = tasks.length === 0;

  // Tasks and undo offers as one ordered list. An offer is placed at the index
  // the task was deleted from, so the strip appears in the gap rather than at
  // the bottom: where it sits is half of what it is telling you. Highest index
  // first, so inserting an earlier one cannot displace a later one.
  const rows = useMemo(() => {
    const merged: Array<
      { kind: 'task'; task: Task; index: number } | { kind: 'undo'; deletion: TaskDeletion }
    > = tasks.map((task, index) => ({ kind: 'task' as const, task, index }));
    [...taskUndo]
      .sort((a, b) => b.index - a.index)
      .forEach((deletion) => {
        merged.splice(Math.min(deletion.index, merged.length), 0, { kind: 'undo', deletion });
      });
    return merged;
  }, [tasks, taskUndo]);

  // Coached mode runs every task in order (drills + timed blocks).
  const hasCoachable = tasks.length > 0;

  // The way out of an empty Progress panel: close it and start practising, so
  // the panel that says "run a drill and this fills up" can actually run one.
  // Undefined when there is nothing to run, rather than offering a dead button.
  const startSession = hasCoachable
    ? () => { setIsProgressOpen(false); setIsCoachedOpen(true); }
    : undefined;

  const allCompleted = !isEmpty && tasks.every(t => log?.completedTaskIds?.includes(t.id));

  // Open the jotter on the rising edge of completion (when no feedback yet),
  // adjusting state during render rather than in an effect. Hold off while a
  // guided session or a drill is on screen — completing the last task there
  // shouldn't pop the note sheet *under* the overlay; we surface it once the
  // coached session closes instead (see CoachedSession onClose below).
  if (allCompleted !== prevAllCompleted) {
    setPrevAllCompleted(allCompleted);
    if (allCompleted && log?.feedback === undefined && !isCoachedOpen && !practiceTask) {
      setIsJotterOpen(true);
    }
  }

  useEffect(() => {
    if (!isRoutineDropdownOpen) return;
    // pointerdown, not mousedown: it fires for touch and pen too, so the menu
    // closes on a tap outside on a phone instead of waiting for a synthesised
    // mouse event that may never arrive.
    const handlePointerDown = (e: PointerEvent) => {
      if (routineDropdownRef.current && !routineDropdownRef.current.contains(e.target as Node)) {
        setIsRoutineDropdownOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setIsRoutineDropdownOpen(false);
      routineTriggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isRoutineDropdownOpen]);

  // Fade an edge only when something is actually past it.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      const up = el.scrollTop > 4;
      const down = el.scrollTop + el.clientHeight < el.scrollHeight - 4;
      setListEdges((prev) => (prev.up === up && prev.down === down ? prev : { up, down }));
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [tasks.length, inlineStep]);

  // On a phone the soft keyboard covers the lower half of the screen, so keep
  // the step the user is on (and its buttons) in view as the flow advances.
  useEffect(() => {
    if (!inlineStep) return;
    inlineFormRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [inlineStep]);

  // Move to the next step, or create the task on the last one. Reached by the
  // visible button and by the form's implicit submit, so a hardware Enter and a
  // tap are the same path.
  const advanceInline = () => {
    if (inlineStep === 'title') {
      if (!inlineDraft.title.trim()) return;
      setInlineStep('description');
      setTimeout(() => descInputRef.current?.focus(), 50);
    } else if (inlineStep === 'description') {
      setInlineStep('duration');
      setTimeout(() => durationInputRef.current?.focus(), 50);
    } else if (inlineStep === 'duration') {
      submitInlineTask();
    }
  };

  const cancelInline = () => {
    setInlineStep(null);
    setLimitNotice(false);
    setInlineDraft({ title: '', description: '', duration: '' });
  };

  // Enter is the form's job now; this only carries the desktop escape hatch.
  const handleInlineKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') cancelInline();
  };

  const submitInlineTask = () => {
    if (!inlineDraft.title.trim()) return;
    if (tasks.length >= MAX_TASKS) {
      // Was a native alert(), which is the one piece of UI the app cannot style
      // and the only place it spoke like a browser instead of like itself.
      setLimitNotice(true);
      return;
    }
    const newTask = {
      id: crypto.randomUUID(),
      title: inlineDraft.title.trim(),
      description: inlineDraft.description.trim() || undefined,
      duration: inlineDraft.duration.trim() || undefined
    };
    useStore.getState().addTask(activeRoutine.id, newTask);
    setInlineStep(null);
    setLimitNotice(false);
    setInlineDraft({ title: '', description: '', duration: '' });
  };

  // Signed in, nothing local, and the cloud copy still coming. Their routine
  // very probably exists; it is on the wire. So the list shows its own shape
  // arriving rather than a wizard asking a returning player who they are.
  if (!activeRoutine && syncing) {
    return (
      <div className="daily-path">
        <div className="task-container-wrapper">
          <div className="task-container glass-panel">
            <p className="sr-only" role="status">
              Fetching your practice from the cloud.
            </p>
            <div className="task-list-scrollable" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="task-skeleton" style={{ animationDelay: `${i * 0.12}s` }}>
                  <span className="task-skeleton-mark" />
                  <span className="task-skeleton-lines">
                    <span className="task-skeleton-line is-title" />
                    <span className="task-skeleton-line" />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // First run: no routine and never asked where they are. Dismissing it drops
  // through to the same blank slate as before, so nobody is trapped in a wizard.
  if (!activeRoutine && !onboardingSkipped) {
    return (
      <SurfaceBoundary name="Setup" overlay onDismiss={() => setOnboardingSkipped(true)}>
        <Suspense fallback={<Loader overlay label="Getting set up…" />}>
          <Onboarding onDone={() => setOnboardingSkipped(true)} />
        </Suspense>
      </SurfaceBoundary>
    );
  }

  if (!activeRoutine) {
    return (
      <div className="daily-path">
        <div className="task-container-wrapper">
          <div className="task-container glass-panel is-blank">
            <motion.button
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="empty-state-placeholder"
              onClick={() => {
                const newId = crypto.randomUUID();
                useStore.getState().addRoutine({
                  id: newId,
                  name: 'My First Routine',
                  description: '',
                  isDefault: true,
                  tasks: []
                });
                setActiveRoutine(newId);
              }}
            >
              <span className="placeholder-text">Start your first routine</span>
              <span className="placeholder-sub">A routine is the set of things you practise in a session.</span>
            </motion.button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="daily-path">
      <div className="path-header-center">
        <div className="routine-selector-container" ref={routineDropdownRef}>
          <button
            ref={routineTriggerRef}
            className="routine-selector"
            onClick={() => setIsRoutineDropdownOpen(prev => !prev)}
            aria-expanded={isRoutineDropdownOpen}
            aria-haspopup="menu"
          >
            <BoltIcon size={18} className="routine-icon" />
            <span className="routine-name">{activeRoutine.name}</span>
            <CaretDownIcon size={16} className={clsx('routine-caret', isRoutineDropdownOpen && 'is-open')} />
          </button>

          <AnimatePresence>
            {isRoutineDropdownOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -8 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="routine-dropdown glass-panel"
                role="menu"
                aria-label="Choose a routine"
              >
                {routines.map(r => (
                  <button
                    key={r.id}
                    role="menuitemradio"
                    aria-checked={r.id === activeRoutineId}
                    className={clsx('dropdown-item', r.id === activeRoutineId && 'active')}
                    onClick={() => {
                      setActiveRoutine(r.id);
                      setIsRoutineDropdownOpen(false);
                    }}
                  >
                    {r.name}
                  </button>
                ))}
                <div className="dropdown-divider" />
                <button
                  role="menuitem"
                  className="dropdown-item manage-action"
                  onClick={() => {
                    setIsRoutineDropdownOpen(false);
                    setIsRoutineModalOpen(true);
                  }}
                >
                  <SlidersIcon size={16} /> Manage routines
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {hasCoachable && (
          <button
            className="progress-launch is-primary"
            onClick={() => setIsCoachedOpen(true)}
            title="Run this whole routine, guided"
          >
            <SessionIcon size={18} className="progress-launch-icon" />
            <span>Coached</span>
          </button>
        )}

        <button
          className="progress-launch"
          // Fetch on the press, not on the release: it buys the download a head
          // start and keeps the microphone request inside the user gesture that
          // asked for it, which is what Safari checks.
          onPointerDown={preloadTuner}
          onFocus={preloadTuner}
          onClick={() => setIsTunerOpen(true)}
          title="Tune up before you start"
        >
          <TuningForkIcon size={18} className="progress-launch-icon" />
          <span>Tune</span>
        </button>

        {recordingOn && (
          <button
            className="progress-launch"
            onClick={() => setIsTechniqueOpen(true)}
            title="Film three angles of your hands, seventy-five seconds"
          >
            <FramingIcon size={18} className="progress-launch-icon" />
            <span>Technique</span>
          </button>
        )}

        {/* Only once there is something to watch. A camera that films and then
            offers nowhere to see the footage is the state this closes, but an
            empty shelf advertised on the main screen is its own small lie. */}
        {recordingOn && hasFootage && (
          <button
            className="progress-launch"
            onClick={() => setIsFootageOpen(true)}
            title="Watch back what you have filmed"
          >
            <CameraIcon size={18} className="progress-launch-icon" />
            <span>Footage</span>
          </button>
        )}

        {/* Not gated on having drill results any more: the Journey is a map of
            the course, and day zero is precisely when someone needs one. */}
        <button
          className="progress-launch"
          onClick={() => {
            setProgressView('journey');
            setIsProgressOpen(true);
          }}
          title="Where you are, and how you are moving"
        >
          <ChartIcon size={18} className="progress-launch-icon" />
          <span>Progress</span>
        </button>
      </div>

      <div className="task-container-wrapper">
        <div className="task-container glass-panel">
          {/* Above the list, not over it: the thing it is asking you to do is
              right there underneath. */}
          <PracticeNudge onStart={() => setIsCoachedOpen(true)} />
          <div
            ref={listRef}
            className={clsx(
              'task-list-scrollable',
              listEdges.up && 'fade-up',
              listEdges.down && 'fade-down',
            )}
          >
            <AnimatePresence mode="popLayout">
              {rows.map((row) =>
                row.kind === 'undo' ? (
                  <UndoStrip key={row.deletion.id} deletion={row.deletion} />
                ) : (
                  <motion.div
                    layout
                    key={row.task.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: row.index * 0.03 }}
                  >
                    <TaskRow routineId={activeRoutine.id} taskId={row.task.id} title={row.task.title} description={row.task.description} duration={row.task.duration} drill={row.task.drill} blocks={row.task.blocks} index={row.index} total={tasks.length} onStart={startTask} />
                  </motion.div>
                ),
              )}

              {isEmpty && !inlineStep && !taskUndo.length && (
                <motion.button
                  type="button"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="empty-state-placeholder"
                  onClick={() => setInlineStep('title')}
                >
                  <span className="placeholder-text">Add your first task</span>
                  <span className="placeholder-sub">
                    A warm-up, a chord drill, a song. Anything you want to do today.
                  </span>
                </motion.button>
              )}

              {inlineStep && (
                <motion.form
                  ref={inlineFormRef}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="inline-task-creator"
                  onSubmit={e => {
                    e.preventDefault();
                    advanceInline();
                  }}
                >
                  <div className="inline-step-head">
                    <span className="inline-steps" aria-hidden="true">
                      {INLINE_STEPS.map(step => (
                        <span
                          key={step}
                          className={clsx('inline-step-dot', step === inlineStep && 'is-on')}
                        />
                      ))}
                    </span>
                    <span className="inline-tooltip">{INLINE_HINTS[inlineStep]}</span>
                    <span className="sr-only">
                      Step {INLINE_STEPS.indexOf(inlineStep) + 1} of {INLINE_STEPS.length}
                    </span>
                  </div>

                  {inlineStep === 'title' && (
                    <div className="inline-input-wrapper">
                      <input
                        ref={titleInputRef}
                        autoFocus
                        aria-label="Task name"
                        placeholder="e.g. Spider Walk"
                        value={inlineDraft.title}
                        onChange={e => setInlineDraft(d => ({ ...d, title: e.target.value }))}
                        onKeyDown={handleInlineKeyDown}
                        className="inline-input fluid-input"
                        enterKeyHint="next"
                        maxLength={60}
                      />
                    </div>
                  )}
                  {inlineStep === 'description' && (
                    <div className="inline-input-wrapper">
                      <input
                        ref={descInputRef}
                        autoFocus
                        aria-label="Description (optional)"
                        placeholder="e.g. Start at 1st fret, alternate picking."
                        value={inlineDraft.description}
                        onChange={e => setInlineDraft(d => ({ ...d, description: e.target.value }))}
                        onKeyDown={handleInlineKeyDown}
                        className="inline-input fluid-input"
                        enterKeyHint="next"
                        maxLength={300}
                      />
                    </div>
                  )}
                  {inlineStep === 'duration' && (
                    <div className="inline-input-wrapper">
                      <input
                        ref={durationInputRef}
                        autoFocus
                        aria-label="Minutes (optional)"
                        placeholder="e.g. 5"
                        value={inlineDraft.duration}
                        onChange={e => setInlineDraft(d => ({ ...d, duration: sanitizeMinutes(e.target.value) }))}
                        onKeyDown={handleInlineKeyDown}
                        className="inline-input fluid-input"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        enterKeyHint="done"
                      />
                    </div>
                  )}

                  {limitNotice && (
                    <p className="inline-notice" role="alert">
                      This routine is full at {MAX_TASKS} tasks. Delete one, or start a
                      second routine, to add more.
                    </p>
                  )}

                  {/* The numeric keypad has no return key, so the last step was a
                      dead end on a phone. These are the real controls now; Enter
                      still works wherever the keyboard offers it. */}
                  <div className="inline-actions">
                    <button type="button" className="inline-action" onClick={cancelInline}>
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="inline-action is-primary"
                      disabled={inlineStep === 'title' && !inlineDraft.title.trim()}
                    >
                      {inlineStep === 'duration' ? 'Add task' : 'Next'}
                    </button>
                  </div>
                </motion.form>
              )}
            </AnimatePresence>
          </div>

          {!isEmpty && (
            <div className="task-container-footer">
               <button
                className="add-task-btn"
                onClick={() => setIsTaskModalOpen(true)}
               >
                 <PlusIcon size={16} />
                 <span>Add quick task</span>
               </button>
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={isFootageOpen}
        onClose={() => setIsFootageOpen(false)}
        title="Footage"
        position="full"
      >
        <SurfaceBoundary name="Your footage">
          <Suspense fallback={<Loader label="Opening your footage…" />}>
            <RecordingLibrary />
          </Suspense>
        </SurfaceBoundary>
      </Modal>

      <Modal
        isOpen={isJotterOpen}
        onClose={() => {
          setIsJotterOpen(false);
        }}
        label="Today's practice note"
        position="bottom"
      >
        <div className="jotter-content">
          <h2 className="jotter-title">That's today's practice done.</h2>
          <p className="jotter-subtitle">
            Anything worth remembering before you put the guitar down?
          </p>
          <textarea
            className="jotter-input"
            aria-label="Practice note"
            placeholder="What felt better than last time? What is still fighting you?"
            value={log?.feedback || ''}
            onChange={(e) => useStore.getState().saveFeedback(today, e.target.value)}
            rows={4}
            maxLength={1000}
          />
          <button
            className="jotter-done-btn"
            onClick={() => setIsJotterOpen(false)}
          >
            Done
          </button>
        </div>
      </Modal>

      <TaskCreatorModal
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
        routineId={activeRoutine.id}
      />

      <RoutineManagerModal
        isOpen={isRoutineModalOpen}
        onClose={() => setIsRoutineModalOpen(false)}
      />

      <Modal
        isOpen={isProgressOpen}
        onClose={() => setIsProgressOpen(false)}
        title="Progress"
        wide
      >
        {/* These read as tabs to a screen reader, so they have to behave like
            them: a panel to point at, arrow keys, and one stop in the tab order
            rather than four. Before this they announced a tablist whose panels
            did not exist. */}
        <div className="progress-tabs" role="tablist" aria-label="Progress view" onKeyDown={onTabKey}>
          {PROGRESS_VIEWS.map((view) => (
            <button
              key={view.id}
              type="button"
              role="tab"
              id={`progress-tab-${view.id}`}
              aria-controls="progress-panel"
              aria-selected={progressView === view.id}
              tabIndex={progressView === view.id ? 0 : -1}
              ref={(el) => { tabRefs.current[view.id] = el; }}
              className={clsx('progress-tab', progressView === view.id && 'is-on')}
              onClick={() => setProgressView(view.id)}
            >
              {view.label}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id="progress-panel"
          aria-labelledby={`progress-tab-${progressView}`}
        >
        {/* Keyed on the tab, so switching away from a tab that failed to load
            and back again is a fresh attempt rather than a stuck panel. */}
        <SurfaceBoundary
          resetKey={progressView}
          name={PROGRESS_VIEWS.find((v) => v.id === progressView)?.label ?? 'This tab'}
        >
          <Suspense fallback={<p className="progress-empty">Reading your practice…</p>}>
            {progressView === 'journey' && <JourneyPanel />}
            {progressView === 'awards' && <AchievementsPanel />}
            {progressView === 'history' && <HistoryPanel onStartSession={startSession} />}
          </Suspense>
        </SurfaceBoundary>

        {progressView === 'numbers' && (
        <ProgressPanel
          onStartSession={startSession}
          onPracticePair={(from, to) => {
            useStore.getState().setLastPair(from, to);
            const existing = tasks.find((t) => t.drill?.kind === 'one-minute-changes');
            const base: Task = existing ?? {
              id: '__changes__',
              title: 'Chord Changes',
              drill: { kind: 'one-minute-changes', durationSec: 60 },
            };
            setIsProgressOpen(false);
            setPracticeTask({
              ...base,
              drill: { kind: 'one-minute-changes', chordFrom: from, chordTo: to, durationSec: 60 },
            });
          }}
        />
        )}
        </div>
      </Modal>

      <SurfaceBoundary
        name={practiceTask?.title ?? 'That drill'}
        overlay={!!practiceTask}
        resetKey={practiceTask?.id ?? null}
        onDismiss={() => setPracticeTask(null)}
      >
        <Suspense fallback={practiceTask ? <Loader overlay label="Tuning up…" /> : null}>
          <AnimatePresence>
            {practiceTask && (
              <PracticeOverlay
                key={practiceTask.id}
                task={practiceTask}
                onClose={() => setPracticeTask(null)}
              />
            )}
          </AnimatePresence>
        </Suspense>
      </SurfaceBoundary>

      <AnimatePresence>
        {isTunerOpen && <TunerLauncher key="tuner" onClose={() => setIsTunerOpen(false)} />}
      </AnimatePresence>

      <SurfaceBoundary
        name="The technique check"
        overlay={isTechniqueOpen}
        resetKey={isTechniqueOpen ? 'open' : null}
        onDismiss={() => setIsTechniqueOpen(false)}
      >
        <Suspense fallback={isTechniqueOpen ? <Loader overlay label="Opening the camera…" /> : null}>
          <AnimatePresence>
            {isTechniqueOpen && (
              <TechniqueCheck key="technique" onClose={() => setIsTechniqueOpen(false)} />
            )}
          </AnimatePresence>
        </Suspense>
      </SurfaceBoundary>

      <SurfaceBoundary
        name="The coached session"
        overlay={isCoachedOpen}
        resetKey={isCoachedOpen ? 'open' : null}
        onDismiss={() => setIsCoachedOpen(false)}
      >
      <Suspense fallback={isCoachedOpen ? <Loader overlay label="Tuning up…" /> : null}>
        <AnimatePresence>
          {isCoachedOpen && activeRoutine && (
            <CoachedSession
              key="coached"
              routine={activeRoutine}
              onClose={() => {
                setIsCoachedOpen(false);
                // If the guided run finished the whole routine, invite a
                // reflection note now (read fresh state — `log` is stale here).
                const acc = useStore.getState().accounts[useStore.getState().currentAccountId];
                const freshLog = acc?.dailyLogs?.[today];
                const done = tasks.length > 0 && tasks.every((t) => freshLog?.completedTaskIds?.includes(t.id));
                if (done && freshLog?.feedback === undefined) {
                  setIsJotterOpen(true);
                }
              }}
            />
          )}
        </AnimatePresence>
      </Suspense>
      </SurfaceBoundary>
    </div>
  );
}
