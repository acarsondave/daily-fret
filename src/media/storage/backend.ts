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
   * Bytes confirmed onto the disk so far, readable without awaiting anything.
   *
   * Exists for the one moment nothing can be awaited: the page is going away
   * mid-recording, and the choice is between filing a row for the footage that
   * already landed and leaving the file on the disk with nothing pointing at it
   * forever.
   */
  bytesFlushed(): number;
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

/** One file a backend is holding, whether or not the index knows about it. */
export interface StoredFile {
  key: string;
  /**
   * Bytes on disk, or null when the backend cannot answer without loading the
   * whole file into memory. IndexedDB is the null case: sizing a clip there
   * means reading it, and reading every clip to count bytes would cost hundreds
   * of megabytes of heap to answer a question about disk.
   */
  bytes: number | null;
  /** When the file was last written, or null when the backend does not track it. */
  modifiedAt: number | null;
}

export interface RecordingStore {
  readonly backend: StorageBackend;
  /**
   * Every file this backend is holding, read from the disk rather than from the
   * index.
   *
   * This is the only way to see a file the index has lost. Without it the index
   * is the sole authority on what exists, which means any clip whose row failed
   * to commit is invisible, unplayable, undeletable and permanently counted
   * against the quota. That is not hypothetical: it had leaked 469 MB across 14
   * files on the first machine anyone checked.
   */
  list(): Promise<StoredFile[]>;
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
