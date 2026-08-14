import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { CameraIcon, KeepIcon, MinusIcon, PlusIcon, StorageIcon, TrashIcon } from '../icons';
import { camerasAreNamed, listCameras, openCameraPreview, type CameraInput } from '../../media/cameraDevice';
import { RecordingError, recoveryFor } from '../../media/failure';
import {
  BYTES_PER_MB,
  QUALITY_PRESETS,
  chooseMimeType,
  formatMegabytes,
  megabytesPerMinute,
  presetFor,
} from '../../media/quality';
import {
  MAX_KEEP_SESSIONS,
  MIN_KEEP_SESSIONS,
  sessionCount,
  totalBytes,
} from '../../media/retention';
import {
  forgetAllRecordings,
  forgetRecording,
  useRecordingStore,
} from '../../media/recordingStore';
import { storageRoom, type StorageRoom } from '../../media/storage';
import type { Recording } from '../../media/types';

/**
 * Practice video, as a thing the user decides about.
 *
 * The order of this pane is the order of the decisions. Whether to record at
 * all comes first and is a real gate: turning it on opens the camera there and
 * then, so consent and the permission prompt are the same moment and nothing
 * can end up "enabled" while the browser is quietly refusing. Then which
 * camera, seen rather than named. Then what it costs, in megabytes a minute,
 * because that is the number the owner is actually spending. Then how much is
 * on the disk right now, then how to get rid of all of it.
 *
 * Nothing here is reassuring in the abstract. Every claim it makes is a number
 * read back off the recordings themselves.
 */
