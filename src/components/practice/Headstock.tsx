// The headstock, drawn straight on, at the scale of the thing in your hand.
//
// A tuner's real question is "which peg do I turn", and the answer has a shape:
// three machine heads a side, the string you are sounding running from the nut
// up to one of them. Six abstract rows could say which string; only the
// headstock says which peg, which is the part the hand acts on.
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

import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import type { TuningString } from '../../audio/tuning';
import './headstock.css';

const VIEW_W = 300;
const VIEW_H = 440;

/** Where the strings leave the nut, left to right: 6th through 1st. */
const NUT_Y = 418;
const NUT_X0 = 102;
const NUT_STEP = 19.2;

/**
 * Post centres. On any 3-a-side headstock the outer strings take the pegs
 * furthest from the nut and the middle pair take the nearest, so the columns run
 * 6-5-4 down the bass side and 1-2-3 down the treble side.
 */
const POST_X_BASS = 94;
const POST_X_TREBLE = 206;
const POST_Y = [96, 186, 276] as const;
/** The silhouette's own edge at each post's height, so a machine head hangs off
    the taper rather than off one straight line the body does not follow. */
const EDGE_X = [61, 66, 78] as const;

interface PegGeometry {
  position: number;
  /** Post centre, in viewBox units. */
  x: number;
  y: number;
  /** Where this string crosses the nut. */
  nutX: number;
  /** The body's edge at this height, where the machine head's shaft leaves it. */
  edgeX: number;
  /** Bass side sits on the left, so its button protrudes left. */
  side: 'bass' | 'treble';
}

const PEGS: PegGeometry[] = [
  { position: 6, x: POST_X_BASS, y: POST_Y[0], nutX: NUT_X0 + NUT_STEP * 0, edgeX: EDGE_X[0], side: 'bass' },
  { position: 5, x: POST_X_BASS, y: POST_Y[1], nutX: NUT_X0 + NUT_STEP * 1, edgeX: EDGE_X[1], side: 'bass' },
  { position: 4, x: POST_X_BASS, y: POST_Y[2], nutX: NUT_X0 + NUT_STEP * 2, edgeX: EDGE_X[2], side: 'bass' },
  { position: 3, x: POST_X_TREBLE, y: POST_Y[2], nutX: NUT_X0 + NUT_STEP * 3, edgeX: VIEW_W - EDGE_X[2], side: 'treble' },
  { position: 2, x: POST_X_TREBLE, y: POST_Y[1], nutX: NUT_X0 + NUT_STEP * 4, edgeX: VIEW_W - EDGE_X[1], side: 'treble' },
  { position: 1, x: POST_X_TREBLE, y: POST_Y[0], nutX: NUT_X0 + NUT_STEP * 5, edgeX: VIEW_W - EDGE_X[0], side: 'treble' },
];

/** Relative visual gauge, 1st (thinnest) through 6th. Real string ratios. */
const GAUGE: Record<number, number> = { 1: 1.1, 2: 1.5, 3: 2, 4: 2.6, 5: 3.3, 6: 4.1 };

/** Input level that drives a string to full visual amplitude. */
const FULL_AMPLITUDE_RMS = 0.22;
/** Peak sideways travel of a ringing string, in viewBox units. */
const MAX_SWING = 5.2;
/** The eye reads a slow shimmer as a live string; faster reads as noise. */
const SWING_HZ = 6;

/** A three-a-side silhouette: a narrow nut end opening into a wide crown with
    the shallow centre dip every guitar with this layout has. */
const OUTLINE =
  'M94 428 C92 400 88 368 84 340 C80 312 78 292 78 274 C77 240 70 212 66 186 ' +
  'C62 152 60 120 61 96 C62 64 74 36 98 26 C116 19 136 40 150 40 ' +
  'C164 40 184 19 202 26 C226 36 238 64 239 96 C240 120 238 152 234 186 ' +
  'C230 212 223 240 222 274 C222 292 220 312 216 340 C212 368 208 400 206 428 Z';

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
  onSelect,
}: Props) {
  const byPosition = new Map(strings.map((s) => [s.position, s]));

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
            <path d="M72 440 C80 330 76 210 88 18" />
            <path d="M96 440 C104 320 98 200 112 14" />
            <path d="M118 442 C124 322 116 194 128 12" />
            <path d="M138 442 C140 320 134 190 142 10" />
            <path d="M162 442 C160 320 166 190 158 10" />
            <path d="M182 442 C176 322 184 194 172 12" />
            <path d="M204 440 C196 320 202 200 188 14" />
            <path d="M228 440 C220 330 224 210 212 18" />
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

        {/* Nut, and the fingerboard running off the bottom of the frame. There
            is no bridge and no scale length here: this is the end of the
            instrument the hand is actually at. */}
        <rect className="headstock-board" x="95" y="424" width="110" height="18" />
        <rect className="headstock-nut" x="93" y="413" width="114" height="12" rx="3" />

        {/* Strings first, so each one disappears into the bore it winds onto
            instead of being painted across the hardware. */}
        {PEGS.map((peg) => {
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

        {PEGS.map((peg) => {
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
      <div className="headstock-pegs">
        {PEGS.map((peg) => {
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
                  ? `${string.name}${string.octave}, string ${string.position}. Listening to this string only. Activate to listen to all six.`
                  : `${string.name}${string.octave}, string ${string.position}${
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
  const out = peg.side === 'bass' ? -1 : 1;
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
          peg.side === 'bass'
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
