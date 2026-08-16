// Which backend holds the footage, and how much room is left.
//
// The choice is made per write and recorded on the clip, never assumed at read
// time. A browser can gain OPFS between one session and the next (an update),
// and a clip written to IndexedDB before that must still play afterwards.

import type { RecordingLocation, StorageBackend } from '../types';
import type { RecordingStore } from './backend';
import { RecordingError } from '../failure';
import { isWriting } from './inflight';
import { indexedDbAvailable, indexedDbStore } from './indexeddb';
import { opfsAvailable, opfsStore } from './opfs';

export type { RecordingSink, RecordingStore, StoredFile } from './backend';

/** The backend a new recording should be written to, best first. */
export function preferredStore(): RecordingStore {
  if (opfsAvailable()) return opfsStore;
  if (indexedDbAvailable()) return indexedDbStore;
  throw new RecordingError(
    'storage',
    'This browser has nowhere to keep a recording that would survive a reload.',
  );
}

/** The backend a clip already on disk lives in. */
export function storeFor(backend: StorageBackend): RecordingStore {
  if (backend === 'opfs') return opfsStore;
  if (backend === 'indexeddb') return indexedDbStore;
  // Unreachable while the union has two members, and the reason this is written
  // as a throw rather than a default: when 'cloud' is added, every reader has to
  // learn about it, and a silent fallback here would have them quietly reporting
  // uploaded clips as missing and pruning them.
  throw new RecordingError('storage', `No reader for recordings stored in ${backend}.`);
}

export async function readRecording(location: RecordingLocation): Promise<Blob> {
  return storeFor(location.backend).read(location.key);
}

export async function deleteRecording(location: RecordingLocation): Promise<void> {
  await storeFor(location.backend).remove(location.key);
}

/** Wipe every backend, including files the index has lost track of. */
export async function deleteEverything(): Promise<void> {
  if (opfsAvailable()) await opfsStore.removeAll();
  if (indexedDbAvailable()) await indexedDbStore.removeAll();
}

/**
 * A file no clip in the library points at.
 *
 * Every one of these is footage nobody can watch and nobody can delete, sitting
 * against a quota that will eventually refuse a recording the player wanted.
 */
export interface OrphanFile {
  location: RecordingLocation;
  /** Null when the backend cannot size a file without loading it. */
  bytes: number | null;
}

export interface OrphanReport {
  files: OrphanFile[];
  /** Bytes we can actually vouch for. */
  bytes: number;
  /** How many of those files the backend would not give a size for. */
  unsized: number;
}

/**
 * Grace period before a file with no index row is called an orphan.
 *
 * The recorder writes the file first and the index row last, so a clip is a
 * legitimate orphan for the length of the recording. The in-flight registry
 * covers that in this tab; this covers the tab that crashed, and the second tab,
 * where nothing local knows a recording was ever running.
 */
const ORPHAN_GRACE_MS = 30 * 60 * 1000;

/**
 * Files on disk that the given clips do not account for.
 *
 * Read from the backends rather than from the index, because a file the index
 * has lost is exactly what this is looking for and the index by definition
 * cannot report it.
 */
export async function findOrphans(
  known: Iterable<RecordingLocation>,
  nowMs: number = Date.now(),
): Promise<OrphanReport> {
  const claimed = new Set<string>();
  for (const location of known) claimed.add(`${location.backend}:${location.key}`);

  const backends: RecordingStore[] = [];
  if (opfsAvailable()) backends.push(opfsStore);
  if (indexedDbAvailable()) backends.push(indexedDbStore);

  const files: OrphanFile[] = [];
  let bytes = 0;
  let unsized = 0;

  for (const store of backends) {
    // One unreadable backend must not hide the orphans in the other one.
    const held = await store.list().catch(() => []);
    for (const file of held) {
      if (claimed.has(`${store.backend}:${file.key}`)) continue;
      if (isWriting(file.key)) continue;
      // A backend that cannot date its files gets the benefit of the doubt only
      // from the in-flight check above, which is the honest position: refusing
      // to reclaim anything there would leak forever instead.
      if (file.modifiedAt !== null && nowMs - file.modifiedAt < ORPHAN_GRACE_MS) continue;
      files.push({ location: { backend: store.backend, key: file.key }, bytes: file.bytes });
      if (file.bytes === null) unsized += 1;
      else bytes += file.bytes;
    }
  }

  return { files, bytes, unsized };
}

/** Delete the given orphans. Returns how many were actually removed. */
export async function deleteOrphans(files: readonly OrphanFile[]): Promise<number> {
  let removed = 0;
  for (const file of files) {
    // One failure must not strand the rest: these are being reclaimed precisely
    // because nothing else will ever come back for them.
    const ok = await deleteRecording(file.location).then(
      () => true,
      () => false,
    );
    if (ok) removed += 1;
  }
  return removed;
}

export interface StorageRoom {
  /** What the browser says this origin is using, across all of its storage. */
  usedBytes: number | null;
  /** What the browser says it would allow. Null when it will not say. */
  quotaBytes: number | null;
}

/**
 * What the browser will admit to.
 *
 * Reported beside the app's own accounting rather than instead of it: the
 * estimate covers everything this origin stores, is deliberately coarse for
 * privacy, and on some browsers is a flat lie of a number. The sum of the
 * clips' own byte counts is the honest figure for "what the recordings cost",
 * and this is the honest figure for "how much room is left".
 */
export async function storageRoom(): Promise<StorageRoom> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.estimate !== 'function') {
    return { usedBytes: null, quotaBytes: null };
  }
  const estimate = await navigator.storage.estimate();
  return {
    usedBytes: typeof estimate.usage === 'number' ? estimate.usage : null,
    quotaBytes: typeof estimate.quota === 'number' ? estimate.quota : null,
  };
}
