import { useCallback, useEffect, useRef } from 'react';
import clsx from 'clsx';
import { ICON_STROKE } from '../icons/Icon';
import { armDirectionAt, slotsPerBarOf, type Pattern, type SlotStroke } from '../../lib/strumPattern';
import './patternBar.css';

/**
 * A phrase of eighth-note slots, and the arm travelling through them.
 *
 * One bar of eight, usually. A two-bar phrase is drawn as one continuous lane
 * of sixteen with a rule where the bar changes, because that is what it is: the
 * arm does not stop at the bar line and neither should the row. Nothing else
 * about the notation changes with the length.
 *
 * This is the drill's whole notation, and every part of it stands in for a
 * sentence the screen would otherwise have to carry.
 *
 * FOUR MARKS, FOUR MEANINGS.
 *
 *  - A plectrum sits at each slot, above the strings where the stroke comes
 *    down and below them where it comes up. Filled where the pattern sounds,
 *    an outline where it does not: "lift the pick off the strings and keep the
 *    arm moving through them" is a fill.
 *  - A cross on the strings themselves marks a percussive slap. It is drawn
 *    there rather than on the pick because that is where the difference actually
 *    is: the arm and the pick do exactly what they do on any other stroke, and
 *    what changes is that the fretting hand has killed the strings underneath.
 *    A slap keeps its filled pick for the same reason — it strikes.
 *  - A bone marker travels the strings in a zigzag, crossing them once a slot,
 *    down then up then down, whether or not anything sounds. That is the arm
 *    the player is supposed to have, and it is the reason the drill exists.
 *  - A strum that was heard is a stroke across the strings, in the accent, drawn
 *    at the position inside its slot where it actually landed. Rushing is the
 *    gap between that stroke and the pick above it, which is a thing to see
 *    rather than a number to read.
 *
 * The colour rule is the one the groove rail already set: bone is the grid the
 * player is measured against, and the accent is the player.
 */

/** What happened at one slot, as far as the surface is concerned. */
export type SlotMarkState =
  /** Nothing yet: the arm has not reached it, or nothing is being measured. */
  | 'idle'
  | 'struck'
  | 'missed'
  | 'added'
  /**
   * Expected, nothing arrived, and no up strum in the run arrived either. That
   * is a level the microphone could not reach rather than a strum the player
   * did not play, so it is drawn as an absence of evidence: see `upStrumsUnheard`
   * in src/lib/patternDeck.ts.
   */
  | 'unheard';

export interface SlotView {
  state: SlotMarkState;
  /**
   * Where inside the slot the strum landed, in slots. Negative is early. Only
   * meaningful once something has been struck.
   */
  at?: number;
  /**
   * Share of the run's bars this slot was struck in, 0 to 1. Weights the stroke
   * on a summary row, so a slot struck in half the bars reads as half there
   * rather than as either kind of absolute.
   */
  share?: number;
}

/** How far from its slot a stroke may be drawn before it would sit on its neighbour. */
const MAX_DRAWN_OFFSET = 0.45;

export type BarSize = 'live' | 'card' | 'deck';

interface Props {
  pattern: Pattern;
  /**
   * Where the arm is, in slots from the start of the phrase, read once a frame.
   *
   * A function rather than a number because the arm moves continuously and the
   * rest of the row does not: reading it here and writing the marker's style
   * directly keeps sixty frames a second of motion out of React entirely, which
   * matters on a surface sharing a thread with the analyser.
   *
   * Returning null is the one state that must not be faked. A marker sweeping
   * over a stopped metronome is the app claiming a beat nobody can hear.
   */
  sweepAt?: () => number | null;
  /** One entry per slot. Absent draws the pattern by itself. */
  slots?: readonly SlotView[];
  size?: BarSize;
  /** A deck card's standing, which decides how present the whole row is drawn. */
  standing?: 'new' | 'learning' | 'automatic';
  className?: string;
  label: string;
}

/**
 * How tall the count's stem is at a slot, which is how the row says what to say.
 *
 * Eighths give three heights and the row reads 1 + 2 + 3 + 4 +. Sixteenths need
 * a fourth, because there are three offbeats in every beat rather than one, and
 * without it the row would draw "1 e + a" as four identical marks and say
 * nothing about where the beat is. The "and" keeps its own middle height so the
 * eighth-note pulse stays visible inside the sixteenths, which is what a player
 * counting "1 e + a" is actually holding on to.
 */
function stemTier(within: number, slotsPerBeat: number): string {
  if (within === 0) return 'is-one';
  if (within % slotsPerBeat === 0) return 'is-beat';
  if (within % (slotsPerBeat / 2) === 0) return 'is-and';
  return 'is-sixteenth';
}

/**
 * Which way the arm is going through a slot.
 *
 * Parity, not the pattern. The arm is a pendulum from the elbow: it is on its
 * way down through every even slot and up through every odd one whatever the
 * pattern asks of it, so a ghost knows its own direction.
 */
function directionAt(slot: number, expected: SlotStroke): 'D' | 'U' {
  // A slap goes through this branch with the ghosts: it is played with whichever
  // way the arm is already travelling, and has no direction to state.
  return expected === 'D' || expected === 'U' ? expected : armDirectionAt(slot);
}

