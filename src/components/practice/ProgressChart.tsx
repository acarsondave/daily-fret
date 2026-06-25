interface Point {
  date: string;
  cpm: number;
}

interface Props {
  series: Point[];
}

function shortDate(d: string): string {
  const [, m, day] = d.split('-');
  const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[parseInt(m, 10)] ?? ''} ${parseInt(day, 10)}`;
}

// A labeled best-cpm-over-time chart (the Monkeytype-style view): gridlines, an
// area-filled trend, value axis, dotted points, and the latest value called out.
export function ProgressChart({ series }: Props) {
  const W = 520;
  const H = 200;
  const padL = 34;
  const padR = 16;
  const padT = 16;
  const padB = 26;

  if (series.length === 0) {
    return <div className="chart-empty">No data yet.</div>;
  }

  const cpms = series.map((p) => p.cpm);
  const max = Math.max(...cpms);
  const min = Math.min(...cpms);
  // Pad the value range a little so the line isn't glued to the edges.
  const top = max === min ? max + 1 : max + Math.ceil((max - min) * 0.15);
  const bottom = max === min ? Math.max(0, max - 1) : Math.max(0, min - Math.ceil((max - min) * 0.15));
  const span = top - bottom || 1;

  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = series.length;

  const x = (i: number) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - ((v - bottom) / span) * innerH;

  const pts = series.map((p, i) => [x(i), y(p.cpm)] as const);
  const line = pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${(padT + innerH).toFixed(1)} L${pts[0][0].toFixed(1)} ${(padT + innerH).toFixed(1)} Z`;

  const ticks = [top, Math.round((top + bottom) / 2), bottom];
  const [lastX, lastY] = pts[pts.length - 1];

  return (
    <svg className="progress-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Best changes per minute over time">
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {ticks.map((t, i) => {
        const gy = y(t);
        return (
          <g key={i}>
            <line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={padL - 8} y={gy + 4} textAnchor="end" className="chart-axis">{t}</text>
          </g>
        );
      })}

      <path d={area} fill="url(#chartFill)" />
      <path d={line} fill="none" stroke="var(--accent-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {pts.map(([px, py], i) => (
        <circle key={i} cx={px} cy={py} r={i === pts.length - 1 ? 4 : 2.5} fill="var(--accent-primary)" />
      ))}
      <circle cx={lastX} cy={lastY} r="7" fill="var(--accent-primary)" opacity="0.18" />

      <text x={padL} y={H - 8} textAnchor="start" className="chart-axis">{shortDate(series[0].date)}</text>
      {n > 1 && (
        <text x={W - padR} y={H - 8} textAnchor="end" className="chart-axis">
          {shortDate(series[n - 1].date)}
        </text>
      )}
    </svg>
  );
}
