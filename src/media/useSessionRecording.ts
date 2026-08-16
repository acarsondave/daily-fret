// Filming a practice session, from the point of view of a practice surface.
//
// Declarative on purpose. A practice surface says what is being played right
// now and this films it: hand it a clip, it rolls; hand it a different clip, it
// files the last one and rolls on the new one; hand it null, it stops. The
// alternative is start/stop calls scattered through six drill callbacks, and
// the failure mode of that is a camera left running over the results screen and
// the walk to put the guitar down.
//
// Nothing here can fail a drill. Every rejection is caught and turned into a
// `failure` the surface can show beside the practice, which carries on.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordingError } from './failure';
import { PracticeRecorder } from './recorder';
import { fileRecording, fileRecordingNow, useRecordingStore } from './recordingStore';
import { shouldFilmSession } from './cadence';
import type { RecordingKind, TechniqueView } from './types';

export interface ActiveClip {
  /** Changing this files the current clip and starts a new one. */
  key: string;
  date: string;
  taskId: string | null;
  routineId: string | null;
  label: string;
  kind?: RecordingKind;
  view?: TechniqueView;
  starred?: boolean;
  durationMs?: number;
}

export interface SessionRecordingState {
  /** The camera is rolling right now. */
  rolling: boolean;
  /** Milliseconds of the clip currently rolling, ticked once a second. */
  elapsedMs: number;
  /** The last thing that went wrong, until the surface dismisses it. */
  failure: RecordingError | null;
  dismissFailure: () => void;
  /** False when the user has recording turned off. Nothing opens a camera. */
  enabled: boolean;
}

const newSessionId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function useSessionRecording(clip: ActiveClip | null): SessionRecordingState {
  const enabled = useRecordingStore((s) => s.settings.enabled);
  const quality = useRecordingStore((s) => s.settings.quality);
  const cameraId = useRecordingStore((s) => s.settings.cameraId);

  const recorderRef = useRef<PracticeRecorder | null>(null);
  // Every clip filmed by this surface belongs to one session, which is the unit
  // retention counts. Generated once per mount: one opening of the practice
  // overlay, or one coached run, is one session.
  const sessionRef = useRef<string | null>(null);
  if (sessionRef.current === null) sessionRef.current = newSessionId();

  // Whether this session is the one that gets filmed. Decided when the first
  // clip arrives and then held for the life of the surface: asking again
  // mid-session would let a session that started filming stop filming halfway
  // through, because the clip it just filed is itself the most recent recording
  // and would answer "not due".
  //
  // A technique check is never subject to it: the player asked for that one.
  const dueRef = useRef<boolean | null>(null);

  // Camera work is asynchronous and React is not. Two clips in quick succession
  // (a coached session advancing) would otherwise have the second start()
  // land before the first stop() finished, and MediaRecorder answers that by
  // throwing. Everything the recorder is asked to do goes through this chain.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const [rolling, setRolling] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [failure, setFailure] = useState<RecordingError | null>(null);

  const dismissFailure = useCallback(() => setFailure(null), []);

  const key = clip?.key ?? null;
  // Read through refs so a change to the label, the task or the quality setting
  // does not restart a recording that is already rolling. The key is what
  // identifies a clip, and only the key starts and stops one.
  //
  // Written in an effect declared above the one that uses them, so React has
  // already refreshed both by the time a new key opens a camera.
  const clipRef = useRef(clip);
  const settingsRef = useRef({ quality, cameraId });
  useEffect(() => {
    clipRef.current = clip;
    settingsRef.current = { quality, cameraId };
  });

  useEffect(() => {
    if (!enabled || key === null) return;
    const request = clipRef.current;
    if (!request) return;

    if (dueRef.current === null) {
      const { recordings, settings } = useRecordingStore.getState();
      dueRef.current = request.kind === 'technique-check'
        || shouldFilmSession(recordings, settings.cadence, Date.now());
    }
    if (!dueRef.current) return;

    let cancelled = false;
    const recorder = recorderRef.current ?? new PracticeRecorder();
    recorderRef.current = recorder;

    queueRef.current = queueRef.current
      .then(async () => {
        if (cancelled) return;
        await recorder.start(
          {
            sessionId: sessionRef.current ?? newSessionId(),
            kind: request.kind ?? 'session',
            date: request.date,
            taskId: request.taskId,
            routineId: request.routineId,
            label: request.label,
            view: request.view,
            starred: request.starred,
            durationMs: request.durationMs,
            quality: settingsRef.current.quality,
            cameraId: settingsRef.current.cameraId,
          },
          {
            onFailure: (err) => {
              setFailure(err);
              setRolling(false);
            },
            onEnded: () => setRolling(false),
          },
        );
        if (cancelled) {
          await recorder.cancel();
          return;
        }
        setFailure(null);
        setRolling(true);
        setStartedAt(Date.now());
        setElapsedMs(0);
      })
      .catch(() => {
        // Already reported through onFailure. Swallowed here and only here, so
        // one bad camera cannot reject the queue every later clip waits on.
      });

    return () => {
      cancelled = true;
      queueRef.current = queueRef.current
        .then(async () => {
          const saved = await recorder.stop();
          setRolling(false);
          setElapsedMs(0);
          if (saved) await fileRecording(saved);
        })
        .catch(() => {});
    };
  }, [enabled, key]);

  // Give the camera back when the surface goes, whatever route it took out.
  //
  // Through the queue, and this matters. Effect cleanups run in declaration
  // order, so the clip effect above has already queued the stop that saves the
  // footage. Cancelling straight away raced it: abort() removed the file that
  // stop() was still writing, and every recording made by leaving a drill with
  // Escape vanished with a "closing writable stream" error behind it. Queued,
  // this runs after the save and finds nothing left to cancel.
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (!recorder) return;
      queueRef.current = queueRef.current.then(() => recorder.cancel()).catch(() => {});
    };
  }, []);

  // Closing or reloading the tab mid-take used to lose the clip entirely.
  //
  // Not "lose the row": the bytes stayed on the disk, filling the quota, with
  // nothing in the library pointing at them and no way to play or delete them.
  // The React cleanups that save a clip never run when the page goes away, so
  // this is the only chance to write the row, and it has to be taken without
  // awaiting anything.
  //
  // `pagehide` rather than `beforeunload`: it is the one that fires on iOS and
  // on a tab the browser discards, which are exactly the cases where nothing
  // else gets a turn.
  useEffect(() => {
    const save = () => {
      const saved = recorderRef.current?.snapshotForInterruption();
      if (saved) fileRecordingNow(saved);
    };
    window.addEventListener('pagehide', save);
    return () => window.removeEventListener('pagehide', save);
  }, []);

  // The clock. Zeroed where the recording starts rather than here, so this
  // effect only subscribes to a timer and never writes state as it mounts.
  useEffect(() => {
    if (!rolling || !startedAt) return;
    const id = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [rolling, startedAt]);

  return { rolling, elapsedMs, failure, dismissFailure, enabled };
}
