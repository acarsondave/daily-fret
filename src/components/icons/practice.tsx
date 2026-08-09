import { IconBase, type IconProps } from './Icon';

// The marks that only a guitar practice coach needs. These are where the set
// earns its keep: a pick, a metronome, a fretted string, a signal meter. Drawn
// on the same 24 grid and the same 1.75 pen as the plumbing in ./ui.

// Transport controls read as solid shapes because they are commitments, not
// navigation. The stroke language still governs their outline radii.
export const PlayIcon = ({ size = 20, className, color }: IconProps) => (
  <svg
    className={className ? `icon-glyph ${className}` : 'icon-glyph'}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    style={color ? { color } : undefined}
    aria-hidden="true"
    focusable="false"
  >
    <path d="M8.6 5.5a1.1 1.1 0 0 1 1.66-.95l9 6.5a1.1 1.1 0 0 1 0 1.9l-9 6.5A1.1 1.1 0 0 1 8.6 18.5Z" />
  </svg>
);

export const PauseIcon = ({ size = 20, className, color }: IconProps) => (
  <svg
    className={className ? `icon-glyph ${className}` : 'icon-glyph'}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    style={color ? { color } : undefined}
    aria-hidden="true"
    focusable="false"
  >
    <rect x="7.6" y="5" width="3.4" height="14" rx="1.5" />
    <rect x="13" y="5" width="3.4" height="14" rx="1.5" />
  </svg>
);

export const SkipIcon = ({ size = 20, className, color }: IconProps) => (
  <svg
    className={className ? `icon-glyph ${className}` : 'icon-glyph'}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    style={color ? { color } : undefined}
    aria-hidden="true"
    focusable="false"
  >
    <path d="M5.4 6a1.1 1.1 0 0 1 1.68-.94l7.4 5.5a1.1 1.1 0 0 1 0 1.88l-7.4 5.5A1.1 1.1 0 0 1 5.4 18Z" />
    <rect x="16.4" y="5.2" width="2.9" height="13.6" rx="1.4" />
  </svg>
);

// A plectrum. This is the app's signature mark: it launches a drill, and it is
// the one object every user of this product is physically holding.
export const PlectrumIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M12 3.6c3.7 0 6.6 2.2 6.6 5.4 0 3.5-3.3 8-5.4 10.3a1.6 1.6 0 0 1-2.4 0C8.7 17 5.4 12.5 5.4 9c0-3.2 2.9-5.4 6.6-5.4Z" />
    <path d="M9.9 8.2c1.5.5 2.5 1.6 3 3.2" />
  </IconBase>
);

// A tuning fork. The one object in the room whose entire purpose is being
// exactly right, which is what the tuner is claiming to be.
export const TuningForkIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M8.5 3.4v7.1a3.5 3.5 0 0 0 7 0V3.4" />
    <path d="M12 14v6.6" />
  </IconBase>
);

export const MicIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M12 4.2a2.7 2.7 0 0 1 2.7 2.7v4.6a2.7 2.7 0 0 1-5.4 0V6.9A2.7 2.7 0 0 1 12 4.2Z" />
    <path d="M6.4 11a5.6 5.6 0 0 0 11.2 0" />
    <path d="M12 16.6v3.2M9.2 19.8h5.6" />
  </IconBase>
);

// Static companion to the swinging mark in Metronome.tsx: tapered body, base
// bar, pendulum at rest.
export const MetronomeIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M8 20 10 5a2 2 0 0 1 4 0l2 15Z" />
    <path d="M6.4 20h11.2" />
    <path d="M12 17.6V8.4" />
  </IconBase>
);

// The coach's voice. A cone with two arcs, sized so the arcs stay separable at
// the 20px the top bar uses.
export const SpeakerIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M4 10.2v3.6a1.4 1.4 0 0 0 1.4 1.4h2.2l4.8 3.6V5.2L7.6 8.8H5.4A1.4 1.4 0 0 0 4 10.2Z" />
    <path d="M15.8 9.4a3.8 3.8 0 0 1 0 5.2" />
    <path d="M18.4 7a7.2 7.2 0 0 1 0 10" />
  </IconBase>
);

