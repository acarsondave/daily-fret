// The headstock, drawn straight on, at the scale of the thing in your hand.
//
// A tuner's real question is "which peg do I turn", and the answer has a shape:
// three machine heads a side, the string you are sounding running from the nut
// out to one of them. Six abstract rows could say which string; only the
// headstock says which peg, which is the part the hand acts on.
//
// ORIENTATION. The neck leaves the top of the frame and the headstock points
// down, which is the guitar as its own player sees it: sitting with the
// instrument in your lap, the neck runs off to your left and the thick string is
// the one nearest you, and turning that view upright to fit a screen puts the
// nut at the top with the low E on the left. It was drawn the other way up
// before, tip at the top, which is how a guitar is photographed rather than how
// it is played, and it put every peg somewhere the hand had to translate.
//
// So, reading down: the pegs nearest the nut carry the D and the G, because the
// two middle strings have the furthest to travel sideways and so must reach
// their posts soonest; the low E and the high E take the far pair at the tip.
// The outer strings therefore fan across the inner posts on their way past,
// which is what the real thing does and what a photograph of any three-a-side
// headstock shows.
//
// It is rendered rather than drawn: the face is a shaded wood, the posts and
// buttons are lit metal with real speculars, and the strings vibrate at the
// measured input level. That last part is the whole point. The display is not a
// picture of a guitar, it is a mirror of this one, moving because the instrument
// is moving.
//
// Geometry lives in shared constants because two layers depend on it: the SVG
// that draws the pegs, and an HTML layer of real buttons sitting exactly on top
// of them, so the targets are focusable, labelled, and 44px without inventing
// keyboard semantics for <g> elements.

import { useEffect, useMemo, useRef } from 'react';
import clsx from 'clsx';
import type { TuningString } from '../../audio/tuning';
import { useUserData } from '../../store';
import './headstock.css';

const VIEW_W = 300;
const VIEW_H = 440;

/** Where the strings cross the nut, left to right: 6th through 1st. */
const NUT_Y = 22;
const NUT_X0 = 102;
const NUT_STEP = 19.2;

/**
 * Post centres, nearest the nut first.
 *
 * On any three-a-side headstock the two middle strings take the pegs nearest the
 * nut and the two outer strings take the pegs at the tip, which is the only
 * arrangement in which no string crosses another.
 */
const POST_X_BASS = 94;
const POST_X_TREBLE = 206;
const POST_Y = [164, 254, 344] as const;
/** The silhouette's own edge at each post's height, so a machine head hangs off
    the taper rather than off one straight line the body does not follow. */
const EDGE_X = [78, 66, 61] as const;

/** Which peg each string winds onto, nearest the nut outwards, per side. */
const BASS_ORDER = [4, 5, 6] as const;
const TREBLE_ORDER = [3, 2, 1] as const;

interface PegGeometry {
  position: number;
  /** Post centre, in viewBox units. */
  x: number;
  y: number;
  /** Where this string crosses the nut. */
  nutX: number;
  /** The body's edge at this height, where the machine head's shaft leaves it. */
  edgeX: number;
  /** Which side of the screen this peg is on, after handedness. */
  side: 'left' | 'right';
}

/**
 * The six pegs, laid out for the guitar in the room.
 *
 * A left-handed guitar is this object mirrored, so the whole layout mirrors: the
 * low E moves to the right and every string's peg goes with it. The face itself
 * is symmetric about its centre line, which is why nothing but these coordinates
 * has to know.
 */
