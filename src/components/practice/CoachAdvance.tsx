import { RetryIcon, SkipIcon } from '../icons';

/**
 * The hand-off at the end of a coached drill.
 *
 * It used to be the countdown alone, and a countdown alone is a session with no
 * steering. A run the microphone ruined could not be retaken and a drill going
 * badly could not be dropped, so the only retry the app offered was quitting the
 * session and resuming it: the owner's diagnostics hold one day with four
 * separate starts of the same drill inside seven minutes, across four microphone
 * sessions of 257, 21.9, 10.2 and 983 seconds.
 *
 * The countdown keeps the accent, because it is the thing that is live and the
 * session moving on by itself is still what normally happens. Again and Skip sit
 * either side of it at the weight of ways out, which is what they are.
 */
interface Props {
  /** What the session is moving toward, e.g. "Rest" or "Finishing". */
  nextLabel: string;
  /** Seconds until it moves there on its own. */
  advanceLeft: number;
  /** Run this segment again. Absent outside a coached session. */
  onAgain?: () => void;
  /** Move on, recording nothing for this segment. Absent outside a coached session. */
  onSkip?: () => void;
}

export function CoachAdvance({ nextLabel, advanceLeft, onAgain, onSkip }: Props) {
  return (
    <div className="coach-handoff">
      {onAgain && (
        <button
          className="coach-handoff-act"
          onClick={onAgain}
          aria-label="Run this drill again and keep the better result"
        >
          <RetryIcon size={17} />
          Again
        </button>
      )}
      <div className="coach-advance">
        <span className="coach-advance-label">{nextLabel} in</span>
        <span className="coach-advance-count">{advanceLeft}</span>
      </div>
      {onSkip && (
        <button
          className="coach-handoff-act"
          onClick={onSkip}
          aria-label="Move on without recording this drill"
        >
          <SkipIcon size={17} />
          Skip
        </button>
      )}
    </div>
  );
}
