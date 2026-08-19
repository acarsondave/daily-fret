// What a drill does when the microphone is not available.
//
// This used to be a dead end. Every measured drill rendered a mic icon, the
// browser's error string and a "Try again" button, and that was the entire
// screen: a player who had denied the microphone at the browser level, or who
// is on a machine with no input at all, could press Try again forever and never
// run the drill. Their generated routine was three-quarters unrunnable, and
// onboarding told them in as many words that "the drills still run, on a timer,
// and nothing is counted", which was not true of any of them.
//
// So the timer is real now. It is the honest degraded mode the app already
// claimed to have: the clock runs, the cues change, the block is recorded as
// time spent, and nothing is written to drillResults because nothing was heard.
// The gate says both halves of that before the player chooses.

import { HourglassIcon, MicIcon, RetryIcon } from '../icons';
import { CoachAdvance } from './CoachAdvance';

interface Props {
  /** The browser's own reason, which can be as terse as "Not supported". */
  error: string | null;
  onRetry: () => void;
  onTimer: () => void;
}

export function MicGate({ error, onRetry, onTimer }: Props) {
  return (
    <div className="mic-gate">
      <MicIcon size={40} color="var(--text-secondary)" />
      <p className="mic-gate-reason">{error ?? 'The microphone did not open.'}</p>
      {/* What the way out costs used to be a sentence above the buttons, saying
          in fourteen words what the second button's own label says in five and
          what the drill then repeats on screen for its whole length. The choice
          is between two named actions, so the two named actions are the whole
          of it. */}
      <div className="mic-gate-actions">
        <button className="practice-btn primary" onClick={onRetry}>
          <RetryIcon size={18} /> Try again
        </button>
        <button className="practice-btn ghost" onClick={onTimer}>
          <HourglassIcon size={18} /> Run it on a timer
        </button>
      </div>
    </div>
  );
}

/**
 * What a timer-only run leaves behind.
 *
 * Deliberately not the results card. That card exists to compare a number with
 * the numbers before it, and there is no number here; dressing a zero up in a
 * progress ring would be the app reporting a measurement it never made.
 */
export function TimerRunEnded({
  autoAdvance,
  advanceLeft,
  nextLabel,
  onNext,
  onClose,
  onAgain,
  onSkip,
}: {
  autoAdvance: boolean;
  advanceLeft: number;
  nextLabel: string;
  onNext?: () => void;
  onClose?: () => void;
  // Coached steering. Again matters most here of anywhere: this screen is what a
  // run the microphone could not open leaves behind, and the microphone may well
  // be back by the time it is read.
  onAgain?: () => void;
  onSkip?: () => void;
}) {
  return (
    <div className="mic-gate">
      <HourglassIcon size={40} color="var(--text-secondary)" />
      {/* Two sentences said the same thing twice: the block ran, and no number
          came of it. The absence of a results ring is already the second half,
          on a surface where every other ending has one. */}
      <p className="mic-gate-reason">Time played. Nothing counted.</p>
      {autoAdvance && onNext ? (
        <CoachAdvance
          nextLabel={nextLabel}
          advanceLeft={advanceLeft}
          onAgain={onAgain}
          onSkip={onSkip}
        />
      ) : (
        <div className="mic-gate-actions">
          <button className="practice-btn ghost" onClick={() => onClose?.()}>
            {onNext ? 'End session' : 'Done'}
          </button>
          {onNext && (
            <button className="practice-btn primary" onClick={onNext} autoFocus>
              Next drill
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Sits under a drill that is running blind, so the screen never implies a count. */
export function UncountedNotice() {
  return (
    <p className="drill-uncounted" role="status">
      <HourglassIcon size={15} /> Nothing is being counted
    </p>
  );
}