function buildPegs(leftHanded: boolean): PegGeometry[] {
  const mirror = (x: number) => (leftHanded ? VIEW_W - x : x);
  const pegs: PegGeometry[] = [];

  for (const [order, postX] of [
    [BASS_ORDER, POST_X_BASS],
    [TREBLE_ORDER, POST_X_TREBLE],
  ] as const) {
    order.forEach((position, row) => {
      const bass = order === BASS_ORDER;
      const x = mirror(postX);
      pegs.push({
        position,
        x,
        y: POST_Y[row],
        nutX: mirror(NUT_X0 + NUT_STEP * (6 - position)),
        edgeX: mirror(bass ? EDGE_X[row] : VIEW_W - EDGE_X[row]),
        side: x < VIEW_W / 2 ? 'left' : 'right',
      });
    });
  }

  // Lowest string first, so the DOM order of the peg buttons is the order the
  // tuner works through them and a keyboard walks the instrument the same way.
  return pegs.sort((a, b) => b.position - a.position);
}

/** Relative visual gauge, 1st (thinnest) through 6th. Real string ratios. */
const GAUGE: Record<number, number> = { 1: 1.1, 2: 1.5, 3: 2, 4: 2.6, 5: 3.3, 6: 4.1 };

/** Input level that drives a string to full visual amplitude. */
const FULL_AMPLITUDE_RMS = 0.22;
/** Peak sideways travel of a ringing string, in viewBox units. */
const MAX_SWING = 5.2;
/** The eye reads a slow shimmer as a live string; faster reads as noise. */
const SWING_HZ = 6;

/** A three-a-side silhouette: a narrow nut end at the top opening into a wide
    crown, with the shallow centre dip every guitar with this layout has. It is
    symmetric about the centre line, which is what lets handedness mirror the
    hardware and leave the face alone. */
const OUTLINE =
  'M94 12 C92 40 88 72 84 100 C80 128 78 148 78 166 C77 200 70 228 66 254 ' +
  'C62 288 60 320 61 344 C62 376 74 404 98 414 C116 421 136 400 150 400 ' +
  'C164 400 184 421 202 414 C226 404 238 376 239 344 C240 320 238 288 234 254 ' +
  'C230 228 223 200 222 166 C222 148 220 128 216 100 C212 72 208 40 206 12 Z';

function stringPath(peg: PegGeometry, swing: number): string {
  const dx = peg.x - peg.nutX;
  const dy = peg.y - NUT_Y;
  const length = Math.hypot(dx, dy);
  // Perpendicular to the string's own line, so a fanned string swings across
  // itself rather than sideways on the screen.
  const nx = -dy / length;
  const ny = dx / length;
  const midX = (peg.nutX + peg.x) / 2 + nx * swing * 2;
  const midY = (NUT_Y + peg.y) / 2 + ny * swing * 2;
  return `M${peg.nutX} ${NUT_Y} Q${midX.toFixed(2)} ${midY.toFixed(2)} ${peg.x} ${peg.y}`;
}

interface Props {
  strings: TuningString[];
  activePosition: number | null;
  /** The string the tuner is leading to next. Guidance, not a filter. */
  targetPosition: number | null;
  /** The user has aimed the tuner at one string and shut out the rest. */
  pinnedPosition: number | null;
  settled: number[];
  /** True while the tuner cannot hear, so the strings must not appear alive. */
  deaf: boolean;
  allSettled: boolean;
  levelRef: React.RefObject<number>;
  reducedMotion: boolean;
  /**
   * Whether the pegs are controls. The tuner's are: pressing one shuts out the
   * other five strings. First run's are not, and rendering six buttons offering
   * to do that on a screen with no tuner behind it would be a promise the
   * surface cannot keep.
   */
  interactive?: boolean;
  onSelect: (position: number) => void;
}

