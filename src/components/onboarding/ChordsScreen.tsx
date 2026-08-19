import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ArrowRightIcon } from '../icons';
import { ChordDiagram } from '../practice/ChordDiagram';
import { useChordDetector } from '../../hooks/useChordDetector';
import { useLearnedTemplates } from '../../hooks/useLearnedTemplates';
import { useCapoOffset } from '../../hooks/useCapo';
import { NO_CHORD } from '../../audio/detector';
import { DETECTABLE_CHORDS } from '../../audio/chords';
import { BEGINNER_MODULES, moduleForChords } from './course';
import { buildFirstRunPlan } from './buildPlan';
import type { FirstRunPlan } from './plan';

/**
 * Two. The chords you have.
 *
 * The old version of this screen was a self-report grid: nine checkboxes, ticked
 * on your behalf from a module you had just been asked to pick, with a sentence
 * telling you to untick anything that was not solid. Two of those things are the
 * app asking a player to do work it can do itself.
 *
 * So the detector is already running when this screen opens. Play A and the A
 * card lights, its dots filling in as if a hand were putting them down. Tapping
 * still works, because someone might be reading this on a train, but tapping is
 * the fallback rather than the interface.
 *
 * Nothing here is a question. The module is derived from whatever ends up lit
 * (moduleForChords is the exact inverse of chordsTaughtBy) and stated as a fact
 * that can be corrected, rather than asked as a question whose answer the app
 * already holds. This is also where the curriculum is finally fetched: 68.5 kB
 * gzipped of course data, bought after the microphone has proved itself and not
 * before.
 */

interface Props {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  micLive: boolean;
  known: string[];
  // An updater rather than a value: the detector's callback lives outside
  // render and cannot read a fresh `known` from a closure, and a ref read
  // during render to bridge that is exactly the pattern React's compiler
  // rules exist to stop.
  onKnownChange: (update: (previous: string[]) => string[]) => void;
  /** Called once the summary is worth fetching, which is the moment this opens. */
  onReady: () => void;
  onNext: (plan: FirstRunPlan) => void;
}

export function ChordsScreen({ headingRef, micLive, known, onKnownChange, onReady, onNext }: Props) {
  const detector = useChordDetector();
  const templates = useLearnedTemplates();
  const capo = useCapoOffset();

  // The module the app worked out, and the player's correction to it if they
  // disagree. Held apart so a correction survives lighting another chord.
  const [override, setOverride] = useState<number | null>(null);
  const [correcting, setCorrecting] = useState(false);
  // The card that lit most recently through the microphone, so the app can say
  // it heard that one rather than leaving it identical to a tap.
  const [heard, setHeard] = useState<string | null>(null);

  const light = useCallback(
    (chord: string) => {
      setHeard((previous) => (previous === chord ? previous : chord));
      onKnownChange((previous) => (previous.includes(chord) ? previous : [...previous, chord]));
    },
    [onKnownChange],
  );

  // Open mode, not restricted to anything: the point of this screen is that the
  // app names what it hears, and a restricted matcher can only ever agree with
  // a list the player has already given it.
  useEffect(() => {
    void detector.start(
      {
        onChord: (ev) => {
          if (ev.chord !== NO_CHORD) light(ev.chord);
        },
      },
      { templates, offset: capo },
    );
    // The summary screen draws chord diagrams, so it costs an engraver and the
    // shape table. Bought here rather than on the tap that shows it: this screen
    // is where someone stands still for a while, and the next one has to land
    // the moment they press Next.
    onReady();
    return () => {
      void detector.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const derived = useMemo(() => moduleForChords(known), [known]);
  // A module the app can stand behind: one the player corrected it to, or one
  // the course actually introduces a chord of. Holding two shapes the course
  // does not teach says nothing about where in it you are standing, and naming
  // a module anyway would be the guess this screen exists to stop making.
  const stated = override ?? (derived?.fromChords ? derived.number : null);
  // With nothing at all to go on, the start of the course is the only honest
  // place to build from, and the routine's own description says as much.
  const moduleNumber = stated ?? (known.length === 0 ? derived?.number ?? null : null);
  const named = useMemo(
    () => (stated === null ? null : BEGINNER_MODULES.find((m) => m.number === stated)),
    [stated],
  );

  const toggle = (chord: string) => {
    onKnownChange((previous) =>
      previous.includes(chord) ? previous.filter((c) => c !== chord) : [...previous, chord],
    );
  };

  const go = async () => {
    await detector.stop();
    onNext(
      buildFirstRunPlan({
        track: derived?.track ?? null,
        module: moduleNumber,
        knownChords: known,
        lessonCode: named?.firstLessonCode ?? null,
      }),
    );
  };

  return (
    <>
      <h1 className="onboarding-title" ref={headingRef} tabIndex={-1}>
        Play the chords you know.
      </h1>

      <div className="onboarding-chords">
        {DETECTABLE_CHORDS.map((chord) => {
          const on = known.includes(chord);
          return (
            <button
              key={chord}
              type="button"
              aria-pressed={on}
              aria-label={`${chord}${on ? ', you have this one' : ''}`}
              className={clsx(
                'onboarding-chord',
                on && 'is-on',
                on && heard === chord && 'is-heard',
              )}
              onClick={() => toggle(chord)}
            >
              <ChordDiagram chord={chord} size={60} showFingers={false} />
              <span className="onboarding-chord-name">{chord}</span>
            </button>
          );
        })}
      </div>

      {/* Stated, not asked. It appears only once there is something to derive it
          from, so nobody is told where they are before they have said anything. */}
      {named && (
        <div className="onboarding-derived">
          <p className="onboarding-lead is-quiet" role="status">
            {/* The title goes in brackets, as it does everywhere else in the
                app: course titles carry their own punctuation ("Air Changes,
                Dynamics & Consolidation!") and one dropped into the middle of
                a sentence unbracketed reads as a typo. */}
            Around module {named.number} ({named.title}).{' '}
            <button
              type="button"
              className="onboarding-inline-btn"
              aria-expanded={correcting}
              onClick={() => setCorrecting((c) => !c)}
            >
              {correcting ? 'Close' : 'Not there'}
            </button>
          </p>
          {correcting && (
            <div className="onboarding-modules">
              {BEGINNER_MODULES.map((m) => (
                <button
                  key={m.number}
                  type="button"
                  className={clsx('onboarding-module', m.number === stated && 'is-on')}
                  aria-pressed={m.number === stated}
                  onClick={() => {
                    setOverride(m.number);
                    setCorrecting(false);
                  }}
                >
                  <span className="onboarding-module-number">{m.number}</span>
                  <span className="onboarding-module-name">{m.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Correcting is a disclosure, not a question: it does not exist until
          the player disagrees, and it is never on the path forward. */}
      {!named && known.length > 0 && (
        <p className="onboarding-lead is-quiet" role="status">
          None of those are shapes the course introduces, so this is built from the {known.length}{' '}
          you have.
        </p>
      )}

      <div className="onboarding-actions is-end">
        {!micLive && known.length === 0 && (
          <p className="onboarding-footnote">Tap the ones you can play, or carry on without any.</p>
        )}
        <button type="button" className="onboarding-next is-primary" onClick={() => void go()}>
          Next <ArrowRightIcon size={16} />
        </button>
      </div>
    </>
  );
}
