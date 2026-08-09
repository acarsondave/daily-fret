// Turn the raw capture into the curriculum database.
//
//   node scripts/build-lesson-db.mjs
//
// Input:  curriculum/lessons/lessons.json   (from scripts/capture-lessons.js)
// Output: curriculum/justinguitar.db.json   (the complete source, with text)
//         curriculum/justinguitar.index.json (structure only, no bodies)
//
// WHY TWO FILES
//
// The database is the thing we reason from: grade, module, taught order, and
// every word of every lesson. It is ~9MB and lives outside src/ so the app
// physically cannot import it into a bundle. The index is the same tree with
// the bodies removed, small enough to read at a glance or diff in a review.
//
// WHAT IT REFUSES TO DO
//
// It does not invent structure. A module's roll comes from the site's own
// lessonsWithinModule, in the site's own order, so a lesson we could not read
// still appears in its place, marked with why it is absent. A gap that is
// stated is data; a gap that is silently closed up is a lie about the course.

import { readFileSync, writeFileSync } from 'node:fs';

const IN = 'curriculum/lessons/lessons.json';
const DB = 'curriculum/justinguitar.db.json';
const INDEX = 'curriculum/justinguitar.index.json';

const raw = JSON.parse(readFileSync(IN, 'utf8'));
const lessons = raw.lessons ?? {};
const paywalled = raw.paywalled ?? {};

const problems = [];
const note = (msg) => problems.push(msg);

// "Module 4" -> 4. Some modules are named rather than numbered (the
// left-handed practice series), and a null number is the honest answer there.
const moduleNumber = (label) => {
  const m = /(\d+)/.exec(label ?? '');
  return m ? Number(m[1]) : null;
};

// --- group by course, then module ------------------------------------------
const courses = new Map();

for (const lesson of Object.values(lessons)) {
  const courseRef = lesson.course?.reference;
  const moduleRef = lesson.module?.reference;
  if (!courseRef || !moduleRef) {
    note(`${lesson.reference ?? lesson.slug}: no course or module, excluded`);
    continue;
  }

  if (!courses.has(courseRef)) {
    courses.set(courseRef, {
      reference: courseRef,
      title: lesson.course.title,
      slug: lesson.course.slug,
      // A course spans grades. The classic beginner course carries lessons at
      // grades 1, 2 and 3 at once, so pinning one grade to a course would have
      // meant discarding two thirds of the answer. Grade lives on the lesson,
      // and a module inherits it because its lessons agree: 140 of 142 modules
      // hold exactly one grade, and the two that do not are recorded as such.
      grades: new Set(),
      modules: new Map(),
    });
  }
  const course = courses.get(courseRef);
  if (lesson.grade?.position != null) course.grades.add(lesson.grade.position);

  if (!course.modules.has(moduleRef)) {
    course.modules.set(moduleRef, {
      reference: moduleRef,
      label: lesson.module.label,
      number: moduleNumber(lesson.module.label),
      title: lesson.module.title,
      slug: lesson.module.slug,
      intro: lesson.module.intro || null,
      // The site's own roll for this module, in taught order. Kept whole.
      roll: lesson.moduleLessons ?? [],
      // The site's ids for every lesson in the module, paid ones included. The
      // roll above omits paid lessons entirely, so this is the only place the
      // true size of a module is stated.
      trueSize: lesson.module.lessonOrder?.length ?? null,
      grades: new Set(),
      bySlug: new Map(),
    });
  }
  const mod = course.modules.get(moduleRef);
  mod.bySlug.set(lesson.slug, lesson);
  if (lesson.grade?.position != null) mod.grades.add(lesson.grade.position);
  if (lesson.grade?.belt) mod.belt = lesson.grade.belt;
}

// --- assemble, keeping the gaps visible ------------------------------------
const why = (slug) => {
  if (paywalled[slug]) return { status: 'paid', soldAt: paywalled[slug] };
  return { status: 'unread' };
};

const lowest = (set) => (set.size ? Math.min(...set) : 99);

