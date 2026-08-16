// The fallback, for browsers without a writable Origin Private File System.
//
// It buffers the whole clip in memory and writes one Blob at the end, because
// IndexedDB has no streaming write. That is a real cost and it is why this is
// the fallback: a 25-minute session at 720p is roughly 270 MB of heap held
// until the recording stops. Everything else in the app is unaffected by that
// only because the recorder caps how long a single clip runs (see recorder.ts).
//
// It is still the right fallback. It is the only browser storage that takes a
// Blob of that size without base64-inflating it, it survives a reload, it is
// per-origin like OPFS, and it does not touch localStorage, where the practice
// history lives and where a hundred megabytes would take the whole app down.

import type { RecordingSink, RecordingStore, StoredFile } from './backend';
import { describeStorageFailure, type RecordingError } from '../failure';
import { markFinished, markWriting } from './inflight';

const DB_NAME = 'daily-fret-recordings';
const DB_VERSION = 1;
const STORE = 'clips';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(describeStorageFailure(request.error));
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(describeStorageFailure(request.error));
        // The transaction can fail after the request succeeded, and quota is
        // exactly the failure that arrives that way.
        tx.onabort = () => reject(describeStorageFailure(tx.error));
        tx.oncomplete = () => db.close();
      }),
  );
}

export function indexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export const indexedDbStore: RecordingStore = {
  backend: 'indexeddb',

  async open(key: string, onFailure?: (error: RecordingError) => void): Promise<RecordingSink> {
    const chunks: Blob[] = [];
    let written = 0;
    let type = '';
    // Same rule as the OPFS sink: a chunk that arrives after the file is
    // finished is dropped rather than reopening a closed record.
    let sealed = false;
    // Nothing is on disk yet here, since this backend writes once at close().
    // Claimed anyway so the key is reserved for the whole recording rather than
    // only for the instant the put lands.
    markWriting(key);

    return {
      write(chunk: Blob): void {
        if (sealed) return;
        // The first chunk carries the type MediaRecorder actually produced,
        // which is what makes the reassembled Blob playable.
        if (!type && chunk.type) type = chunk.type;
        chunks.push(chunk);
        written += chunk.size;
      },
      // Always zero until close(), and that is the truth rather than a gap:
      // this backend holds the whole clip in memory and writes it once, so
      // until the put lands there is nothing on the disk to file a row for.
      bytesFlushed(): number {
        return 0;
      },
      async close(): Promise<number> {
        if (sealed) return written;
        sealed = true;
        markFinished(key);
        try {
          await run('readwrite', (store) => store.put(new Blob(chunks, { type }), key));
        } catch (err) {
          // Nothing partial to keep: this backend holds the whole clip in memory
          // and writes it once, so a failed put means no file at all. Reported
          // through both channels for the same reason the OPFS sink does, so a
          // caller that only listens to one of them still hears about it.
          const failure = describeStorageFailure(err);
          onFailure?.(failure);
          chunks.length = 0;
          throw failure;
        }
        chunks.length = 0;
        return written;
      },
      async abort(): Promise<void> {
        sealed = true;
        markFinished(key);
        chunks.length = 0;
      },
    };
  },

  async list(): Promise<StoredFile[]> {
    const keys = await run<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
    // Sizes and timestamps are deliberately not reported. IndexedDB keeps
    // neither as metadata, so the only way to produce them is to read every clip
    // back into memory, which for a library of half-hour sessions is hundreds of
    // megabytes of heap spent answering a question about disk. A caller that
    // gets null here should say it does not know rather than guess.
    return keys
      .filter((key): key is string => typeof key === 'string')
      .map((key) => ({ key, bytes: null, modifiedAt: null }));
  },

  async read(key: string): Promise<Blob> {
    const value = await run<unknown>('readonly', (store) => store.get(key) as IDBRequest<unknown>);
    if (!(value instanceof Blob)) {
      throw describeStorageFailure(new Error('That recording is no longer on this device.'));
    }
    return value;
  },

  async remove(key: string): Promise<void> {
    await run('readwrite', (store) => store.delete(key));
  },

  async removeAll(): Promise<void> {
    await run('readwrite', (store) => store.clear());
  },
};
