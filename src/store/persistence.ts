// What happens when the disk says no.
//
// Every practice result is written to localStorage synchronously, from inside
// the click that produced it. zustand's persist middleware calls `setItem`
// straight out of its subscribe listener, so a storage that throws throws
// through `set`, through the action, and out of the event handler. React's
// error boundary never sees it: it is not a render, so nothing catches it and
// nothing is shown. The BPM readout has already moved, the drill already reads
// as done, and every result from that point on lives only in memory.
//
// localStorage runs out for real. WebKit caps an origin at roughly 5MB, the
// persisted blob is six figures of bytes today and grows with every session,
// and Safari's private mode refuses the very first write. A browser with
// cookies blocked throws on merely touching `localStorage`.
//
// So writes are guarded here and the failure becomes state the interface can
// show. Two rules the product cannot bend on:
//
//   - Never claim a result was saved when it was not. A confident wrong claim
//     costs more trust than an admitted gap.
//   - Never evict practice history to make room. The history is the product.
//     A cache can drop its oldest entry; months of someone's practice cannot.
//
// The in-memory state stays correct either way, so the session keeps working.
// What changes is that the app stops promising the session survives a reload.

import { useSyncExternalStore } from 'react';
import type { StateStorage } from 'zustand/middleware';

export type PersistenceFailure =
  /** The origin is out of room. Writing again will not help until space frees up. */
  | 'quota'
  /** Storage is refusing to serve this origin at all: blocked cookies, private mode. */
  | 'unavailable';

export type PersistenceState =
  | { status: 'saved' }
  | {
      status: 'failed';
      reason: PersistenceFailure;
      /** When the first write in this failing run was refused. */
      since: number;
      /** Bytes of the snapshot that could not be written. */
      bytes: number;
    };

let state: PersistenceState = { status: 'saved' };
const listeners = new Set<(state: PersistenceState) => void>();

export function persistenceState(): PersistenceState {
  return state;
}

export function onPersistenceChange(fn: (state: PersistenceState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Subscribe a component to whether the last write landed.
 *
 * The snapshot object is only replaced when the answer actually changes, so a
 * session of successful writes never re-renders anything reading this.
 */
export function usePersistence(): PersistenceState {
  return useSyncExternalStore(onPersistenceChange, persistenceState, persistenceState);
}

function publish(next: PersistenceState): void {
  // A run of refused writes is one failure, not one per drill. Holding the
  // first `since` keeps the interface from resetting its own alarm every time
  // the user finishes another rep into a disk that is still full.
  if (next.status === 'saved' && state.status === 'saved') return;
  if (next.status === 'failed' && state.status === 'failed' && next.reason === state.reason) return;
  state = next;
  for (const fn of listeners) fn(state);
}

// Safari and Firefox report a full origin differently, and the legacy numeric
// codes are what older WebKit still sends. Any of them means the same thing to
// the user: there is no room, and trying again changes nothing.
const QUOTA_NAMES = new Set(['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED']);
const LEGACY_QUOTA_CODES = new Set([22, 1014]);

function classify(err: unknown): PersistenceFailure {
  if (err instanceof Error && QUOTA_NAMES.has(err.name)) return 'quota';
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    if (LEGACY_QUOTA_CODES.has(err.code)) return 'quota';
  }
  return 'unavailable';
}

const encoder = new TextEncoder();

/**
 * Wrap a Storage so a refused write becomes reportable state instead of an
 * exception thrown out of a click handler.
 *
 * Takes a resolver rather than a Storage because reading `window.localStorage`
 * is itself a throwing operation when the browser has blocked storage for the
 * origin, and that throw would happen at store construction, before anything
 * exists to report it.
 */
export function guardedStorage(resolve: () => Storage): StateStorage {
  const backing = (): Storage | null => {
    try {
      return resolve();
    } catch (err) {
      publish({ status: 'failed', reason: classify(err), since: Date.now(), bytes: 0 });
      return null;
    }
  };

  return {
    getItem: (name) => {
      const store = backing();
      if (!store) return null;
      try {
        return store.getItem(name);
      } catch (err) {
        publish({ status: 'failed', reason: classify(err), since: Date.now(), bytes: 0 });
        return null;
      }
    },

    setItem: (name, value) => {
      const store = backing();
      if (!store) return;
      try {
        store.setItem(name, value);
        publish({ status: 'saved' });
      } catch (err) {
        // The old value stays where it is. Clearing the key to fit the new one
        // would trade a session's results for every session before it.
        publish({
          status: 'failed',
          reason: classify(err),
          since: Date.now(),
          bytes: encoder.encode(value).length,
        });
      }
    },

    removeItem: (name) => {
      const store = backing();
      if (!store) return;
      try {
        store.removeItem(name);
      } catch (err) {
        publish({ status: 'failed', reason: classify(err), since: Date.now(), bytes: 0 });
      }
    },
  };
}
