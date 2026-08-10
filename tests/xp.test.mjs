// The points economy, its anti-farming properties, and the benchmark.
//
// The benchmark near the bottom is the part that matters most over time. An
// economy that pays too little makes the ladder feel grudging and an economy
// that pays too much makes it meaningless; both failures are invisible on the
// day they are introduced and obvious eighteen months later, by which point the
// history has been rewritten. So the shape of the curve is asserted here, at one
// month, six months, one year, two years and five years of real practice, for
// two different habits, and a change that breaks it fails a test instead of
// being noticed in 2028.

import {
  computeXp, levelFor, pointsForLevel, runCredit, BANDS, restAdvice, REST_EARNED_AFTER,
  RUN_POINTS, RUN_FLOOR, REPS_MAX, BEST_DAY_BONUS, TIMED_TASK_CAP, STATED_POINTS,
  STATED_DAY_CAP, UNHEARD_SHARE, MAX_STREAK_BONUS, DAY_FULL_UP_TO,
} from '../src/lib/xp.ts';
import { evaluateAchievements, ACHIEVEMENTS, OPEN_CHORD_COUNT } from '../src/data/achievements.ts';
import { allStandings, readEvidence } from '../src/lib/progression.ts';
import { pairKey } from '../src/lib/pairs.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?' — '+d:''}`); };

// A day the way the store writes one now: runs in the order they happened, the
// day's best summarised beside them, and a record of how each task settled.
const day = (date, runsByKey = {}, records = {}) => {
  const drillResults = {};
  const drillRuns = {};
  for (const [key, values] of Object.entries(runsByKey)) {
    const list = Array.isArray(values) ? values : [values];
    drillRuns[key] = list.map((value, i) => ({ value, at: i }));
    drillResults[key] = Math.max(...list);
  }
  const completedTaskIds = Object.keys(records);
  const log = { date, routineId: 'r1', completedTaskIds, taskRecords: records };
  if (Object.keys(drillResults).length) {
    log.drillResults = drillResults;
    log.drillRuns = drillRuns;
  }
  return [date, log];
};
/** A day recorded before completion records existed. */
const legacyDay = (date, drillResults, tasks = []) =>
  [date, { date, routineId: 'r1', completedTaskIds: tasks, drillResults }];
const timed = (minutes) => ({ evidence: 'timed', seconds: minutes * 60, ranToEnd: true, at: 1 });
const stated = () => ({ stated: true, at: 1 });
const logs = (...entries) => Object.fromEntries(entries);
const iso = (offsetDays, from = Date.UTC(2026, 0, 1)) =>
  new Date(from + offsetDays * 86_400_000).toISOString().slice(0, 10);

console.log('\nDoing the work is what earns\n');
{
  check('an empty history is zero', computeXp({}).total === 0);
  const one = computeXp(logs(day('2026-01-01', { [pairKey('A','D')]: 30 })));
  const expected = runCredit(30);
  check('one run earns its base plus what was in it',
    one.total === Math.round(expected.base + expected.reps), String(one.total));
  check('the base is the base', one.source.heard === RUN_POINTS, String(one.source.heard));

  // The whole point of the rebalance: where the number landed against your own
  // history does not change what the work was worth.
  const good = computeXp(logs(
    day('2026-01-01', { k: 40 }), day('2026-01-03', { k: 39 }),
  )).days[1];
  const rough = computeXp(logs(
    day('2026-01-01', { k: 40 }), day('2026-01-03', { k: 4 }),
  )).days[1];
  check('a rough run earns the same base as a good one',
    rough.points.heard === good.points.heard && rough.points.heard === RUN_POINTS,
    `${rough.points.heard} vs ${good.points.heard}`);
  check('and falling far short of your best is never a deduction',
    rough.xp >= RUN_FLOOR && rough.xp >= RUN_POINTS, String(rough.xp));
  const collapse = computeXp(logs(
    day('2026-01-01', { k: 60 }),
    ...Array.from({length:9}, (_,i) => day(iso(i + 1), { k: 5 })),
  ));
  check('nine bad days in a row still earn nine days of work',
    collapse.days.slice(1).every((d) => d.points.heard === RUN_POINTS),
    collapse.days.slice(1).map((d) => d.points.heard).join(' '));
  check('and the total only ever goes up',
    collapse.days.every((d) => d.xp > 0)
      && collapse.days.reduce((n, d) => n + d.xp, 0) === collapse.total);

  check('a zero result earns nothing',
    computeXp(logs(day('2026-01-01', { [pairKey('A','D')]: 0 }))).total === 0);
  check('a negative result earns nothing',
    computeXp(logs(day('2026-01-01', { [pairKey('A','D')]: -9 }))).total === 0);
  check('the breakdown always adds up to the total', (() => {
    const x = computeXp(logs(
      day('2026-01-01', { a: [20, 22], b: 30 }, { t1: timed(4), t2: stated() }),
      day('2026-01-02', { a: 26, b: [29, 31] }, { t1: timed(3) }),
      day('2026-01-03', { a: 26 }, { t2: stated() }),
    ));
    const s = x.source;
    return s.heard + s.reps + s.timed + s.bests + s.streak + s.stated === x.total;
  })());
}