export function Headstock({
  strings,
  activePosition,
  targetPosition,
  pinnedPosition,
  settled,
  deaf,
  allSettled,
  levelRef,
  reducedMotion,
  interactive = true,
  onSelect,
}: Props) {
  const byPosition = new Map(strings.map((s) => [s.position, s]));
  // Handedness is a fact about the instrument in the room, like the capo, so the
  // drawing reads it rather than making the tuner remember to pass it.
  const leftHanded = useUserData().leftHanded ?? false;
  const pegs = useMemo(() => buildPegs(leftHanded), [leftHanded]);

  return (
    <div className={clsx('headstock', deaf && 'is-deaf', allSettled && 'is-done')}>
      <svg
        className="headstock-svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <defs>
          {/* Rosewood, lit from the upper left. The only warm surface in the
              app: it is the one screen showing a physical object rather than a
              record of one, and the warmth is what makes it read as wood
              instead of as another dark panel. */}
          <linearGradient id="hs-face" x1="0.12" y1="0" x2="0.9" y2="1">
            <stop offset="0%" stopColor="#43342a" />
            <stop offset="34%" stopColor="#33261e" />
            <stop offset="72%" stopColor="#231a14" />
            <stop offset="100%" stopColor="#180f0b" />
          </linearGradient>
          {/* The sheen a finished face throws back at a light above it. */}
          <linearGradient id="hs-sheen" x1="0" y1="0" x2="1" y2="0.35">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
            <stop offset="38%" stopColor="#ffffff" stopOpacity="0.03" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.22" />
          </linearGradient>
          <linearGradient id="hs-nut" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#efe8d8" />
            <stop offset="55%" stopColor="#cfc5ae" />
            <stop offset="100%" stopColor="#9d947f" />
          </linearGradient>
          {/* Nickel. Two speculars and a shadowed underside is the whole trick;
              a flat grey disc at this size reads as a hole, not as hardware. */}
          <linearGradient id="hs-metal" x1="0.15" y1="0" x2="0.85" y2="1">
            <stop offset="0%" stopColor="#f2f5f7" />
            <stop offset="26%" stopColor="#c2cad1" />
            <stop offset="52%" stopColor="#7d868e" />
            <stop offset="78%" stopColor="#525a62" />
            <stop offset="100%" stopColor="#8f979e" />
          </linearGradient>
          <linearGradient id="hs-button" x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor="#b6bec5" />
            <stop offset="38%" stopColor="#7b838a" />
            <stop offset="72%" stopColor="#42484e" />
            <stop offset="100%" stopColor="#767e85" />
          </linearGradient>
          <linearGradient id="hs-seam" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#000000" stopOpacity="0.16" />
            <stop offset="45%" stopColor="#e8b98a" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.16" />
          </linearGradient>
          <radialGradient id="hs-bore" cx="0.42" cy="0.36" r="0.72">
            <stop offset="0%" stopColor="#0b0908" />
            <stop offset="70%" stopColor="#1c1611" />
            <stop offset="100%" stopColor="#2b211a" />
          </radialGradient>
          <linearGradient id="hs-sweep" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffe9c2" stopOpacity="0" />
            <stop offset="50%" stopColor="#fff4dd" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#ffe9c2" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="hs-string" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8e9299" />
            <stop offset="45%" stopColor="#dfe4ea" />
            <stop offset="100%" stopColor="#9aa0a7" />
          </linearGradient>

          <clipPath id="hs-clip">
            <path d={OUTLINE} />
          </clipPath>
        </defs>

        <g clipPath="url(#hs-clip)">
          <path d={OUTLINE} fill="url(#hs-face)" />
          {/* Grain: long, near-invisible strokes that only register as texture.
              Drawn rather than filtered, because a feTurbulence over a surface
              this size costs a full-frame raster on every repaint and this
              screen is already running an analyser and an animation loop. */}
          <g className="headstock-grain">
            <path d="M72 0 C80 110 76 230 88 422" />
            <path d="M96 0 C104 120 98 240 112 426" />
            <path d="M118 -2 C124 118 116 246 128 428" />
            <path d="M138 -2 C140 120 134 250 142 430" />
            <path d="M162 -2 C160 120 166 250 158 430" />
            <path d="M182 -2 C176 118 184 246 172 428" />
            <path d="M204 0 C196 120 202 240 188 426" />
            <path d="M228 0 C220 110 224 230 212 422" />
          </g>
          {/* The centre stripe a book-matched face carries. It is what stops
              the wood reading as one flat sheet of brown. */}
          <rect className="headstock-seam" x="138" y="0" width="24" height={VIEW_H} />
          <path d={OUTLINE} fill="url(#hs-sheen)" />
          {/* All six done. One pass of light down the face, once, and then the
              screen is quiet again. The only unprompted motion on this surface,
              spent on the only moment that has earned it. */}
          <rect className="headstock-sweep" x="0" y="-200" width={VIEW_W} height="150" />
        </g>

        {/* Bevel. A hairline of light on the lit edge and a dark on the other is
            what separates the face from the ground without a drawn border. */}
        <path className="headstock-edge" d={OUTLINE} />

        {/* Nut, and the fingerboard running off the top of the frame towards the
            body. There is no bridge and no scale length here: this is the end of
            the instrument the hand is actually at. */}
        <rect className="headstock-board" x="95" y="-2" width="110" height="18" />
        <rect className="headstock-nut" x="93" y="15" width="114" height="12" rx="3" />

        {/* Strings first, so each one disappears into the bore it winds onto
            instead of being painted across the hardware. */}
        {pegs.map((peg) => {
          const string = byPosition.get(peg.position);
          if (!string) return null;
          return (
            <VibratingString
              key={peg.position}
              peg={peg}
              isActive={!deaf && peg.position === activePosition}
              isSettled={settled.includes(peg.position)}
              levelRef={levelRef}
              reducedMotion={reducedMotion}
            />
          );
        })}

        {pegs.map((peg) => {
          const string = byPosition.get(peg.position);
          if (!string) return null;
          return (
            <Peg
              key={peg.position}
              peg={peg}
              isActive={peg.position === activePosition}
              isSettled={settled.includes(peg.position)}
              isTarget={peg.position === targetPosition && peg.position !== activePosition}
              isPinned={peg.position === pinnedPosition}
            />
          );
        })}
      </svg>

      {/* Real buttons, laid over the posts they belong to. The SVG stays
          presentational so focus, labels and hit area come from the platform. */}
      {interactive && (
      <div className="headstock-pegs">
        {pegs.map((peg) => {
          const string = byPosition.get(peg.position);
          if (!string) return null;
          const isSettled = settled.includes(peg.position);
          const isPinned = peg.position === pinnedPosition;
          const isTarget = peg.position === targetPosition;
          return (
            <button
              key={peg.position}
              type="button"
              className={clsx(
                'headstock-peg',
                `is-${peg.side}`,
                peg.position === activePosition && 'is-active',
                isSettled && 'is-settled',
                isTarget && 'is-target',
                isPinned && 'is-pinned',
              )}
              style={{
                left: `${(peg.x / VIEW_W) * 100}%`,
                top: `${(peg.y / VIEW_H) * 100}%`,
              }}
              aria-pressed={isPinned}
              aria-label={
                isPinned
                  ? `${string.label}, string ${string.position}. Listening to this string only. Activate to listen to all six.`
                  : `${string.label}, string ${string.position}${
                      isSettled ? ', in tune' : isTarget ? ', tune this one next' : ''
                    }. Activate to listen to this string only.`
              }
              onClick={() => onSelect(peg.position)}
            >
              {/* The letter stays put and turns green. Swapping it for a tick
                  cost the one thing the label is for: which string this is. */}
              <span className="headstock-peg-note" aria-hidden="true">{string.name}</span>
            </button>
          );
        })}
      </div>
      )}
    </div>
  );
}

