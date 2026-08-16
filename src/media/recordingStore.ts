// The index of what has been filmed, and the settings that govern filming.
//
// Deliberately its own store with its own localStorage key, and deliberately
// NOT part of the practice store in src/store.
//
// The practice store is uploaded to Firestore whole, and `syncFromRemote`
// rebuilds an account field by field from a whitelist. An index of files that
// exist only in this machine's Origin Private File System has no business
// travelling to another device: on the phone, every entry would name a clip
// that is not there, offer to play it, and fail. And anything not in that
// whitelist is dropped on the first sync, so the index would quietly empty
// itself the first time the owner signed in.
//
// The recordings are local by decision this pass. Their index is local for the
// same reason, and the two stay consistent because they are the same fact.
//
// What lives here is small: one row per clip, no bytes. A hundred clips is
// well under 40 kB of JSON.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_QUALITY } from './quality';
import { DEFAULT_KEEP_SESSIONS, clampKeepSessions, planPrune, pruneEvent } from './retention';
import { deleteEverything, deleteOrphans, deleteRecording, findOrphans, type OrphanReport } from './storage';
import { forgetPoster } from './posterFrames';
import type { PruneEvent, Recording, RecordingCadence, RecordingQuality, RecordingSettings } from './types';

interface RecordingState {
  settings: RecordingSettings;
  /** Newest first. The order the review library will want them in. */
  recordings: Recording[];
  /** The last prune, kept until the user has seen it. Never auto-cleared. */
  lastPrune: PruneEvent | null;

  setEnabled: (enabled: boolean) => void;
  setCadence: (cadence: RecordingCadence) => void;
  setQuality: (quality: RecordingQuality) => void;
  setKeepSessions: (keep: number) => void;
  setCameraId: (deviceId: string | null) => void;
  toggleStar: (id: string) => void;
  acknowledgePrune: () => void;
}

const DEFAULT_SETTINGS: RecordingSettings = {
  enabled: false,
  cadence: 'weekly',
  quality: DEFAULT_QUALITY,
  keepSessions: DEFAULT_KEEP_SESSIONS,
  cameraId: null,
};

const CADENCES: readonly RecordingCadence[] = ['weekly', 'every-session', 'manual'];

export const useRecordingStore = create<RecordingState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      recordings: [],
      lastPrune: null,

      setEnabled: (enabled) => set((s) => ({ settings: { ...s.settings, enabled } })),
      setCadence: (cadence) => set((s) => ({ settings: { ...s.settings, cadence } })),
      setQuality: (quality) => set((s) => ({ settings: { ...s.settings, quality } })),
      setKeepSessions: (keep) =>
        set((s) => ({ settings: { ...s.settings, keepSessions: clampKeepSessions(keep) } })),
      setCameraId: (cameraId) => set((s) => ({ settings: { ...s.settings, cameraId } })),

      toggleStar: (id) =>
        set((s) => ({
          recordings: s.recordings.map((r) => (r.id === id ? { ...r, starred: !r.starred } : r)),
        })),

      acknowledgePrune: () => set({ lastPrune: null }),
    }),
    {
      name: 'daily-fret-recordings',
      // Recording is off until someone turns it on, and a version of this app
      // that lost that guarantee across an upgrade would be recording without
      // consent. Reading it back explicitly rather than spreading the persisted
      // object over the defaults is what makes that impossible.
      merge: (persisted, current) => {
        const saved = persisted as Partial<RecordingState> | undefined;
        const settings = saved?.settings;
        return {
          ...current,
          recordings: Array.isArray(saved?.recordings) ? saved.recordings : [],
          lastPrune: saved?.lastPrune ?? null,
          settings: {
            enabled: settings?.enabled === true,
            // An unreadable cadence falls to the cheapest one, never to the one
            // that fills the disk. Same reasoning as `enabled` above.
            cadence: CADENCES.includes(settings?.cadence as RecordingCadence)
              ? (settings!.cadence as RecordingCadence)
              : 'weekly',
            quality: settings?.quality ?? DEFAULT_QUALITY,
            keepSessions: clampKeepSessions(settings?.keepSessions ?? DEFAULT_KEEP_SESSIONS),
            cameraId: settings?.cameraId ?? null,
          },
        };
      },
    },
  ),
);

