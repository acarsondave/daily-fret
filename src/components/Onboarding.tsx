import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, PlectrumIcon } from './icons';
import { ChordDiagram } from './practice/ChordDiagram';
import { useStore } from '../store';
import { CURRICULUM, trackModules } from '../data/curriculum';
import { buildRoutine, chordsInModule, routineMinutes } from '../lib/routineBuilder';
import './Onboarding.css';

/** Courses someone can start from. The rest of the catalogue is not a path. */
const TRACKS = ['b1', 'b2'];
/** The chords a beginner might already have. Everything Grade 1 teaches. */
const KNOWN_CHORDS = ['D', 'A', 'E', 'Em', 'Am', 'Dm', 'C', 'G'];

type Step = 'where' | 'module' | 'chords' | 'ready';

/**
 * First run.
 *
 * The app used to open on an empty list and one button reading "start your
 * first routine", which asks a beginner to design their own practice before
 * they have played anything. This asks the two questions it can actually act
 * on — where are you, and what can you already play — and builds the routine
 * itself.
 *
 * Nothing here is required. Skipping lands on the same empty list as before, so
 * a returning player who just wants to build their own is one tap from it.
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const addRoutine = useStore((s) => s.addRoutine);
  const setActiveRoutine = useStore((s) => s.setActiveRoutine);
  const setCurrentLesson = useStore((s) => s.setCurrentLesson);
  const setSkillClaimed = useStore((s) => s.setSkillClaimed);

  const [step, setStep] = useState<Step>('where');
  const [track, setTrack] = useState('b1');
  const [module, setModule] = useState<number | null>(null);
  const [known, setKnown] = useState<string[]>([]);

  const modules = useMemo(() => trackModules(track), [track]);
  const newChords = useMemo(
    () => (module === null ? [] : chordsInModule(track, module)),
    [track, module],
  );
  const routine = useMemo(
    () => (module === null ? null : buildRoutine({ track, module, knownChords: known })),
    [track, module, known],
  );

  const finish = () => {
    if (!routine || module === null) return;
    addRoutine(routine);
    setActiveRoutine(routine.id);
    // The first lesson of the chosen module: enough for the Journey to know
    // which part of the course this person is standing in.
    const first = modules.find((m) => m.number === module)?.lessons[0];
    if (first) setCurrentLesson(first.code);
    // A chord someone says they already have is a claim, and the progression
    // model records it as exactly that: it will be overridden the moment a
    // drill produces a real number.
    for (const chord of known) setSkillClaimed(`chord.${chord}`, true);
    onDone();
  };

  return createPortal(
    <motion.div
      className="onboarding"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      role="dialog"
      aria-modal="true"
      aria-label="Set up your practice"
    >
      <div className="onboarding-panel">
        {/* The first screen a stranger sees said nothing about what they had
            opened. A wordmark is not decoration here: it is the only thing on
            the screen that answers "what is this". */}
        <p className="onboarding-brand">Daily<span>Fret</span></p>
        <div className="onboarding-steps" aria-hidden="true">
          {(['where', 'module', 'chords', 'ready'] as Step[]).map((s) => (
            <span key={s} className={clsx('onboarding-dot', s === step && 'is-on')} />
          ))}
        </div>

        {step === 'where' && (
          <section className="onboarding-body">
            <h1 className="onboarding-title">This is where you practise.</h1>
            <p className="onboarding-lead">
              Not where you learn. Bring whatever course you are following and this
              keeps the daily work in order, listens while you play, and shows you
              what is actually moving.
            </p>
            <p className="onboarding-lead">Which course are you on?</p>
            <div className="onboarding-choices">
              {TRACKS.map((code) => {
                const t = CURRICULUM.tracks.find((x) => x.code === code);
                if (!t) return null;
                return (
                  <button
                    key={code}
                    type="button"
                    className={clsx('onboarding-choice', track === code && 'is-on')}
                    onClick={() => {
                      setTrack(code);
                      setModule(null);
                      setStep('module');
                    }}
                  >
                    <span className="onboarding-choice-name">{t.title}</span>
                    <span className="onboarding-choice-note">
                      {t.modules.length} modules
                    </span>
                  </button>
                );
              })}
            </div>
            <button type="button" className="onboarding-skip" onClick={onDone}>
              I will set it up myself
            </button>
          </section>
        )}

        {step === 'module' && (
          <section className="onboarding-body">
            <h1 className="onboarding-title">How far have you got?</h1>
            <p className="onboarding-lead">
              Pick the module you are working through now. You can change it later.
            </p>
            <div className="onboarding-modules">
              {modules.map((m) => (
                <button
                  key={m.number}
                  type="button"
                  className={clsx('onboarding-module', module === m.number && 'is-on')}
                  onClick={() => {
                    setModule(m.number);
                    setStep('chords');
                  }}
                >
                  <span className="onboarding-module-number">{m.number}</span>
                  <span className="onboarding-module-name">{m.title ?? `Module ${m.number}`}</span>
                </button>
              ))}
            </div>
            <button type="button" className="onboarding-back" onClick={() => setStep('where')}>
              <ArrowLeftIcon size={16} /> Back
            </button>
          </section>
        )}

        {step === 'chords' && (
          <section className="onboarding-body">
            <h1 className="onboarding-title">Which of these can you already play?</h1>
            <p className="onboarding-lead">
              Only the ones you can put down without thinking. Nothing is lost by
              leaving one out: the first time a drill hears it, the app will know.
            </p>
            <div className="onboarding-chords">
              {KNOWN_CHORDS.map((chord) => {
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
                        prev.includes(chord) ? prev.filter((c) => c !== chord) : [...prev, chord],
                      )
                    }
                  >
                    <ChordDiagram chord={chord} size={64} showFingers={false} />
                    <span className="onboarding-chord-name">{chord}</span>
                    {isNew && <span className="onboarding-chord-tag">this module</span>}
                  </button>
                );
              })}
            </div>
            <div className="onboarding-actions">
              <button type="button" className="onboarding-back" onClick={() => setStep('module')}>
                <ArrowLeftIcon size={16} /> Back
              </button>
              <button type="button" className="onboarding-next" onClick={() => setStep('ready')}>
                Build my routine <ArrowRightIcon size={16} />
              </button>
            </div>
          </section>
        )}

        {step === 'ready' && routine && (
          <section className="onboarding-body">
            <h1 className="onboarding-title">Here is tomorrow morning.</h1>
            <p className="onboarding-lead">
              About {routineMinutes(routine)} minutes. Change anything you like; this
              is your routine now, not a template.
            </p>
            <ol className="onboarding-preview">
              {routine.tasks.map((t) => (
                <li key={t.id} className="onboarding-preview-item">
                  <span className="onboarding-preview-name">{t.title}</span>
                  <span className="onboarding-preview-note">{t.description}</span>
                </li>
              ))}
            </ol>
            <div className="onboarding-actions">
              <button type="button" className="onboarding-back" onClick={() => setStep('chords')}>
                <ArrowLeftIcon size={16} /> Back
              </button>
              <button type="button" className="onboarding-next is-primary" onClick={finish}>
                <CheckIcon size={16} /> Start practising
              </button>
            </div>
            <p className="onboarding-footnote">
              <PlectrumIcon size={14} /> The drills listen through your microphone.
              You will be asked the first time one starts.
            </p>
          </section>
        )}
      </div>
    </motion.div>,
    document.body,
  );
}
