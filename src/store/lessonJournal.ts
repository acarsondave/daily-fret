// Where the learner has stood in their course, and when.
//
// `currentLesson` is a single overwritten string: it can say where you are and
// can never say how you got here, because the day you left module 3 is gone the
// moment you set module 4. Every other record in this app can be rebuilt from
// what happened afterwards. These days cannot, so they are appended rather than
// replaced, and the file is separate from the store so the merge can be tested
// without loading Firebase.

/** One arrival at a lesson, and the day it happened. */
export interface LessonStand {
  /** Curriculum lesson code, e.g. `b1-504`. */
  code: string;
  /** YYYY-MM-DD, the local day the learner arrived here. */
  from: string;
}

const wellFormed = (s: unknown): s is LessonStand =>
  typeof s === 'object' &&
  s !== null &&
  typeof (s as LessonStand).code === 'string' &&
  typeof (s as LessonStand).from === 'string';

/**
 * Two journals into one, by arrival.
 *
 * Unioned rather than picked, like the note map: each device appends its own
 * arrivals, so neither copy is a superset and taking one outright would drop
 * days no later write can reconstruct.
 *
 * Keyed on the day AND the code rather than the code alone, because a learner
 * who returns to a lesson months later stood there twice and folding those into
 * one entry would erase the return, which is precisely the kind of thing this
 * record exists to hold. Sorted by day, so the result reads as a path whichever
 * device wrote which part of it.
 *
 * Cloud data is not trusted to be well formed. A half-written entry is dropped
 * rather than thrown on, so one bad record cannot take a real day with it.
 */
export function mergeLessonJournals(
  a: readonly LessonStand[] | undefined,
  b: readonly LessonStand[] | undefined,
): LessonStand[] | undefined {
  if (!a?.length && !b?.length) return undefined;
  const byArrival = new Map<string, LessonStand>();
  for (const stand of [...(a ?? []), ...(b ?? [])]) {
    if (!wellFormed(stand)) continue;
    byArrival.set(`${stand.from}|${stand.code}`, stand);
  }
  if (!byArrival.size) return undefined;
  return [...byArrival.values()].sort((x, y) => (x.from < y.from ? -1 : x.from > y.from ? 1 : 0));
}

/**
 * The journal with an arrival appended, or unchanged when this is not one.
 *
 * Re-confirming the lesson you are already on is not an arrival, and the
 * Journey panel can set the same code on any visit.
 */
export function withArrival(
  journal: readonly LessonStand[] | undefined,
  previousCode: string | undefined,
  code: string,
  today: string,
): LessonStand[] {
  const existing = journal ?? [];
  if (previousCode === code) return [...existing];
  return [...existing, { code, from: today }];
}