console.log('\nModifiers adjust the base, and the floor holds under them\n');
{
  // Swept across the whole domain rather than spot-checked, because the promises
  // below are the ones that must survive the first modifier that subtracts.
  const values = Array.from({length:600}, (_,i) => i * 0.5);
  check('no run the app heard is ever worth less than the floor',
    values.every((v) => runCredit(v).base + runCredit(v).reps >= RUN_FLOOR));
  check('and no line of the breakdown is ever negative',
    values.every((v) => runCredit(v).base >= 0 && runCredit(v).reps >= 0));
  check('the base never varies with the number',
    values.every((v) => runCredit(v).base === RUN_POINTS));
  check('the modifier is bounded', values.every((v) => runCredit(v).reps <= REPS_MAX),
    String(REPS_MAX));
  check('and cannot dominate the base', REPS_MAX < RUN_POINTS, `${REPS_MAX} vs ${RUN_POINTS}`);

  // Perverse incentives. Each of these would be a reason to practise worse.
  check('playing more is never worth less, so there is no reason to stop early',
    values.every((v, i) => i === 0
      || runCredit(v).reps >= runCredit(values[i-1]).reps - 1e-12));
  const hard = runCredit(8).base + runCredit(8).reps;
  const easy = runCredit(50).base + runCredit(50).reps;
  check('a hard drill still earns most of what an easy one does, so neither is ducked',
    hard > easy * 0.6, `${hard.toFixed(2)} vs ${easy.toFixed(2)}`);
  check('and pushing is never punished', runCredit(60).reps >= runCredit(30).reps);
}

console.log('\nRunning a drill again is more work, and is paid as more work\n');
{
  const runs = (n) => computeXp(logs(day('2026-02-01', { k: Array(n).fill(20) }))).total;
  check('two runs pay more than one', runs(2) > runs(1), `${runs(2)} vs ${runs(1)}`);
  check('four runs pay more than two', runs(4) > runs(2), `${runs(4)} vs ${runs(2)}`);
  check('but twenty runs of one drill pay nothing like twenty times',
    runs(20) < runs(1) * 6, `${runs(20)} vs ${runs(1) * 20}`);
  check('and less than a varied session of five different drills',
    runs(20) < computeXp(logs(day('2026-02-01',
      Object.fromEntries(['a','b','c','d','e'].map((k) => [k, 20]))))).total,
    String(runs(20)));
  check('a day recorded before runs existed reads as one run',
    computeXp(logs(legacyDay('2026-02-01', { k: 20 }))).total === runs(1),
    String(computeXp(logs(legacyDay('2026-02-01', { k: 20 }))).total));
}

