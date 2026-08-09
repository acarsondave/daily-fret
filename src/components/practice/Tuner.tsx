import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import clsx from 'clsx';
import { CheckIcon, CloseIcon, CaretDownIcon, TuningForkIcon } from '../icons';
import { MicPermissionHint } from './MicPermissionHint';
import { usePitchDetector } from '../../hooks/usePitchDetector';
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
  type TuningString,
} from '../../audio/tuning';
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
/** Input level that drives the string to full visual amplitude. */
const FULL_AMPLITUDE_RMS = 0.22;

/** A string at rest, in the row's 100x20 viewBox. */
const FLAT_WIRE = 'M0 10 C 25 10, 75 10, 100 10';

/** Relative visual gauge, 1st (thinnest) through 6th. Real string ratios. */
const STROKE_BY_POSITION: Record<number, number> = { 1: 1, 2: 1.4, 3: 1.9, 4: 2.5, 5: 3.2, 6: 4 };

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
 * Cents to a position along the track, as a fraction of half the track width.
 *
 * Deliberately not linear. The whole job happens in the last few cents, and on a
 * linear scale being 3 cents flat and being perfect are the same pixel, so the
 * display would go still exactly when the user still has work to do. The power
 * curve spends more of the track on the part that matters and compresses the far
 * end, which nobody reads precisely anyway.
 *
 * The exponent is a balance: too aggressive and a reading well inside tolerance
 * still sits near the edge of the tolerance band, which makes the display argue
 * with itself. `tuner.css` derives the band's width from this curve, so the two
 * have to move together.
 */
const CENTS_CURVE = 0.7;

function centsToOffset(cents: number): number {
  const clamped = Math.max(-1, Math.min(1, cents / 50));
  return Math.sign(clamped) * Math.pow(Math.abs(clamped), CENTS_CURVE);
}

interface Props {
  onClose: () => void;
}

export function Tuner({ onClose }: Props) {
  const reducedMotion = useReducedMotion();
  const { status, error, pitch, levelRef, start, stop } = usePitchDetector();

  const [tuningId, setTuningId] = useState(readStoredTuning);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lockedPosition, setLockedPosition] = useState<number | null>(null);
  const [settled, setSettled] = useState<number[]>([]);

  const tuning = useMemo(() => getTuning(tuningId), [tuningId]);
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
  const match = useMemo(() => {
    if (!pitch) return null;
    const locked = lockedPosition
      ? tuning.strings.find((s) => s.position === lockedPosition)
      : undefined;
    return locked ? matchString(pitch.hz, locked) : nearestString(pitch.hz, tuning);
  }, [pitch, tuning, lockedPosition]);

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

  // A string that reads clearly off again has stopped being tuned, whatever we
  // said earlier. Neighbouring strings pull each other flat as you work round the
  // headstock, and leaving a stale tick there would be a small lie.
  //
  // Adjusted during render rather than in an effect: this is a reaction to a new
  // reading arriving, not a synchronisation with anything outside React. Holding
  // the drifting string means the tick is pulled once, on the transition, rather
  // than on every frame the peg is turning.
  const [driftingPosition, setDriftingPosition] = useState<number | null>(null);
  const drifting = activePosition !== null && Math.abs(cents) > NEAR_CENTS ? activePosition : null;
  if (drifting !== driftingPosition) {
    setDriftingPosition(drifting);
    if (drifting !== null) {
      setSettled((prev) => (prev.includes(drifting) ? prev.filter((p) => p !== drifting) : prev));
    }
  }

  const allSettled = settled.length === tuning.strings.length;
  const allSettledRef = useRef(false);
  useEffect(() => {
    if (allSettled && !allSettledRef.current) sfx.complete();
    allSettledRef.current = allSettled;
  }, [allSettled]);

  const chooseTuning = useCallback((id: string) => {
    setTuningId(id);
    setPickerOpen(false);
    setLockedPosition(null);
    setSettled([]);
    try {
      localStorage.setItem(TUNING_KEY, id);
    } catch {
      /* not being able to remember the choice is not worth failing over */
    }
  }, []);

  // Strings render high to low, matching the tab staff elsewhere in the app.
  const rows = useMemo(() => [...tuning.strings].reverse(), [tuning]);

  return createPortal(
    <motion.div
      className="practice-overlay tuner-overlay"
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

        {status === 'error' ? (
          <div className="tuner-blocked">
            <p className="tuner-blocked-title">The tuner needs to hear your guitar.</p>
            <p className="tuner-blocked-body">{error}</p>
            <MicPermissionHint />
            <button type="button" className="tuner-retry" onClick={() => void start()}>
              Try again
            </button>
          </div>
        ) : (
          <>
            <div className="tuner-board">
              <div className="tuner-scale" aria-hidden="true">
                <span>flat</span>
                <span>sharp</span>
              </div>

              <div className="tuner-strings">
                {/* True pitch, and the tolerance either side of it. Showing the
                    tolerance as a place rather than a number is what stops the
                    puck sitting visibly off-centre while the readout says the
                    string is in tune. */}
                <span
                  className={clsx('tuner-zone', verdict === 'tuned' && !far && 'is-tuned')}
                  aria-hidden="true"
                />
                <span className="tuner-rail" aria-hidden="true" />
                {rows.map((string) => (
                  <StringRow
                    key={string.position}
                    string={string}
                    isActive={string.position === activePosition}
                    isLocked={string.position === lockedPosition}
                    isSettled={settled.includes(string.position)}
                    cents={string.position === activePosition ? cents : 0}
                    verdict={string.position === activePosition ? verdict : null}
                    far={string.position === activePosition && far}
                    levelRef={levelRef}
                    reducedMotion={Boolean(reducedMotion)}
                    onToggleLock={() =>
                      setLockedPosition((prev) => (prev === string.position ? null : string.position))
                    }
                  />
                ))}
              </div>
            </div>

            <Readout
              status={status}
              pitchHz={pitch?.hz ?? null}
              fading={pitch?.fading ?? false}
              match={match}
              verdict={verdict}
              far={far}
              allSettled={allSettled}
              lockedName={
                lockedPosition
                  ? tuning.strings.find((s) => s.position === lockedPosition)?.name ?? null
                  : null
              }
            />
          </>
        )}
      </div>
    </motion.div>,
    document.body,
  );
}

