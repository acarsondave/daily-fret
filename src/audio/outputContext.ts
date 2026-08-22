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
const RESUME_GAP_MS = 750;

let ctx: AudioContext | null = null;
let detachUnlock: (() => void) | null = null;
let lastResumeAt = 0;
let retryTimer: ReturnType<typeof setInterval> | null = null;
// Whether anything currently wants to be heard, as opposed to whether we happen
// to be asking right now. The two came apart badly: filming a session opens a
// microphone, the browser hands the output route away, and the click gave up
// after twenty seconds while the camera held that route for the whole drill.
// The metronome, the coach and the cues were then silent for the rest of the
// session with nothing left asking for them back.
let wanted = false;
// What the last look found. Kept because audibility can change with nothing
// fired: Chrome hands the output route to a camera and leaves the context
// suspended without a statechange, so comparing against this is the only way
// anything learns the click has gone quiet.
let lastReady = false;
const listeners = new Set<(ready: boolean) => void>();

function stopRetries(): void {
  if (!retryTimer) return;
  clearInterval(retryTimer);
  retryTimer = null;
}

function notify(): void {
  const ready = isOutputAudioReady();
  lastReady = ready;
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
          // The watch outlives the recovery. It is what notices the second
          // interruption, which on some browsers arrives with no event at all.
          if (!wanted) stopRetries();
        } else if (wanted) {
          // The route was taken away while something was still trying to be
          // heard. Opening a camera does exactly this, and so does a call or
          // another tab. Start asking again from a full budget rather than
          // letting an earlier interruption's spent retries decide this one.
          armOutputAudioUnlock();
          resumeOutputAudio();
          startRetries();
        }
        notify();
      });
    }
    return ctx;
  } catch {
    return null;
  }
}

// Ask the browser to free audio, at most once every RESUME_GAP_MS.
//
// Deliberately throttled by time and NOT by an in-flight promise: WebKit leaves
// the promise from a denied resume() pending forever rather than rejecting it,
// so gating on "one in flight" latches on the first failure and never calls
// resume() again — including from inside the user gesture that would have been
// allowed. `force` skips the throttle for exactly that case.
export function resumeOutputAudio(force = false): void {
  const c = getOutputContext();
  if (!c || c.state === 'running') return;
  const now = performance.now();
  if (!force && now - lastResumeAt < RESUME_GAP_MS) return;
  lastResumeAt = now;
  try {
    void Promise.resolve(c.resume()).catch(() => {});
  } catch {
    // Older implementations throw instead of rejecting; state stays suspended
    // and the caller finds out through onOutputAudioChange like everyone else.
  }
}

// Call from inside a real user gesture. A context created outside one starts
// suspended and stays that way, however many times resume() is asked politely.
export function unlockOutputAudio(): void {
  const c = getOutputContext();
  if (!c || c.state === 'running') return;
  resumeOutputAudio(true); // a gesture is the one moment worth spending
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
// start time can lose the click for the rest of the session. Once a second is
// enough to recover without loading the media stack — the failure mode this
// replaced was resuming 40 times a second.
export function requestOutputAudio(): void {
  wanted = true;
  // Armed even when audio is already fine. Starting the watch only on a failure
  // was the gap that silenced a real session: the click started audible, a
  // camera took the route a few seconds later without firing anything, and
  // there was nothing running to find out.
  startRetries();
  if (isOutputAudioReady()) return;
  armOutputAudioUnlock(); // a tap is still the fastest route back
  resumeOutputAudio();
}

// One second-by-second look at whether the app can still be heard, running for
// as long as anything wants to be. Two jobs, and the second is the one that was
// missing: it asks for a suspended context back, and it *notices* a context that
// stopped being audible with nothing fired to say so.
//
// It used to stop the moment audio came back, which made every recovery here
// depend on a statechange arriving. Chrome does not fire one when a camera takes
// the route, and since the app started filming every session on a chosen day
// that stopped being rare. `wanted` is the honest bound: it is false the moment
// the metronome stops, and a state read once a second costs nothing.
function startRetries(): void {
  if (retryTimer) return;
  lastReady = isOutputAudioReady();
  retryTimer = setInterval(() => {
    if (!wanted) {
      stopRetries();
      return;
    }
    const ready = isOutputAudioReady();
    if (ready !== lastReady) notify();
    if (!ready) resumeOutputAudio();
  }, RETRY_MS);
}

/**
 * Something opened an audio input and may have taken the output route with it.
 *
 * Not a request: it makes no claim that anything wants to be heard, so a camera
 * opening during a silent timed block does not start the app asking for audio
 * nobody is waiting on. It only revives the asking that is already justified,
 * for the browsers that suspend a context without ever firing a statechange.
 */
export function nudgeOutputAudio(): void {
  if (!wanted) return;
  startRetries();
  if (isOutputAudioReady()) return;
  resumeOutputAudio(true);
}

// Nothing wants to be heard any more; stop asking.
export function releaseOutputAudio(): void {
  wanted = false;
  stopRetries();
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