console.log('\nA personal best is recognition, not the point\n');
{
  const x = computeXp(logs(
    day('2026-01-01', { k: 30 }),
    day('2026-01-02', { k: 40 }),
    day('2026-01-03', { k: 41 }),
  ));
  check('the first run of a drill is a baseline, not a best', x.days[0].bests === 0);
  check('beating it pays the bonus once', x.days[1].points.bests === BEST_DAY_BONUS,
    String(x.days[1].points.bests));
  check('and the size of the gain makes no difference', (() => {
    const inch = computeXp(logs(day('2026-03-01', { k: 100 }), day('2026-03-02', { k: 101 })));
    const leap = computeXp(logs(day('2026-03-01', { k: 100 }), day('2026-03-02', { k: 400 })));
    return inch.days[1].points.bests === leap.days[1].points.bests;
  })());
  check('five bests in one day still pay one bonus', (() => {
    const first = Object.fromEntries(['a','b','c','d','e'].map((k) => [k, 10]));
    const better = Object.fromEntries(['a','b','c','d','e'].map((k) => [k, 20]));
    const y = computeXp(logs(day('2026-04-01', first), day('2026-04-02', better)));
    return y.days[1].points.bests === BEST_DAY_BONUS && y.days[1].bests === 5;
  })());
  check('the bonus stays a small part of a session',
    BEST_DAY_BONUS < 5 * RUN_POINTS, String(BEST_DAY_BONUS));

  // With no penalty for a low number, the obvious worry is that starting low and
  // inching up beats playing well. It buys one capped bonus a day, on days an
  // honest player often earns anyway, and it costs real progress on every drill.
  const sandbagger = logs(...Array.from({length:30}, (_,i) =>
    day(iso(i), Object.fromEntries(['a','b','c'].map((k) => [k, 10 + i])))));
  const honest = logs(...Array.from({length:30}, (_,i) =>
    day(iso(i), Object.fromEntries(['a','b','c'].map((k) => [k, 55 + (i % 5 === 0 ? 1 : -2)])))));
  const sb = computeXp(sandbagger).total;
  const hn = computeXp(honest).total;
  check('deliberately underperforming does not meaningfully out-earn playing well',
    sb < hn * 1.1, `${sb} vs ${hn}`);
  check('and the whole advantage is one capped bonus a day',
    sb - hn <= BEST_DAY_BONUS * 30, `${sb - hn}`);
}

console.log('\nWhat the app cannot hear\n');
{
  const heard = computeXp(logs(day('2026-05-01',
    Object.fromEntries(['a','b','c','d','e'].map((k) => [k, 20])))));
  check('a session of drills earns the session', heard.source.heard === 5 * RUN_POINTS,
    String(heard.total));

  const timersOnly = computeXp(logs(...Array.from({length:60}, (_,i) =>
    day(iso(i), {}, { t1: timed(5), t2: timed(5), t3: timed(5) }))));
  check('sixty days of timers and no playing earns nothing', timersOnly.total === 0,
    String(timersOnly.total));
  const wordOnly = computeXp(logs(...Array.from({length:60}, (_,i) =>
    day(iso(i), {}, { t1: stated(), t2: stated(), t3: stated(), t4: stated() }))));
  check('sixty days of saying so earns nothing', wordOnly.total === 0, String(wordOnly.total));
  check('nor counts as a day practised', wordOnly.practiceDays === 0);
  check('nor builds a streak', wordOnly.bestStreak === 0 && timersOnly.bestStreak === 0);

  // Alongside real playing, both are credited, each in its own line.
  const session = { t1: timed(3), t2: timed(4), t3: timed(5), t4: stated() };
  const mixed = computeXp(logs(...Array.from({length:20}, (_,i) =>
    day(iso(i), Object.fromEntries(['a','b','c','d','e'].map((k) => [k, 20])), session))));
  check('a timed block is credited its minutes', mixed.source.timed > 0, String(mixed.source.timed));
  check('a stated completion is credited its rate', mixed.source.stated > 0,
    String(mixed.source.stated));
  check('and neither exceeds what the app heard',
    mixed.source.timed + mixed.source.stated
      <= (mixed.source.heard + mixed.source.bests) * UNHEARD_SHARE + 1,
    `${mixed.source.timed + mixed.source.stated} vs ${mixed.source.heard + mixed.source.bests}`);

  const oneMinute = computeXp(logs(day('2026-06-01', { a: 20, b: 20, c: 20 }, { t: timed(1) })));
  check('a minute on the clock is worth a point', oneMinute.source.timed === 1,
    String(oneMinute.source.timed));
  const runaway = computeXp(logs(day('2026-06-01',
    Object.fromEntries(Array.from({length:20}, (_,i) => [`d${i}`, 20])), { t: timed(600) })));
  check('a timer left running all day is capped', runaway.source.timed <= TIMED_TASK_CAP,
    String(runaway.source.timed));
  const halfDone = computeXp(logs(day('2026-06-01', { a: 20, b: 20, c: 20 },
    { t: { evidence: 'timed', seconds: 180, at: 1 } })));
  check('a block left half-finished still pays the minutes it ran',
    halfDone.source.timed === 3, String(halfDone.source.timed));

  const manyClaims = computeXp(logs(day('2026-06-01',
    Object.fromEntries(Array.from({length:20}, (_,i) => [`d${i}`, 20])),
    Object.fromEntries(Array.from({length:10}, (_,i) => [`t${i}`, stated()])))));
  check('claims are capped by the day', manyClaims.source.stated <= STATED_DAY_CAP,
    String(manyClaims.source.stated));
  const oneClaim = computeXp(logs(day('2026-06-01', { a: 20, b: 20, c: 20 }, { t: stated() })));
  check('one claim is worth its rate', oneClaim.source.stated === STATED_POINTS,
    String(oneClaim.source.stated));
  const unsettled = computeXp(logs(['2026-06-02', {
    date: '2026-06-02', routineId: 'r1', completedTaskIds: [],
    drillResults: { a: 20 }, drillRuns: { a: [{ value: 20, at: 1 }] },
    taskRecords: { t: { stated: true, at: 1 } },
  }]));
  check('a claim that never settled the task is worth nothing',
    unsettled.source.stated === 0, String(unsettled.source.stated));
  check('a measured task is never paid twice for its completion',
    computeXp(logs(day('2026-06-03', { t1: 20 }, { t1: { evidence: 'measured', at: 1 } })))
      .source.stated === 0);

  // Months of history predate completion records. Reading those ticks as nothing
  // would delete a chunk of someone's past on the day this shipped.
  const legacy = computeXp(logs(...Array.from({length:10}, (_,i) =>
    legacyDay(iso(i), { a: 20, b: 20, c: 20 }, ['a', 'stretches', 'song']))));
  check('an older day still earns for what it recorded', legacy.source.stated > 0,
    String(legacy.source.stated));
}