interface PegProps {
  peg: PegGeometry;
  isActive: boolean;
  isSettled: boolean;
  isTarget: boolean;
  isPinned: boolean;
}

function Peg({ peg, isActive, isSettled, isTarget, isPinned }: PegProps) {
  const out = peg.side === 'left' ? -1 : 1;
  const shaftX = peg.edgeX;
  const buttonX = peg.edgeX + out * 24;

  return (
    <g
      className={clsx(
        'headstock-machine',
        isActive && 'is-active',
        isSettled && 'is-settled',
        isTarget && 'is-target',
        isPinned && 'is-pinned',
      )}
    >
      {/* Live halo, first so the metal above stays metal. */}
      <circle className="headstock-halo" cx={peg.x} cy={peg.y} r="22" />
      {/* Shaft from the body edge out to the button. */}
      <rect
        className="headstock-shaft"
        x={Math.min(shaftX, buttonX)}
        y={peg.y - 2.6}
        width={Math.abs(buttonX - shaftX)}
        height="5.2"
        rx="1.6"
      />
      {/* Tuner button: a rounded paddle, seen edge on, hanging just clear of the
          body the way a machine head actually does. */}
      <path
        className="headstock-button"
        d={
          peg.side === 'left'
            ? `M${buttonX + 9} ${peg.y - 9} C${buttonX - 2} ${peg.y - 11}, ${buttonX - 12} ${peg.y - 6}, ${buttonX - 12} ${peg.y} C${buttonX - 12} ${peg.y + 6}, ${buttonX - 2} ${peg.y + 11}, ${buttonX + 9} ${peg.y + 9} Z`
            : `M${buttonX - 9} ${peg.y - 9} C${buttonX + 2} ${peg.y - 11}, ${buttonX + 12} ${peg.y - 6}, ${buttonX + 12} ${peg.y} C${buttonX + 12} ${peg.y + 6}, ${buttonX + 2} ${peg.y + 11}, ${buttonX - 9} ${peg.y + 9} Z`
        }
      />

      {/* The bore the post sits in, then the post, then the winding. */}
      <circle className="headstock-bore" cx={peg.x} cy={peg.y} r="14.5" />
      <circle className="headstock-post" cx={peg.x} cy={peg.y} r="11.5" />
      <circle className="headstock-post-top" cx={peg.x} cy={peg.y} r="6.6" />
      <circle className="headstock-post-hole" cx={peg.x} cy={peg.y} r="2.3" />

      {/* Seats when the string is called done. A ring that draws itself is the
          confirmation: it happens where the eye already is, on the peg. */}
      <circle className="headstock-seal" cx={peg.x} cy={peg.y} r="18" />
      {/* Where the tuner is pointing next. Drawn outside the seal so a string
          that is both done and next reads as done, which it is. */}
      <circle className="headstock-aim" cx={peg.x} cy={peg.y} r="21" />
    </g>
  );
}

