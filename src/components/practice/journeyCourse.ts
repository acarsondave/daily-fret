// The beginner course as a map, and the one distinction a map of it has to make.
//
// Every module holds two kinds of thing. Some of it is practice: a shape, a
// change, a pattern, something you come back to for weeks and the app can put a
// number on. The rest is taught once: how to hold the guitar, what a capo does,
// how to read a chord box. You watch it, you have it, it never appears again.
//
// Rendered in the same visual language the second kind reads as a to-do list
// full of items nobody would ever do. lib/routineBuilder reached the same
// conclusion when it stopped putting "How To Hold Your Guitar" on a daily list;
// this is the map's own statement of it, so the Journey can show a module's real
// shape instead of a flat roll of lesson titles.
//
// Structure only, read from src/data/curriculum.ts. Every count here is the
// course's own.

import {
  CURRICULUM,
  getLesson,
  type CurriculumLesson,
  type CurriculumTrack,
} from '../../data/curriculum';
import type { Skill, SkillFamily } from '../../data/skills';
import type { SkillStanding } from '../../lib/progression';
import { skillsInModule } from '../../lib/routineBuilder';

/** Exactly what the site calls the course. The three graded tracks all use it. */
const SITE_TITLE = 'Beginner Guitar Course';

export interface JourneyModule {
  /** Curriculum track code the module belongs to, e.g. 'bg1'. */
  track: string;
  number: number;
  /** The course's own module code, e.g. 'BG04'. */
  reference: string;
  title: string;
  grade: number | null;
  /** The module's true size, including lessons the site refuses to name. */
  lessonCount: number;
  /** How many of those are paid, and so absent from `lessons` below. */
  paidNotListed: number;
  /** The lessons we can name, in taught order. */
  lessons: CurriculumLesson[];
}

export interface JourneyGrade {
  track: string;
  /** "Grade 1" where every module agrees on one, otherwise the track's title. */
  title: string;
  modules: JourneyModule[];
  lessonCount: number;
  paidNotListed: number;
}

function taughtModules(track: CurriculumTrack): JourneyModule[] {
  return track.modules
    .flatMap((m) =>
      // A companion series runs alongside the taught path rather than being part
      // of it: Justin's own left-handed practice diary sits under Grade 1 and is
      // not a module anybody works through. Unnumbered modules go with it.
      m.companion || m.number === null
        ? []
        : [
            {
              track: track.code,
              number: m.number,
              reference: m.reference,
              title: m.title,
              grade: m.grade,
              lessonCount: m.lessonCount,
              paidNotListed: m.paidNotListed,
              lessons: m.lessons
                .map(getLesson)
                .filter((l): l is CurriculumLesson => l !== null),
            },
          ],
    )
    .sort((a, b) => a.number - b.number);
}

/**
 * The name to put on a grade.
 *
 * Every taught module carries the grade it belongs to, so "Grade 2" is a fact
 * about the data rather than a string cut off the track title. Where the modules
 * disagree the full title is printed instead: a track that spans grades has no
 * single grade number and inventing one would be a claim.
 */
function gradeTitle(modules: readonly JourneyModule[], fullTitle: string): string {
  const grades = new Set(modules.map((m) => m.grade));
  if (grades.size !== 1) return fullTitle;
  const [grade] = [...grades];
  return grade === null ? fullTitle : `Grade ${grade}`;
}

/**
 * The beginner course, in taught order.
 *
 * Ordered by the lowest module each grade starts at rather than by the track's
 * `order` field, which is the same number for Grade 1 and Grade 2.
 */
export const BEGINNER_PATH: readonly JourneyGrade[] = CURRICULUM.tracks
  .filter((t) => !t.legacy && t.siteTitle === SITE_TITLE)
  .map((t) => {
    const modules = taughtModules(t);
    return {
      track: t.code,
      title: gradeTitle(modules, t.title),
      modules,
      lessonCount: modules.reduce((n, m) => n + m.lessonCount, 0),
      paidNotListed: modules.reduce((n, m) => n + m.paidNotListed, 0),
    };
  })
  .filter((g) => g.modules.length > 0)
  .sort((a, b) => a.modules[0].number - b.modules[0].number);

/** Every taught module of the beginner course, in module order. */
export const BEGINNER_MODULE_PATH: readonly JourneyModule[] = BEGINNER_PATH.flatMap(
  (g) => g.modules,
);