/**
 * The pick.
 *
 * The app's own plectrum outline, drawn here rather than through the icon set
 * because this notation has to fill it, point it either way and take its size
 * from the row it is drawn in, none of which an icon is allowed to decide. The
 * size comes through CSS rather than a prop so a narrow phone can shrink the
 * glyph without the component knowing anything about viewports. The pen is the
 * icon set's, and it thins with the glyph exactly as the icon set's does.
 */
function Pick({ up, filled }: { up: boolean; filled: boolean }) {
  return (
    <svg className="pb-pick" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 3.6c3.7 0 6.6 2.2 6.6 5.4 0 3.5-3.3 8-5.4 10.3a1.6 1.6 0 0 1-2.4 0C8.7 17 5.4 12.5 5.4 9c0-3.2 2.9-5.4 6.6-5.4Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={ICON_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={up ? 'rotate(180 12 12)' : undefined}
      />
    </svg>
  );
}

export function PatternBar({
  pattern,
  sweepAt,
  slots,
  size = 'live',
  standing,
  className,
  label,
}: Props) {
  const armRef = useRef<HTMLSpanElement | null>(null);
  const length = pattern.slots.length;
  const perBar = slotsPerBarOf(pattern);
  const bars = length / perBar;

  /** The x of a slot's centre, as a percentage of the whole phrase. */
  const centreOf = useCallback(
    (slot: number, offset = 0): string => `${((slot + 0.5 + offset) / length) * 100}%`,
    [length],
  );

  // The arm, from one number, written straight to the element. Inside a slot it
  // travels from one extreme to the other and crosses the strings at the slot's
  // centre, so the sign of the travel flips every slot. That zigzag is the
  // mechanic the lesson teaches, and it is the only thing here that moves.
  useEffect(() => {
    if (!sweepAt) return;
    let frame = requestAnimationFrame(function draw() {
      frame = requestAnimationFrame(draw);
      const arm = armRef.current;
      if (!arm) return;
      const at = sweepAt();
      if (at === null || !Number.isFinite(at)) {
        arm.style.opacity = '0';
        return;
      }
      const phase = ((at % length) + length) % length;
      const inSlot = phase % 1;
      const descending = Math.floor(phase) % 2 === 0;
      const travel = descending ? inSlot * 2 - 1 : 1 - inSlot * 2;
      arm.style.opacity = '1';
      arm.style.left = centreOf(Math.floor(phase), inSlot - 0.5);
      arm.style.transform = `translate(-50%, calc(-50% + ${travel * 46}%))`;
    });
    return () => cancelAnimationFrame(frame);
  }, [sweepAt, length, centreOf]);

  return (
    <div
      className={clsx(
        'pattern-bar',
        `is-${size}`,
        bars > 1 && 'is-phrase',
        standing && `is-${standing}`,
        className,
      )}
      role="img"
      aria-label={label}
    >
      <div className="pb-lane">
        {/* The count, drawn rather than written: a full stem on every beat one,
            a shorter one on the other beats, a short one on every "and". The row
            reads as 1 + 2 + 3 + 4 + without any of it being text. */}
        {pattern.slots.map((_, slot) => (
          <span
            key={`stem-${slot}`}
            className={clsx('pb-stem', stemTier(slot % perBar, pattern.slotsPerBeat))}
            style={{ left: centreOf(slot) }}
          />
        ))}

        {/* Where one bar ends and the next begins. Only ever drawn on a phrase:
            on a single bar the row's own edges are the bar lines, and a rule
            through the middle of it would say a division that is not there. */}
        {Array.from({ length: bars - 1 }, (_, i) => (
          <span
            key={`barline-${i}`}
            className="pb-barline"
            style={{ left: `${((i + 1) / bars) * 100}%` }}
          />
        ))}

        {/* The strings the pick crosses. The app's established hairline. */}
        <span className="rail-wire pb-strings" />

        {pattern.slots.map((expected, slot) => {
          const view = slots?.[slot];
          const state = view?.state ?? 'idle';
          const up = directionAt(slot, expected) === 'U';
          const landed = state === 'struck' || state === 'added';
          const offset = landed
            ? Math.max(-MAX_DRAWN_OFFSET, Math.min(MAX_DRAWN_OFFSET, view?.at ?? 0))
            : 0;
          return (
            <span key={`slot-${slot}`} className="pb-slot">
              <span
                className={clsx(
                  'pb-pick-mark',
                  up ? 'is-up' : 'is-down',
                  expected ? 'is-sounded' : 'is-ghost',
                  state === 'missed' && 'is-missed',
                  state === 'unheard' && 'is-unheard',
                )}
                style={{ left: centreOf(slot) }}
              >
                <Pick up={up} filled={!!expected && state !== 'unheard'} />
              </span>
              {expected === 'X' && (
                <span
                  className={clsx('pb-mute', state === 'missed' && 'is-missed')}
                  style={{ left: centreOf(slot) }}
                />
              )}
              {landed && (
                <span
                  className={clsx('pb-stroke', state === 'added' ? 'is-added' : 'is-struck')}
                  style={{
                    left: centreOf(slot, offset),
                    opacity: view?.share === undefined ? undefined : 0.4 + 0.6 * view.share,
                  }}
                />
              )}
            </span>
          );
        })}

        {/* The arm. It never stops, and it is bone rather than accent because it
            is the grid the player is measured against, not the player. */}
        {sweepAt && <span ref={armRef} className="pb-arm" />}
      </div>
    </div>
  );
}
