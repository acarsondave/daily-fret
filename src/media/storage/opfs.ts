// The Origin Private File System backend: the one we want.
//
// The reason it is preferred is not that it is newer. MediaRecorder hands back
// a chunk every second or so, and OPFS gives a writable stream, so each chunk
// goes straight to disk and the peak memory cost of a half-hour recording is
// one chunk. Every other option in a browser means holding the whole clip in
// memory until the recording stops, which for a 25-minute session at 720p is
// roughly 270 MB of JavaScript heap on a machine that is also running a
// real-time chord detector. That is the difference, and it is why the fallback
// in ./indexeddb.ts is a fallback rather than a peer.
//
// The bytes never leave the machine. Nothing here uploads, and OPFS is not
// reachable by any other origin or by the user's file manager, which is the
// other half of why it suits footage of someone's living room.

import type { RecordingSink, RecordingStore, StoredFile } from './backend';
import { describeStorageFailure, type RecordingError } from '../failure';
import { markFinished, markWriting } from './inflight';

const DIRECTORY = 'daily-fret-recordings';

/**
 * How often the bytes written so far are landed into the real file.
 *
 * The trade is between how much of an interrupted take is lost and how often
 * the stream is closed and reopened. Thirty seconds costs two extra closes a
 * minute against a recorder already handing over a chunk a second, and it bounds
 * the loss from closing the tab mid-take to the last half minute rather than the
 * whole take. Chosen over a minute because a technique check only runs for 60 to
 * 90 seconds, and at a minute an interrupted one would keep nothing.
 */
const CHECKPOINT_MS = 30_000;

/**
 * Whether this browser can do the thing we actually need.
 *
 * Deliberately checks `createWritable` and not merely `getDirectory`. Safari
 * shipped OPFS with only the worker-only sync access handle for a version or
 * two, so a `getDirectory` check alone reports success on a browser where every
 * write throws.
 */
export function opfsAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function' &&
    typeof FileSystemFileHandle !== 'undefined' &&
    typeof FileSystemFileHandle.prototype.createWritable === 'function'
  );
}

async function directory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIRECTORY, { create: true });
}

