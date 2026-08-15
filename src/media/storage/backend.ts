// The one shape both storage backends answer to.
//
// Written as a streaming sink rather than a `save(key, blob)` because that is
// the only interface OPFS can honour without buffering the whole clip, and the
// point of choosing OPFS is that it does not have to. IndexedDB cannot stream,
// so it buffers behind the same three methods; the cost is stated where it is
// paid (./indexeddb.ts) rather than hidden by an interface that pretends the
// two are equivalent.

import type { StorageBackend } from '../types';
import type { RecordingError } from '../failure';

export interface RecordingSink {
  /**
   * Take one chunk. Deliberately not async: MediaRecorder's dataavailable
   * handler cannot await, and a sink that needed it would drop chunks under
   * load. Ordering is the sink's problem, and a failure is reported through the
   * `onFailure` passed to `open` as well as from `close`.
   */
  write(chunk: Blob): void;
  /**
   * Finish the file and report how many bytes actually reached the disk.
   *
   * Only throws when there is nothing to keep. A write that failed part-way
   * through leaves a shorter file rather than a broken one, and the bytes that
   * landed are footage the player filmed.
   */
  close(): Promise<number>;
  /** Give up and leave nothing behind. Never throws. */
  abort(): Promise<void>;
}

export interface RecordingStore {
  readonly backend: StorageBackend;
  /**
   * Open a file for writing.
   *
   * `onFailure` is how a write that fails long after it was handed over gets
   * back to the recorder. Writes are deliberately fire-and-forget (see
   * `RecordingSink.write`), so without this the first anyone hears of a full
   * disk is `close()`, by which point the recorder has spent minutes filming
   * into a file that stopped accepting bytes. Called at most once.
   */
  open(key: string, onFailure?: (error: RecordingError) => void): Promise<RecordingSink>;
  read(key: string): Promise<Blob>;
  remove(key: string): Promise<void>;
  removeAll(): Promise<void>;
}
