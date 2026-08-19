import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import clsx from 'clsx';
import { ArrowRightIcon, MicIcon } from '../icons';
import { Headstock } from '../practice/Headstock';
import { usePitchDetector } from '../../hooks/usePitchDetector';
import { DEFAULT_TUNING_ID, getTuning, nearestString, readPitch } from '../../audio/tuning';

/**
 * One. The note.
 *
 * The proof the whole product rests on, done rather than described: play a
 * string, and the string lights on the headstock while the letter is drawn at
 * the size of the only thing on screen. The wizard this replaced spent five
 * screens talking about the microphone before opening it once, and then
 * reported the result as a line of text reading "Heard G. That is the
 * microphone working."
 */

/** Marks that unlock the way on. Three is two more than a coincidence. */
const MARKS_NEEDED = 3;
/** How long a live microphone waits before offering a way past it. */
const PATIENCE_MS = 12000;

export function NoteScreen({
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
