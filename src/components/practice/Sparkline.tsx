interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}

// Minimal trend line. Uses currentColor so callers control the hue via CSS.
export function Sparkline({ values, width = 96, height = 28, className }: SparklineProps) {
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const pad = 3;
  const usableH = height - pad * 2;

  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = pad + usableH - ((v - min) / span) * usableH;
    return [x, y] as const;
  });

  const d = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');

  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      aria-hidden="true"
    >
      <path
        d={d}
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />
      <circle cx={lastX} cy={lastY} r={2.5} fill="currentColor" />
    </svg>
  );
}
