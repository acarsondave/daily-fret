// Everything first run needs from the beginner curriculum, in one place.
//
// One import boundary rather than four, so it is obvious from the import graph
// exactly which module pulls the 68.5 kB gzipped course data, and so that the
// first screen and the summary screen provably do not.

export { BEGINNER_MODULES } from '../../lib/beginnerCourse';
export {
  HEARABLE_CHORDS,
  buildRoutine,
  moduleForChords,
  routineMinutes,
  taskMinutes,
} from '../../lib/routineBuilder';