export function RecordingSetting() {
  const settings = useRecordingStore((s) => s.settings);
  const recordings = useRecordingStore((s) => s.recordings);
  const lastPrune = useRecordingStore((s) => s.lastPrune);
  const setEnabled = useRecordingStore((s) => s.setEnabled);
  const setQuality = useRecordingStore((s) => s.setQuality);
  const setKeepSessions = useRecordingStore((s) => s.setKeepSessions);
  const setCameraId = useRecordingStore((s) => s.setCameraId);
  const toggleStar = useRecordingStore((s) => s.toggleStar);
  const acknowledgePrune = useRecordingStore((s) => s.acknowledgePrune);

  const [cameras, setCameras] = useState<CameraInput[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<RecordingError | null>(null);
  const [room, setRoom] = useState<StorageRoom | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Whether this browser could record at all, asked once. A picker, a quality
  // chooser and a storage meter for a browser that will not write a video file
  // is an interface promising something it cannot do.
  const [supported] = useState(
    () => chooseMimeType() !== null && typeof navigator.mediaDevices?.getUserMedia === 'function',
  );

  const used = useMemo(() => totalBytes(recordings), [recordings]);
  const sessions = useMemo(() => sessionCount(recordings), [recordings]);
  const techniqueClips = useMemo(
    () => recordings.filter((r) => r.kind === 'technique-check'),
    [recordings],
  );

  const refreshCameras = useCallback(() => {
    void listCameras().then(setCameras);
  }, []);

  useEffect(() => {
    refreshCameras();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshCameras);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshCameras);
  }, [refreshCameras]);

  useEffect(() => {
    void storageRoom().then(setRoom);
  }, [recordings]);

  const closePreview = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  // The camera is never left open behind a closed settings pane.
  useEffect(() => closePreview, [closePreview]);

  useEffect(() => {
    streamRef.current = stream;
    const video = videoRef.current;
    if (video && video.srcObject !== stream) video.srcObject = stream;
  }, [stream]);

  const openPreview = useCallback(
    async (deviceId: string | null): Promise<boolean> => {
      setOpening(true);
      setError(null);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStream(null);
      try {
        const preset = presetFor(settings.quality);
        const live = await openCameraPreview(deviceId, preset.width, preset.height);
        setStream(live);
        // Device labels only exist once permission has been granted, so this is
        // the moment the picker stops saying "Camera 1".
        refreshCameras();
        return true;
      } catch (err) {
        setError(
          err instanceof RecordingError
            ? err
            : new RecordingError('failed', 'The camera could not be opened.'),
        );
        return false;
      } finally {
        setOpening(false);
      }
    },
    [refreshCameras, settings.quality],
  );

  // Turning it on is the consent moment and the permission prompt at once. It
  // only sticks if a camera actually opened.
  const turnOn = async () => {
    if (await openPreview(settings.cameraId)) setEnabled(true);
  };

  const turnOff = () => {
    closePreview();
    setEnabled(false);
    setConfirmingDelete(false);
  };

  const chooseCamera = (deviceId: string) => {
    const next = deviceId || null;
    setCameraId(next);
    if (stream) void openPreview(next);
  };

  const deleteAll = async () => {
    setDeleting(true);
    try {
      await forgetAllRecordings();
      setConfirmingDelete(false);
    } catch (err) {
      setError(
        err instanceof RecordingError ? err : new RecordingError('storage', 'Some recordings could not be deleted.'),
      );
    } finally {
      setDeleting(false);
    }
  };

  const mbPerMinute = megabytesPerMinute(settings.quality);
  const named = camerasAreNamed(cameras);

  return (
    <div className="setting-block">
      <h3 className="setting-head" id="recording-setting-label">
        <CameraIcon size={18} className="setting-head-icon" />
        <span>Practice video</span>
      </h3>

      {!supported ? (
        <p className="setting-note">
          This browser will not record video the app can save, so recording is unavailable here.
          Everything else works as normal. Chrome, Firefox or Safari on a laptop will do it.
        </p>
      ) : !settings.enabled ? (
        <>
          <p className="setting-note">
            Nobody can watch your hands but you. Turn this on and the app films each drill while it
            runs, so there is footage to look back at without setting a camera up every day.
          </p>
          <p className="setting-note">
            It is off until you turn it on. Recordings stay on this device, are never uploaded, and
            you can delete them all in one tap. While the camera is rolling the screen says so.
          </p>
          <button type="button" className="settings-action-btn" onClick={() => void turnOn()} disabled={opening}>
            <CameraIcon size={18} />
            <span>{opening ? 'Opening the camera…' : 'Record my practice'}</span>
          </button>
          {error && <CameraProblem error={error} />}
        </>
      ) : (
        <>
          <p className="setting-note">
            The app films each drill while it runs. Everything stays on this device.
          </p>

          {/* --- The shot ------------------------------------------------- */}
          <div className="rec-preview">
            {stream ? (
              <video ref={videoRef} className="rec-preview-video" autoPlay playsInline muted />
            ) : (
              <button
                type="button"
                className="rec-preview-open"
                onClick={() => void openPreview(settings.cameraId)}
                disabled={opening}
              >
                <CameraIcon size={22} />
                <span>{opening ? 'Opening the camera…' : 'Show me the shot'}</span>
                <span className="rec-preview-hint">
                  The camera only opens while you are looking at it.
                </span>
              </button>
            )}
          </div>
          {stream && (
            <button type="button" className="settings-action-btn is-quiet" onClick={closePreview}>
              <span>Close the camera</span>
            </button>
          )}
          {error && <CameraProblem error={error} />}

          <label className="rec-field">
            <span className="rec-field-label">Camera</span>
            <select
              className="mic-setting-select"
              value={cameras.some((c) => c.deviceId === settings.cameraId) ? settings.cameraId ?? '' : ''}
              onChange={(e) => chooseCamera(e.target.value)}
            >
              <option value="">System default</option>
              {cameras.map((c) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {!named && (
            <p className="setting-note">
              Camera names appear once you have shown the shot at least once.
            </p>
          )}

          {/* --- What it costs -------------------------------------------- */}
          <div className="rec-field">
            <span className="rec-field-label">Quality</span>
            <div className="rec-quality">
              {QUALITY_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={settings.quality === preset.id}
                  className={clsx('rec-quality-option', settings.quality === preset.id && 'is-on')}
                  onClick={() => setQuality(preset.id)}
                >
                  <span className="rec-quality-name">{preset.label}</span>
                  <span className="rec-quality-rate">
                    {megabytesPerMinute(preset.id).toFixed(1)} MB a minute
                  </span>
                  <span className="rec-quality-blurb">{preset.blurb}</span>
                </button>
              ))}
            </div>
          </div>

          {/* --- How much is kept ----------------------------------------- */}
          <div className="rec-field">
            <span className="rec-field-label">Keep the last</span>
            <div className="rec-stepper">
              <button
                type="button"
                className="rec-stepper-btn"
                onClick={() => setKeepSessions(settings.keepSessions - 1)}
                disabled={settings.keepSessions <= MIN_KEEP_SESSIONS}
                aria-label="Keep one fewer session"
              >
                <MinusIcon size={16} />
              </button>
              <span className="rec-stepper-value">
                {settings.keepSessions}
                <span className="rec-stepper-unit">sessions</span>
              </span>
              <button
                type="button"
                className="rec-stepper-btn"
                onClick={() => setKeepSessions(settings.keepSessions + 1)}
                disabled={settings.keepSessions >= MAX_KEEP_SESSIONS}
                aria-label="Keep one more session"
              >
                <PlusIcon size={16} />
              </button>
            </div>
          </div>
          <p className="setting-note">
            Older sessions are deleted to make room. At {mbPerMinute.toFixed(1)} MB a minute, twenty
            minutes of practice a day works out at roughly{' '}
            {/* Through the same formatter as every other size on this screen, so
                a figure past a thousand reads as gigabytes rather than as
                "1826 MB", which is a number nobody converts in their head. */}
            {formatMegabytes(mbPerMinute * 20 * settings.keepSessions * BYTES_PER_MB)} in total.
            Technique checks are never deleted this way, and nor is anything you have kept.
          </p>

          {/* --- What it is costing right now ----------------------------- */}
          <div className="rec-usage">
            <div className="rec-usage-head">
              <StorageIcon size={18} className="rec-usage-icon" />
              <span className="rec-usage-total">{formatMegabytes(used)}</span>
              <span className="rec-usage-detail">
                {recordings.length === 0
                  ? 'nothing recorded yet'
                  : `${recordings.length} clip${recordings.length === 1 ? '' : 's'} across ${sessions} session${sessions === 1 ? '' : 's'}`}
              </span>
            </div>
            <RoomBar used={used} room={room} />
          </div>

          {lastPrune && (
            <div className="rec-prune" role="status">
              <p className="rec-prune-text">
                Made room on {new Date(lastPrune.at).toLocaleDateString()}: {lastPrune.clips} older
                clip{lastPrune.clips === 1 ? '' : 's'} deleted, {formatMegabytes(lastPrune.bytes)}{' '}
                freed.
              </p>
              <button type="button" className="settings-action-btn is-quiet" onClick={acknowledgePrune}>
                <span>Got it</span>
              </button>
            </div>
          )}

          {/* --- The deliberate clips ------------------------------------- */}
          <div className="rec-field">
            <span className="rec-field-label">Technique checks</span>
            {techniqueClips.length === 0 ? (
              <p className="setting-note">
                None yet. Run one from the Technique button above your routine: three angles,
                seventy-five seconds, kept until you delete them.
              </p>
            ) : (
              <ul className="rec-clips">
                {techniqueClips.map((clip) => (
                  <TechniqueRow
                    key={clip.id}
                    clip={clip}
                    onToggleStar={() => toggleStar(clip.id)}
                    onDelete={() => void forgetRecording(clip.id)}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* --- The way out ---------------------------------------------- */}
          {confirmingDelete ? (
            <div className="settings-confirm" role="group" aria-label="Confirm delete all recordings">
              <p className="settings-confirm-text">
                Delete all {recordings.length} recording{recordings.length === 1 ? '' : 's'},
                technique checks included? {formatMegabytes(used)} goes back. This cannot be undone.
              </p>
              <div className="settings-confirm-actions">
                <button
                  type="button"
                  className="settings-action-btn is-quiet"
                  onClick={() => setConfirmingDelete(false)}
                >
                  <span>Keep them</span>
                </button>
                <button
                  type="button"
                  className="settings-action-btn is-danger"
                  onClick={() => void deleteAll()}
                  disabled={deleting}
                >
                  <TrashIcon size={18} />
                  <span>{deleting ? 'Deleting…' : 'Delete everything'}</span>
                </button>
              </div>
            </div>
          ) : (
            // Absent rather than disabled when there is nothing to delete. A
            // greyed-out destructive control is a promise about a state the
            // user is not in, and this app does not dim text to say so.
            recordings.length > 0 && (
              <button
                type="button"
                className="settings-action-btn is-danger"
                onClick={() => setConfirmingDelete(true)}
              >
                <TrashIcon size={18} />
                <span>Delete all recordings</span>
              </button>
            )
          )}

          <button type="button" className="settings-action-btn is-quiet" onClick={turnOff}>
            <span>Stop recording my practice</span>
          </button>
          <p className="setting-note">
            Turning it off leaves what has already been filmed where it is. Delete it above if you
            want it gone.
          </p>
        </>
      )}
    </div>
  );
}

function CameraProblem({ error }: { error: RecordingError }) {
  return (
    <div className="rec-problem" role="alert">
      <p className="rec-problem-head">{error.message}</p>
      <p className="rec-problem-help">{recoveryFor(error.kind)}</p>
    </div>
  );
}

/**
 * How much room is left, as a bar the recordings fill part of.
 *
 * The browser's estimate covers everything this origin stores and is
 * deliberately coarse, so it is drawn as the ground rather than reported as a
 * fact. When the browser will not say, the bar goes and only the app's own
 * total remains, which is the number that was measured rather than guessed.
 */
function RoomBar({ used, room }: { used: number; room: StorageRoom | null }) {
  const quota = room?.quotaBytes ?? null;
  if (!quota) {
    return (
      <p className="rec-usage-note">
        This browser will not say how much room is left, so keep an eye on the total above.
      </p>
    );
  }
  const others = Math.max(0, (room?.usedBytes ?? used) - used);
  return (
    <>
      <div className="rec-bar" aria-hidden="true">
        {/* No fill at all when nothing has been recorded. The minimum width
            that keeps a sliver of a very small recording visible would
            otherwise paint a mark for zero bytes. */}
        {used > 0 && (
          <span className="rec-bar-fill" style={{ width: `${Math.min(100, (used / quota) * 100)}%` }} />
        )}
        {others > 0 && (
          <span
            className="rec-bar-others"
            style={{ width: `${Math.min(100, (others / quota) * 100)}%` }}
          />
        )}
      </div>
      <p className="rec-usage-note">
        Of the roughly {formatMegabytes(quota)} this browser will let the app use.
      </p>
    </>
  );
}

function TechniqueRow({
  clip,
  onToggleStar,
  onDelete,
}: {
  clip: Recording;
  onToggleStar: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="rec-clip">
      <span className="rec-clip-text">
        <span className="rec-clip-name">{clip.label}</span>
        <span className="rec-clip-meta">
          {clip.date} · {Math.round(clip.durationMs / 1000)}s · {formatMegabytes(clip.bytes)}
          {clip.hasAudio ? '' : ' · silent'}
        </span>
      </span>
      <button
        type="button"
        className={clsx('rec-clip-tool', clip.starred && 'is-kept')}
        onClick={onToggleStar}
        aria-pressed={clip.starred}
        aria-label={clip.starred ? `Stop keeping ${clip.label}` : `Keep ${clip.label}`}
        title={clip.starred ? 'Kept. Nothing will delete this automatically.' : 'Keep this one'}
      >
        <KeepIcon size={16} />
      </button>
      <button
        type="button"
        className="rec-clip-tool is-danger"
        onClick={onDelete}
        aria-label={`Delete ${clip.label}`}
        title="Delete this clip"
      >
        <TrashIcon size={16} />
      </button>
    </li>
  );
}
