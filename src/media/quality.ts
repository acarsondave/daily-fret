// What the recorder encodes, and what that costs.
//
// Two decisions live here and nowhere else, because both of them are numbers
// the user is entitled to see before they spend a gigabyte on them.
//
// The container and codec are chosen by asking the browser rather than by
// assuming WebM exists. Safari has no WebM encoder at all and answers every
// `video/webm` probe with false; it writes MP4 with H.264 and AAC. Chrome and
// Firefox prefer WebM. A hard-coded string is how a feature like this ships
// working on the developer's machine and silently recording nothing on the
// user's phone.

import type { RecordingQuality } from './types';

export interface QualityPreset {
  id: RecordingQuality;
  label: string;
  /** What this setting is for, in one line, in the app's own voice. */
  blurb: string;
  width: number;
  height: number;
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
}

/**
 * Three choices, not a slider.
 *
 * A bitrate slider asks the player to have an opinion about kilobits while
 * holding a guitar. These are named by what they are for: 720p at a modest
 * bitrate is the middle one and the default, because it is the lowest setting
 * at which a fretting hand is genuinely readable on a laptop screen.
 */
export const QUALITY_PRESETS: readonly QualityPreset[] = [
  {
    id: 'light',
    label: 'Light',
    blurb: 'Enough to see shape and posture. Cheapest to keep.',
    width: 854,
    height: 480,
    videoBitsPerSecond: 500_000,
    audioBitsPerSecond: 64_000,
  },
  {
    id: 'standard',
    label: 'Standard',
    blurb: '720p. Fingers are readable. This is the one to leave it on.',
    width: 1280,
    height: 720,
    videoBitsPerSecond: 1_500_000,
    audioBitsPerSecond: 96_000,
  },
  {
    id: 'detail',
    label: 'Detail',
    blurb: '1080p, for picking apart one chord change frame by frame.',
    width: 1920,
    height: 1080,
    videoBitsPerSecond: 3_000_000,
    audioBitsPerSecond: 128_000,
  },
];

export const DEFAULT_QUALITY: RecordingQuality = 'standard';

export function presetFor(quality: RecordingQuality): QualityPreset {
  const preset = QUALITY_PRESETS.find((p) => p.id === quality);
  // A quality id that is not in the table is a bug in whatever wrote it, and
  // encoding at a guessed bitrate would hide that bug behind footage of the
  // wrong size. Say so instead.
  if (!preset) throw new Error(`Unknown recording quality: ${quality}`);
  return preset;
}

/** One binary megabyte, used consistently everywhere a size is shown. */
export const BYTES_PER_MB = 1024 * 1024;

/**
 * Megabytes a minute of footage costs at this setting, from the bitrates above
 * rather than from a number typed into the interface. The two cannot drift.
 * Real measurements land within a few per cent of this: the encoder tracks the
 * bitrate it was given, and the container adds well under one per cent.
 */
export function megabytesPerMinute(quality: RecordingQuality): number {
  const preset = presetFor(quality);
  const bitsPerMinute = (preset.videoBitsPerSecond + preset.audioBitsPerSecond) * 60;
  return bitsPerMinute / 8 / BYTES_PER_MB;
}

export function formatMegabytes(bytes: number): string {
  const mb = bytes / BYTES_PER_MB;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 100) return `${Math.round(mb)} MB`;
  if (mb >= 10) return `${mb.toFixed(1)} MB`;
  return `${mb.toFixed(mb >= 1 ? 1 : 2)} MB`;
}

/**
 * Candidates in the order we would rather have them.
 *
 * VP9 first: the best quality per byte of anything a browser will encode, and
 * the whole point of this feature is footage worth keeping on a connection that
 * cannot afford to ship it anywhere. VP8 next, for older Chromium and Firefox
 * builds. Then bare WebM and bare MP4, which let the browser pick its own
 * codecs, which is what Safari needs: it answers every `codecs=` probe about
 * H.264 with a different string than you expect and accepts the plain one.
 */
const CONTAINER_CANDIDATES: readonly string[] = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
];

/**
 * The best container this browser will actually write, or null if it will not
 * write any of them.
 *
 * Null is a real answer and callers must handle it. A browser with
 * MediaRecorder but no encoder we can name is a browser this feature cannot run
 * on, and starting a recorder there produces a zero-byte file with no error.
 */
export function chooseMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  // Older Safari shipped MediaRecorder before isTypeSupported. Everything it
  // writes is MP4, so name that rather than refusing to record at all.
  if (typeof MediaRecorder.isTypeSupported !== 'function') return 'video/mp4';
  return CONTAINER_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

/** The file extension a clip of this type should be saved under. */
export function extensionFor(mimeType: string): string {
  if (mimeType.startsWith('video/mp4')) return 'mp4';
  if (mimeType.startsWith('video/webm')) return 'webm';
  return 'bin';
}
