// The microphone track that is open right now, if there is one.
//
// The video recorder needs guitar audio, and a drill usually already has the
// microphone open with settings chosen for a guitar: echo cancellation, noise
// suppression and automatic gain all deliberately off, because every one of
// them is tuned for speech and mangles an instrument. Opening a second
// getUserMedia for the recorder would take a second audio session against the
// same input, which on iOS is enough to make the first one drop out mid-drill,
// and would capture the guitar through the browser's speech processing anyway.
//
// So the recorder clones the track that is already live instead. A clone is
// independent: stopping it does not stop the drill's capture, and the drill
// stopping does not silence the recording mid-clip, it just ends the track.
//
// A registry rather than a parameter threaded through the component tree,
// because the surfaces that start a recording (the practice overlay, the
// coached session) are not the ones that own the microphone (each drill owns
// its own detector). Exactly one MicStream is meant to be live at a time, which
// is what makes a module-level answer to "is the mic open" a fact rather than a
// guess; registering a second one replaces the first, so the answer is always
// the most recently opened.

let liveTrack: MediaStreamTrack | null = null;

/**
 * Resolvers waiting for a microphone that is on its way.
 *
 * "Is the mic open" is the wrong question during the half-second that decides
 * the answer. A coached session starts a drill and a recording in the same
 * commit: the drill calls getUserMedia and the recorder asks this module about
 * a track that is 385ms from existing. Answering "no" is how the recorder ends
 * up opening a second, independent audio session against the same input, which
 * is the exact outcome this module exists to prevent.
 *
 * Non-empty only while an open is genuinely in flight, so a surface with no
 * microphone at all (a song play-along, a timed block) is still answered
 * immediately rather than made to wait out a timeout.
 */
let opening = 0;
let waiters: Array<() => void> = [];

const settle = (): void => {
  const pending = waiters;
  waiters = [];
  for (const resume of pending) resume();
};

/** A microphone is being opened. Must be paired with `endMicOpen`. */
export function beginMicOpen(): void {
  opening += 1;
}

/**
 * That open has finished, one way or the other.
 *
 * Called on every exit path including failure and teardown, because a recorder
 * waiting on a microphone that is never coming is worse than one that opened
 * its own: it delays the footage and then produces silent footage anyway.
 */
export function endMicOpen(): void {
  opening = Math.max(0, opening - 1);
  if (opening === 0) settle();
}

export function registerLiveMic(track: MediaStreamTrack | null): void {
  liveTrack = track;
  // Anything waiting wanted this exact moment, and waiting for the rest of the
  // graph to finish would hand back a track the caller could already have used.
  if (track) settle();
}

export function clearLiveMic(track: MediaStreamTrack | null): void {
  // By identity: a stream torn down after another one opened must not clear the
  // newer one's registration.
  if (track === null || liveTrack === track) liveTrack = null;
}

/**
 * A clonable, live guitar audio track, or null.
 *
 * Checks readyState rather than trusting the registration: a track can end
 * without its owner tearing down (device unplugged), and cloning an ended track
 * produces a silent recording that looks like it worked.
 */
export function liveMicTrack(): MediaStreamTrack | null {
  if (!liveTrack) return null;
  if (liveTrack.readyState !== 'live') return null;
  return liveTrack;
}

/**
 * The same answer, but willing to wait for a microphone that is already opening.
 *
 * Returns immediately in both of the cases that are not a race: a track is
 * already live, or nothing is opening at all. Only the genuine overlap waits,
 * and it waits for the open to finish rather than for a fixed delay, so the
 * common case costs nothing and the timeout is only a backstop against a
 * getUserMedia that never settles.
 */
export function awaitLiveMicTrack(timeoutMs: number): Promise<MediaStreamTrack | null> {
  const ready = liveMicTrack();
  if (ready) return Promise.resolve(ready);
  if (opening === 0) return Promise.resolve(null);

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      waiters = waiters.filter((w) => w !== finish);
      resolve(liveMicTrack());
    };
    const timer = setTimeout(finish, timeoutMs);
    waiters.push(finish);
  });
}
