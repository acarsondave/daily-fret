export type DrillKind = 'one-minute-changes' | 'chord-trainer' | 'song' | 'chord-rotation';

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
  // song: skip the self-paced Learn pass and go straight to the real recording.
  // For a song you already know and just want to keep playing in the session.
  playOnly?: boolean;
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

export interface DailyLog {
  date: string; // YYYY-MM-DD
  routineId: string;
  completedTaskIds: string[];
  feedback?: string;
  drillResults?: Record<string, number>; // taskId -> best changes/min for the day
}

export interface UserState {
  routines: Routine[];
  dailyLogs: Record<string, DailyLog>; // Keyed by YYYY-MM-DD
  activeRoutineId: string | null;
}
