import type { Routine } from '../../types';

/**
 * What the second screen hands the third.
 *
 * Deliberately plain data. The whole beginner curriculum lives behind the chord
 * screen's own chunk, and passing a built routine rather than the inputs to
 * build one is what keeps the summary screen, and the shell around it, free of
 * that dependency.
 */
export interface FirstRunPlan {
  routine: Routine;
  /** Rough minutes of playing, counted from the tasks. */
  minutes: number;
  /** How many of those tasks the microphone actually counts. */
  measured: number;
  /** First lesson of the derived module, or null where the course names none. */
  lessonCode: string | null;
}
