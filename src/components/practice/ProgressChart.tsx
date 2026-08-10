import type { SeriesPoint } from '../../lib/drillStats';

interface Props {
  series: SeriesPoint[];
  /** What the numbers are, e.g. "changes / min" or "shapes placed". */
  unitLabel: string;
}

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(d: string): string {
  const [, m, day] = d.split('-');
  return `${MONTHS[parseInt(m, 10)] ?? ''} ${parseInt(day, 10)}`;
}

// Beyond this many sessions a dot per point is a smear rather than a reading,
// so only the two that carry meaning stay: the best, and the latest.
const DOTS_UP_TO = 24;

/**
 * One drill's results over time: gridlines, a trend line, a value axis, the
 * personal best marked, and the latest value called out.
 *
 * Two points is the contract. A single result is not a trend and must not be
 * drawn as one, so the caller states it in words instead.
 */
export function ProgressChart({ series, unitLabel }: Props) {
  if (series.length < 2) return null;

  const W = 520;
  const H = 200;
  const padL = 34;
  const padR = 16;
  const padT = 16;
  const padB = 26;

  const values = series.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  // Pad the value range a little so the line isn't glued to the edges.
  const top = max === min ? max + 1 : max + Math.ceil((max - min) * 0.15);
  const bottom = max === min ? Math.max(0, max - 1) : Math.max(0, min - Math.ceil((max - min) * 0.15));
  const span = top - bottom || 1;

  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = series.length;

  const x = (i: number) => padL + (i / (n - 1)) * innerW;
  const y = (v: number) => padT + innerH - ((v - bottom) / span) * innerH;

  const pts = series.map((p, i) => [x(i), y(p.value)] as const);
  const line = pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${(padT + innerH).toFixed(1)} L${pts[0][0].toFixed(1)} ${(padT + innerH).toFixed(1)} Z`;

  const ticks = [top, Math.round((top + bottom) / 2), bottom];
  const bestIndex = values.lastIndexOf(max);
  const [lastX, lastY] = pts[pts.length - 1];
  const [bestX, bestY] = pts[bestIndex];

  // A filled area measured from a baseline that is not zero exaggerates every
  // wobble into a mountain. The axis has to be cropped for a change rate that
  // lives between 40 and 60, so the fill is what gives way.
  const zeroBased = bottom === 0;
  const summary =
    `${unitLabel} over ${n} sessions. Latest ${values[n - 1]} on ${shortDate(series[n - 1].date)}, ` +
    `best ${max} on ${shortDate(series[bestIndex].date)}, lowest ${min}.`;

  return (
    <svg className="progress-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {ticks.map((t) => {
        const gy = y(t);
        return (
          <g key={t}>
            <line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="var(--border-subtle)" strokeWidth="1" />
            <text x={padL - 8} y={gy + 4} textAnchor="end" className="chart-axis">{t}</text>
          </g>
        );
      })}

      {zeroBased && <path d={area} fill="url(#chartFill)" />}
      <path d={line} fill="none" stroke="var(--accent-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {n <= DOTS_UP_TO &&
        pts.map(([px, py], i) => (
          <circle key={series[i].date} cx={px} cy={py} r="2.5" fill="var(--accent-primary)" />
        ))}

      {/* When the latest run *is* the best, one marker carries both, in the
          record colour. Stacking them hid the best under the newer dot. */}
      {bestIndex !== n - 1 && (
        <>
          <circle cx={bestX} cy={bestY} r="6" fill="var(--record-color)" opacity="0.2" />
          <circle cx={bestX} cy={bestY} r="3.5" fill="var(--record-color)" />
        </>
      )}
      <circle
        cx={lastX}
        cy={lastY}
        r="7"
        fill={bestIndex === n - 1 ? 'var(--record-color)' : 'var(--accent-primary)'}
        opacity="0.2"
      />
      <circle
        cx={lastX}
        cy={lastY}
        r="4"
        fill={bestIndex === n - 1 ? 'var(--record-color)' : 'var(--accent-primary)'}
      />

      <text x={padL} y={H - 8} textAnchor="start" className="chart-axis">{shortDate(series[0].date)}</text>
      <text x={W - padR} y={H - 8} textAnchor="end" className="chart-axis">
        {shortDate(series[n - 1].date)}
      </text>
    </svg>
  );
}
