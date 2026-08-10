import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import clsx from 'clsx';
import { CloseIcon, CaretDownIcon, TuningForkIcon, MicIcon, RetryIcon } from '../icons';
import { Headstock } from './Headstock';
import { usePitchDetector, type PitchStatus } from '../../hooks/usePitchDetector';
import type { MicFailureKind } from '../../audio/micStream';
import { sfx } from '../../audio/sfx';
import {
  TUNINGS,
  DEFAULT_TUNING_ID,
  IN_TUNE_CENTS,
  NEAR_CENTS,
  getTuning,
  matchString,
  nearestString,
  readPitch,
  type Tuning,
  type TuningString,
} from '../../audio/tuning';
// The shell this surface sits in, imported by the surface that uses it. It used
// to arrive only if a drill had been opened first in the same page load, which
// is never true of a tuner: tuning is the first thing anyone does.
import './overlayShell.css';
import './tuner.css';

const TUNING_KEY = 'daily-fret-tuning';
/** Beyond this the reading is a different note, not a mis-tuned string. */
const FAR_CENTS = 60;
/**
 * Past a semitone, cents stop being a unit anyone acts on. Locking onto a string
 * and then playing a different one can produce readings like "1522 cents flat",
 * which is technically true and completely useless. Beyond this the note name
 * and the frequency carry the message instead.
 */
const CENTS_READABLE_MAX = 100;
/** How long the pitch must sit inside tolerance before a string is called done. */
const SETTLE_MS = 700;

/**
 * Hysteresis, and it is deliberate on both ends.
 *
 * A string is called done at IN_TUNE_CENTS (4) held for SETTLE_MS, and is only
 * un-done once it reads DRIFT_CENTS (12) or worse for DRIFT_MS. The gap between
 * the two thresholds is the whole point: a green string sitting at 6 or 8 cents
 * keeps its tick instead of flickering it off and on. An open string that is
 * ringing wobbles by a cent or two, a neighbour sounding sympathetically pulls
 * the estimate about, and a decaying note drifts as its partials die; matching
 * the two thresholds would turn all of that into a blinking display.
 *
 * 12 cents is chosen because it is roughly where a guitar starts to sound out
 * against itself, so the tick is pulled at about the point a player would agree
 * it should be. The live number underneath never hides any of this: it reads the
 * true distance every frame, tick or no tick.
 */
const DRIFT_CENTS = 12;
const DRIFT_MS = 300;

type Verdict = 'flat' | 'sharp' | 'tuned';

function readStoredTuning(): string {
  try {
    const stored = localStorage.getItem(TUNING_KEY);
    if (stored && TUNINGS.some((t) => t.id === stored)) return stored;
  } catch {
    /* private mode — fall through to the default */
  }
  return DEFAULT_TUNING_ID;
}

/**
 * The order the tuner leads through: 6th to 1st, thickest to thinnest.
 *
 * It is the order every beginner course names the strings in, including the one
 * this app's curriculum follows, so the sequence matches the words the learner
 * already has. It is also the order that settles the neck fastest: the low
 * strings carry the most tension, so moving them first means the smaller
 * corrections at the treble end are made against a neck that has stopped
 * shifting. Working the other way guarantees a second pass.
 */
function orderedStrings(tuning: Tuning): TuningString[] {
  return [...tuning.strings].sort((a, b) => b.position - a.position);
}

/**
 * Cents to a position along the track, as a fraction of half the track width.
 *
 * Deliberately not linear. The whole job happens in the last few cents, and on a
 * linear scale being 3 cents flat and being perfect are the same pixel, so the
 * display would go still exactly when the user still has work to do. The power
 * curve spends more of the track on the part that matters and compresses the far
 * end, which nobody reads precisely anyway.
 *
 * Because the curve compresses, the axis has to declare itself rather than let
 * the eye assume it is linear: `tuner.css` derives the tolerance band from this
 * function, and the track draws labelled marks at 25 and 50 cents from the same
 * function, so a puck near the end and a number reading 38 cannot disagree.
 */
const CENTS_CURVE = 0.7;
/** The full span of the track, either side of true pitch. */
const TRACK_CENTS = 50;
/** Fraction of half the track the puck may travel, leaving room for its own width. */
const PUCK_TRAVEL = 0.46;

function centsToOffset(cents: number): number {
  const clamped = Math.max(-1, Math.min(1, cents / TRACK_CENTS));
  return Math.sign(clamped) * Math.pow(Math.abs(clamped), CENTS_CURVE);
}

