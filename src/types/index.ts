export type DrillKind = 'one-minute-changes' | 'chord-trainer';

export interface DrillConfig {
  kind: DrillKind;
  chordFrom?: string; // legacy single-pair changes config (back-compat)
  chordTo?: string;
  durationSec?: number; // defaults to 60
  // one-minute-changes: the chords you're comfortable switching between (pairs
  // are derived from these). chord-trainer: the pool of chords to call out.
  chords?: string[];
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  duration?: string; // e.g., "5 mins"
  drill?: DrillConfig; // when set, the task launches an interactive detector
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