// Muted variant, so the coach-voice toggle changes shape and not only opacity.
export const SpeakerOffIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M4 10.2v3.6a1.4 1.4 0 0 0 1.4 1.4h2.2l4.8 3.6V5.2L7.6 8.8H5.4A1.4 1.4 0 0 0 4 10.2Z" />
    <path d="M16 10 20 14M20 10l-4 4" />
  </IconBase>
);

export const MusicNoteIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M9.4 17.6V6.6l9-1.7v10.4" />
    <ellipse cx="7.2" cy="17.8" rx="2.2" ry="1.9" />
    <ellipse cx="16.2" cy="15.6" rx="2.2" ry="1.9" />
  </IconBase>
);

// Streak. Two flames rather than one silhouette, so it still reads as fire at
// the 14px the header uses.
export const FlameIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M12 2.9c3.5 3 5.5 5.6 5.5 9a5.5 5.5 0 1 1-11 0c0-2 .9-3.8 2.5-5.4.2 1.1.7 1.9 1.5 2.3C11.1 6.8 11.5 4.7 12 2.9Z" />
    <path d="M12 20a2.8 2.8 0 0 0 2.8-2.8c0-1.5-1.1-2.4-2.8-4.2-1.7 1.8-2.8 2.7-2.8 4.2A2.8 2.8 0 0 0 12 20Z" />
  </IconBase>
);

export const TrophyIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M7.6 4.2h8.8v4.3a4.4 4.4 0 0 1-8.8 0Z" />
    <path d="M7.6 5.8H5.2a2.5 2.5 0 0 0 2.6 3.6" />
    <path d="M16.4 5.8h2.4a2.5 2.5 0 0 1-2.6 3.6" />
    <path d="M12 12.9v3.1" />
    <path d="M9.4 19.8h5.2l-.5-3.8h-4.2Z" />
  </IconBase>
);

// Practice next. Concentric rings with the cue mark sitting off-centre, which
// is the point: this is the pair that is behind, not the bullseye.
export const TargetIcon = (p: IconProps) => (
  <IconBase {...p}>
    <circle cx="12" cy="12" r="8.4" />
    <circle cx="12" cy="12" r="3.6" />
    <path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6" />
  </IconBase>
);

export const ChartIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M4.2 3.8v15a1.2 1.2 0 0 0 1.2 1.2h14.4" />
    <path d="M7.6 15.6 11 11.2l2.9 2.5 4.4-6" />
    <circle cx="18.3" cy="7.7" r="1.5" fill="currentColor" stroke="none" />
  </IconBase>
);

export const HourglassIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M6.8 3.6h10.4M6.8 20.4h10.4" />
    <path d="M8 3.6v3c0 2 4 3.6 4 5.4 0-1.8 4-3.4 4-5.4v-3" />
    <path d="M8 20.4v-3c0-2 4-3.6 4-5.4 0 1.8 4 3.4 4 5.4v3" />
  </IconBase>
);

export const BoltIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M13.4 2.8 6 13.6h5l-.4 7.6L18 10.4h-5Z" />
  </IconBase>
);

// Coached session: the whole routine run end to end. A ring of beats with the
// start mark inside, rather than a generic play-in-a-circle.
export const SessionIcon = (p: IconProps) => (
  <IconBase {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M10.4 8.9 15.8 12l-5.4 3.1Z" fill="currentColor" />
  </IconBase>
);

export const RetryIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M4.6 12a7.4 7.4 0 1 0 2.5-5.6" />
    <path d="M5.4 3.2v3.9h3.9" />
  </IconBase>
);

export const SpinnerIcon = ({ size = 20, className, color }: IconProps) => (
  <svg
    className={className ? `icon-glyph icon-spin ${className}` : 'icon-glyph icon-spin'}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    style={color ? { color } : undefined}
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="12" cy="12" r="8.5" opacity="0.22" />
    <path d="M20.5 12a8.5 8.5 0 0 0-8.5-8.5" />
  </svg>
);
