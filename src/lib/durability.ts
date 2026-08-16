// Asking the browser to keep this.
//
// Everything the app knows lives in this origin's storage: the practice
// history in localStorage, the footage in the Origin Private File System. By
// default all of it is "best-effort", which is a term of art meaning the
// browser may throw it away.
//
// That is not a remote risk. WebKit deletes all script-written storage for an
// origin that has gone seven days of browser use without a click or a tap, and
// Chromium evicts least-recently-used origins under disk pressure. A fortnight
// away from the guitar is a normal thing for a person to do and an ordinary
// reason to lose months of practice history.
//
// `navigator.storage.persist()` moves the origin out of that category. Safari's
// seven-day rule applies to best-effort storage only, and a persisted origin is
// exempt; Chromium and WebKit both answer automatically from browsing history
// with no prompt, so asking costs the user nothing. Firefox does prompt, which
// is why this is only ever called from inside a real user gesture rather than
// fired off at startup.
//
// It is deliberately a request and not a guarantee. A denied request is
// reported honestly rather than hidden, because "your practice is saved" is a
// claim the app has to be able to stand behind.

export type Durability =
  /** Not asked yet. */
  | 'unknown'
  /** The browser has agreed to keep this until the user deletes it. */
  | 'persistent'
  /** The browser reserves the right to clear it. */
  | 'best-effort'
  /** No Storage API, so there is nothing to ask and nothing to promise. */
  | 'unsupported';

let state: Durability = 'unknown';
let asking: Promise<Durability> | null = null;
const listeners = new Set<(state: Durability) => void>();

export function storageDurability(): Durability {
  return state;
}

export function onDurabilityChange(fn: (state: Durability) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function settle(next: Durability): Durability {
  if (next === state) return state;
  state = next;
  for (const fn of listeners) fn(state);
  return state;
}

function supported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.persist === 'function' &&
    typeof navigator.storage?.persisted === 'function'
  );
}

/**
 * Read the current answer without asking for anything.
 *
 * Safe at startup: `persisted()` is a query, it never prompts, and it never
 * changes the browser's mind.
 */
export async function readDurability(): Promise<Durability> {
  if (!supported()) return settle('unsupported');
  try {
    return settle((await navigator.storage.persisted()) ? 'persistent' : 'best-effort');
  } catch {
    // A browser that will not answer is one that cannot promise anything.
    return settle('unsupported');
  }
}

/**
 * Ask the browser to keep this origin's data.
 *
 * Call from inside a user gesture. Two reasons: Firefox shows a prompt, and a
 * prompt that arrives unprovoked is worse than one that follows a tap; and the
 * browsers that decide automatically weigh engagement, so asking during real use
 * is asking at the moment most likely to be granted.
 *
 * Cheap to call repeatedly. A browser that said no today can say yes next week
 * once the app has more history behind it, so this is asked again on later
 * visits rather than written off after one refusal.
 */
export function requestDurableStorage(): Promise<Durability> {
  if (state === 'persistent' || state === 'unsupported') return Promise.resolve(state);
  // One request in flight at a time. Several drills finishing at once must not
  // turn into several persist() calls.
  asking ??= (async () => {
    if (!supported()) return settle('unsupported');
    try {
      if (await navigator.storage.persisted()) return settle('persistent');
      return settle((await navigator.storage.persist()) ? 'persistent' : 'best-effort');
    } catch {
      return settle('unsupported');
    } finally {
      asking = null;
    }
  })();
  return asking;
}
