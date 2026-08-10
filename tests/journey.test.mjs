// What the Journey panel says about the course, checked against the course.
//
// The curriculum under this panel was replaced wholesale — a captured database
// took over from a sitemap-derived one — and the panel was only patched. Every
// claim it makes is a number, a title or a count read from that data, so every
// claim is checkable, and this is where it gets checked. The two defects that
// prompted the rebuild are the first two suites: a module list that silently
// began at 1 because module 0 was never in it, and a grade lookup that filed
// every BG-15xx lesson under Grade 1.

import { CURRICULUM, getLessonByCode } from '../src/data/curriculum.ts';
import { ALL_SKILLS } from '../src/data/skills.ts';
import { allStandings } from '../src/lib/progression.ts';
import { readiness, CHANGES_BAR, CHORD_BAR } from '../src/lib/readiness.ts';
import { pairKey } from '../src/lib/pairs.ts';
import {
  countLine,
  evidenceLine,
  kindNote,
  paidGap,
  shapeOf,
  stateLabel,
} from '../src/components/practice/journeyCopy.ts';
import {
  BEGINNER_PATH,
  BEGINNER_MODULE_PATH,
  BEGINNER_TOTALS,
  gradeOf,
  isPractice,
  moduleContent,
  moduleOfLesson,
  positionOf,
} from '../src/components/practice/journeyCourse.ts';

