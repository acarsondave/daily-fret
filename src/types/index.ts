export type DrillKind =
  | 'one-minute-changes'
  | 'chord-trainer'
  | 'song'
  | 'chord-rotation'
  | 'strum-timing'
  | 'strum-pattern'
  | 'note-finder';

export interface DrillConfig {
  kind: DrillKind;
  chordFrom?: string; // legacy single-pair changes config (back-compat)
  chordTo?: string;
  durationSec?: number; // defaults to 60
  // one-minute-changes: the chords you're comfortable switching between (pairs
  // are derived from these). chord-trainer: the pool of chords to call out.
  // chord-rotation: the ordered ring of chords to cycle through (e.g. D,A,E).
  chords?: string[];
  // one-minute-changes: exact change-pairs to drill, in order. When set these
  // override the auto-derived combinations of `chords`, so a routine can
  // prescribe specific transitions (e.g. Justin's Am↔E, Em↔D, Am↔Em) instead of
  // every pair. `chords` is still carried as a fallback for older app builds.
  pairs?: Array<{ from: string; to: string }>;
  songId?: string; // song-player: which song from the catalog to play along to
  // strum-timing: the tempo to measure at. The drill is about holding a tempo
  // rather than beating one, so nothing in its own history implies a next
  // number the way a change rate does; a routine states it, or the standard
  // practice click is used.
  bpm?: number;
  // strum-pattern: the deck this run deals from, as D/U/- strings. A deck is
  // stored as strings rather than as pattern ids for the same reason a block
  // is: deleting a saved pattern must never silently change what a task asks
  // for. Absent means the opening rungs of the built-in ladder.
  patterns?: string[];
  // strum-pattern: bars each dealt pattern is played for before the next is
  // dealt. Absent takes MIN_PATTERN_BARS, which is the shortest run the
  // matcher will form an opinion about (src/lib/strumPattern.ts).
  bars?: number;
  // note-finder: the rung of the ladder to run, as a rung id from
  // src/lib/noteFinder.ts. Absent is the normal case and the better one: the
  // drill reads its own history and runs the lowest rung not yet cleared, which
  // is the same rule the click applies to tempo. Stated only when a routine
  // deliberately pins a rung.
  rungId?: string;
}

// One labeled block inside a configurable timed task. Lets a single task (e.g.
// "Strumming") hold several self-contained blocks, each with its own minutes,
// that coached mode walks through as separate segments.
export interface TimedBlock {
  id: string;
  label: string;
  durationSec: number;
  note?: string;
  pattern?: string; // optional strum pattern (D/U/- string) to show during the block
  // Tempo this block should be practised at. A timed block has no measurable
  // change rate to derive one from, so a riff or strumming pattern with a real
  // tempo states it here; everything else falls back to the standard click.
  bpm?: number;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  duration?: string; // e.g., "5 mins"
  drill?: DrillConfig; // when set, the task launches an interactive detector
  blocks?: TimedBlock[]; // when set (and no drill), a multi-block timed task
  bpm?: number; // practice tempo for a plain timed task (see TimedBlock.bpm)
}

export interface Routine {
  id: string;
  name: string;
  description: string;
  tasks: Task[];
  isDefault?: boolean;
  chords?: string[]; // working chord vocabulary; drives pairs + Coached mode
}

// What the app itself witnessed for a task today. Absent means it witnessed
// nothing, which is a different statement from "not done" and has to stay
// distinguishable: a completion the user asserted must never read as a
// measurement.
//   measured - the microphone counted something for this task today.
//   timed    - a timer for this task ran inside the app today.
//   silent   - a drill ran its full length and nothing was heard.
// Ranked in exactly that order: evidence accumulates over a day and never
// downgrades, so a silent second run cannot erase a measured first one.
export type TaskEvidence = 'measured' | 'timed' | 'silent';

export interface TaskRecord {
  evidence?: TaskEvidence;
  // Total seconds this task's timer actually ran today, summed across runs.
  seconds?: number;
  // A timer for this task reached zero at least once. This, not elapsed time,
  // is what earns a timed task its completion: skipping is not doing.
  ranToEnd?: boolean;
  // The user said this is done. Kept beside the evidence rather than folded
  // into it, so "you marked this" can never be presented as "the app heard it".
  stated?: boolean;
  at: number; // epoch ms of the most recent run
}

// One run of one drill. The app used to keep only the day's best, which cannot
// tell one lucky attempt from three consistent ones, and threw away the runs it
// summarised. The summary stays (everything downstream reads it); this is the
// thing it is a summary of.
export interface DrillRun {
  value: number;
  /**
   * The bar this run's pattern first came out whole on, or null when it never
   * did. Only the strum-pattern drill writes it, and it is here rather than
   * folded into `value` because it answers a different question: `value` says
   * how much of the pattern landed in time, and this says how long it took to
   * arrive. `patternStanding` needs both, and a score alone cannot tell a
   * pattern you have from one you are working out.
   *
   * Absent on every run that is not a dealt pattern.
   */
  settledBar?: number | null;
  /**
   * Median milliseconds a find took on this run, or null when it found nothing.
   *
   * Only the note finder writes it, and it is here rather than folded into
   * `value` for the same reason `settledBar` is: `value` says how many notes
   * were found and this says how long each one took to arrive, which is the
   * figure that actually moves over months. `rungStanding` needs both.
   *
   * Absent on every run that is not a note find.
   */
  findMs?: number | null;
  // Epoch ms. Absent on runs reconstructed from a day that predates this, where
  // the only honest statement is that the day held at least one run at that
  // value, not when.
  at?: number;
}

export interface DailyLog {
  date: string; // YYYY-MM-DD
  routineId: string;
  completedTaskIds: string[];
  feedback?: string;
  drillResults?: Record<string, number>; // result key -> best value for the day
  // Every heard run of the day, in the order they happened, under the same keys
  // as drillResults. Absent on older logs; read it through `runsFor` in
  // src/store/completion.ts rather than directly, so a day recorded before this
  // existed still answers the question.
  drillRuns?: Record<string, DrillRun[]>
  // How each of today's completions came about. Absent on logs written before
  // this existed, and never backfilled: an old day is readable exactly as it
  // was recorded, and the app does not invent evidence it never had.
  taskRecords?: Record<string, TaskRecord>;
}

export interface UserState {
  routines: Routine[];
  dailyLogs: Record<string, DailyLog>; // Keyed by YYYY-MM-DD
  activeRoutineId: string | null;
}
