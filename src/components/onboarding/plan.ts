import type { Routine } from '../../types';

/**
 * What the second screen hands the third.
 *
 * Deliberately plain data, and deliberately already reduced to what gets drawn.
 * The whole beginner curriculum and the song catalogue both live behind the
 * chord screen's chunk, and passing the finished shape of the summary rather
 * than the inputs to compute one is what keeps the last screen, and the shell
 * around it, free of either.
 *
 * This file holds types only. Anything here that needed a function would put a
 * course-sized import in front of the microphone.
 */

/** A chart, as the last screen draws it: a name and the shapes it asks for. */
export interface PlanSong {
  title: string;
  artist: string;
  chords: string[];
}

/** One block of the session, reduced to what the summary shows. */
export interface PlanTask {
  id: string;
  title: string;
  /**
   * Whole minutes, which is also how many strokes it is drawn with. Zero for a
   * play-along: it ends when the record does.
   */
  minutes: number;
  /** The microphone counts this block. A play-along never does. */
  counted: boolean;
  /** Shapes this block plays. Empty where the drill has none of its own. */
  chords: string[];
  /** Set on the play-along block and nowhere else. */
  song: PlanSong | null;
}

export interface FirstRunPlan {
  routine: Routine;
  /** Minutes of blocks that have a length. A song is not one of them. */
  minutes: number;
  /** How many of those blocks the microphone actually counts. */
  measured: number;
  /** First lesson of the derived module, or null where the course names none. */
  lessonCode: string | null;
  tasks: PlanTask[];
  /**
   * The nearest chart one shape short of playable, and the shape.
   *
   * The reason to come back tomorrow, and the app already knows it exactly. Null
   * when the catalogue holds nothing that close.
   */
  horizon: { song: PlanSong; missing: string } | null;
}
