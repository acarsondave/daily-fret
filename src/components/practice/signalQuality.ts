import { useCallback, useEffect, useRef, useState } from 'react';
import { CHROMA_SALIENCE_MIN, MIN_STRUM_RMS, type LevelEvent } from '../../audio/detector';
import type { MicRouteState } from '../../audio/micStream';
import type { TimingLevel } from '../../audio/timing';

export type SignalQuality =
  | 'silent'
  | 'weak'
  /** Plenty of clean signal arriving, and none of it is matching any chord. */
  | 'unreadable'
  /**
   * The microphone is gone: revoked, unplugged, or taken by something else.
   *
   * Not a measurement, and not something the frames can say. A dead input
   * stops delivering frames rather than delivering quiet ones, so from in here
   * it is indistinguishable from a silent room, and telling a player to strum
   * louder at a microphone that no longer exists is the worst reading the meter
   * can give. The capture layer knows (src/audio/micStream.ts watches the
   * track's `ended` event); this is where it says so.
   */
  | 'lost'
  | 'good'
  | 'loud';

/**
 * The loudness half of the question, from one frame.
 *
 * This is all a single frame can answer. It deliberately does NOT return 'good',
 * because a frame on its own cannot know whether anything is being recognised,
 * and that turned out to be the difference between a meter that helps and a
 * meter that lies. See `useSignalMeter` below.
 */
export function classifyLevel(ev: LevelEvent | null): Exclude<SignalQuality, 'unreadable' | 'lost'> {
  if (!ev || ev.chroma === null) return 'silent';
  if (ev.rms > 0.6) return 'loud';
  if (ev.salience < CHROMA_SALIENCE_MIN) return 'weak';
  return 'good';
}

/**
 * How long a run of clean, unmatched signal has to last before the meter says so.
 *
 * Long on purpose. Changing between two shapes produces plenty of frames that
 * legitimately match nothing: the old chord dying, fingers in the air, the new
 * one not yet down. Two and a half seconds of continuous tonal signal with
 * essentially nothing matching is not a chord change, it is a microphone the
 * detector cannot read.
 */
const UNREADABLE_WINDOW_MS = 2500;
/** Below this share of matched frames, over a full window, something is wrong. */
const UNREADABLE_MATCH_SHARE = 0.05;
/** Frames of real tonal signal needed before the window is allowed an opinion. */
const UNREADABLE_MIN_FRAMES = 60;
/**
 * With no frame for this long the detector has stopped feeding us.
 *
 * A mic that is revoked, unplugged, or taken by another app stops delivering
 * frames rather than delivering quiet ones, so a meter that only updates when a
 * frame arrives freezes on whatever it last said. Green, forever, over a drill
 * that is hearing nothing.
 */
const STALE_MS = 1200;

/**
 * The same question for the strum-timing path, which has no chroma to ask about.
 *
 * Timing needs a *louder* signal than chord matching does, not a quieter one:
 * the attack detector works on how far the band level jumps, so a strum that is
 * only just above the room is a strum whose moment cannot be placed. The bar is
 * therefore the detector's own strum floor rather than a tonal one.
 */
export function classifyTimingLevel(level: TimingLevel | null): SignalQuality {
  if (!level) return 'silent';
  if (level.rms > 0.6) return 'loud';
  if (level.rms < Math.max(level.noiseFloor * 2, MIN_STRUM_RMS)) return 'silent';
  if (level.rms < MIN_STRUM_RMS * 2.5) return 'weak';
  return 'good';
}

// How long a new bucket must hold before we actually show it. Level events
// arrive ~40×/s and naturally jitter around the thresholds; without this dwell
// the meter strobes and looks broken.
const DWELL_MS = 400;

/**
 * A debounced quality, and the only place the dwell is implemented.
 *
 * Split out from `useSignalMeter` when the timing drill arrived needing the same
 * calm meter over a completely different measurement. The debounce is about how
 * a reading is shown, not about what it means, so it belongs to neither
 * classifier.
 */