interface VibratingStringProps {
  peg: PegGeometry;
  isActive: boolean;
  isSettled: boolean;
  levelRef: React.RefObject<number>;
  reducedMotion: boolean;
}

function VibratingString({ peg, isActive, isSettled, levelRef, reducedMotion }: VibratingStringProps) {
  const pathRef = useRef<SVGPathElement | null>(null);
  const amplitudeRef = useRef(0);
  /** Whether the string is already drawn straight, so five idle strings stop
      rewriting the same `d` sixty times a second between plucks. */
  const restingRef = useRef(true);
  // Read inside the loop so it never has to restart, and so a settled string
  // damps out smoothly instead of snapping straight.
  const stateRef = useRef({ isActive, isSettled });
  useEffect(() => {
    stateRef.current = { isActive, isSettled };
  }, [isActive, isSettled]);

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
          path.setAttribute('d', stringPath(peg, 0));
          restingRef.current = true;
        }
        return;
      }
      restingRef.current = false;
      const swing = Math.sin(((now - started) / 1000) * 2 * Math.PI * SWING_HZ) * amplitude * MAX_SWING;
      path.setAttribute('d', stringPath(peg, swing));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [peg, levelRef, reducedMotion]);

  return (
    <path
      ref={pathRef}
      className={clsx('headstock-string', isActive && 'is-active', isSettled && 'is-settled')}
      d={stringPath(peg, 0)}
      strokeWidth={GAUGE[peg.position]}
    />
  );
}
