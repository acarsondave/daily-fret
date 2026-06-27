export type DrillKind = 'one-minute-changes' | 'chord-trainer' | 'song';

export interface DrillConfig {
  kind: DrillKind;
  chordFrom?: string; // legacy single-pair changes config (back-compat)
  chordTo?: string;
  durationSec?: number; // defaults to 60
  // one-minute-changes: the chords you're comfortable switching between (pairs
  // are derived from these). chord-trainer: the pool of chords to call out.
  chords?: string[];
  songId?: string; // song-player: which song from the catalog to play along to
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
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  duration?: string; // e.g., "5 mins"
  drill?: DrillConfig; // when set, the task launches an interactive detector
  blocks?: TimedBlock[]; // when set (and no drill), a multi-block timed task
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