export const opfsStore: RecordingStore = {
  backend: 'opfs',

  async open(key: string, onFailure?: (error: RecordingError) => void): Promise<RecordingSink> {
    let handle: FileSystemFileHandle;
    let stream: FileSystemWritableFileStream;
    try {
      const dir = await directory();
      handle = await dir.getFileHandle(key, { create: true });
      stream = await handle.createWritable();
    } catch (err) {
      throw describeStorageFailure(err);
    }
    // From here the file exists on disk with no index row behind it, which is
    // indistinguishable from an orphan until the recorder commits the row.
    markWriting(key);

    // Writes are serialised through this promise rather than awaited by the
    // caller. MediaRecorder's dataavailable handler is not async-aware: if two
    // chunks arrive while a write is in flight and both call write(), the
    // stream throws "already locked" and the tail of the recording is lost.
    let queue: Promise<void> = Promise.resolve();
    /**
     * Bytes that are in the real file, recoverable even if this page dies now.
     *
     * Separate from `pending` because a writable stream is not a pipe to the
     * file. Chromium writes into a sibling swap file and only moves it into
     * place at close(), so a twenty-minute recording interrupted by a reload
     * leaves the real file at exactly zero bytes with every frame in a swap the
     * browser then discards. This was measured, not assumed: the first version
     * of the interrupted-clip salvage filed a row claiming 137 KB against a file
     * of size 0, and the library gained an entry that could not play.
     */
    let committed = 0;
    /** Written to the current stream but not yet closed into the file. */
    let pending = 0;
    let lastCheckpoint = Date.now();
    let failure: unknown = null;

    /**
     * Land what has been written so far and open a fresh stream after it.
     *
     * This is the whole mechanism that makes an interrupted recording
     * survivable. Called from inside the write queue, so it can never race a
     * chunk. `keepExistingData` plus a seek to the end is what makes the new
     * stream append rather than truncate; without either, every checkpoint would
     * throw away the recording so far.
     */
    async function checkpoint(): Promise<void> {
      await stream.close();
      committed += pending;
      pending = 0;
      stream = await handle.createWritable({ keepExistingData: true });
      await stream.seek(committed);
      lastCheckpoint = Date.now();
    }
    // MediaRecorder can deliver one more chunk after it has been told to stop,
    // and a write to a stream that is already closing throws asynchronously
    // where nothing is waiting to catch it. A chunk that arrives after the file
    // is finished is dropped rather than thrown: it is a fraction of a second
    // of footage, and the alternative was an unhandled rejection tearing down
    // the save that had already succeeded.
    let sealed = false;

    return {
      write(chunk: Blob): void {
        if (sealed || failure) return;
        queue = queue
          .then(async () => {
            if (sealed || failure) return;
            await stream.write(chunk);
            pending += chunk.size;
            // Cheap: one close and reopen a minute, against a stream that is
            // taking a chunk a second anyway. The cost of not doing it is the
            // whole take.
            if (Date.now() - lastCheckpoint >= CHECKPOINT_MS) await checkpoint();
          })
          // Caught on this link rather than on the next one's rejection handler.
          // Deferring it left a rejected promise with nothing attached to it for
          // a whole timeslice, which every browser reports as an unhandled
          // rejection: a full disk printed "QuotaExceededError" into the
          // console of a drill that was still running perfectly well.
          .catch((err: unknown) => {
            if (failure) return;
            failure = err;
            // Told now rather than at close(), so the recorder can stop filming
            // into a file that has stopped accepting bytes and mark the clip
            // for what it is.
            onFailure?.(describeStorageFailure(err));
          });
      },
      // Only the checkpointed bytes, deliberately. This number's one job is to
      // answer "how much of this clip would survive if the page died right now",
      // and everything since the last checkpoint would not.
      bytesFlushed(): number {
        return committed;
      },
      async close(): Promise<number> {
        if (sealed) return committed;
        await queue;
        sealed = true;
        markFinished(key);
        try {
          await stream.close();
          committed += pending;
          pending = 0;
        } catch (err) {
          failure ??= err;
        }
        // Only a file with nothing in it is a failure. A write that ran out of
        // room part-way leaves a shorter clip, and the footage that did land is
        // footage the player filmed: throwing here would delete it and report
        // "no room" about a recording that already existed.
        if (failure && committed === 0) throw describeStorageFailure(failure);
        return committed;
      },
      async abort(): Promise<void> {
        if (sealed) return;
        sealed = true;
        markFinished(key);
        await queue.catch(() => {});
        await stream.abort().catch(() => {});
        await opfsStore.remove(key).catch(() => {});
      },
    };
  },

  async list(): Promise<StoredFile[]> {
    const files: StoredFile[] = [];
    try {
      const dir = await directory();
      for await (const [key, handle] of dir.entries()) {
        if (handle.kind !== 'file') continue;
        // Sizing is a metadata read here, not a load: getFile() hands back a
        // Blob view of what is already on disk.
        const file = await handle.getFile();
        files.push({ key, bytes: file.size, modifiedAt: file.lastModified });
      }
    } catch (err) {
      throw describeStorageFailure(err);
    }
    return files;
  },

  async read(key: string): Promise<Blob> {
    try {
      const dir = await directory();
      const handle = await dir.getFileHandle(key);
      return await handle.getFile();
    } catch (err) {
      throw describeStorageFailure(err);
    }
  },

  async remove(key: string): Promise<void> {
    const dir = await directory();
    // A file that is already gone is the state this asked for, and reporting it
    // would make deleting an index entry whose file was cleared by the browser
    // impossible.
    await dir.removeEntry(key).catch(() => {});
  },

  async removeAll(): Promise<void> {
    const root = await navigator.storage.getDirectory();
    // Recursive on the whole directory rather than entry by entry, so a file
    // the index lost track of goes with the rest instead of sitting on the
    // disk forever counting against the quota.
    await root.removeEntry(DIRECTORY, { recursive: true }).catch(() => {});
  },
};
