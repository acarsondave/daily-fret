// The beginner course, as the app is allowed to describe it.
//
// Three tracks in the curriculum share one site title and one continuous module
// numbering: Grade 1 runs modules 0 to 7, Grade 2 picks up at 8, Grade 3 ends at
// 22. Onboarding used to name those tracks by hardcoded code and count their
// modules by hand, which is how it came to offer a practice diary as a startable
// module and promise a ninth module the next screen did not have. Every number
// here is read from the data, so a rebuild of the curriculum moves the copy with
// it.
//
// Structure only. Titles, numbers, ordering and lesson codes are what this file
// touches; lesson prose lives outside src/ and stays there. See docs/CURRICULUM.md.

import { CURRICULUM, trackModules } from '../data/curriculum';

/** Exactly what the site calls the course. The three graded tracks all use it. */
const SITE_TITLE = 'Beginner Guitar Course';

export interface TaughtModule {
  number: number;
  title: string;
  /** The course's own module code, e.g. 'BG04'. */
  reference: string;
  /** Lessons the module holds, including any the site does not name. */
  lessonCount: number;
  /** The first lesson we have a name for, or null when the site names none. */
  firstLessonCode: string | null;
}

export interface BeginnerGrade {
  /** Curriculum track code, e.g. 'bg1'. */
  code: string;
  /** "Grade 1", or the track's full title where the data does not agree on one. */
  title: string;
  /** The taught path. Companion series and unnumbered modules are not entries. */
  modules: TaughtModule[];
}

function taughtModules(code: string): TaughtModule[] {
  // trackModules resolves lessons but drops the module's own lessonCount, and
  // the two are not the same number: the site's chapter roll omits paid lessons,
  // so six beginner modules hold more than they name. Counting the resolved
  // lessons understated those six and closed a gap the data states plainly.
  const sizes = new Map(
    (CURRICULUM.tracks.find((t) => t.code === code)?.modules ?? [])
      .map((m) => [m.reference, m.lessonCount] as const),
  );
  return trackModules(code)
    .filter((m) => !m.companion && m.number !== null)
    .map((m) => ({
      // Narrowed by the filter above; the module type allows null for the
      // companion series, which never reaches here.
      number: m.number as number,
      title: m.title,
      reference: m.reference,
      lessonCount: sizes.get(m.reference) ?? m.lessons.length,
      firstLessonCode: m.lessons[0]?.code ?? null,
    }))
    .sort((a, b) => a.number - b.number);
}

/**
 * The name to put on a grade's card.
 *
 * Every taught module carries the grade it belongs to, so "Grade 2" is a fact
 * about the data rather than a string carved off the track title. Where the
 * modules disagree, the track's own full title is printed instead: a course that
 * spans grades has no single grade number and inventing one would be a claim.
 */
function gradeTitle(code: string, fullTitle: string): string {
  const grades = new Set(
    trackModules(code)
      .filter((m) => !m.companion && m.number !== null)
      .map((m) => m.grade),
  );
  if (grades.size !== 1) return fullTitle;
  const [grade] = [...grades];
  return grade === null ? fullTitle : `Grade ${grade}`;
}

/**
 * The beginner course's grades, in taught order.
 *
 * Ordered by the lowest module each one starts at rather than by the track's
 * `order` field, which is the same number for Grade 1 and Grade 2.
 */
export const BEGINNER_GRADES: readonly BeginnerGrade[] = CURRICULUM.tracks
  .filter((t) => !t.legacy && t.siteTitle === SITE_TITLE)
  .map((t) => ({
    code: t.code,
    title: gradeTitle(t.code, t.title),
    modules: taughtModules(t.code),
  }))
  .filter((g) => g.modules.length > 0)
  .sort((a, b) => a.modules[0].number - b.modules[0].number);

export const isBeginnerTrack = (code: string): boolean =>
  BEGINNER_GRADES.some((g) => g.code === code);

export const beginnerGrade = (code: string): BeginnerGrade | null =>
  BEGINNER_GRADES.find((g) => g.code === code) ?? null;

/** Every taught module of the whole beginner course, in module order. */
export const BEGINNER_MODULES: readonly TaughtModule[] = BEGINNER_GRADES.flatMap(
  (g) => g.modules,
).sort((a, b) => a.number - b.number);

/** Which grade a module number belongs to, for naming a routine after it. */
export function gradeOfModule(module: number): BeginnerGrade | null {
  return BEGINNER_GRADES.find((g) => g.modules.some((m) => m.number === module)) ?? null;
}

export const findModule = (track: string, module: number): TaughtModule | null =>
  beginnerGrade(track)?.modules.find((m) => m.number === module) ?? null;