console.log('\nA day has a shape\n');
{
  const spread = (n) => computeXp(logs(day('2026-07-01',
    Object.fromEntries(Array.from({length:n}, (_,i) => [`d${i}`, 20]))))).total;
  const session = 5 * (runCredit(20).base + runCredit(20).reps);
  check('a real session sits inside the full-rate band',
    session <= DAY_FULL_UP_TO && spread(5) === Math.round(5 * runCredit(20).base)
      + Math.round(5 * runCredit(20).reps),
    `${spread(5)} against a band of ${DAY_FULL_UP_TO}`);
  check('the returns bend once a day is past a session',
    spread(20) - spread(15) < spread(5) - spread(1),
    `${spread(20) - spread(15)} vs ${spread(5) - spread(1)}`);
  check('six times the drills pays more', spread(30) > spread(5) * 2,
    `${spread(30)} vs ${spread(5)}`);
  check('and well under six times more', spread(30) < spread(5) * 4,
    `${spread(30)} vs ${spread(5)}`);
  check('and never reaches zero, so there is no point at which to stop',
    spread(60) > spread(50), `${spread(60)} vs ${spread(50)}`);
}

console.log('\nStreaks\n');
{
  const run = (n) => computeXp(logs(...Array.from({length:n}, (_,i) =>
    day(iso(i, Date.UTC(2026, 2, 1)), { [pairKey('A','D')]: 20 }))));
  check('a two-day run has no bonus yet', run(2).days[1].points.streak === 0);
  check('the third day starts earning it', run(3).days[2].points.streak > 0);
  check('the streak is measured', run(9).bestStreak === 9, String(run(9).bestStreak));
  check('the bonus is capped so a streak cannot dwarf playing',
    run(31).days.at(-1).points.streak === MAX_STREAK_BONUS,
    String(run(31).days.at(-1).points.streak));
  check('and the cap stays under a fifth of a session',
    MAX_STREAK_BONUS < 5 * RUN_POINTS, String(MAX_STREAK_BONUS));
  const broken = computeXp(logs(
    day('2026-03-01', { a: 5 }), day('2026-03-02', { a: 5 }), day('2026-03-05', { a: 5 }),
  ));
  check('a gap resets the streak', broken.bestStreak === 2, String(broken.bestStreak));
  const timerDay = computeXp(logs(
    day('2026-03-01', { a: 5 }), day('2026-03-02', {}, { t: timed(20) }), day('2026-03-03', { a: 5 }),
  ));
  check('a day of timers alone does not extend a run of practice',
    timerDay.bestStreak === 1, String(timerDay.bestStreak));
  check('a month boundary is handled',
    computeXp(logs(day('2026-01-31', { a: 5 }), day('2026-02-01', { a: 5 }))).bestStreak === 2);
}

