// One calibration per guitar.
//
// The detector learns how chords sound on a specific instrument through a
// specific microphone. That fit is the whole reason calibration exists, and it
// is also why a single stored calibration was wrong: pick up a different guitar
// and the templates that made A and D separable are now describing an
// instrument that is not in the room. The failure is quiet — drills just stop
// counting — which is the worst way for it to fail.
//
// `ChordCalibration` always carried a `label`, so the shape was designed for
// this. What was missing was a list, a pick, and a rule for which one is live.

import type { CalibrationData, ChordCalibration } from '../audio/calibration';
import { MIN_SAMPLES } from '../audio/calibration';

export interface ChordProfile extends ChordCalibration {
  id: string;
  label: string;
}

/** Id given to a calibration made before profiles existed. */
export const LEGACY_PROFILE_ID = 'guitar-1';

/** What that pre-profiles calibration is called once it becomes a profile. */
export const LEGACY_PROFILE_LABEL = 'My guitar';

interface ProfileHolder {
  chordProfiles?: ChordProfile[];
  activeProfileId?: string;
  /** Pre-profiles single calibration. Read on migration, never written again. */
  chordCalibration?: ChordCalibration;
}

/**
 * Every stored profile, migrating a pre-profiles calibration on the way through.
 *
 * The migration is a read, not a write: nothing is rewritten until the user
 * actually does something, so opening the app on a new build cannot damage a
 * calibration that took ten minutes to record.
 */
export function profilesOf(acc: ProfileHolder | undefined): ChordProfile[] {
  if (acc?.chordProfiles?.length) return acc.chordProfiles;
  const legacy = acc?.chordCalibration;
  if (!legacy) return [];
  return [{ ...legacy, id: LEGACY_PROFILE_ID, label: legacy.label || LEGACY_PROFILE_LABEL }];
}

/**
 * The profile the detector is currently using.
 *
 * Falls back to the first rather than to nothing when the active id is stale
 * (a profile deleted on another device, say). Being calibrated to the wrong
 * guitar of two is recoverable; silently dropping to the built-in templates
 * after a sync looks exactly like the app breaking.
 */
export function activeProfileOf(acc: ProfileHolder | undefined): ChordProfile | undefined {
  const profiles = profilesOf(acc);
  if (!profiles.length) return undefined;
  return profiles.find((p) => p.id === acc?.activeProfileId) ?? profiles[0];
}

/** Chords in a profile with enough frames behind them to be trusted. */
export function readyChords(profile: ChordProfile | undefined): number {
  if (!profile?.chords) return 0;
  return Object.values(profile.chords).filter((c) => c.samples >= MIN_SAMPLES).length;
}

/**
 * Whether a profile can actually drive the matcher.
 *
 * A discriminative fit needs two chords to contrast; one is a profile that
 * exists but changes nothing, and saying "calibrated" about it would be a
 * claim the detector cannot honour.
 */
export function profileIsUsable(profile: ChordProfile | undefined): boolean {
  return readyChords(profile) >= 2;
}

export function newProfileId(profiles: readonly ChordProfile[]): string {
  const taken = new Set(profiles.map((p) => p.id));
  for (let n = 1; ; n++) {
    const id = `guitar-${n}`;
    if (!taken.has(id)) return id;
  }
}

/** A name that is not already in the list, so two guitars never read the same. */
export function nextProfileLabel(profiles: readonly ChordProfile[]): string {
  const taken = new Set(profiles.map((p) => p.label.trim().toLowerCase()));
  if (!taken.has(LEGACY_PROFILE_LABEL.toLowerCase())) return LEGACY_PROFILE_LABEL;
  for (let n = 2; ; n++) {
    const label = `Guitar ${n}`;
    if (!taken.has(label.toLowerCase())) return label;
  }
}

export function makeProfile(
  id: string,
  label: string,
  chords: CalibrationData,
  at: number,
): ChordProfile {
  return { id, label, version: 1, createdAt: at, updatedAt: at, chords };
}
