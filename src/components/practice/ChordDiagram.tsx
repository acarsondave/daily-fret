import { useMemo, type CSSProperties } from 'react';
import clsx from 'clsx';
import { useUserData } from '../../store';
import {
  FRET_COUNT,
  fretWindow,
  getChordShape,
  type ChordShape,
} from '../../data/chordShapes';
import './chordDiagram.css';

const STRINGS = 6;

// Drawn in a 100-wide space so the CSS only ever sets a width. Numbers are
// deliberately explicit rather than derived from a scale factor: this is a
// fixed piece of engraving, and a half-pixel of drift shows.
const BOX_LEFT = 12;
const BOX_RIGHT = 88;
const BOX_TOP = 26;
const BOX_BOTTOM = 106;
const STRING_GAP = (BOX_RIGHT - BOX_LEFT) / (STRINGS - 1);
const FRET_GAP = (BOX_BOTTOM - BOX_TOP) / FRET_COUNT;

interface Props {
  chord: string;
  /** Width in px. Height follows. */
  size?: number;
  /** Show the finger number inside each dot. */
  showFingers?: boolean;
  /**
   * Mirror the box. Defaults to the player's own setting; pass it explicitly
   * only where a diagram must be drawn in a fixed orientation regardless.
   */
  flipped?: boolean;
  className?: string;
}

/**
 * One chord, engraved.
 *
 * Not an image and not a font glyph: the geometry is derived from the shape data
 * so the same source can later drive a fretboard view, a capo offset, or a
 * left-handed mirror without anything being redrawn by hand.
 */
export function ChordDiagram({ chord, size = 132, showFingers = true, flipped, className }: Props) {
  const shape = useMemo(() => getChordShape(chord), [chord]);
  // Handedness is a fact about the instrument in the room, like the capo, so the
  // diagram reads it rather than making six call sites remember to pass it.
  const leftHanded = useUserData().leftHanded ?? false;
  const mirrored = flipped ?? leftHanded;
  if (!shape) return null;

  const { start, showNut } = fretWindow(shape);
  const x = (stringIndex: number) =>
    BOX_LEFT + (mirrored ? STRINGS - 1 - stringIndex : stringIndex) * STRING_GAP;
  // Centre of the fret's cell, which is where a finger actually sits.
  const y = (fret: number) => BOX_TOP + (fret - start + 0.5) * FRET_GAP;

  const label = describeShape(shape, start);

  return (
    // The `size` prop is the box's intrinsic width, and it travels as its own
    // custom property so a stylesheet can still override the width.
    //
    // It used to be written as `--cd-size`, the same property the stylesheet
    // sets, which cannot work: an inline declaration beats every author rule
    // without `!important`. Four media queries that shrink a diagram on a narrow
    // phone or a short laptop had therefore never applied once. The stylesheet
    // owns `--cd-size` and this only supplies what it falls back to.
    <figure
      className={clsx('chord-diagram', className)}
      style={{ '--cd-intrinsic': `${size}px` } as CSSProperties}
    >
      <svg
        viewBox="0 0 100 124"
        role="img"
        aria-label={label}
        focusable="false"
      >
        {/* Open and muted markers, above the nut where a player expects them. */}
        {shape.frets.map((fret, i) =>
          fret === 0 ? (
            <circle key={i} className="cd-open" cx={x(i)} cy={16} r={3.4} />
          ) : fret < 0 ? (
            <g key={i} className="cd-mute">
              <line x1={x(i) - 3.2} y1={12.8} x2={x(i) + 3.2} y2={19.2} />
              <line x1={x(i) + 3.2} y1={12.8} x2={x(i) - 3.2} y2={19.2} />
            </g>
          ) : null,
        )}

        {showNut ? (
          <line className="cd-nut" x1={BOX_LEFT} y1={BOX_TOP} x2={BOX_RIGHT} y2={BOX_TOP} />
        ) : (
          <text className="cd-fret-number" x={BOX_LEFT - 4} y={BOX_TOP + FRET_GAP * 0.5} textAnchor="end">
            {start}
          </text>
        )}

        {Array.from({ length: FRET_COUNT }, (_, i) => (
          <line
            key={`f${i}`}
            className="cd-fret"
            x1={BOX_LEFT}
            y1={BOX_TOP + (i + 1) * FRET_GAP}
            x2={BOX_RIGHT}
            y2={BOX_TOP + (i + 1) * FRET_GAP}
          />
        ))}

        {/* Gauge follows the strings, so a mirrored box still has the thick low
            E on the side the player's thumb is nearest. */}
        {Array.from({ length: STRINGS }, (_, i) => (
          <line
            key={`s${i}`}
            className="cd-string"
            x1={x(i)}
            y1={BOX_TOP}
            x2={x(i)}
            y2={BOX_BOTTOM}
            style={{ strokeWidth: 0.5 + (STRINGS - 1 - i) * 0.16 }}
          />
        ))}

        {shape.barre && (
          <line
            className="cd-barre"
            x1={x(shape.barre.from)}
            y1={y(shape.barre.fret)}
            x2={x(shape.barre.to)}
            y2={y(shape.barre.fret)}
          />
        )}

        {shape.frets.map((fret, i) => {
          if (fret <= 0) return null;
          // A finger inside a barre is already drawn by the barre itself.
          const inBarre =
            shape.barre &&
            fret === shape.barre.fret &&
            i >= shape.barre.from &&
            i <= shape.barre.to;
          const finger = shape.fingers[i];
          return (
            <g key={`d${i}`}>
              {!inBarre && <circle className="cd-dot" cx={x(i)} cy={y(fret)} r={6.2} />}
              {showFingers && finger > 0 && !inBarre && (
                <text className="cd-finger" x={x(i)} y={y(fret)} textAnchor="middle" dy="0.34em">
                  {finger}
                </text>
              )}
            </g>
          );
        })}
        {showFingers && shape.barre && (
          <text
            className="cd-finger"
            x={(x(shape.barre.from) + x(shape.barre.to)) / 2}
            y={y(shape.barre.fret)}
            textAnchor="middle"
            dy="0.34em"
          >
            {shape.barre.finger}
          </text>
        )}
      </svg>
    </figure>
  );
}

/** Spoken form of the shape, for anyone who cannot see the box. */
function describeShape(shape: ChordShape, start: number): string {
  const names = ['low E', 'A', 'D', 'G', 'B', 'high E'];
  const parts = shape.frets.map((fret, i) => {
    if (fret < 0) return `${names[i]} muted`;
    if (fret === 0) return `${names[i]} open`;
    const finger = shape.fingers[i];
    return `${names[i]} fret ${fret}${finger ? `, finger ${finger}` : ''}`;
  });
  const where = start > 1 ? ` starting at fret ${start}` : '';
  return `${shape.name} chord${where}. ${parts.join('. ')}.`;
}