console.log('\nOrder matters, so the replay must be ordered\n');
{
  const forward = logs(day('2026-04-01', { a: 10 }), day('2026-04-02', { a: 20 }));
  const shuffled = { '2026-04-02': forward['2026-04-02'], '2026-04-01': forward['2026-04-01'] };
  check('the same history scores the same whatever order the keys are in',
    computeXp(forward).total === computeXp(shuffled).total);
  check('and finds the same best', computeXp(shuffled).totalBests === 1);
}

console.log('\nLevels, unbounded\n');
{
  check('nothing done is level one', levelFor(0).level === 1);
  check('the cost of a level always rises',
    Array.from({length:400}, (_,i) => i + 1)
      .every((n) => pointsForLevel(n + 1) > pointsForLevel(n)));
  check('and the ladder has no last rung',
    pointsForLevel(10_000) > pointsForLevel(1_000) && Number.isFinite(pointsForLevel(10_000)));
  check('landing exactly on a threshold is the new level',
    levelFor(pointsForLevel(57)).level === 57, String(levelFor(pointsForLevel(57)).level));
  check('and one point short of it is not',
    levelFor(pointsForLevel(57) - 1).level === 56);
  check('progress inside a level is a fraction', (() => {
    const mid = Math.round((pointsForLevel(40) + pointsForLevel(41)) / 2);
    const l = levelFor(mid);
    return l.progress > 0.2 && l.progress < 0.8;
  })());
  check('the bands are ordered and start at level one',
    BANDS[0].from === 1 && BANDS.every((b, i) => i === 0 || b.from > BANDS[i-1].from));
  check('every band has a title that says something',
    BANDS.every(b => b.title.length > 4 && !/level/i.test(b.title)));
  check('the last band never ends', levelFor(pointsForLevel(9_999)).nextBand === null);
  check('and a level in it still counts up',
    levelFor(pointsForLevel(9_999)).level === 9_999);
  check('the two directions are exact inverses of each other',
    Array.from({length:900}, (_,i) => i + 1)
      .every((n) => levelFor(pointsForLevel(n)).level === n
        && levelFor(pointsForLevel(n) - 1).level === Math.max(1, n - 1)));

  // A level has to keep arriving, or the ladder has a ceiling in practice even
  // without having one in arithmetic.
  const daysPerLevel = (level, perDay) => (pointsForLevel(level + 1) - pointsForLevel(level)) / perDay;
  check('a level costs a couple of days early on', daysPerLevel(20, 33) < 3,
    daysPerLevel(20, 33).toFixed(1));
  check('under a week at a year in', daysPerLevel(120, 33) < 7, daysPerLevel(120, 33).toFixed(1));
  check('and under a fortnight five years in', daysPerLevel(350, 33) < 14,
    daysPerLevel(350, 33).toFixed(1));
}

