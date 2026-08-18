import { motion } from 'framer-motion';

/**
 * The one moment the app celebrates, and it celebrates it without saying so.
 *
 * It used to sit in the one-minute drill only, while the other two counting
 * drills marked a personal best by turning a line of text gold and putting a
 * trophy next to it. That line is gone from all three: the gold arc past the
 * mark on the ring is what beating your best looks like now, and this is what
 * it feels like. Same burst, same timing, in all three places.
 */
export function PersonalBestSparkle() {
  return (
    <div className="om-sparkles" aria-hidden="true">
      {Array.from({ length: 10 }).map((_, i) => (
        <motion.span
          key={i}
          className="om-sparkle"
          initial={{ opacity: 0, x: 0, y: 0, scale: 0 }}
          animate={{
            opacity: [0, 1, 0],
            x: Math.cos((i / 10) * Math.PI * 2) * 120,
            y: Math.sin((i / 10) * Math.PI * 2) * 120,
            scale: [0, 1, 0.6],
          }}
          transition={{ duration: 1.1, delay: 0.15 + i * 0.02, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}
