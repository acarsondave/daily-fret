import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CameraIcon, FramingIcon, KeepIcon, TrashIcon } from '../icons';
import { useRecordingStore, forgetRecording } from '../../media/recordingStore';
import { readRecording } from '../../media/storage';
import { formatMegabytes } from '../../media/quality';
import { buildLibrary, endNote, formatDuration, viewName } from '../../media/library';
import type { Recording } from '../../media/types';
import { EmptyState } from './EmptyState';
import './recordingLibrary.css';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const when = new Date(y, m - 1, d);
  return `${DAY_NAMES[when.getDay()]} ${d} ${MONTHS[m - 1]}`;
}

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** What the player is doing with the bytes of the clip it is showing. */
type Playing =
  | { state: 'loading'; id: string }
  | { state: 'ready'; id: string; url: string }
  | { state: 'missing'; id: string; why: string };

/**
 * Watch back what you filmed.
 *
 * The app cannot see the player's hands, so the recordings are the closest
 * thing to a teacher looking at them, and this is where that actually happens.
 * It is deliberately not a file manager: the unit is a sitting rather than a
 * file, technique checks are kept apart from ordinary practice because
 * comparing one against another months later is their whole point, and a clip
 * that was cut short says so rather than presenting itself as a complete take.
 */
export function RecordingLibrary() {
  const recordings = useRecordingStore((s) => s.recordings);
  const toggleStar = useRecordingStore((s) => s.toggleStar);
  const library = useMemo(() => buildLibrary(recordings), [recordings]);

  const [playing, setPlaying] = useState<Playing | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  // The object URL holds the whole clip in memory for as long as it exists, and
  // a two hundred megabyte leak per row clicked is not an abstraction. It is
  // revoked when the selection changes and when this unmounts, and the effect
  // owns creation and revocation together so neither can happen without the
  // other.
  useEffect(() => {
    if (!playing || playing.state !== 'ready') return;
    const { url } = playing;
    return () => URL.revokeObjectURL(url);
  }, [playing]);

  const open = useCallback(async (recording: Recording) => {
    setConfirmingDelete(null);
    setPlaying({ state: 'loading', id: recording.id });
    try {
      const blob = await readRecording(recording.location);
      setPlaying({ state: 'ready', id: recording.id, url: URL.createObjectURL(blob) });
    } catch {
      // The index lives in localStorage and the footage lives in the origin's
      // private file system. Clearing site data can take one and leave the
      // other, so a row with no bytes behind it is a real state and not a bug
      // to hide: it says so, and offers the only thing left to do about it.
      setPlaying({
        state: 'missing',
        id: recording.id,
        why: 'The video file is gone, though this entry survived. Clearing browser storage does this.',
      });
    }
  }, []);

  // MediaRecorder writes its container as it goes, so it cannot put a duration
  // in the header of a file whose end it has not reached. The browser then
  // reports `Infinity`, and the scrubber on the native controls has no length to
  // work against: the clip plays from the start and cannot be moved through.
  //
  // For a review library that is close to fatal, because reviewing technique is
  // almost entirely scrubbing to the bar where the change goes wrong.
  //
  // Seeking past the end forces the browser to walk the file and work the real
  // duration out, after which it announces it and we return to the start. It
  // runs the moment the metadata lands, before the player can have touched
  // anything, and does nothing at all for a container that knew its own length.
  const primeDuration = useCallback((video: HTMLVideoElement) => {
    if (video.duration !== Infinity) return;
    const onDurationChange = () => {
      if (video.duration === Infinity) return;
      video.removeEventListener('durationchange', onDurationChange);
      video.currentTime = 0;
    };
    video.addEventListener('durationchange', onDurationChange);
    video.currentTime = 1e101;
  }, []);

  const remove = useCallback(async (id: string) => {
    setConfirmingDelete(null);
    setPlaying((current) => (current?.id === id ? null : current));
    await forgetRecording(id);
  }, []);

  if (recordings.length === 0) {
    return (
      <EmptyState
        icon={<CameraIcon size={26} />}
        title="No footage yet"
        body="Practice sessions you film land here, alongside the day you played them."
      />
    );
  }

  const renderClip = (clip: Recording, index: number) => {
    const isOpen = playing?.id === clip.id;
    const note = endNote(clip.endedBy);
    return (
      <li key={clip.id} className={isOpen ? 'reclib-clip is-open' : 'reclib-clip'}>
        <div className="reclib-clip-row">
          <button
            className="reclib-clip-open"
            onClick={() => (isOpen ? setPlaying(null) : open(clip))}
            aria-expanded={isOpen}
          >
            <span className="reclib-clip-name">
              {clip.view ? viewName(clip.view) : `Take ${index + 1}`}
            </span>
            <span className="reclib-clip-meta">
              {formatDuration(clip.durationMs)}
              <span className="reclib-dot" aria-hidden="true" />
              {formatMegabytes(clip.bytes)}
              {!clip.hasAudio && (
                <>
                  <span className="reclib-dot" aria-hidden="true" />
                  no sound
                </>
              )}
            </span>
          </button>

          <button
            className={clip.starred ? 'reclib-act is-on' : 'reclib-act'}
            onClick={() => toggleStar(clip.id)}
            aria-pressed={clip.starred}
            title={clip.starred ? 'Kept: never deleted to make room' : 'Keep this one'}
          >
            <KeepIcon size={16} />
          </button>

          <button
            className="reclib-act is-danger"
            onClick={() => setConfirmingDelete(confirmingDelete === clip.id ? null : clip.id)}
            title="Delete this take"
          >
            <TrashIcon size={16} />
          </button>
        </div>

        {note && <p className="reclib-cut">{note}</p>}

        {confirmingDelete === clip.id && (
          <div className="reclib-confirm">
            <span>Delete this take for good?</span>
            <div className="reclib-confirm-acts">
              <button className="reclib-confirm-no" onClick={() => setConfirmingDelete(null)}>
                Keep it
              </button>
              <button className="reclib-confirm-yes" onClick={() => remove(clip.id)}>
                Delete
              </button>
            </div>
          </div>
        )}

        {isOpen && playing.state === 'loading' && (
          <p className="reclib-status">Opening…</p>
        )}
        {isOpen && playing.state === 'missing' && (
          <p className="reclib-status is-warn">{playing.why}</p>
        )}
        {isOpen && playing.state === 'ready' && (
          <motion.div
            className="reclib-player"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            <video
              className="reclib-video"
              src={playing.url}
              controls
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => primeDuration(e.currentTarget)}
            />
          </motion.div>
        )}
      </li>
    );
  };

  const renderSitting = (
    session: (typeof library.days)[number]['sessions'][number],
    heading: string,
  ) => (
    <li key={session.sessionId} className="reclib-sitting">
      <div className="reclib-sitting-head">
        <h4 className="reclib-sitting-title">{heading}</h4>
        <span className="reclib-sitting-meta">
          {formatDuration(session.totalMs)}
          <span className="reclib-dot" aria-hidden="true" />
          {formatMegabytes(session.totalBytes)}
        </span>
      </div>
      <ul className="reclib-clips">{session.clips.map(renderClip)}</ul>
    </li>
  );

  return (
    <div className="reclib">
      {library.checks.length > 0 && (
        <section className="reclib-section">
          <div className="reclib-section-head">
            <FramingIcon size={18} className="reclib-section-icon" />
            <h3 className="reclib-section-title">Technique checks</h3>
          </div>
          {/* Kept apart and kept forever. Watching one of these against the same
              angles from months ago is the only way this app can show a player
              their own hands changing. */}
          <p className="reclib-section-note">
            Three angles, filmed on purpose. These are never deleted to make room.
          </p>
          <ul className="reclib-sittings">
            {library.checks.map((s) =>
              renderSitting(s, `${longDate(s.date)}, ${clockTime(s.startedAt)}`),
            )}
          </ul>
        </section>
      )}

      {library.days.length > 0 && (
        <section className="reclib-section">
          <div className="reclib-section-head">
            <CameraIcon size={18} className="reclib-section-icon" />
            <h3 className="reclib-section-title">Practice</h3>
          </div>
          <ul className="reclib-days">
            {library.days.map((day) => (
              <li key={day.date} className="reclib-day">
                <div className="reclib-day-head">
                  <h4 className="reclib-day-title">{longDate(day.date)}</h4>
                  <span className="reclib-day-meta">
                    {formatDuration(day.totalMs)}
                    <span className="reclib-dot" aria-hidden="true" />
                    {formatMegabytes(day.totalBytes)}
                  </span>
                </div>
                <ul className="reclib-sittings">
                  {day.sessions.map((s) => renderSitting(s, s.label))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