console.log('\nThe benchmark: real practice against the ladder\n');
{
  // Deterministic, so the numbers below are reproducible rather than sampled.
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const CHORDS = ['A','D','E','Em','Am','G','C','Dm','F'];
  // Fast early, long plateau, which is what learning this instrument looks like.
  const rate = (i, offset) =>
    Math.max(4, Math.round(58 * (1 - Math.exp(-(i + 20) / 260)) * (0.9 + rnd() * 0.16) - offset));

  // One session off the routine builder: three change pairs, Chord Perfect, an
  // anchor rotation, and three timed blocks the microphone will never hear.
  const practitioner = (days, perWeek) => {
    seed = 12345;
    const out = [];
    for (let i = 0; i < days; i++) {
      const date = iso(i, Date.UTC(2021, 0, 4));
      if (i % 7 >= perWeek) continue;
      const vocab = Math.min(CHORDS.length, 3 + Math.floor(i / 21));
      const runs = {};
      for (let p = 0; p < 3; p++) {
        runs[pairKey(CHORDS[(i + p) % vocab], CHORDS[(i + p + 1) % vocab])] = [rate(i, p * 3)];
      }
      runs.cp = [Math.max(3, Math.round(rate(i, 0) * 0.5))];
      runs.anchor = [Math.max(3, Math.round(rate(i, 0) * 0.7))];
      out.push(day(date, runs, {
        cp: { evidence: 'measured', at: 1 },
        anchor: { evidence: 'measured', at: 1 },
        stretches: timed(3), rhythm: timed(4), song: timed(5),
      }));
    }
    return logs(...out);
  };

  const at = (days, perWeek) => {
    const xp = computeXp(practitioner(days, perWeek));
    return { xp, level: levelFor(xp.total) };
  };

  const marks = [['1 month', 30], ['6 months', 182], ['1 year', 365], ['2 years', 730], ['5 years', 1825]];
  for (const perWeek of [6, 4]) {
    console.log(`    ${perWeek} days a week`);
    for (const [label, days] of marks) {
      const { xp, level } = at(days, perWeek);
      console.log(`      ${label.padEnd(9)} ${String(xp.practiceDays).padStart(4)} sessions  ` +
        `${String(xp.total).padStart(6)} points  ${(xp.total / xp.practiceDays).toFixed(1)}/session  ` +
        `level ${String(level.level).padStart(3)}  "${level.band.title}"`);
    }
  }

  const daily = marks.map(([, d]) => at(d, 6));
  const [dMonth, dHalf, dYear, dTwo, dFive] = daily;
  const four = marks.map(([, d]) => at(d, 4));
  const [, , fYear, , fFive] = four;

  check('a session is worth about the half hour it takes',
    dMonth.xp.total / dMonth.xp.practiceDays > 25 && dMonth.xp.total / dMonth.xp.practiceDays < 45,
    (dMonth.xp.total / dMonth.xp.practiceDays).toFixed(1));
  check('a month in is past level 15', dMonth.level.level >= 15, String(dMonth.level.level));
  check('six months in is past level 60', dHalf.level.level >= 60, String(dHalf.level.level));
  check('a year of near-daily practice clears level 100', dYear.level.level >= 100,
    String(dYear.level.level));
  check('four days a week clears it inside eighteen months',
    levelFor(fYear.xp.total * 1.5).level >= 100, String(levelFor(fYear.xp.total * 1.5).level));
  check('two years in is past level 150', dTwo.level.level >= 150, String(dTwo.level.level));
  check('five years in is past level 300', dFive.level.level >= 300, String(dFive.level.level));
  check('and is still levelling every week or so', (() => {
    const perDay = dFive.xp.total / dFive.xp.practiceDays;
    const cost = pointsForLevel(dFive.level.level + 1) - pointsForLevel(dFive.level.level);
    return cost / perDay < 12;
  })(), `${((pointsForLevel(dFive.level.level + 1) - pointsForLevel(dFive.level.level)) / (dFive.xp.total / dFive.xp.practiceDays)).toFixed(1)} days a level`);
  check('five years in is deep in the named bands but not out of them',
    dFive.level.bandIndex >= BANDS.length - 3 && dFive.level.nextBand !== null,
    `${dFive.level.band.title}, next "${dFive.level.nextBand?.title}"`);
  check('and the open band is reachable rather than decorative',
    levelFor(dFive.xp.total * 2).band.title === BANDS.at(-1).title,
    levelFor(dFive.xp.total * 2).band.title);
  check('a lighter habit still moves through the bands',
    fFive.level.level >= 200 && fFive.level.band.title !== BANDS[0].title,
    `L${fFive.level.level} "${fFive.level.band.title}"`);
  check('and five years does not run into the millions', dFive.xp.total < 100_000,
    String(dFive.xp.total));

  const share = (x, k) => x.source[k] / x.total;
  const played = share(dFive.xp, 'heard') + share(dFive.xp, 'reps');
  check('what the app heard is the biggest part of the standing', played > 0.5,
    `${(played*100).toFixed(0)}%`);
  check('and the modifier never outweighs the base it adjusts',
    share(dFive.xp, 'reps') < share(dFive.xp, 'heard'),
    `${(share(dFive.xp,'reps')*100).toFixed(0)}% vs ${(share(dFive.xp,'heard')*100).toFixed(0)}%`);
  check('what it could not hear never overtakes what it did',
    share(dFive.xp, 'timed') + share(dFive.xp, 'stated') < played,
    `${((share(dFive.xp,'timed') + share(dFive.xp,'stated'))*100).toFixed(0)}%`);
  check('the best bonus stays recognition rather than the point',
    share(dFive.xp, 'bests') < 0.1, `${(share(dFive.xp,'bests')*100).toFixed(0)}%`);
}

