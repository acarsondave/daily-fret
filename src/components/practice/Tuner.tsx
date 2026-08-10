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
const CENTS_KEY = 'daily-fret-tuner-cents';
/** Beyond this the reading is a different note, not a mis-tuned string. */
const FAR_CENTS = 60;
/**
 * Past a semitone, cents stop being a unit anyone acts on. Locking onto a string
 * and then playing a different one can produce readings like "1522 cents flat",
 * which is technically true and completely useless. Beyond this the note name
 * carries the message instead, in the one place cents are shown at all.
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
 * Cents are off by default and stay a choice.
 *
 * The screen's whole job is one instruction to a person holding a guitar, and a
 * signed number in a unit they have never been taught is not that instruction.
 * It is kept for the player who does read it, one menu away, next to the sentence
 * that says what it measures.
 */
function readStoredCents(): boolean {
  try {
    return localStorage.getItem(CENTS_KEY) === 'on';
  } catch {
    return false;
  }
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
  const [showCents, setShowCents] = useState(readStoredCents);

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
  //
  // A reading with a second string ringing under it is not about one string at
  // all, so it is not matched to one. Two E strings sounding together repeat at
  // the low E's period, and the estimator reports that period at full
  // confidence; attributing it would put a green tick on the low E while the
  // player was sounding the high E, which is exactly what it used to do.
  const crowdedAt = pitch?.secondNoteAt ?? null;
  const match = useMemo(() => {
    if (!pitch || pitch.secondNoteAt !== null) return null;
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

  /**
   * Whether this reading may decide anything.
   *
   * Showing a reading and acting on one are different bars. The display follows
   * the first analysis of a new string, because a tuner that lags the instrument
   * feels broken. Marking a string done, or taking that mark away, waits for a
   * reading that is steady (several analyses agree), live (the string is still
   * sounding rather than being held on screen after it died), and singular
   * (no second string ringing with it).
   */
  const decisive = pitch !== null && !pitch.provisional && !pitch.fading && pitch.secondNoteAt === null;

  // A string counts as done only after holding tolerance, not on the first frame
  // that touches it. Peg turns overshoot through the centre constantly, and a
  // tuner that says "done" as you sweep past has told you nothing.
  const holdRef = useRef<{ position: number; since: number } | null>(null);
  useEffect(() => {
    if (!decisive || activePosition === null || verdict !== 'tuned') {
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
  }, [decisive, activePosition, verdict]);

  // The other half of the same mechanism. A string that reads clearly off again
  // has stopped being tuned, whatever we said five minutes ago: neighbours pull
  // each other flat as you work round the headstock, and new strings never stop
  // moving. Holding the reading for DRIFT_MS before pulling the tick is what
  // stops an ordinary ring or a decaying note undoing finished work.
  const driftRef = useRef<{ position: number; since: number } | null>(null);
  useEffect(() => {
    const drifting =
      decisive && activePosition !== null && Math.abs(cents) >= DRIFT_CENTS ? activePosition : null;
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
  }, [decisive, activePosition, cents]);

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

  const toggleCents = useCallback(() => {
    setShowCents((on) => {
      const next = !on;
      try {
        localStorage.setItem(CENTS_KEY, next ? 'on' : 'off');
      } catch {
        /* not being able to remember the choice is not worth failing over */
      }
      return next;
    });
  }, []);

  const togglePin = useCallback((position: number) => {
    setPinnedPosition((prev) => (prev === position ? null : position));
  }, []);

  const deaf = isDeaf(status);
  const byPosition = useMemo(
    () => new Map(tuning.strings.map((s) => [s.position, s])),
    [tuning],
  );
  const targetLabel = targetPosition ? byPosition.get(targetPosition)?.label ?? null : null;
  const pinnedLabel = pinnedPosition ? byPosition.get(pinnedPosition)?.label ?? null : null;

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
                aria-label={`Tuner options. Tuning: ${tuning.name}.`}
              >
                <TuningForkIcon size={18} />
                <span>{tuning.name}</span>
                <CaretDownIcon size={15} className={clsx('tuner-caret', pickerOpen && 'is-open')} />
              </button>
              {pickerOpen && (
                <div className="tuner-tuning-menu glass-panel" role="menu" aria-label="Tuner options">
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
                  {/* Everything an experienced player might miss lives here, one
                      tap away, and the explanation travels with the switch so
                      the unit is defined at the moment it is turned on. */}
                  <span className="tuner-menu-rule" role="separator" />
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={showCents}
                    className={clsx('tuner-tuning-option is-switch', showCents && 'is-active')}
                    onClick={toggleCents}
                  >
                    <span className="tuner-tuning-name">
                      Show cents
                      <span className={clsx('tuner-switch', showCents && 'is-on')} aria-hidden="true" />
                    </span>
                    <span className="tuner-tuning-note">
                      A cent is a hundredth of a semitone. One fret is 100 of them.
                    </span>
                  </button>
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
                crowdedAt={crowdedAt}
                match={match}
                verdict={verdict}
                far={far}
                allSettled={allSettled}
                targetLabel={targetLabel}
                pinnedLabel={pinnedLabel}
                showCents={showCents}
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

interface CallInput {
  status: PitchStatus;
  crowdedAt: number | null;
  match: { string: TuningString; cents: number } | null;
  verdict: Verdict | null;
  far: boolean;
  allSettled: boolean;
  targetLabel: string | null;
  pinnedLabel: string | null;
}

/**
 * The one sentence the screen is for.
 *
 * Everything here is an instruction to a person with both hands on an
 * instrument: which string, which way, roughly how far. Flat and sharp are not
 * used; they are the same jargon as cents in shorter words, and tighten and
 * loosen name the thing the hand is already doing. Nothing in it is a number.
 *
 * There is deliberately no branch that means "wait and hope". A tuner that
 * cannot hear says which of the several reasons it is, because they have
 * different ways out.
 */
function tuningCall({
  status,
  crowdedAt,
  match,
  verdict,
  far,
  allSettled,
  targetLabel,
  pinnedLabel,
}: CallInput): string {
  if (status === 'requesting') return 'Asking for the microphone.';
  if (status === 'asleep') return 'The browser has paused audio for this page. One tap gets it back.';
  if (status === 'muted') return 'Another app has taken the microphone. Close it and the tuner picks up again.';
  if (status === 'idle') return 'The microphone is closed.';

  // Two strings sounding together are one signal, and which of them the player
  // meant is not in it. Saying so is the only honest answer, and the way out is
  // in the same sentence.
  if (crowdedAt !== null) {
    return targetLabel
      ? `Another string is ringing. Play the ${targetLabel} alone.`
      : 'Another string is ringing. Play one string alone.';
  }

  const cents = match?.cents ?? 0;

  // The payoff lands the instant the sixth string settles, not once the note has
  // died away. It stays a resting point rather than an exit: anything that reads
  // clearly off from here pulls its tick and takes the guidance back.
  if (allSettled && (!match || Math.abs(cents) <= NEAR_CENTS)) {
    return 'All six are in tune. Go and play.';
  }

  // Nothing sounding. This is where the tuner leads: it names the string it is
  // waiting for rather than waiting silently.
  if (!match) {
    if (pinnedLabel) return `Listening for the ${pinnedLabel} only.`;
    return targetLabel ? `Play the ${targetLabel}.` : 'Play any string.';
  }

  const label = match.string.label;

  // More than a semitone out, with a pin holding the tuner on one string: the
  // distance has stopped meaning anything, so offer the way back instead.
  if (pinnedLabel && Math.abs(cents) > CENTS_READABLE_MAX) {
    return `That does not sound like the ${pinnedLabel}. Tap its peg to hear all six again.`;
  }

  if (far) return cents < 0 ? `Keep tightening the ${label}.` : `Keep loosening the ${label}.`;

  if (verdict === 'tuned') {
    return targetLabel && targetLabel !== label
      ? `The ${label} is in tune. Now the ${targetLabel}.`
      : `The ${label} is in tune.`;
  }

  if (Math.abs(cents) <= NEAR_CENTS) {
    return verdict === 'flat' ? 'Almost. A touch tighter.' : 'Almost. A touch looser.';
  }

  return verdict === 'flat' ? `Tighten the ${label}.` : `Loosen the ${label}.`;
}

interface ReadoutProps {
  status: PitchStatus;
  pitchHz: number | null;
  fading: boolean;
  crowdedAt: number | null;
  match: { string: TuningString; cents: number } | null;
  verdict: Verdict | null;
  far: boolean;
  allSettled: boolean;
  targetLabel: string | null;
  pinnedLabel: string | null;
  showCents: boolean;
  onWake: () => void;
}

function Readout({
  status,
  pitchHz,
  fading,
  crowdedAt,
  match,
  verdict,
  far,
  allSettled,
  targetLabel,
  pinnedLabel,
  showCents,
  onWake,
}: ReadoutProps) {
  const cents = match?.cents ?? 0;
  const call = tuningCall({
    status, crowdedAt, match, verdict, far, allSettled, targetLabel, pinnedLabel,
  });

  // The bar runs from true pitch out to the reading, so distance is a length
  // rather than the position of a dot. A length is the thing the eye measures
  // without being asked, which is what a screen at arm's length has to rely on.
  const puck = trackPercent(cents);
  const spanFrom = Math.min(50, puck);
  const spanTo = Math.max(50, puck);
  // The puck has run out of track. Say so on the puck rather than letting it sit
  // at the end pretending to be a reading.
  const pinnedToEnd = match !== null && Math.abs(cents) > TRACK_CENTS;

  // Cents, for the player who asked for them. Past a semitone the distance to
  // the string stops meaning anything, so the note actually sounding carries the
  // message instead, which is the only place a note name appears at all.
  const heard = pitchHz !== null ? readPitch(pitchHz) : null;
  let detail: string | null = null;
  if (showCents && match && Math.abs(cents) <= CENTS_READABLE_MAX) {
    const rounded = Math.round(cents);
    const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
    detail = `${sign}${Math.abs(rounded)} cents`;
  } else if (showCents && match && heard) {
    detail = `sounding ${heard.name}${heard.octave}`;
  }

  return (
    <div
      className={clsx(
        'tuner-readout',
        crowdedAt !== null ? 'is-crowded' : match && (far ? 'is-far' : `is-${verdict}`),
        fading && 'is-fading',
        allSettled && 'is-done',
      )}
    >
      {/* The instruction, and the largest thing on the screen. It is what the
          surface is for; everything else on it supports this sentence. */}
      <p className="tuner-call" role="status">
        {call}
      </p>

      {/* How far, drawn as a place rather than said as a number, so the bar
          landing inside the band always agrees with the sentence above it. The
          ends say what is wrong with the string, which is what makes the
          sentence's tighten and loosen self-explaining. */}
      <div className={clsx('tuner-track', !match && 'is-quiet')} aria-hidden="true">
        <div className="tuner-track-rail">
          <span className="tuner-track-zone" />
          {match && (
            <span
              className="tuner-track-span"
              style={{ left: `${spanFrom}%`, width: `${spanTo - spanFrom}%` }}
            />
          )}
          <span className="tuner-track-centre" />
          {match && (
            <span
              className={clsx('tuner-track-puck', pinnedToEnd && 'is-pinned')}
              style={{ left: `${puck}%` }}
            />
          )}
        </div>
        <div className="tuner-track-scale">
          <span>too loose</span>
          <span>too tight</span>
        </div>
      </div>

      {showCents && <p className="tuner-cents">{detail}</p>}

      {status === 'asleep' && (
        <button type="button" className="tuner-action is-primary" onClick={onWake}>
          Let the tuner hear
        </button>
      )}
    </div>
  );
}