interface StringRowProps {
  string: TuningString;
  isActive: boolean;
  isLocked: boolean;
  isSettled: boolean;
  cents: number;
  verdict: Verdict | null;
  far: boolean;
  levelRef: React.RefObject<number>;
  reducedMotion: boolean;
  onToggleLock: () => void;
}

function StringRow({
  string,
  isActive,
  isLocked,
  isSettled,
  cents,
  verdict,
  far,
  levelRef,
  reducedMotion,
  onToggleLock,
}: StringRowProps) {
  const pathRef = useRef<SVGPathElement | null>(null);
  const amplitudeRef = useRef(0);
  /** Whether the wire is already drawn flat, so five idle rows stop writing the
      same `d` attribute to the DOM sixty times a second between plucks. */
  const restingRef = useRef(true);
  // Read inside the animation loop so the loop itself never has to restart, and
  // so a settled string can damp out smoothly instead of snapping flat.
  const stateRef = useRef({ isActive, isSettled });
  useEffect(() => {
    stateRef.current = { isActive, isSettled };
  }, [isActive, isSettled]);

  // The string vibrates with the note's real envelope: amplitude tracks input
  // level, so it swells on the pluck and dies away exactly as the string does.
  // That is the whole reason the display feels connected to the instrument
  // rather than to a timer.
  useEffect(() => {
    if (reducedMotion) return;
    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const path = pathRef.current;
      if (!path) return;
      const { isActive: live, isSettled: done } = stateRef.current;
      const target = live && !done ? Math.min(1, levelRef.current / FULL_AMPLITUDE_RMS) : 0;
      amplitudeRef.current += (target - amplitudeRef.current) * 0.14;
      const amplitude = amplitudeRef.current;
      if (amplitude < 0.002) {
        if (!restingRef.current) {
          path.setAttribute('d', FLAT_WIRE);
          restingRef.current = true;
        }
        return;
      }
      restingRef.current = false;
      // Fundamental mode: the whole length swings together, pinned at both ends.
      // A cubic whose control points sit at 4/3 of the peak reproduces that
      // shape in one segment, which keeps this loop essentially free.
      const swing = Math.sin(((now - started) / 1000) * 2 * Math.PI * 6) * amplitude * 6;
      const control = 10 - swing * 1.333;
      path.setAttribute('d', `M0 10 C 25 ${control.toFixed(2)}, 75 ${control.toFixed(2)}, 100 10`);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [levelRef, reducedMotion]);

  const offset = isActive ? centsToOffset(cents) : 0;

  return (
    <div
      className={clsx(
        'tuner-string',
        isActive && 'is-active',
        isSettled && 'is-settled',
        isLocked && 'is-locked',
        verdict && `is-${verdict}`,
        far && 'is-far',
      )}
    >
      <button
        type="button"
        className="tuner-string-label"
        onClick={onToggleLock}
        aria-pressed={isLocked}
        aria-label={
          isLocked
            ? `${string.name}${string.octave}, string ${string.position}. Listening to this string only. Tap to listen to all six.`
            : `${string.name}${string.octave}, string ${string.position}${isSettled ? ', in tune' : ''}. Tap to listen to this string only.`
        }
      >
        <span className="tuner-string-note">{string.name}</span>
        <span className="tuner-string-mark" aria-hidden="true">
          {isSettled ? <CheckIcon size={13} /> : string.position}
        </span>
      </button>

      <div className="tuner-string-track">
        <svg
          className="tuner-string-wire"
          viewBox="0 0 100 20"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            ref={pathRef}
            d={FLAT_WIRE}
            vectorEffect="non-scaling-stroke"
            style={{ strokeWidth: STROKE_BY_POSITION[string.position] }}
          />
        </svg>
        {isActive && (
          <span
            className="tuner-puck"
            aria-hidden="true"
            style={{ left: `${50 + offset * 46}%` }}
          />
        )}
      </div>
    </div>
  );
}

interface ReadoutProps {
  status: string;
  pitchHz: number | null;
  fading: boolean;
  match: { string: TuningString; cents: number } | null;
  verdict: Verdict | null;
  far: boolean;
  allSettled: boolean;
  lockedName: string | null;
}

function Readout({ status, pitchHz, fading, match, verdict, far, allSettled, lockedName }: ReadoutProps) {
  const heard = pitchHz !== null ? readPitch(pitchHz) : null;
  const cents = match?.cents ?? 0;
  const rounded = Math.round(cents);

  // Once the pitch is most of a semitone from the string, the string's name is
  // no longer an honest headline: the display would read "D" while the guitar is
  // sounding a D sharp. Past that point the heading becomes what was actually
  // heard, and the string it is being measured against moves into the small line.
  const headline = far && heard ? { name: heard.name, octave: heard.octave } : match?.string ?? null;
  const showCents = match !== null && Math.abs(cents) <= CENTS_READABLE_MAX;

  let guidance: string;
  if (status === 'requesting') {
    guidance = 'Opening the microphone.';
  } else if (allSettled) {
    guidance = 'All six. Go and play.';
  } else if (!match) {
    guidance = lockedName
      ? `Listening for the ${lockedName} string.`
      : 'Play a string. I will work out which one.';
  } else if (!showCents) {
    // More than a semitone out. Say what is actually going on instead of
    // reporting a distance, and if a lock is what caused it, offer the way back.
    guidance = lockedName
      ? `That does not sound like the ${lockedName} string. Tap ${lockedName} to listen to all six again.`
      : cents < 0
        ? 'A long way flat. Keep tightening.'
        : 'A long way sharp. Keep easing it off.';
  } else if (far) {
    guidance = cents < 0 ? 'A long way flat. Keep tightening.' : 'A long way sharp. Keep easing it off.';
  } else if (verdict === 'tuned') {
    guidance = `${match.string.name} is in tune.`;
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
      )}
    >
      <div className="tuner-readout-note">
        {headline ? (
          <>
            <span className="tuner-readout-name">{headline.name}</span>
            <span className="tuner-readout-octave">{headline.octave}</span>
          </>
        ) : (
          <span className="tuner-readout-name is-empty">·</span>
        )}
      </div>

      <div className="tuner-readout-cents">
        {showCents && match ? (
          <>
            <span className="tuner-readout-value">
              {rounded > 0 ? '+' : rounded < 0 ? '−' : ''}
              {Math.abs(rounded)}
            </span>
            <span className="tuner-readout-unit">
              {far ? `cents from ${match.string.name}` : 'cents'}
            </span>
          </>
        ) : (
          <span className="tuner-readout-unit">{heard ? `${heard.hz.toFixed(1)} Hz` : 'listening'}</span>
        )}
      </div>

      <p className="tuner-guidance" role="status">
        {guidance}
      </p>
    </div>
  );
}
