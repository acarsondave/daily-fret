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
const RETRY_MS = 1000;
const RETRY_LIMIT = 20;

let ctx: AudioContext | null = null;
let detachUnlock: (() => void) | null = null;
let resuming: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setInterval> | null = null;
let retriesLeft = 0;
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

// Pure getter: creates the context if needed and never resumes it. Resuming
// belongs to resumeOutputAudio() alone. This function is called from the
// metronome's 25ms scheduler tick, and a resume() from a hot path is not a
// no-op when it can't succeed — it queues work on the browser's media stack
// dozens of times a second and starves everything else playing, the coach's
// <audio> lines included.
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
        if (isOutputAudioReady()) {
          detachUnlock?.();
          releaseOutputAudio();
        }
        notify();
      });
    }
    return ctx;
  } catch {
    return null;
  }
}

// Ask the browser to free audio. Single-flight: a second call while one is in
// flight returns the same promise, so no path can stack these up.
export function resumeOutputAudio(): Promise<void> {
  const c = getOutputContext();
  if (!c) return Promise.resolve();
  if (c.state === 'running') return Promise.resolve();
  if (resuming) return resuming;
  const settle = () => {
    resuming = null;
  };
  const started = c.resume() as Promise<void> | undefined;
  resuming =
    started && typeof started.then === 'function'
      ? started.then(settle, settle)
      : Promise.resolve().then(settle);
  return resuming;
}

// Call from inside a real user gesture. A context created outside one starts
// suspended and stays that way, however many times resume() is asked politely.
export function unlockOutputAudio(): void {
  const c = getOutputContext();
  if (!c || c.state === 'running') return;
  void resumeOutputAudio();
  try {
    // iOS only truly frees a context once something has played through it, so
    // push one silent sample.
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, c.sampleRate);
    src.connect(c.destination);
    src.start(0);
  } catch {
    // A failed primer must never break the gesture handler it runs inside; the
    // resumeOutputAudio() above is the part that matters.
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

// Keep asking for audio while something actually wants to be heard. Safari can
// hand the audio session to a media element (the coach's voice clips) and leave
// this context suspended with no statechange to react to, so a single attempt at
// start time can lose the click for the rest of the session. Once a second, at
// most for RETRY_LIMIT tries, is enough to recover without loading the media
// stack — the failure mode this replaced was resuming 40 times a second.
export function requestOutputAudio(): void {
  if (isOutputAudioReady()) return;
  armOutputAudioUnlock(); // a tap is still the fastest route back
  void resumeOutputAudio();
  if (retryTimer) return;
  retriesLeft = RETRY_LIMIT;
  retryTimer = setInterval(() => {
    if (isOutputAudioReady() || retriesLeft-- <= 0) {
      releaseOutputAudio();
      return;
    }
    void resumeOutputAudio();
  }, RETRY_MS);
}

// Nothing wants to be heard any more; stop asking.
export function releaseOutputAudio(): void {
  if (!retryTimer) return;
  clearInterval(retryTimer);
  retryTimer = null;
}

// Readable state for diagnosing a silent session in the field.
export function outputAudioState(): { context: string; asking: boolean; armed: boolean } {
  return { context: ctx?.state ?? 'none', asking: !!retryTimer, armed: !!detachUnlock };
}

// Subscribe to audibility changes. Returns an unsubscribe.
export function onOutputAudioChange(fn: (ready: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