console.log('\nAwards\n');
{
  const build = (l, claimed = []) => {
    const xp = computeXp(l);
    const ev = readEvidence(l);
    const bests = new Map(ev.pairs);
    for (const [k,v] of ev.tasks) bests.set(k, v);
    return { xp, bests, standings: allStandings(l, claimed) };
  };
  const award = (list, id) => {
    const found = list.find(a => a.id === id);
    if (!found) throw new Error(`no award "${id}": the suite and the set have drifted apart`);
    return found;
  };
  const runOf = (n, from = 0) => logs(...Array.from({length:n}, (_,i) =>
    day(iso(from + i, Date.UTC(2026, 5, 1)), { [pairKey('A','D')]: 20 })));

  const none = evaluateAchievements(build({}));
  check('none are earned on an empty history', none.every(a => !a.earned));
  check('every award has a goal in the second person',
    ACHIEVEMENTS.every(a => a.goal.length > 15));
  check('ids are unique', new Set(ACHIEVEMENTS.map(a=>a.id)).size === ACHIEVEMENTS.length);
  // Every one of these used to render its zero: "Best pair: 0 a minute", "0 so
  // far". A first run looked like a broken panel rather than an empty one.
  check('and none of them report a zero as evidence', none.every(a => a.detail === undefined),
    none.filter(a => a.detail !== undefined).map(a => a.detail).join(' | '));

  const started = evaluateAchievements(build(logs(day('2026-05-01', { [pairKey('A','D')]: 12 }))));
  check('the first drill is earned', award(started, 'first-drill').earned);
  check('the gate is not', !award(started, 'the-gate').earned);
  check('but it reports how close', Math.abs(award(started, 'the-gate').progress - 0.4) < 1e-9,
    String(award(started, 'the-gate').progress));
  check('and names the pair it measured', /A to D/.test(award(started, 'the-gate').detail ?? ''),
    award(started, 'the-gate').detail);

  const gated = evaluateAchievements(build(logs(day('2026-05-01', { [pairKey('A','D')]: 30 }))));
  check('thirty a minute clears the gate', award(gated, 'the-gate').earned);

  // Eight pairs past a bar of five was reported as "8 of 5 so far", which reads
  // as arithmetic going wrong rather than as a record.
  const broad = evaluateAchievements(build(logs(day('2026-05-01', Object.fromEntries(
    [['A','D'],['A','E'],['D','E'],['C','G'],['Am','Em'],['C','Am']].map(([a,b]) => [pairKey(a,b), 33]),
  )))));
  check('a count past the bar is never reported against it',
    award(broad, 'five-pairs').detail === '6 pairs past it.', award(broad, 'five-pairs').detail);
  check('and its progress stops at one', award(broad, 'five-pairs').progress === 1);

  const week = evaluateAchievements(build(runOf(7)));
  check('seven days running is earned', award(week, 'week').earned);
  check('progress never exceeds one', week.every(a => a.progress >= 0 && a.progress <= 1));

  // Nothing may be earned by saying so. Every chord skill marked done by hand
  // still leaves the open-chord award unearned, because a claim is a claim.
  const claimedAll = ['D','A','E','Em','Am','Dm','C','G'].map(c => `chord.${c}`);
  const claimed = evaluateAchievements(build({}, claimedAll));
  check('no award can be earned by claiming a skill', claimed.every(a => !a.earned),
    claimed.filter(a => a.earned).map(a => a.id).join(' '));
  // The day list carries days that were only timed or asserted, so anything
  // counting days has to filter them out.
  const unheardDays = evaluateAchievements(build(logs(...Array.from({length:60}, (_,i) =>
    day(iso(i), {}, { t1: timed(10), t2: timed(10), t3: stated() })))));
  check('nor by two months of timers and claims', unheardDays.every(a => !a.earned),
    unheardDays.filter(a => a.earned).map(a => a.id).join(' '));
  check('the open-chord bar is the eight the course teaches', OPEN_CHORD_COUNT === 8,
    String(OPEN_CHORD_COUNT));
}

