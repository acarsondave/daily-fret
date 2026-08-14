// The one shape both storage backends answer to.
//
// Written as a streaming sink rather than a `save(key, blob)` because that is
// the only interface OPFS can honour without buffering the whole clip, and the
// point of choosing OPFS is that it does not have to. IndexedDB cannot stream,
// so it buffers behind the same three methods; the cost is stated where it is
// paid (./indexeddb.ts) rather than hidden by an interface that pretends the
// two are equivalent.

import type { StorageBackend } from '../types';

export interface RecordingSink {
  /**
   * Take one chunk. Deliberately not async: MediaRecorder's dataavailable
   * handler cannot await, and a sink that needed it would drop chunks under
   * load. Ordering and failures are the sink's problem, reported from close().
   */
  write(chunk: Blob): void;
  /** Finish the file and report its size in bytes. Throws a RecordingError. */
  close(): Promise<number>;
  /** Give up and leave nothing behind. Never throws. */
  abort(): Promise<void>;
}

export interface RecordingStore {
  readonly backend: StorageBackend;
  open(key: string): Promise<RecordingSink>;
  read(key: string): Promise<Blob>;
  remove(key: string): Promise<void>;
  removeAll(): Promise<void>;
}
