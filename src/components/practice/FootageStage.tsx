import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CloseIcon, KeepIcon, SwapIcon, TrashIcon } from '../icons';
import { containFocus, pushOverlay } from '../overlayStack';
import { readRecording } from '../../media/storage';
import { formatMegabytes } from '../../media/quality';
import { endNote, formatDuration, gapLabel, viewName } from '../../media/library';
import type { Recording } from '../../media/types';

/** What the stage is doing with a clip's bytes. */
type Loaded =
  | { state: 'loading' }
  | { state: 'ready'; url: string }
  | { state: 'missing' };

function useClipUrl(recording: Recording | null): Loaded {
  // Stamped with the clip it belongs to rather than reset on every change.
  // Writing "loading" as the effect starts would be a synchronous setState in an
  // effect body and a second render for a state we can simply derive: a result
  // for a different clip than the one being asked about IS loading.
  const [resolved, setResolved] = useState<{ id: string; value: Loaded } | null>(null);

  useEffect(() => {
    if (!recording) return;
    let cancelled = false;
    let made: string | null = null;

    readRecording(recording.location)
      .then((blob) => {
        made = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(made);
          return;
        }
        setResolved({ id: recording.id, value: { state: 'ready', url: made } });
      })
      .catch(() => {
        if (!cancelled) setResolved({ id: recording.id, value: { state: 'missing' } });
      });

    // The object URL pins the whole clip in memory. Created and revoked in one
    // effect so there is no path where one happens without the other.
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [recording]);

  if (!recording) return { state: 'loading' };
  return resolved?.id === recording.id ? resolved.value : { state: 'loading' };
}

/**
 * MediaRecorder writes no duration into a container it is still streaming, so
 * the browser reports Infinity and the scrubber has nothing to work against.
 * Seeking past the end makes it walk the file and work the real length out.
 */
function primeDuration(video: HTMLVideoElement): void {
  if (video.duration !== Infinity) return;
  const onDurationChange = () => {
    if (video.duration === Infinity) return;
    video.removeEventListener('durationchange', onDurationChange);
    video.currentTime = 0;
  };
  video.addEventListener('durationchange', onDurationChange);
  video.currentTime = 1e101;
}

interface Props {
  clip: Recording;
  /** Earlier clips of the same angle, offered as something to hold this against. */
  earlier: Recording[];
  onClose: () => void;
  onStar: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * One clip, watched.
 *
 * The stage is where the interface is supposed to disappear: the footage runs at
 * the size the screen allows and everything else sits under it in small type.
 *
 * Its one real mechanic is the comparison. A technique clip can be held against
 * an earlier take of the same angle, and both scrub from a single control, which
 * is the only way to actually see a hand change: two players with two scrubbers
 * is two videos, and the difference lives in the same bar of the same exercise.
 * The pairing is restricted to matching angles on purpose, because two different
 * camera positions differ for reasons that have nothing to do with the playing.
 */
export function FootageStage({ clip, earlier, onClose, onStar, onDelete }: Props) {
  const [against, setAgainst] = useState<Recording | null>(null);
  const [confirming, setConfirming] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // The stage opens on top of the panel that launched it, so Escape and Tab
  // belong to it and not to the surface underneath. Without this the key closed
  // the whole footage screen and lost the reader's place on the spine, which is
  // the exact nested-overlay trap this app has already paid for once.
  useEffect(() => {
    const claim = pushOverlay();
    // Written straight to the node rather than held in state, the same way
    // Modal does it: the layer is a fact about what was already open when this
    // opened, so it never needs to cause a render.
    if (wrapRef.current) wrapRef.current.style.zIndex = String(claim.layer);

    const onKey = (event: KeyboardEvent) => {
      if (!claim.isTop()) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === 'Tab' && panelRef.current) containFocus(panelRef.current, event);
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      claim.release();
    };
  }, [onClose]);

  const main = useClipUrl(clip);
  const other = useClipUrl(against);

  const mainRef = useRef<HTMLVideoElement>(null);
  const otherRef = useRef<HTMLVideoElement>(null);

  const bothPlaying = useRef(false);

  // One control drives both. The comparison is worthless if the two takes are a
  // second apart, so the second video is slaved to the first rather than given
  // its own controls.
  const sync = useCallback(() => {
    const lead = mainRef.current;
    const follow = otherRef.current;
    if (!lead || !follow) return;
    if (Math.abs(follow.currentTime - lead.currentTime) > 0.12) {
      follow.currentTime = lead.currentTime;
    }
    if (!lead.paused && follow.paused) void follow.play().catch(() => {});
    if (lead.paused && !follow.paused) follow.pause();
    bothPlaying.current = !lead.paused;
  }, []);

