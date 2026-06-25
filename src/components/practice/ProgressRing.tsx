import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface ProgressRingProps {
  progress: number; // 0..1
  size?: number;
  stroke?: number;
  className?: string;
  children?: ReactNode;
}

// Circular target ring. Stroke color is driven by `currentColor` so the parent
// can switch between accent and a celebratory hue with a single CSS class.
export function ProgressRing({
  progress,
  size = 220,
  stroke = 10,
  className,
  children,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(1, progress));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);
  const center = size / 2;

  return (
    <div
      className={className}
      style={{ position: 'relative', width: size, height: size }}
    >
      <svg width={size} height={size} aria-hidden="true">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
        }}
      >
        {children}
      </div>
    </div>
  );
}
