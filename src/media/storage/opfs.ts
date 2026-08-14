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

import type { RecordingSink, RecordingStore } from './backend';
import { describeStorageFailure } from '../failure';

const DIRECTORY = 'daily-fret-recordings';

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

  async open(key: string): Promise<RecordingSink> {
    let stream: FileSystemWritableFileStream;
    try {
      const dir = await directory();
      const file = await dir.getFileHandle(key, { create: true });
      stream = await file.createWritable();
    } catch (err) {
      throw describeStorageFailure(err);
    }

    // Writes are serialised through this promise rather than awaited by the
    // caller. MediaRecorder's dataavailable handler is not async-aware: if two
    // chunks arrive while a write is in flight and both call write(), the
    // stream throws "already locked" and the tail of the recording is lost.
    let queue: Promise<void> = Promise.resolve();
    let written = 0;
    let failure: unknown = null;

    return {
      write(chunk: Blob): void {
        written += chunk.size;
        queue = queue.then(
          () => stream.write(chunk),
          // Once one write has failed the file is already wrong; keep the first
          // reason and stop trying, rather than reporting the tenth failure.
          (err) => {
            failure ??= err;
          },
        );
      },
      async close(): Promise<number> {
        await queue;
        try {
          await stream.close();
        } catch (err) {
          failure ??= err;
        }
        if (failure) throw describeStorageFailure(failure);
        return written;
      },
      async abort(): Promise<void> {
        await queue.catch(() => {});
        await stream.abort().catch(() => {});
        await opfsStore.remove(key).catch(() => {});
      },
    };
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