  useEffect(() => {
    if (!against) return;
    const follow = otherRef.current;
    return () => {
      if (follow && !follow.paused) follow.pause();
    };
  }, [against]);

  const note = endNote(clip.endedBy);
  const canCompare = earlier.length > 0;

  return (
    <div
      ref={wrapRef}
      className="stage-wrap"
      // Clicking the ground behind the clip puts it away, the way stepping back
      // from something you are watching does.
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
    <motion.div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={clip.view ? viewName(clip.view) : clip.label}
      tabIndex={-1}
      className={against ? 'stage is-paired' : 'stage'}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="stage-screens">
        {against && (
          <figure className="stage-screen is-past">
            <figcaption className="stage-stamp">
              {new Date(against.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            </figcaption>
            {other.state === 'ready' ? (
              <video
                ref={otherRef}
                className="stage-video"
                src={other.url}
                playsInline
                muted
                preload="metadata"
                onLoadedMetadata={(e) => primeDuration(e.currentTarget)}
              />
            ) : (
              <p className={other.state === 'loading' ? 'stage-note' : 'stage-note is-gone'}>
                {other.state === 'loading' ? 'Opening…' : 'That footage is no longer on this machine.'}
              </p>
            )}
          </figure>
        )}

        <figure className="stage-screen">
          {against && (
            <figcaption className="stage-stamp is-now">
              {new Date(clip.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            </figcaption>
          )}
          {main.state === 'ready' ? (
            <video
              ref={mainRef}
              className="stage-video"
              src={main.url}
              controls
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => primeDuration(e.currentTarget)}
              onTimeUpdate={against ? sync : undefined}
              onPlay={against ? sync : undefined}
              onPause={against ? sync : undefined}
              onSeeked={against ? sync : undefined}
            />
          ) : (
            // Waiting and gone are different facts and get different marks, so
            // neither the reader nor a test can mistake one for the other.
            <p className={main.state === 'loading' ? 'stage-note' : 'stage-note is-gone'}>
              {main.state === 'loading'
                ? 'Opening…'
                : 'The video file is gone, though this entry survived. Clearing browser storage does that.'}
            </p>
          )}
        </figure>
      </div>

      {against && (
        <p className="stage-gap">
          {gapLabel(against.startedAt, clip.startedAt)}, same angle, one scrubber
        </p>
      )}

      <div className="stage-foot">
        <div className="stage-facts">
          <h3 className="stage-title">{clip.view ? viewName(clip.view) : clip.label}</h3>
          <p className="stage-meta">
            {new Date(clip.startedAt).toLocaleDateString(undefined, {
              weekday: 'long', day: 'numeric', month: 'long',
            })}
            <span className="stage-dot" aria-hidden="true" />
            {formatDuration(clip.durationMs)}
            <span className="stage-dot" aria-hidden="true" />
            {formatMegabytes(clip.bytes)}
            {!clip.hasAudio && (
              <>
                <span className="stage-dot" aria-hidden="true" />
                no sound
              </>
            )}
          </p>
          {note && <p className="stage-cut">{note}</p>}
        </div>

        <div className="stage-acts">
          {canCompare && (
            <button
              className={against ? 'stage-act is-on' : 'stage-act'}
              onClick={() => setAgainst(against ? null : earlier[0])}
            >
              <SwapIcon size={16} />
              {against ? 'On its own' : 'Hold against earlier'}
            </button>
          )}
          <button
            className={clip.starred ? 'stage-act is-kept' : 'stage-act'}
            onClick={() => onStar(clip.id)}
            aria-pressed={clip.starred}
          >
            <KeepIcon size={16} />
            {clip.starred ? 'Kept' : 'Keep'}
          </button>
          <button className="stage-act is-danger" onClick={() => setConfirming(true)}>
            <TrashIcon size={16} />
            Delete
          </button>
          <button className="stage-act" onClick={onClose} aria-label="Close this clip">
            <CloseIcon size={16} />
          </button>
        </div>
      </div>

      {against && earlier.length > 1 && (
        <div className="stage-picker">
          {earlier.map((r) => (
            <button
              key={r.id}
              className={r.id === against.id ? 'stage-pick is-on' : 'stage-pick'}
              onClick={() => setAgainst(r)}
            >
              {new Date(r.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            </button>
          ))}
        </div>
      )}

      {confirming && (
        <div className="stage-confirm">
          <span>Delete this take for good?</span>
          <div className="stage-confirm-acts">
            <button className="stage-confirm-no" onClick={() => setConfirming(false)}>Keep it</button>
            <button className="stage-confirm-yes" onClick={() => onDelete(clip.id)}>Delete</button>
          </div>
        </div>
      )}
    </motion.div>
    </div>
  );
}
