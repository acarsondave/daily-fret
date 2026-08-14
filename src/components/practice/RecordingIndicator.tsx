import { RecordIcon } from '../icons';
import { recoveryFor, type RecordingError } from '../../media/failure';
import './recording.css';

/**
 * The one thing this feature owes the person in front of the camera.
 *
 * It has a hard job. Honest means unmissable: nobody may ever discover after
 * the fact that they were filmed. Kind means calm: a flashing red badge in your
 * eyeline while you are trying to hold an F chord makes you play worse, and an
 * app that makes you self-conscious about being watched has defeated the point
 * of watching.
 *
 * So it is two marks with different jobs. A hairline frame around the whole
 * viewport, breathing slowly, sits entirely in peripheral vision: it is
 * impossible to be in this room and not know the camera is on, and it never
 * occupies the part of the screen the eye is using. And a small pill in the top
 * bar carries the facts, elapsed time included, for when you actually want to
 * know. Neither of them moves quickly, because nothing here is urgent; it is
 * simply true.
 */

interface Props {
  rolling: boolean;
  elapsedMs: number;
  failure: RecordingError | null;
  onDismissFailure: () => void;
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function RecordingIndicator({ rolling, elapsedMs, failure, onDismissFailure }: Props) {
  if (!rolling && !failure) return null;

  return (
    <>
      {rolling && (
        <>
          <span className="capture-frame" aria-hidden="true" />
          <span className="capture-pill">
            <RecordIcon size={14} className="capture-pill-mark" />
            {/* The word is what makes the mark unambiguous; the clock is what
                makes it useful. On a phone the word goes and the clock stays,
                because a red dot beside a running timer has never meant
                anything else. */}
            <span className="capture-pill-word">Recording</span>
            <span className="capture-pill-clock">{clock(elapsedMs)}</span>
          </span>
        </>
      )}

      {/* Announced once when it starts, not once a second. The clock above is
          deliberately outside this. */}
      <span className="sr-only" role="status">
        {rolling ? 'The camera is recording this drill.' : ''}
      </span>

      {failure && (
        <div className="capture-notice" role="alert">
          <div className="capture-notice-text">
            <p className="capture-notice-head">{failure.message}</p>
            {/* The drill is the product. Saying so here is not reassurance, it
                is the fact that stops someone abandoning a session over a
                camera. */}
            <p className="capture-notice-help">
              {recoveryFor(failure.kind)} Your practice is still being counted.
            </p>
          </div>
          <button type="button" className="capture-notice-dismiss" onClick={onDismissFailure}>
            Got it
          </button>
        </div>
      )}
    </>
  );
}