console.log('\nTwenty days inside a month, and coming back after one off\n');
{
  const build = (l) => {
    const xp = computeXp(l);
    const ev = readEvidence(l);
    const bests = new Map(ev.pairs);
    for (const [k,v] of ev.tasks) bests.set(k, v);
    return { xp, bests, standings: allStandings(l, []) };
  };
  const award = (l, id) => evaluateAchievements(build(l)).find(a => a.id === id);
  // Days chosen by index from a fixed start, so a window can be built exactly.
  const on = (...offsets) => logs(...offsets.map((o) => day(iso(o), { [pairKey('A','D')]: 20 })));
  const range = (n, step = 1) => Array.from({length:n}, (_,i) => i * step);

  check('twenty days inside thirty is earned', award(on(...range(20)), 'consistency').earned);
  check('nineteen is not', !award(on(...range(19)), 'consistency').earned);
  // Every other day: twenty practised days, but spread over thirty-nine.
  check('twenty days spread over more than a month is not',
    !award(on(...range(20, 2)), 'consistency').earned,
    String(award(on(...range(20, 2)), 'consistency').detail));
  check('and the window is reported honestly',
    award(on(...range(20, 2)), 'consistency').detail === 'Best month so far: 15 days.',
    award(on(...range(20, 2)), 'consistency').detail);
  // Days the app only timed sit in the same list as days it heard. A month of
  // them between two practice days must not close the window or the gap.
  const padded = { ...on(0, 1, 9) };
  for (const o of range(7, 1)) {
    const [date, log] = day(iso(o + 2), {}, { t1: timed(10), t2: timed(10) });
    padded[date] = log;
  }
  check('timed days do not fill the consistency window',
    award(padded, 'consistency').detail === 'Best month so far: 3 days.',
    award(padded, 'consistency').detail);
  check('nor close the gap a comeback is measured over',
    award(padded, 'comeback').earned, String(award(padded, 'comeback').detail));
  // The old version scanned forward from every practised day. This one has to
  // finish on a history long enough for that to hurt.
  {
    const long = on(...range(1200));
    const t0 = performance.now();
    const out = award(long, 'consistency');
    const ms = performance.now() - t0;
    check('the window is linear, not quadratic', ms < 60, `${ms.toFixed(1)}ms`);
    check('and still finds the full month', out.earned && out.detail === 'Best month so far: 30 days.',
      out.detail);
  }

  check('coming back after a week off is earned', award(on(0, 1, 9), 'comeback').earned,
    String(award(on(0, 1, 9), 'comeback').detail));
  check('six days away is not', !award(on(0, 1, 8), 'comeback').earned);
  check('and it counts the days away, not the calendar gap',
    award(on(0, 1, 9), 'comeback').detail === 'You came back after 7 days off.',
    award(on(0, 1, 9), 'comeback').detail);
  check('it stays out of the list until it happens',
    ACHIEVEMENTS.find(a => a.id === 'comeback').hiddenUntilEarned === true);
}

{
  console.log('\nRest advice\n');
  const run = (n, upTo) => Object.fromEntries(Array.from({length:n}, (_,i) => {
    const d = new Date(Date.UTC(2026, 6, Number(upTo.slice(-2)) - (n - 1 - i)));
    const date = d.toISOString().slice(0,10);
    return [date, { date, routineId:'r1', completedTaskIds:['t1'], drillResults:{ a: 20 } }];
  }));
  check('a short run is not told to rest', !restAdvice(run(3, '2026-07-10'), '2026-07-10').earned);
  check('a long run is', restAdvice(run(8, '2026-07-10'), '2026-07-10').earned);
  check('the run is counted right', restAdvice(run(8, '2026-07-10'), '2026-07-10').run === 8,
    String(restAdvice(run(8, '2026-07-10'), '2026-07-10').run));
  check('today being empty does not break the run at breakfast',
    restAdvice(run(7, '2026-07-09'), '2026-07-10').run === 7,
    String(restAdvice(run(7, '2026-07-09'), '2026-07-10').run));
  check('the threshold is the threshold',
    restAdvice(run(REST_EARNED_AFTER, '2026-07-10'), '2026-07-10').earned);
  check('an empty history says nothing', restAdvice({}, '2026-07-10').run === 0);
  check('and offers no message', restAdvice({}, '2026-07-10').message === null);
  check('the message never scolds',
    !/lazy|fail|lose|broke/i.test(restAdvice(run(9, '2026-07-10'), '2026-07-10').message ?? ''));
}

console.log(failures===0?'\nALL PASS\n':`\n${failures} FAILURE(S)\n`);
process.exit(failures?1:0);