export const recordingSettings = (): RecordingSettings => useRecordingStore.getState().settings;

export const recordingEnabled = (): boolean => useRecordingStore.getState().settings.enabled;

/**
 * Files on disk that no clip in the library points at, and what they cost.
 *
 * Reads the disk, not the index. Everything it finds is footage that cannot be
 * watched, cannot be deleted through the library, and counts against the quota
 * until the browser refuses a recording the player wanted to make.
 */
export function surveyOrphans(): Promise<OrphanReport> {
  return findOrphans(useRecordingStore.getState().recordings.map((r) => r.location));
}

/**
 * Delete those files.
 *
 * Deliberately only ever run because someone asked for it. The recorder writes
 * a clip's file long before it writes the clip's row, so a recording in progress
 * is indistinguishable from an orphan by anything the disk can tell us; the
 * in-flight registry and the grace period in findOrphans() both guard that, and
 * requiring a deliberate press is the third guard. Reclaiming footage is not
 * worth one chance in a thousand of eating the session someone just played.
 */
export async function reclaimOrphans(): Promise<{ files: number; bytes: number }> {
  const report = await surveyOrphans();
  const removed = await deleteOrphans(report.files);
  // Report what was actually reclaimed rather than what was found, and count
  // bytes only for the files a backend could size.
  return { files: removed, bytes: removed === report.files.length ? report.bytes : 0 };
}

/**
 * File a finished clip and apply the retention limit.
 *
 * Index first, then disk. If the delete of a pruned file fails the entry is
 * already gone from the library, which is the wrong way round only if you would
 * rather show a row that cannot play than leak a file. Such a file is no longer
 * lost forever: surveyOrphans() reads the disk itself and reclaimOrphans() can
 * come back for it without taking the rest of the library with it.
 */
export async function fileRecording(recording: Recording): Promise<void> {
  const { recordings, settings } = useRecordingStore.getState();
  const all = [recording, ...recordings];
  const { keep, drop } = planPrune(all, settings.keepSessions);

  const event = pruneEvent(drop, Date.now());
  useRecordingStore.setState((s) => ({
    recordings: keep,
    // A previous prune the user has not read yet is not overwritten by a
    // smaller one; the counts add up, because both of them happened.
    lastPrune: event
      ? {
          at: event.at,
          clips: event.clips + (s.lastPrune?.clips ?? 0),
          bytes: event.bytes + (s.lastPrune?.bytes ?? 0),
        }
      : s.lastPrune,
  }));

  await Promise.all(drop.map((r) => deleteRecording(r.location).catch(() => {})));
  await Promise.all(drop.map((r) => forgetPoster(r).catch(() => {})));
}

/**
 * File a row and nothing else, synchronously.
 *
 * For `pagehide`, where there is no time to await a prune, a delete or a
 * measurement, and where the alternative is a file on the disk that nothing
 * points at. zustand's persist middleware writes to localStorage inside the
 * `setState` call, so by the time this returns the row has survived the page.
 * Retention catches up on the next clip.
 */
export function fileRecordingNow(recording: Recording): void {
  useRecordingStore.setState((s) => ({ recordings: [recording, ...s.recordings] }));
}

/** Forget one clip, its file, and the still made from it. */
export async function forgetRecording(id: string): Promise<void> {
  const target = useRecordingStore.getState().recordings.find((r) => r.id === id);
  if (!target) return;
  useRecordingStore.setState((s) => ({ recordings: s.recordings.filter((r) => r.id !== id) }));
  await forgetPoster(target);
  await deleteRecording(target.location);
}

/**
 * Delete every recording, including any file the index lost track of.
 *
 * One obvious action, and it is genuinely one: the index is emptied and the
 * whole storage directory goes, so nothing is left behind claiming to have been
 * deleted.
 */
export async function forgetAllRecordings(): Promise<void> {
  const { recordings } = useRecordingStore.getState();
  useRecordingStore.setState({ recordings: [], lastPrune: null });
  await Promise.all(recordings.map((r) => forgetPoster(r).catch(() => {})));
  await deleteEverything();
}