let failures = 0;
const check = (l, ok, d) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${!ok && d ? ` — ${d}` : ''}`);
};

const standings = allStandings({});
const moduleByNumber = (n) => BEGINNER_MODULE_PATH.find((m) => m.number === n);

console.log('\nThe course the panel draws\n');
{
  check('three grades', BEGINNER_PATH.length === 3, `${BEGINNER_PATH.length}`);
  check(
    'named Grade 1, Grade 2, Grade 3',
    BEGINNER_PATH.map((g) => g.title).join(', ') === 'Grade 1, Grade 2, Grade 3',
    BEGINNER_PATH.map((g) => g.title).join(', '),
  );

  const numbers = BEGINNER_MODULE_PATH.map((m) => m.number);
  // The old panel derived a module number from the first digit of a lesson code,
  // which made module 0 unreachable and the list appear to start at 1.
  check('the list starts at module 0', numbers[0] === 0, `starts at ${numbers[0]}`);
  check('it ends at module 22', numbers[numbers.length - 1] === 22, `ends at ${numbers.at(-1)}`);
  check(
    'the numbering is continuous with no gaps',
    numbers.every((n, i) => n === i),
    numbers.join(','),
  );
  check('23 modules in the totals', BEGINNER_TOTALS.modules === 23, `${BEGINNER_TOTALS.modules}`);

  const named = BEGINNER_PATH.flatMap((g) => g.modules).every((m) => m.title.length > 0);
  check('every module carries the course\'s own title', named);

  // Justin's own practice diaries sit under Grade 1 and Grade 2 as companion
  // series. They are not modules anyone works through and must not be offered
  // as if they were.
  const companions = CURRICULUM.tracks
    .filter((t) => ['bg1', 'bg2', 'bg3'].includes(t.code))
    .flatMap((t) => t.modules)
    .filter((m) => m.companion);
  check('the data does hold companion series', companions.length > 0, `${companions.length}`);
  check(
    'no companion series is drawn as a module',
    companions.every((c) => !BEGINNER_MODULE_PATH.some((m) => m.reference === c.reference)),
    companions.map((c) => c.reference).join(','),
  );
}

console.log('\nEvery count the panel prints\n');
{
  const raw = CURRICULUM.tracks
    .filter((t) => ['bg1', 'bg2', 'bg3'].includes(t.code))
    .flatMap((t) => t.modules)
    .filter((m) => !m.companion && m.number !== null);

  const lessons = raw.reduce((n, m) => n + m.lessonCount, 0);
  const paid = raw.reduce((n, m) => n + m.paidNotListed, 0);
  check('the lesson total is the course\'s own', BEGINNER_TOTALS.lessons === lessons,
    `${BEGINNER_TOTALS.lessons} vs ${lessons}`);
  check('the paid total is the course\'s own', BEGINNER_TOTALS.paidNotListed === paid,
    `${BEGINNER_TOTALS.paidNotListed} vs ${paid}`);
  check('some paid lessons exist to be declared', paid > 0, `${paid}`);

  // The rule the whole dataset is built on: a gap is stated, never closed up.
  // The row prints lessonCount and lists only what the site names, so the
  // difference has to be exactly what the row admits to.
  check(
    'a module\'s named lessons plus its paid ones are its true size',
    BEGINNER_MODULE_PATH.every((m) => m.lessons.length + m.paidNotListed === m.lessonCount),
    BEGINNER_MODULE_PATH.filter((m) => m.lessons.length + m.paidNotListed !== m.lessonCount)
      .map((m) => `${m.number}: ${m.lessons.length}+${m.paidNotListed}!=${m.lessonCount}`)
      .join(' '),
  );

  const grades = BEGINNER_PATH.every(
    (g) => g.lessonCount === g.modules.reduce((n, m) => n + m.lessonCount, 0),
  );
  check('each grade\'s lesson count is the sum of its modules', grades);

  check('the largest module is a real module size',
    BEGINNER_MODULE_PATH.some((m) => m.lessonCount === BEGINNER_TOTALS.largestModule),
    `${BEGINNER_TOTALS.largestModule}`);
}

console.log('\nWhere the learner is standing\n');
{
  // The defect this replaced: `currentLesson.split('-')[0]` returned 'bg' for a
  // BG-15xx code, so a Grade 3 learner was shown Grade 1.
  const later = getLessonByCode('bg-1501');
  check('a BG-15xx lesson is in the data', later !== null);
  const laterModule = later ? moduleOfLesson(later.code) : null;
  check('it resolves to module 15', laterModule?.number === 15, `${laterModule?.number}`);
  check('and to Grade 3', laterModule ? gradeOf(laterModule)?.title === 'Grade 3' : false,
    laterModule ? gradeOf(laterModule)?.title : 'no module');

  const four = moduleByNumber(4);
  check('module 4 is the one the course names',
    four.title === 'Metronome, Stretches & THE Pattern', four.title);
  const at = positionOf(four);
  check('module 4 has 4 behind and 18 ahead', at.behind === 4 && at.ahead === 18,
    `${at.behind}/${at.ahead}`);
  check('behind plus ahead plus itself is the whole course',
    at.behind + at.ahead + 1 === BEGINNER_TOTALS.modules);

  check('a lesson outside the taught path resolves to no module',
    moduleOfLesson('nj-101') === null);
  check('an unknown code resolves to no module', moduleOfLesson('not-a-code') === null);
}

console.log('\nThe two kinds of thing in a module\n');
{
  // The owner's complaint, as an assertion. "Holding the guitar" is a real part
  // of the course; it is not practice, and it must never be shown as if it were.
  const zero = moduleByNumber(0);
  check('module 0 is "Before You Begin: Guitar Basics"',
    zero.title === 'Before You Begin: Guitar Basics', zero.title);

  const content = moduleContent(zero, standings);
  const once = content.taughtOnce.map((s) => s.skill.id).sort();
  check('holding the guitar is taught once, not practised', once.includes('setup.holding'), once.join(' '));
  check('tuning is taught once, not practised', once.includes('setup.tuning'), once.join(' '));
  check('reading a chord box is taught once', once.includes('theory.chord-boxes'), once.join(' '));
  check('holding a pick is taught once', once.includes('setup.pick'), once.join(' '));
  check('nothing in module 0 is presented as practice with a number',
    content.measured === 0, `${content.measured} measured`);
  check('module 0 still maps to something rather than reading as unmapped',
    content.mapped);

  const one = moduleContent(moduleByNumber(1), standings);
  const oneIds = one.practice.map((s) => s.skill.id);
  check('module 1 is where the chords start',
    oneIds.includes('chord.D') && oneIds.includes('chord.A'), oneIds.join(' '));
  check('module 1 does not inherit module 0\'s setup lessons',
    !one.taughtOnce.some((s) => s.skill.id === 'setup.tuning'),
    one.taughtOnce.map((s) => s.skill.id).join(' '));
  check('the chords are counted as measured', one.measured >= 2, `${one.measured}`);
  check('nothing is at its bar for a learner with no logs', one.atBar === 0, `${one.atBar}`);

  const KNOWLEDGE = new Set(['setup', 'theory', 'ear']);
  check('no skill the taxonomy calls knowledge is presented as practice',
    ALL_SKILLS.every((s) => (s.measure.kind === 'known' ? !isPractice(s) : true)),
    ALL_SKILLS.filter((s) => s.measure.kind === 'known' && isPractice(s)).map((s) => s.id).join(' '));
  check('no setup, theory or ear skill is presented as practice',
    ALL_SKILLS.every((s) => (KNOWLEDGE.has(s.family) ? !isPractice(s) : true)),
    ALL_SKILLS.filter((s) => KNOWLEDGE.has(s.family) && isPractice(s)).map((s) => s.id).join(' '));
  check('every open chord is practice',
    ALL_SKILLS.filter((s) => s.family === 'chords').every(isPractice));
  check('the drills, the timed work and the gaps are all practice',
    ['changes.one-minute', 'rhythm.patterns', 'technique.stretches', 'songs.play-along',
     'technique.finger-placement']
      .every((id) => isPractice(ALL_SKILLS.find((s) => s.id === id))));
  // Tapping your foot is a motor skill the taxonomy files as `known` because a
  // foot is not in the microphone. It belongs on the "taught here, not drilled"
  // side, which is why that side is not labelled "taught once".
  check('a skill with nothing to hear is not offered as practice',
    !isPractice(ALL_SKILLS.find((s) => s.id === 'rhythm.foot')));
}

console.log('\nWhat a module row is allowed to claim\n');
{
  for (const module of BEGINNER_MODULE_PATH) {
    const c = moduleContent(module, standings);
    if (c.measured > c.practice.length || c.atBar > c.measured) {
      check(`module ${module.number} counts are consistent`, false,
        `${c.atBar}/${c.measured} of ${c.practice.length}`);
    }
    if (!c.mapped && (c.practice.length || c.taughtOnce.length)) {
      check(`module ${module.number} reports mapped correctly`, false, 'unmapped but not empty');
    }
    // Only a skill with a bar can ever produce a number, so only those may be
    // counted as measured. Timed skills and the ones waiting on analysis the app
    // does not have are practice, and they are not scores.
    const barless = c.practice.filter((s) => s.bar === null).length;
    if (c.measured !== c.practice.length - barless) {
      check(`module ${module.number} only counts scorable skills`, false, `${c.measured}`);
    }
  }
  check('every module\'s counts are internally consistent', true);

  // Fifteen of the twenty-three modules have no skill mapped to them at all.
  // The row must say that rather than drawing an empty progress bar, which
  // would read as no progress instead of as no measurement.
  const unmapped = BEGINNER_MODULE_PATH.filter((m) => !moduleContent(m, standings).mapped);
  check('the unmapped modules are the later grades, and there are some',
    unmapped.length > 0 && unmapped.every((m) => m.number >= 8),
    unmapped.map((m) => m.number).join(','));
}

console.log('\nWhat the panel is allowed to say\n');
{
  const zero = moduleByNumber(0);
  const four = moduleByNumber(4);
  check('module 0 reads as taught rather than drilled',
    shapeOf(zero, moduleContent(zero, standings)) ===
      'This module: 1 to practise and 4 taught but not drilled, across 6 lessons.',
    shapeOf(zero, moduleContent(zero, standings)));
  check('module 4 reads as practice',
    shapeOf(four, moduleContent(four, standings)) ===
      'This module: 6 to practise and 1 taught but not drilled, across 8 lessons.',
    shapeOf(four, moduleContent(four, standings)));
  check('an unmapped module says so rather than claiming nothing to do',
    shapeOf(moduleByNumber(16), moduleContent(moduleByNumber(16), standings))
      .includes('none of them mapped to a drill here yet'),
    shapeOf(moduleByNumber(16), moduleContent(moduleByNumber(16), standings)));

  check('a row states the module\'s true size, not the length of its list',
    countLine(moduleByNumber(8), moduleContent(moduleByNumber(8), standings)).startsWith('11 lessons'),
    countLine(moduleByNumber(8), moduleContent(moduleByNumber(8), standings)));
  check('the paid gap is stated for a module that has one',
    paidGap(moduleByNumber(8)) === '1 more lesson in this module is paid, and the course does not name it.',
    String(paidGap(moduleByNumber(8))));
  check('and for a module with more than one',
    paidGap(moduleByNumber(19)) === '2 more lessons in this module are paid, and the course does not name them.',
    String(paidGap(moduleByNumber(19))));
  check('a module with nothing missing says nothing', paidGap(zero) === null);
  check('every module either states its gap or has none',
    BEGINNER_MODULE_PATH.every((m) => (m.paidNotListed > 0) === (paidGap(m) !== null)));

  const find = (id) => standings.find((s) => s.skill.id === id);
  check('a skill with no analysis says so, and does not say "Ready" forever',
    stateLabel(find('rhythm.metronome')) === 'Not measured yet',
    stateLabel(find('rhythm.metronome')));
  check('a timed skill says the clock is the measure',
    stateLabel(find('technique.stretches')) === 'On the clock',
    stateLabel(find('technique.stretches')));
  check('an untouched drill is ready', stateLabel(find('chord.D')) === 'Ready',
    stateLabel(find('chord.D')));

  // Manual ticking is gone. progression.ts still writes "Mark it when it feels
  // settled" for the kinds it cannot hear, and printing that under a row with no
  // control on it would be an instruction to nothing.
  const lines = standings.map(evidenceLine).filter((l) => l !== null);
  check('no line tells the learner to mark anything',
    lines.every((l) => !/mark it/i.test(l)),
    lines.filter((l) => /mark it/i.test(l)).join(' | '));
  check('the two chips that carry their own story print no second sentence',
    evidenceLine(find('rhythm.metronome')) === null &&
      evidenceLine(find('technique.stretches')) === null);
  check('a measured skill keeps its real evidence',
    (evidenceLine(find('chord.D')) ?? '').includes('No change drill has used D yet'),
    String(evidenceLine(find('chord.D'))));
  check('the chips are explained once per module, not once per row',
    kindNote(moduleContent(four, standings)) ===
      'On the clock: minutes are the measure, so there is no score. ' +
      'Not measured yet: real practice the app has no analysis for.',
    String(kindNote(moduleContent(four, standings))));
}

console.log('\nAgreeing with the Numbers tab\n');
{
  // Two vocabularies for "good enough" exist in this app and they mean different
  // things. readiness.ts owns Held: three runs running at the bar, still fresh.
  // progression.ts owns `solid`, which is only that a best-ever result cleared
  // the bar once. One run over the bar therefore reads as Cleared here and as
  // "1 of 3" on Numbers, and the two must not both be spelled "Solid".
  const today = '2026-08-10';
  const oneGoodRun = [{ date: '2026-08-09', value: CHANGES_BAR + 4 }];
  const stand = readiness(oneGoodRun, CHANGES_BAR, today);
  check('one run over the bar is not Held on Numbers', stand.state === 'hit', stand.state);
  check('and Numbers spells that as a count of three', stand.label === '1 of 3', String(stand.label));

  const solid = allStandings({
    '2026-08-09': {
      date: '2026-08-09',
      routineId: 'r1',
      completedTaskIds: [],
      drillResults: { [pairKey('A', 'D')]: CHORD_BAR + 8 },
    },
  });
  const chordA = solid.find((s) => s.skill.id === 'chord.A');
  check('the same single run makes a chord solid in the progression model',
    chordA.state === 'solid', chordA.state);
  check('the Journey calls that Cleared, never Held',
    stateLabel(chordA) === 'Cleared', stateLabel(chordA));

  const RESERVED = ['Held', 'Lapsed'];
  const words = standings.map(stateLabel).concat(solid.map(stateLabel));
  check('no Journey chip borrows a word readiness owns',
    words.every((w) => !RESERVED.includes(w)),
    [...new Set(words)].join(', '));
  check('no module row says "solid" either',
    BEGINNER_MODULE_PATH.every(
      (m) => !/\bsolid\b/i.test(countLine(m, moduleContent(m, standings))),
    ));
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
