// Which backend holds the footage, and how much room is left.
//
// The choice is made per write and recorded on the clip, never assumed at read
// time. A browser can gain OPFS between one session and the next (an update),
// and a clip written to IndexedDB before that must still play afterwards.

import type { RecordingLocation, StorageBackend } from '../types';
import type { RecordingStore } from './backend';
import { RecordingError } from '../failure';
import { indexedDbAvailable, indexedDbStore } from './indexeddb';
import { opfsAvailable, opfsStore } from './opfs';

export type { RecordingSink, RecordingStore } from './backend';

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
