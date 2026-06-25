export type DrillKind = 'free-play' | 'one-minute-changes' | 'chord-trainer';

export interface DrillConfig {
  kind: DrillKind;
  chordFrom?: string; // one-minute-changes
  chordTo?: string; // one-minute-changes
  durationSec?: number; // one-minute-changes / chord-trainer, defaults to 60
  chords?: string[]; // chord-trainer: the pool of chords to call out
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