const built = [...courses.values()]
  .sort((a, b) => lowest(a.grades) - lowest(b.grades) || a.reference.localeCompare(b.reference))
  .map((course) => ({
    reference: course.reference,
    title: course.title,
    slug: course.slug,
    grades: [...course.grades].sort((a, b) => a - b),
    modules: [...course.modules.values()]
      .sort((a, b) => lowest(a.grades) - lowest(b.grades)
        || (a.number ?? 99) - (b.number ?? 99)
        || a.reference.localeCompare(b.reference))
      .map((mod) => {
        // Walk the site's roll, not our own keys: that is what preserves the
        // taught order and makes an absence visible in the position it belongs.
        const lessons = mod.roll.map((entry, i) => {
          const got = mod.bySlug.get(entry.slug);
          if (!got) {
            return {
              position: i + 1,
              slug: entry.slug,
              title: entry.title,
              duration: entry.duration ?? null,
              ...why(entry.slug),
            };
          }
          return {
            position: i + 1,
            status: 'ok',
            reference: got.reference,
            slug: got.slug,
            title: got.title,
            duration: got.duration ?? null,
            video: got.video ?? null,
            releasedAt: got.releasedAt ?? null,
            summary: got.summary ?? null,
            videoChapters: got.videoChapters || null,
            text: got.text ?? '',
          };
        });

        // Anything captured that the roll never mentioned. Should be nothing;
        // if it is not, the roll and the lesson disagree and we want to see it.
        const rolled = new Set(mod.roll.map((e) => e.slug));
        for (const slug of mod.bySlug.keys()) {
          if (!rolled.has(slug)) note(`${mod.reference}: ${slug} captured but absent from the module roll`);
        }

        const listed = lessons.length;
        const notListed = mod.trueSize != null ? Math.max(0, mod.trueSize - listed) : 0;
        if (notListed) {
          // We know how many are missing but not which: the site never names
          // them. Stating the count is the most that is true.
          note(`${mod.reference} "${mod.title}": ${notListed} of ${mod.trueSize} lessons are paid and not listed`);
        }
        if (mod.grades.size > 1) {
          note(`${mod.reference} "${mod.title}": spans grades ${[...mod.grades].sort().join(', ')}`);
        }

        return {
          reference: mod.reference,
          label: mod.label,
          number: mod.number,
          title: mod.title,
          slug: mod.slug,
          grade: mod.grades.size === 1 ? [...mod.grades][0] : null,
          gradesPresent: [...mod.grades].sort((a, b) => a - b),
          belt: mod.belt ?? null,
          intro: mod.intro,
          lessonCount: mod.trueSize ?? listed,
          listed,
          readable: lessons.filter((l) => l.status === 'ok').length,
          paidNotListed: notListed,
          lessons,
        };
      }),
  }));

const allLessons = built.flatMap((c) => c.modules.flatMap((m) => m.lessons));
const db = {
  source: 'justinguitar.com',
  capturedAt: raw.capturedAt,
  builtFrom: IN,
  counts: {
    courses: built.length,
    modules: built.reduce((n, c) => n + c.modules.length, 0),
    lessons: allLessons.length,
    readable: allLessons.filter((l) => l.status === 'ok').length,
    paidNotListed: built.reduce((n, c) => n + c.modules.reduce((m, x) => m + x.paidNotListed, 0), 0),
  },
  // Grade is the axis the app reasons along, so it is stated at the top rather
  // than left to be reassembled by walking every module.
  byGrade: [...new Set(built.flatMap((c) => c.modules.map((m) => m.grade)))]
    .filter((g) => g != null).sort((a, b) => a - b)
    .map((g) => {
      const mods = built.flatMap((c) => c.modules.filter((m) => m.grade === g).map((m) => ({ course: c.reference, ...m })));
      return {
        grade: g,
        belt: mods[0]?.belt ?? null,
        modules: mods.length,
        lessons: mods.reduce((n, m) => n + m.readable, 0),
        courses: [...new Set(mods.map((m) => m.course))],
      };
    }),
  courses: built,
};

// The index is the same tree with the writing removed.
const index = {
  ...db,
  courses: built.map((c) => ({
    ...c,
    modules: c.modules.map((m) => ({
      ...m,
      intro: m.intro ? `${m.intro.slice(0, 120)}…` : null,
      lessons: m.lessons.map(({ text, videoChapters, summary, ...rest }) => ({
        ...rest,
        textChars: text ? text.length : 0,
      })),
    })),
  })),
};

writeFileSync(DB, JSON.stringify(db, null, 2));
writeFileSync(INDEX, JSON.stringify(index, null, 2));

console.log(`\n${DB}`);
console.log(`${INDEX}\n`);
for (const g of db.byGrade) {
  console.log(`  grade ${String(g.grade).padEnd(2)} ${String(g.belt ?? '').padEnd(9)} ${String(g.modules).padStart(3)} modules ${String(g.lessons).padStart(5)} lessons   ${g.courses.join(', ')}`);
}
console.log('');
for (const c of built) {
  const n = c.modules.reduce((a, m) => a + m.lessonCount, 0);
  const ok = c.modules.reduce((a, m) => a + m.readable, 0);
  console.log(`  ${c.reference.padEnd(6)} grades ${c.grades.join('/').padEnd(6)} ${String(c.modules.length).padStart(3)} modules ${String(ok).padStart(4)}/${String(n).padEnd(4)} readable  ${c.title}`);
}
console.log(`\n  ${db.counts.readable} lessons readable across ${db.counts.modules} modules, ` +
  `plus ${db.counts.paidNotListed} paid lessons the site does not list.`);

if (problems.length) {
  console.log(`\n${problems.length} things worth a look:`);
  problems.slice(0, 20).forEach((p) => console.log(`  ${p}`));
  if (problems.length > 20) console.log(`  ... and ${problems.length - 20} more`);
}
console.log('');
