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

export function registerLiveMic(track: MediaStreamTrack | null): void {
  liveTrack = track;
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
