// What a practice recording is, as a piece of data.
//
// The app cannot watch the player's hands, and a teacher is not available. The
// answer is footage: the camera stays where it is and the app films the session
// as a side effect of running it. This file is the model everything else in
// src/media/ reads and writes, and it is deliberately shaped for two things
// that do not exist yet, because retro-fitting either one would mean rewriting
// every clip already on disk:
//
//  - Cloud upload. `location` names where the bytes are rather than assuming,
//    and `upload` records what has been sent. A later pass adds a backend to
//    the union and fills the field in; nothing already stored has to move.
//  - Automated technique analysis. `analysis` is absent until an analyser has
//    looked at a clip, which is a different statement from "found nothing", and
//    it carries the engine version so old verdicts can be told apart from new
//    ones and re-run.
//
// Nothing here holds video bytes. The index is small enough to sit in
// localStorage; the footage never goes anywhere near it.

/** Why a clip exists, which is also what may prune it. */
export type RecordingKind =
  | 'session' // filmed automatically while a drill or timed block ran
  | 'technique-check'; // a deliberate short capture from a named angle

/**
 * The three angles a technique check films, in the order it films them.
 *
 * These are not arbitrary. A single camera cannot show a fretting hand, a
 * thumb position and a strumming arm at once, and the one angle most people
 * default to (straight on, phone propped against a music stand) is the angle
 * that hides the fretboard behind the player's own hand.
 */
export type TechniqueView =
  | 'front' // straight on: posture, both hands in frame, the whole picture
  | 'neck' // over the shoulder, down the neck: finger placement and arching
  | 'strumming'; // from the picking side: wrist, angle of attack, dynamics

export const TECHNIQUE_VIEWS: readonly TechniqueView[] = ['front', 'neck', 'strumming'];

/** How much the recording is allowed to cost, in resolution and bitrate. */
export type RecordingQuality = 'light' | 'standard' | 'detail';

/**
 * How often practice sessions are filmed automatically.
 *
 * `weekly` is the default and the reason the feature is affordable: one filmed
 * session a week is a record of a month, where one filmed session a day is
 * twenty gigabytes nobody opens. See ./cadence.ts for the rule.
 */
export type RecordingCadence = 'weekly' | 'every-session' | 'manual';

/**
 * Where a clip's bytes live.
 *
 * A union rather than a boolean, so adding 'cloud' later is an addition and not
 * a migration. Every reader switches on it, which means a clip stored under a
 * backend this build does not understand is reported as unreachable rather than
 * silently treated as missing and pruned.
 */
export type StorageBackend = 'opfs' | 'indexeddb';

export interface RecordingLocation {
  backend: StorageBackend;
  /** File name inside the recordings directory, or the IndexedDB key. */
  key: string;
}

/** What a future upload pass has done with this clip. Absent means untouched. */
export interface RecordingUpload {
  state: 'pending' | 'uploaded' | 'failed';
  at: number;
  /** Whatever the remote calls it. Absent until an upload has succeeded. */
  remoteId?: string;
  /** Why the last attempt failed, kept so a retry can say what it is retrying. */
  error?: string;
}

/**
 * What an analyser made of this clip.
 *
 * The findings are deliberately a flat list of statements rather than a schema
 * invented ahead of the analyser that has to fill it. What is fixed here is the
 * part a later engine cannot add cheaply: which engine spoke, and when, so a
 * verdict from an early version is never mistaken for a current one.
 */
export interface RecordingAnalysis {
  engineVersion: number;
  at: number;
  findings: string[];
}

export type RecordingEnd =
  | 'complete' // the drill finished and the recording was stopped with it
  | 'time-limit' // the per-clip cap was reached
  | 'device-lost' // the camera went away
  | 'hidden' // the tab or the screen went away and the camera stopped with it
  | 'storage-full'; // the disk filled part-way through

export interface Recording {
  id: string;
  /**
   * Every clip filmed during one opening of a practice surface shares this.
   * Retention counts sessions, not clips, so a routine of eight drills is one
   * thing to keep or let go rather than eight.
   */
  sessionId: string;
  kind: RecordingKind;
  /** YYYY-MM-DD, the same key a DailyLog is filed under. */
  date: string;
  /** The task this clip was filmed during. Null for a technique check. */
  taskId: string | null;
  routineId: string | null;
  /** What was being played, in the player's own words (the task title). */
  label: string;
  view?: TechniqueView;
  startedAt: number;
  durationMs: number;
  bytes: number;
  /** The full type string MediaRecorder actually used, codecs included. */
  mimeType: string;
  quality: RecordingQuality;
  width: number;
  height: number;
  /** Silent footage is much less useful for review, so this is worth knowing. */
  hasAudio: boolean;
  /** Starred clips are never pruned, whatever the retention count says. */
  starred: boolean;
  /**
   * How the clip came to an end. Footage cut short is kept and says so, rather
   * than being thrown away or offered as a complete take: a review library that
   * cannot tell "this is where you stopped playing" from "this is where the
   * camera fell over" will have the player drawing conclusions from an edit the
   * app made.
   */
  endedBy: RecordingEnd;
  location: RecordingLocation;
  upload?: RecordingUpload;
  analysis?: RecordingAnalysis;
}

/**
 * A prune that happened. Kept so deleting is never silent: the settings pane
 * reads this back and says what went, and when.
 */
export interface PruneEvent {
  at: number;
  clips: number;
  bytes: number;
}

export interface RecordingSettings {
  /** Off until the user turns it on. There is no default-on path to this. */
  enabled: boolean;
  cadence: RecordingCadence;
  quality: RecordingQuality;
  /** How many practice sessions of footage to keep before the oldest goes. */
  keepSessions: number;
  /** Preferred camera, or null for whatever the system hands over. */
  cameraId: string | null;
}