export const BEGINNER_TOTALS = {
  modules: BEGINNER_MODULE_PATH.length,
  lessons: BEGINNER_MODULE_PATH.reduce((n, m) => n + m.lessonCount, 0),
  paidNotListed: BEGINNER_MODULE_PATH.reduce((n, m) => n + m.paidNotListed, 0),
  largestModule: BEGINNER_MODULE_PATH.reduce((n, m) => Math.max(n, m.lessonCount), 0),
};

/** The module a lesson sits in, or null when it is outside the taught path. */
export function moduleOfLesson(code: string): JourneyModule | null {
  return (
    BEGINNER_MODULE_PATH.find((m) => m.lessons.some((l) => l.code === code)) ?? null
  );
}

/** How far into the course a module is, and how much of it is still ahead. */
export function positionOf(module: JourneyModule): { behind: number; ahead: number } {
  const at = BEGINNER_MODULE_PATH.indexOf(module);
  if (at === -1) return { behind: 0, ahead: BEGINNER_MODULE_PATH.length };
  return { behind: at, ahead: BEGINNER_MODULE_PATH.length - at - 1 };
}

export const gradeOf = (module: JourneyModule): JourneyGrade | null =>
  BEGINNER_PATH.find((g) => g.modules.includes(module)) ?? null;

/**
 * Whether a skill is something the learner comes back to.
 *
 * Two reads off the taxonomy, never off a list of titles:
 *
 * - `measure.kind === 'known'` is the taxonomy's own word for knowledge rather
 *   than motor skill: reading chord boxes, what makes a chord minor, what a capo
 *   does. Each is learned once and there is nothing to repeat tomorrow.
 * - the `setup`, `theory` and `ear` families are about the instrument, or about
 *   knowing things, rather than about playing. Tuning is the sharp case: it is
 *   measured, it has a real drill behind it, and it is still not practice. It
 *   happens before practice and it has a surface of its own.
 *
 * Tapping your foot is the case that shows why the other half of the split is
 * labelled "taught here, not drilled" rather than "taught once". It is a motor
 * skill, it is worth repeating, and a foot is not in the microphone, so this app
 * has nothing to offer it beyond naming it. Saying so is the honest version.
 */
const PLAYING_FAMILIES = new Set<SkillFamily>([
  'chords',
  'changes',
  'rhythm',
  'technique',
  'riffs',
  'songs',
]);

export const isPractice = (skill: Skill): boolean =>
  skill.measure.kind !== 'known' && PLAYING_FAMILIES.has(skill.family);

export interface ModuleContent {
  /** What recurs: drilled, on a clock, or waiting on analysis the app lacks. */
  practice: SkillStanding[];
  /** Taught here and not drilled: a fact, a grip, a posture, a foot keeping time. */
  taughtOnce: SkillStanding[];
  /** Practice the app can put a number on today. */
  measured: number;
  /** How many of those are held: at their bar three runs running, still fresh. */
  atBar: number;
  /** Whether any skill at all maps to this module. */
  mapped: boolean;
}

const EMPTY_CONTENT: ModuleContent = {
  practice: [],
  taughtOnce: [],
  measured: 0,
  atBar: 0,
  mapped: false,
};

/**
 * What a module asks of the learner, split by kind.
 *
 * Skills are ordered by where the module first teaches them, so the list reads
 * in the order the course actually goes, not in the order the taxonomy happens
 * to be written.
 */
export function moduleContent(
  module: JourneyModule,
  standings: readonly SkillStanding[],
): ModuleContent {
  const skills = skillsInModule(module.track, module.number);
  if (!skills.length) return EMPTY_CONTENT;

  const taughtAt = new Map(module.lessons.map((l, i) => [l.code, i]));
  const byId = new Map(standings.map((s) => [s.skill.id, s]));
  const rank = (skill: Skill): number => {
    let first = Number.MAX_SAFE_INTEGER;
    for (const code of skill.lessons) {
      const at = taughtAt.get(code);
      if (at !== undefined && at < first) first = at;
    }
    return first;
  };

  const resolved = skills
    .flatMap((skill) => {
      const standing = byId.get(skill.id);
      return standing ? [standing] : [];
    })
    .sort((a, b) => rank(a.skill) - rank(b.skill));

  const practice = resolved.filter((s) => isPractice(s.skill));
  return {
    practice,
    taughtOnce: resolved.filter((s) => !isPractice(s.skill)),
    // A bar is what makes a number possible. Timed skills and the ones waiting
    // on analysis the app does not have are practice, and they are not measured.
    measured: practice.filter((s) => s.bar !== null).length,
    atBar: practice.filter((s) => s.bar !== null && s.state === 'solid').length,
    mapped: resolved.length > 0,
  };
}
