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
import { deleteEverything, deleteRecording } from './storage';
import type { PruneEvent, Recording, RecordingQuality, RecordingSettings } from './types';

interface RecordingState {
  settings: RecordingSettings;
  /** Newest first. The order the review library will want them in. */
  recordings: Recording[];
  /** The last prune, kept until the user has seen it. Never auto-cleared. */
  lastPrune: PruneEvent | null;

  setEnabled: (enabled: boolean) => void;
  setQuality: (quality: RecordingQuality) => void;
  setKeepSessions: (keep: number) => void;
  setCameraId: (deviceId: string | null) => void;
  toggleStar: (id: string) => void;
  acknowledgePrune: () => void;
}

const DEFAULT_SETTINGS: RecordingSettings = {
  enabled: false,
  quality: DEFAULT_QUALITY,
  keepSessions: DEFAULT_KEEP_SESSIONS,
  cameraId: null,
};

export const useRecordingStore = create<RecordingState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      recordings: [],
      lastPrune: null,

      setEnabled: (enabled) => set((s) => ({ settings: { ...s.settings, enabled } })),
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
 * File a finished clip and apply the retention limit.
 *
 * Index first, then disk. If the delete of a pruned file fails the entry is
 * already gone from the library, which is the wrong way round only if you would
 * rather show a row that cannot play than leak a file. The next "delete all"
 * clears the directory recursively and takes any such orphan with it.
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
}

/** Forget one clip and delete its file. */
export async function forgetRecording(id: string): Promise<void> {
  const target = useRecordingStore.getState().recordings.find((r) => r.id === id);
  if (!target) return;
  useRecordingStore.setState((s) => ({ recordings: s.recordings.filter((r) => r.id !== id) }));
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
  useRecordingStore.setState({ recordings: [], lastPrune: null });
  await deleteEverything();
}