/** Percentage position along the track for a cents value. */
function trackPercent(cents: number): number {
  return 50 + centsToOffset(cents) * PUCK_TRAVEL * 100;
}

/**
 * The recovery for a refused microphone is per browser and per platform, and a
 * generic "check your settings" is the kind of help that helps nobody. Sniffing
 * the agent is the wrong tool for behaviour and the right one here: this is a
 * sentence about a menu, and the menu really is different.
 */
function permissionRoute(): string {
  if (typeof navigator === 'undefined') return 'Allow the microphone for this site in your browser settings, then try again.';
  const ua = navigator.userAgent;
  const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua);
  if (isSafari) {
    return /iPhone|iPad|iPod/.test(ua)
      ? 'In Safari, tap the page settings button in the address bar, choose Microphone, and set it to Allow. Then try again.'
      : 'In Safari, open Settings for This Website from the Safari menu, set Microphone to Allow, then try again.';
  }
  if (/Firefox/.test(ua)) {
    return 'In Firefox, click the padlock in the address bar, clear the blocked Microphone permission, then try again.';
  }
  return 'Click the padlock or the camera icon in the address bar, allow the microphone for this site, then try again.';
}

interface Recovery {
  title: string;
  body: string;
  /** Null when nothing the user does on this screen can help. */
  retry: string | null;
}

function recoveryFor(kind: MicFailureKind, message: string): Recovery {
  switch (kind) {
    case 'denied':
      return {
        title: 'The microphone is blocked for this site.',
        body: permissionRoute(),
        retry: 'Try again',
      };
    case 'no-device':
      return {
        title: 'No microphone found.',
        body: 'Plug one in, or check that your computer has an input selected, and try again.',
        retry: 'Try again',
      };
    case 'device-busy':
      return {
        title: 'Something else is using the microphone.',
        body: 'A call, a recording app, or another tab has it. Close that, then try again.',
        retry: 'Try again',
      };
    case 'insecure':
      return {
        title: 'The tuner needs a secure connection.',
        body: 'Browsers only allow the microphone over https. Open the site at its https address.',
        retry: null,
      };
    case 'unsupported':
      return {
        title: 'This browser cannot record audio.',
        body: 'The tuner needs microphone access, which this browser does not offer. Safari, Chrome, or Firefox will work.',
        retry: null,
      };
    default:
      return { title: 'The microphone could not be opened.', body: message, retry: 'Try again' };
  }
}

/** True while the tuner is provably not hearing anything, whatever the reason. */
function isDeaf(status: PitchStatus): boolean {
  return status !== 'listening';
}

interface Props {
  onClose: () => void;
}

