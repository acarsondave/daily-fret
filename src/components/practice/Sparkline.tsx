interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  area?: boolean; // fill under the line for a clearer trend read
}

// Minimal trend line. Uses currentColor so callers control the hue via CSS.
export function Sparkline({
  values,
  width = 96,
  height = 28,
  className,
  area = false,
}: SparklineProps) {
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  // Inset on both axes, not just the vertical one. The last point used to land
  // at exactly x = width, so half its stroke fell outside the viewBox and the
  // line appeared to run into whatever was drawn around it. Inside the "Best"
  // pill that read as the trend leaking through the border.
  const pad = 3;
  const stepX = (width - pad * 2) / (values.length - 1);
  const usableH = height - pad * 2;

  const points = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + usableH - ((v - min) / span) * usableH;
    return [x, y] as const;
  });

  const d = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');

  const [lastX, lastY] = points[points.length - 1];
  const areaD = `${d} L${width.toFixed(1)} ${height} L0 ${height} Z`;

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      aria-hidden="true"
    >
      {area && <path d={areaD} fill="currentColor" opacity={0.12} stroke="none" />}
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
