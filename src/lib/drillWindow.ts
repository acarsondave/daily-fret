// How long a stored count was counted over, written on the key that names it.
//
// A drill's number is a count, and a count means nothing without the window it
// was taken in. The app compared those counts against per-minute bars and drew a
// personal best across them while the blocks behind them were built at sixty
// seconds in one place and ninety in another. Nothing showed, because every path
// that builds a changes drill happens to use sixty; a thirty-second block would
// have halved what "held" means without a word about it, and Chord Perfect's
// ninety-second block already out-ranked its sixty-second one on the same shapes.
//
// The window goes on the key, for the same reason the shapes are on it: a number
// that was not taken the same way is not the same number. It could not go beside
// the value, because the field every reader compares (`drillResults`) is a plain
// map of key to number and has nowhere to put a second fact.
//
// Unlike the pool of shapes, though, a window divides out. So the readers fold
// every window of one drill back onto one base key and hold rates, which is what
// makes a ninety-second block and a sixty-second block comparable rather than
// merely separate.
//
// This module is only the string mechanics. Which keys are counts at all, and
// which are already rates, is a question about the drill vocabulary and lives in
// lib/drillKeys.ts. Split so that lib/pairs.ts can read a window without
// importing the vocabulary that imports it.

/**
 * Separates a drill key from the seconds it was measured over.
 *
 * Not a character any chord name, pool separator or ring arrow uses, so an
 * existing key can never be mistaken for one that carries a window.
 */
export const WINDOW_SEP = '@';

/**
 * What a key with no window written on it was measured over.
 *
 * Sixty seconds, because that is what every path that ever wrote one used: the
 * changes drill, the rotation and the strum block are all built at sixty, and
 * the owner's practice history is months of one-minute runs. Reading them any
 * other way would rewrite results nobody re-played.
 *
 * It is an assumption, and it is stated rather than hidden, because it is wrong
 * for exactly one case: Chord Perfect blocks were built at ninety configured
 * seconds and ran longer still. Those legacy scores therefore read high against
 * newly recorded ones. Rescaling them on a guess about which build wrote them
 * would be worse: it would change numbers the player earned.
 */
export const ASSUMED_WINDOW_SEC = 60;

/**
 * The drill a key names, with any window stripped off.
 *
 * A separator with nothing readable after it is left where it is rather than
 * trimmed away, so a corrupt key stays visibly corrupt instead of quietly
 * resolving to a real drill and collecting somebody else's runs.
 */
export function baseKey(key: string): string {
  const at = key.lastIndexOf(WINDOW_SEP);
  if (at < 0 || keyWindow(key) === null) return key;
  return key.slice(0, at);
}

/** The seconds a key records, or null when it records none. */
export function keyWindow(key: string): number | null {
  const at = key.lastIndexOf(WINDOW_SEP);
  if (at < 0) return null;
  const seconds = Number(key.slice(at + 1));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/**
 * The same key, stating the seconds the run was counted over.
 *
 * Throws rather than shrugging on either way of getting it wrong. A window of
 * zero would divide by zero downstream, and a key that already carries one means
 * a caller has run this twice and is about to file the run under a drill that
 * does not exist.
 */
export function withWindow(key: string, durationSec: number): string {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`A drill run cannot have been measured over ${durationSec} seconds.`);
  }
  if (key.includes(WINDOW_SEP)) {
    throw new Error(`The key "${key}" already states the window it was measured over.`);
  }
  return `${key}${WINDOW_SEP}${Math.round(durationSec)}`;
}

/** A count, as the per-minute rate it works out to. */
export function perMinute(value: number, windowSec: number): number {
  if (!Number.isFinite(windowSec) || windowSec <= 0) {
    throw new Error(`A rate cannot be read from a window of ${windowSec} seconds.`);
  }
  return windowSec === 60 ? value : (value * 60) / windowSec;
}
