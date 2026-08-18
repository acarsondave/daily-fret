import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { CameraIcon, KeepIcon, MinusIcon, PlusIcon, StorageIcon, TrashIcon } from '../icons';
import { camerasAreNamed, listCameras, openCameraPreview, type CameraInput } from '../../media/cameraDevice';
import { RecordingError, recoveryFor } from '../../media/failure';
import {
  QUALITY_PRESETS,
  chooseMimeType,
  formatMegabytes,
  megabytesPerMinute,
  presetFor,
} from '../../media/quality';
import { nextFilmingDue } from '../../media/cadence';
import type { RecordingCadence } from '../../media/types';

import {
  BUDGET_CHOICES,
  MAX_KEEP_SESSIONS,
  MIN_KEEP_SESSIONS,
  TECHNIQUE_POOL,
  minutesInBudget,
  planPrune,
  sessionCount,
  totalBytes,
  typicalSessionMinutes,
} from '../../media/retention';
import {
  applyRetention,
  forgetAllRecordings,
  forgetRecording,
  reclaimOrphans,
  surveyOrphans,
  useRecordingStore,
} from '../../media/recordingStore';
import { storageRoom, type OrphanReport, type StorageRoom } from '../../media/storage';
import type { Recording } from '../../media/types';

/** When the most recent automatic session was filmed, or 0 if none ever was. */
function lastFilmedAt(recordings: readonly Recording[]): number {
  return recordings.reduce((latest, r) => (r.kind === 'session' ? Math.max(latest, r.startedAt) : latest), 0);
}

/**
 * How often to film, in the order a player should consider them.
 *
 * Weekly leads and is the default because the owner asked for it after living
 * with the alternative: filming every coached session is heavy, and twenty
 * takes a week is a landfill nobody opens. The cost line is the honest reason
 * to pick one, so it sits where the quality rows put their megabytes.
 */