function useQualityDwell() {
  const [quality, setQuality] = useState<SignalQuality>('silent');
  const currentRef = useRef<SignalQuality>('silent');
  const pendingRef = useRef<{ q: SignalQuality; since: number } | null>(null);

  const set = useCallback((q: SignalQuality) => {
    const now = Date.now();
    if (q === currentRef.current) {
      pendingRef.current = null;
      return;
    }
    if (!pendingRef.current || pendingRef.current.q !== q) {
      pendingRef.current = { q, since: now };
      return;
    }
    if (now - pendingRef.current.since >= DWELL_MS) {
      currentRef.current = q;
      pendingRef.current = null;
      setQuality(q);
    }
  }, []);

  const reset = useCallback(() => {
    currentRef.current = 'silent';
    pendingRef.current = null;
    setQuality('silent');
  }, []);

  return { quality, set, reset };
}

/**
 * Mic-quality state for the chord drills.
 *
 * This used to classify one frame at a time on tonal salience alone, and its
 * comment claimed that made it agree with the detector's matching floor. It did
 * not. Salience is computed before any template is compared, so a guitar
 * producing a perfectly clean tonal signal that matched no chord at all read
 * "good". The owner's own diagnostic exports show what that cost: two sessions,
 * forty-eight minutes of real practice, a quarter of all frames matching nothing
 * and almost nothing counted, behind a green meter the whole way. A meter that
 * is wrong in this direction is worse than no meter, because it sends the player
 * looking for the fault in their hands.
 *
 * So the window, not the frame, is the unit. Loudness still comes per frame;
 * whether anything is being recognised can only be asked over time.
 */
export function useSignalMeter(route?: MicRouteState | null) {
  const { quality, set, reset } = useQualityDwell();
  // A rolling window of recent frames that carried enough tone to be matchable,
  // and whether each one actually matched.
  const framesRef = useRef<{ at: number; matched: boolean }[]>([]);
  const lastPushRef = useRef(0);

  const push = useCallback(
    (ev: LevelEvent | null) => {
      const now = Date.now();
      lastPushRef.current = now;
      const level = classifyLevel(ev);

      // Only frames the detector had a fair chance at count towards the verdict.
      // Judging it on quiet or clipped frames would blame the detector for a
      // microphone problem the meter is already reporting as weak or loud.
      const frames = framesRef.current;
      if (level === 'good' && ev) frames.push({ at: now, matched: ev.chord !== null });
      const cutoff = now - UNREADABLE_WINDOW_MS;
      while (frames.length && frames[0].at < cutoff) frames.shift();

      if (level !== 'good') {
        set(level);
        return;
      }
      if (frames.length < UNREADABLE_MIN_FRAMES) {
        set('good');
        return;
      }
      const matched = frames.reduce((n, f) => n + (f.matched ? 1 : 0), 0);
      set(matched / frames.length < UNREADABLE_MATCH_SHARE ? 'unreadable' : 'good');
    },
    [set],
  );

  // Frames stopping is itself a reading, and the only one that catches a mic
  // that died mid-drill.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!lastPushRef.current || Date.now() - lastPushRef.current < STALE_MS) return;
      framesRef.current.length = 0;
      set('silent');
    }, 500);
    return () => clearInterval(id);
  }, [set]);

  const clear = useCallback(() => {
    framesRef.current.length = 0;
    lastPushRef.current = 0;
    reset();
  }, [reset]);

  // A microphone that has gone outranks every reading taken through it. Derived
  // here rather than pushed in, so no drill can hold a stale verdict from before
  // the input died, and so the four surfaces that show this meter cannot each
  // forget it in their own way.
  return { quality: route === 'closed' ? ('lost' as const) : quality, push, reset: clear };
}

/** The same meter, fed by the strum-timing analyser. */
export function useTimingSignalMeter() {
  const { quality, set, reset } = useQualityDwell();
  const push = useCallback((level: TimingLevel | null) => set(classifyTimingLevel(level)), [set]);
  return { quality, push, reset };
}
