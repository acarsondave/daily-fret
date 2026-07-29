// One AudioContext for everything the app plays back: the metronome click and
// the SFX cues. Two reasons it is shared rather than one per feature:
//
//  1. Browsers only release audio inside a user gesture, and each context has to
//     be released on its own. One context means one unlock to get right.
//  2. iOS treats every context as a live audio route; fewer of them means fewer
//     interruptions and less to recover from.
//
// The microphone deliberately keeps its own context — mixing capture into the
// playback graph makes teardown much harder to reason about.

const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'keydown'] as const;

let ctx: AudioContext | null = null;
let detachUnlock: (() => void) | null = null;
const listeners = new Set<(ready: boolean) => void>();

function notify(): void {
  const ready = isOutputAudioReady();
  for (const fn of listeners) fn(ready);
}

// Anything other than 'running' is inaudible. Safari also reports 'interrupted'
// (a call, another app taking the route), which isn't in the spec's union.
export function isOutputAudioReady(): boolean {
  return ctx?.state === 'running';
}

export function getOutputContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    // The system can close a context behind our back (iOS interruption,
    // audio-session eviction). A closed one never plays again, so recreate
    // rather than staying silent until the page is reloaded.
    if (ctx && ctx.state === 'closed') ctx = null;
    if (!ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      ctx.addEventListener('statechange', () => {
        if (isOutputAudioReady()) detachUnlock?.();
        notify();
      });
    }
    if (ctx.state !== 'running') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// Call from inside a real user gesture. A context created outside one starts
// suspended and stays that way, however many times resume() is asked politely.
export function unlockOutputAudio(): void {
  const c = getOutputContext();
  if (!c || c.state === 'running') return;
  try {
    // iOS only truly frees a context once something has played through it, so
    // push one silent sample.
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, c.sampleRate);
    src.connect(c.destination);
    src.start(0);
  } catch {
    // A failed primer must never break the gesture handler it runs inside; the
    // resume() in getOutputContext is the part that matters.
  }
}

// Unlock on the next tap anywhere. Armed once at app start, so the user's first
// interaction frees audio long before the coach starts a click on its own.
// Self-detaches as soon as the context is running.
export function armOutputAudioUnlock(): void {
  if (typeof document === 'undefined' || detachUnlock || isOutputAudioReady()) return;
  const handler = () => unlockOutputAudio();
  UNLOCK_EVENTS.forEach((e) => document.addEventListener(e, handler, { passive: true }));
  detachUnlock = () => {
    UNLOCK_EVENTS.forEach((e) => document.removeEventListener(e, handler));
    detachUnlock = null;
  };
}

// Subscribe to audibility changes. Returns an unsubscribe.
export function onOutputAudioChange(fn: (ready: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