const CADENCE_CHOICES: readonly {
  id: RecordingCadence; label: string; cost: string; blurb: string;
}[] = [
  {
    id: 'weekly',
    label: 'Once a week',
    cost: 'about 4 a month',
    blurb: 'Enough to see a month of change without filling the disk.',
  },
  {
    id: 'every-session',
    label: 'Every session',
    cost: 'a few GB a month',
    blurb: 'Everything you practise, at the cost of storage and some CPU.',
  },
  {
    id: 'manual',
    label: 'Only when I ask',
    cost: 'nothing on its own',
    blurb: 'Technique checks only. Practice sessions are never filmed.',
  },
];

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
  const setCadence = useRecordingStore((s) => s.setCadence);
  const setKeepSessions = useRecordingStore((s) => s.setKeepSessions);
  const setKeepBytes = useRecordingStore((s) => s.setKeepBytes);
  const setCameraId = useRecordingStore((s) => s.setCameraId);
  const toggleStar = useRecordingStore((s) => s.toggleStar);
  const acknowledgePrune = useRecordingStore((s) => s.acknowledgePrune);

  const [cameras, setCameras] = useState<CameraInput[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<RecordingError | null>(null);
  const [room, setRoom] = useState<StorageRoom | null>(null);
  const [orphans, setOrphans] = useState<OrphanReport | null>(null);
  const [reclaiming, setReclaiming] = useState(false);
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
  // How long this player's own sessions run, so the budgets below can be priced
  // in sessions rather than only in minutes. Null until something is filmed,
  // and the copy says minutes only rather than inventing a session length.
  const sessionMinutes = useMemo(() => typicalSessionMinutes(recordings), [recordings]);
  // What cannot be pruned even so: starred clips and the newest technique
  // checks. Stated rather than discovered when the budget refuses to be met.
  const overBudget = useMemo(
    () =>
      planPrune(recordings, {
        keepSessions: settings.keepSessions,
        keepBytes: settings.keepBytes,
      }).overBudget,
    [recordings, settings.keepSessions, settings.keepBytes],
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

  // Files on the disk that no clip points at. Read from the disk rather than the
  // index, because the index is exactly what has lost them. Surveyed whenever
  // the library changes, so reclaiming one immediately stops offering it again.
  useEffect(() => {
    if (!settings.enabled) return;
    let live = true;
    void surveyOrphans().then(
      (report) => { if (live) setOrphans(report); },
      // A backend that will not list is not an error worth interrupting anyone
      // for. It means this pane cannot offer the reclaim, not that anything is
      // wrong with the recordings it can see.
      () => { if (live) setOrphans(null); },
    );
    return () => { live = false; };
  }, [recordings, settings.enabled]);

  const reclaim = async () => {
    setReclaiming(true);
    try {
      const freed = await reclaimOrphans();
      setOrphans(await surveyOrphans());
      if (freed.files === 0) {
        setError(new RecordingError('storage', 'Those files could not be deleted.'));
      }
    } finally {
      setReclaiming(false);
    }
  };

  // A limit is a promise about the disk, so it takes effect when it is set
  // rather than whenever the next clip happens to be filed.
  const chooseBudget = (bytes: number) => {
    setKeepBytes(bytes);
    void applyRetention();
  };

  const chooseSessions = (count: number) => {
    setKeepSessions(count);
    void applyRetention();
  };

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

  // Read off the last filmed session rather than the wall clock, so the pane
  // states a date that stays true however long it sits open. A countdown would
  // be wrong the moment midnight passed behind it.
  const nextDue = useMemo(
    () => nextFilmingDue(recordings, settings.cadence, lastFilmedAt(recordings)),
    [recordings, settings.cadence],
  );

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

          {/* --- How often ------------------------------------------------ */}
          <div className="rec-field">
            <span className="rec-field-label">Film a session</span>
            <div className="rec-cadence">
              {CADENCE_CHOICES.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  aria-pressed={settings.cadence === choice.id}
                  className={clsx('rec-cadence-option', settings.cadence === choice.id && 'is-on')}
                  onClick={() => setCadence(choice.id)}
                >
                  <span className="rec-cadence-name">{choice.label}</span>
                  <span className="rec-cadence-rate">{choice.cost}</span>
                  <span className="rec-cadence-blurb">{choice.blurb}</span>
                </button>
              ))}
            </div>
            {/* Where the player actually stands, rather than leaving them to
                work it out from the rule. */}
            <p className="rec-field-note">
              {settings.cadence === 'weekly'
                ? nextDue === null
                  ? 'The next practice session you run will be filmed.'
                  : `Next one from ${new Date(nextDue).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}. Technique checks are never held back.`
                : settings.cadence === 'manual'
                  ? 'Only technique checks are filmed, when you ask for one.'
                  : 'Every coached session is filmed. This fills the disk quickly.'}
            </p>
          </div>

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
          {/* The budget leads, because bytes are what fill a disk. Counting
              sessions alone let one thirty-minute routine take a single slot
              worth 340 MB, so eight slots was 2.7 GB before anything could
              possibly be deleted. Each size is priced in the footage it buys at
              the quality chosen above, which is the whole point of showing it
              here: the cost is visible before it is spent, and it moves when the
              quality does. */}
          <div className="rec-field">
            <span className="rec-field-label">Keep at most</span>
            <div className="rec-budget">
              {BUDGET_CHOICES.map((bytes) => (
                <button
                  key={bytes}
                  type="button"
                  aria-pressed={settings.keepBytes === bytes}
                  className={clsx('rec-budget-option', settings.keepBytes === bytes && 'is-on')}
                  onClick={() => chooseBudget(bytes)}
                >
                  <span className="rec-budget-size">{formatMegabytes(bytes)}</span>
                  <span className="rec-budget-buys">
                    {Math.round(minutesInBudget(bytes, settings.quality))} minutes filmed
                  </span>
                  {sessionMinutes !== null && (
                    <span className="rec-budget-blurb">
                      about{' '}
                      {Math.max(
                        1,
                        Math.round(minutesInBudget(bytes, settings.quality) / sessionMinutes),
                      )}{' '}
                      of your sessions
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="rec-field">
            <span className="rec-field-label">And no more than</span>
            <div className="rec-stepper">
              <button
                type="button"
                className="rec-stepper-btn"
                onClick={() => chooseSessions(settings.keepSessions - 1)}
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
                onClick={() => chooseSessions(settings.keepSessions + 1)}
                disabled={settings.keepSessions >= MAX_KEEP_SESSIONS}
                aria-label="Keep one more session"
              >
                <PlusIcon size={16} />
              </button>
            </div>
          </div>
          <p className="setting-note">
            Whichever runs out first. At {mbPerMinute.toFixed(1)} MB a minute the oldest sessions go
            to make room, whole rather than in pieces. Anything you have kept stays for good, and so
            do your last {TECHNIQUE_POOL} technique checks.
          </p>
          {overBudget > 0 && (
            <p className="setting-note is-warning" role="status">
              Kept clips and technique checks come to {formatMegabytes(overBudget)} more than this
              budget on their own. Nothing is deleted to close that gap. Unkeep something below, or
              choose a larger size.
            </p>
          )}

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

          {/* Footage the index lost track of: a crashed tab, a delete that
              failed after its row had gone. It cannot be played, cannot be
              deleted from the library, and counts against the quota until the
              browser refuses a recording the player wanted to make. Offered
              rather than done automatically, because the recorder writes a file
              before it writes its row and nothing on the disk can tell a
              recording in progress from an abandoned one. */}
          {orphans && orphans.files.length > 0 && (
            <div className="rec-orphans">
              <p className="rec-orphans-text">
                {orphans.files.length} file{orphans.files.length === 1 ? '' : 's'} on the disk that
                the library cannot see, holding{' '}
                {/* "at least", because a backend that will not size a file
                    without loading it is not counted in the total. Quoting the
                    known part as the whole would overstate the reclaim. */}
                {orphans.unsized > 0 ? 'at least ' : ''}
                {formatMegabytes(orphans.bytes)}. Nothing you can watch is among them: every clip in
                the list above stays exactly where it is.
              </p>
              <button
                type="button"
                className="settings-action-btn is-quiet"
                onClick={() => void reclaim()}
                disabled={reclaiming}
              >
                <StorageIcon size={18} />
                <span>{reclaiming ? 'Reclaiming…' : 'Reclaim that space'}</span>
              </button>
            </div>
          )}

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