export function Tuner({ onClose }: Props) {
  const reducedMotion = useReducedMotion();
  const { status, failure, error, pitch, levelRef, start, stop, wake } = usePitchDetector();

  const [tuningId, setTuningId] = useState(readStoredTuning);
  const [pickerOpen, setPickerOpen] = useState(false);
  /**
   * The user overriding the sequence. Pinning both aims the tuner at one string
   * and stops it listening to the others, which is the way out when a string is
   * so far off that it reads as its neighbour.
   */
  const [pinnedPosition, setPinnedPosition] = useState<number | null>(null);
  const [settled, setSettled] = useState<number[]>([]);

  const tuning = useMemo(() => getTuning(tuningId), [tuningId]);
  const order = useMemo(() => orderedStrings(tuning), [tuning]);
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void start();
    return () => {
      void stop();
    };
  }, [start, stop]);

  // Escape closes the picker if it is open, and the tuner otherwise, so the key
  // always undoes exactly one thing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pickerOpen) {
        setPickerOpen(false);
        pickerTriggerRef.current?.focus();
      } else {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pickerOpen, onClose]);

  useEffect(() => {
    if (!pickerOpen) return;
    // pointerdown, not mousedown: it covers touch and pen, so a tap outside the
    // menu closes it on a phone instead of waiting for a synthesised mouse event.
    const onPointerDown = (e: PointerEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [pickerOpen]);

  // Reading -> what the display is about. `match` is which string, `verdict` is
  // how it is doing, `far` means the pitch is closer to some other note entirely.
  //
  // Note that a pin, not the sequence target, is what narrows detection. The
  // tuner leads, but it never refuses to read the string actually being played:
  // being told "that is the D string, and it is 30 cents flat" when you meant to
  // play A is more use than being told nothing.
  const match = useMemo(() => {
    if (!pitch) return null;
    const pinned = pinnedPosition
      ? tuning.strings.find((s) => s.position === pinnedPosition)
      : undefined;
    return pinned ? matchString(pitch.hz, pinned) : nearestString(pitch.hz, tuning);
  }, [pitch, tuning, pinnedPosition]);

  const cents = match?.cents ?? 0;
  const activePosition = match?.string.position ?? null;
  const far = match !== null && Math.abs(cents) > FAR_CENTS;
  const verdict: Verdict | null = match
    ? Math.abs(cents) <= IN_TUNE_CENTS
      ? 'tuned'
      : cents < 0
        ? 'flat'
        : 'sharp'
    : null;

  // A string counts as done only after holding tolerance, not on the first frame
  // that touches it. Peg turns overshoot through the centre constantly, and a
  // tuner that says "done" as you sweep past has told you nothing.
  const holdRef = useRef<{ position: number; since: number } | null>(null);
  useEffect(() => {
    if (activePosition === null || verdict !== 'tuned') {
      holdRef.current = null;
      return;
    }
    if (holdRef.current?.position !== activePosition) {
      holdRef.current = { position: activePosition, since: Date.now() };
    }
    const remaining = Math.max(0, SETTLE_MS - (Date.now() - holdRef.current.since));
    const timer = window.setTimeout(() => {
      setSettled((prev) => {
        if (prev.includes(activePosition)) return prev;
        sfx.tuned();
        return [...prev, activePosition];
      });
    }, remaining);
    return () => clearTimeout(timer);
  }, [activePosition, verdict]);

  // The other half of the same mechanism. A string that reads clearly off again
  // has stopped being tuned, whatever we said five minutes ago: neighbours pull
  // each other flat as you work round the headstock, and new strings never stop
  // moving. Holding the reading for DRIFT_MS before pulling the tick is what
  // stops an ordinary ring or a decaying note undoing finished work.
  const driftRef = useRef<{ position: number; since: number } | null>(null);
  useEffect(() => {
    const drifting =
      activePosition !== null && Math.abs(cents) >= DRIFT_CENTS ? activePosition : null;
    if (drifting === null) {
      driftRef.current = null;
      return;
    }
    if (driftRef.current?.position !== drifting) {
      driftRef.current = { position: drifting, since: Date.now() };
    }
    const remaining = Math.max(0, DRIFT_MS - (Date.now() - driftRef.current.since));
    const timer = window.setTimeout(() => {
      setSettled((prev) => (prev.includes(drifting) ? prev.filter((p) => p !== drifting) : prev));
    }, remaining);
    return () => clearTimeout(timer);
  }, [activePosition, cents]);

  /**
   * Where the tuner is pointing. A pin wins; otherwise it is the next string in
   * order that is not done, so finishing one hands the sequence on by itself.
   * It goes null only when all six are done, and comes straight back the moment
   * one drifts out, which is what makes the finished state a resting point
   * rather than an exit.
   */
  const targetPosition = useMemo(() => {
    if (pinnedPosition !== null) return pinnedPosition;
    return order.find((s) => !settled.includes(s.position))?.position ?? null;
  }, [pinnedPosition, order, settled]);

  const allSettled = settled.length === tuning.strings.length;
  const allSettledRef = useRef(false);
  useEffect(() => {
    if (allSettled && !allSettledRef.current) sfx.complete();
    allSettledRef.current = allSettled;
  }, [allSettled]);

  const chooseTuning = useCallback((id: string) => {
    setTuningId(id);
    setPickerOpen(false);
    setPinnedPosition(null);
    setSettled([]);
    try {
      localStorage.setItem(TUNING_KEY, id);
    } catch {
      /* not being able to remember the choice is not worth failing over */
    }
  }, []);

  const togglePin = useCallback((position: number) => {
    setPinnedPosition((prev) => (prev === position ? null : position));
  }, []);

  const deaf = isDeaf(status);
  const byPosition = useMemo(
    () => new Map(tuning.strings.map((s) => [s.position, s])),
    [tuning],
  );
  const targetName = targetPosition ? byPosition.get(targetPosition)?.name ?? null : null;
  const pinnedName = pinnedPosition ? byPosition.get(pinnedPosition)?.name ?? null : null;

  return createPortal(
    <motion.div
      className={clsx('practice-overlay tuner-overlay', allSettled && 'is-done')}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="practice-topbar">
        <span className="practice-eyebrow">Tuner</span>
        <div className="practice-topbar-actions">
          <button className="practice-close" onClick={onClose} aria-label="Close the tuner">
            <CloseIcon size={20} />
          </button>
        </div>
      </div>

      <div className="practice-body tuner-body">
        {status === 'error' ? (
          <Blocked
            kind={failure ?? 'failed'}
            message={error ?? 'The microphone could not be opened.'}
            onRetry={() => void start()}
          />
        ) : (
          <>
            <div className="tuner-tuning" ref={pickerRef}>
              <button
                ref={pickerTriggerRef}
                type="button"
                className="tuner-tuning-trigger"
                onClick={() => setPickerOpen((open) => !open)}
                aria-expanded={pickerOpen}
                aria-haspopup="menu"
              >
                <TuningForkIcon size={18} />
                <span>{tuning.name}</span>
                <CaretDownIcon size={15} className={clsx('tuner-caret', pickerOpen && 'is-open')} />
              </button>
              {pickerOpen && (
                <div className="tuner-tuning-menu glass-panel" role="menu" aria-label="Choose a tuning">
                  {TUNINGS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={t.id === tuningId}
                      className={clsx('tuner-tuning-option', t.id === tuningId && 'is-active')}
                      onClick={() => chooseTuning(t.id)}
                    >
                      <span className="tuner-tuning-name">{t.name}</span>
                      <span className="tuner-tuning-note">{t.note}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="tuner-stage">
              <Headstock
                strings={tuning.strings}
                activePosition={deaf ? null : activePosition}
                targetPosition={deaf ? null : targetPosition}
                pinnedPosition={pinnedPosition}
                settled={settled}
                deaf={deaf}
                allSettled={allSettled}
                levelRef={levelRef}
                reducedMotion={Boolean(reducedMotion)}
                onSelect={togglePin}
              />

              <Readout
                status={status}
                pitchHz={pitch?.hz ?? null}
                fading={pitch?.fading ?? false}
                match={match}
                verdict={verdict}
                far={far}
                allSettled={allSettled}
                targetName={targetName}
                pinnedName={pinnedName}
                onWake={wake}
              />
            </div>
          </>
        )}
      </div>
    </motion.div>,
    document.body,
  );
}

interface BlockedProps {
  kind: MicFailureKind;
  message: string;
  onRetry: () => void;
}

function Blocked({ kind, message, onRetry }: BlockedProps) {
  const { title, body, retry } = recoveryFor(kind, message);
  return (
    <div className="tuner-blocked" role="alert">
      <span className="tuner-blocked-mark" aria-hidden="true">
        <MicIcon size={26} />
      </span>
      <p className="tuner-blocked-title">{title}</p>
      <p className="tuner-blocked-body">{body}</p>
      {retry && (
        <button type="button" className="tuner-action is-primary" onClick={onRetry}>
          <RetryIcon size={17} /> {retry}
        </button>
      )}
    </div>
  );
}

interface ReadoutProps {
  status: PitchStatus;
  pitchHz: number | null;
  fading: boolean;
  match: { string: TuningString; cents: number } | null;
  verdict: Verdict | null;
  far: boolean;
  allSettled: boolean;
  targetName: string | null;
  pinnedName: string | null;
  onWake: () => void;
}

function Readout({
  status,
  pitchHz,
  fading,
  match,
  verdict,
  far,
  allSettled,
  targetName,
  pinnedName,
  onWake,
}: ReadoutProps) {
  const heard = pitchHz !== null ? readPitch(pitchHz) : null;
  const cents = match?.cents ?? 0;
  const rounded = Math.round(cents);

  // Once the pitch is most of a semitone from the string, the string's name is
  // no longer an honest headline: the display would read "D" while the guitar is
  // sounding a D sharp. Past that point the heading becomes what was actually
  // heard, and the string it is being measured against moves into the small line.
  const headline = far && heard ? { name: heard.name, octave: heard.octave } : match?.string ?? null;
  const showCents = match !== null && Math.abs(cents) <= CENTS_READABLE_MAX;
  // The puck has run out of track. Say so on the puck rather than letting it sit
  // at the end pretending to be a reading.
  const pinnedToEnd = match !== null && Math.abs(cents) > TRACK_CENTS;

  // Every status renders something a person can act on. There is deliberately no
  // branch here that means "wait and hope": a tuner that cannot hear says which
  // of the several reasons it is, because they have different ways out.
  let guidance: string;
  if (status === 'requesting') {
    guidance = 'Asking for the microphone.';
  } else if (status === 'asleep') {
    guidance = 'The browser has paused audio for this page. One tap gets it back.';
  } else if (status === 'muted') {
    guidance = 'Another app has taken the microphone. Close it and the tuner picks up again.';
  } else if (status === 'idle') {
    guidance = 'The microphone is closed.';
  } else if (allSettled && (!match || Math.abs(cents) <= NEAR_CENTS)) {
    // The payoff lands the instant the sixth string settles, not once the note
    // has died away. It stays a resting point rather than an exit: anything that
    // reads clearly off from here pulls its tick and takes the guidance back.
    guidance = 'All six. Go and play, or sound any string to check it again.';
  } else if (!match) {
    // Nothing sounding. This is where the tuner leads: it names the string it is
    // waiting for rather than waiting silently.
    guidance = pinnedName
      ? `Listening for the ${pinnedName} string only.`
      : targetName
        ? `Play the ${targetName} string.`
        : 'Play a string. I will work out which one.';
  } else if (!showCents) {
    // More than a semitone out. Say what is actually going on instead of
    // reporting a distance, and if a pin is what caused it, offer the way back.
    guidance = pinnedName
      ? `That does not sound like the ${pinnedName} string. Tap ${pinnedName} to listen to all six again.`
      : cents < 0
        ? 'A long way flat. Keep tightening.'
        : 'A long way sharp. Keep easing it off.';
  } else if (far) {
    guidance = cents < 0 ? 'A long way flat. Keep tightening.' : 'A long way sharp. Keep easing it off.';
  } else if (verdict === 'tuned') {
    guidance = targetName && targetName !== match.string.name
      ? `${match.string.name} is in tune. ${targetName} next.`
      : `${match.string.name} is in tune.`;
  } else if (Math.abs(cents) <= NEAR_CENTS) {
    guidance = verdict === 'flat' ? 'Almost. A hair tighter.' : 'Almost. A touch looser.';
  } else {
    guidance = verdict === 'flat' ? 'Flat. Tighten it.' : 'Sharp. Ease it off.';
  }

  return (
    <div
      className={clsx(
        'tuner-readout',
        match && (far ? 'is-far' : `is-${verdict}`),
        fading && 'is-fading',
        allSettled && 'is-done',
      )}
    >
      <div className="tuner-readout-note">
        {/* Empty until a string sounds. The slot keeps its height rather than
            holding a placeholder glyph, which only ever read as an artefact. */}
        {headline && (
          <>
            <span className="tuner-readout-name">{headline.name}</span>
            <span className="tuner-readout-octave">{headline.octave}</span>
          </>
        )}
      </div>

      {/* The number, at the size the rest of the world puts it, because a player
          who already reads cents should not have to learn this tuner's own
          dialect to use it. Signed the universal way: negative is flat. The word
          underneath is for everyone who has never been told which is which. */}
      <div className="tuner-readout-cents">
        {showCents && match ? (
          <>
            <span className="tuner-readout-value">
              {rounded > 0 ? '+' : rounded < 0 ? '−' : ''}
              {Math.abs(rounded)}
            </span>
            <span className="tuner-readout-unit">
              {far
                ? `cents from ${match.string.name}`
                : verdict === 'tuned'
                  ? 'cents, in tune'
                  : cents < 0
                    ? 'cents flat'
                    : 'cents sharp'}
            </span>
          </>
        ) : (
          heard && <span className="tuner-readout-unit">{heard.hz.toFixed(1)} Hz</span>
        )}
      </div>

      {/* The tolerance drawn as a place, not a number, so the marker landing
          inside the band always agrees with the sentence underneath. The 25-cent
          marks are placed by the same curve as the puck, so the axis shows its
          own compression instead of inviting the eye to read it as linear. */}
      <div className={clsx('tuner-track', !match && 'is-quiet')}>
        <div className="tuner-track-rail">
          <span className="tuner-track-zone" aria-hidden="true" />
          <span className="tuner-track-centre" aria-hidden="true" />
          <span className="tuner-track-tick" aria-hidden="true" style={{ left: `${trackPercent(-25)}%` }} />
          <span className="tuner-track-tick" aria-hidden="true" style={{ left: `${trackPercent(25)}%` }} />
          {match && (
            <span
              className={clsx('tuner-track-puck', pinnedToEnd && 'is-pinned')}
              aria-hidden="true"
              style={{ left: `${trackPercent(cents)}%` }}
            />
          )}
        </div>
        <div className="tuner-track-scale" aria-hidden="true">
          <span>−50 flat</span>
          <span>sharp +50</span>
        </div>
      </div>

      <p className="tuner-guidance" role="status">
        {guidance}
      </p>

      {status === 'asleep' && (
        <button type="button" className="tuner-action is-primary" onClick={onWake}>
          Let the tuner hear
        </button>
      )}
    </div>
  );
}
