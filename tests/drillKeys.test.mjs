// What a drill result is a result of, and what happens to the months of them
// that were filed under a task id.
//
// The defect this pins: Chord Perfect and the anchor rotation wrote their
// numbers under the id of the task they were launched from, so renaming,
// rebuilding or regenerating a routine orphaned every one of them. The keys name
// what was played now, and none of the old numbers are allowed to go missing on
// the way.

import {
  captureDrillKeyAliases,
  chordKey,
  describeDrillKey,
  isDrillKey,
  mergeDrillKeyAliases,
  findKey,
  parseFindKey,
  parsePoolKey,
  parseRingKey,
  poolKey,
  resolveDrillLogs,
  ringKey,
  rotationRing,
  sessionKeyForTask,
  trainerPool,
} from '../src/lib/drillKeys.ts';
import { collectDrillStats, keyDrillHistory } from '../src/lib/drillStats.ts';
import { drillSeries } from '../src/lib/tempo.ts';
import { allStandings, readEvidence } from '../src/lib/progression.ts';
import { FIND_BAR, ROTATION_BAR } from '../src/lib/readiness.ts';
import { finderHistory, rungRuns } from '../src/lib/finderHistory.ts';
import { RUNGS, currentRung } from '../src/lib/noteFinder.ts';
import { withWindow } from '../src/lib/drillWindow.ts';
import { runsFor } from '../src/store/completion.ts';
import { pairKey } from '../src/lib/pairs.ts';

let failures = 0;
const check = (l, ok, d) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${d ? `: ${d}` : ''}`);
};

const day = (date, drillResults, extra = {}) => [
  date,
  { date, routineId: 'r1', completedTaskIds: ['t1'], drillResults, ...extra },
];
const logs = (...entries) => Object.fromEntries(entries);

const POOL = ['A', 'D', 'E', 'G', 'C'];
const RING = ['D', 'A', 'E'];

// The routine as it stood before any of this shipped: two task-keyed drills,
// each with the chords it actually plays.
const routineBefore = {
  id: 'r1',
  name: 'Module 4 Daily',
  description: '',
  tasks: [
    { id: 't1', title: 'Chord Perfect', drill: { kind: 'chord-trainer', durationSec: 300, chords: POOL } },
    { id: 't2', title: 'Anchor changes', drill: { kind: 'chord-rotation', durationSec: 60, chords: RING } },
    { id: 't3', title: 'Spider walk', duration: '5' },
  ],
};

console.log('\nA key names what was played\n');
{
  check('a pool is a set, so its order never forks the history',
    poolKey(['E', 'A', 'D']) === poolKey(['D', 'E', 'A']));
  check('and a repeated shape does not double it',
    poolKey(['A', 'A', 'D']) === poolKey(['A', 'D']), poolKey(['A', 'A', 'D']));
  check('but a different set of shapes is a different drill',
    poolKey(['A', 'D']) !== poolKey(['A', 'D', 'F']));
  check('a pool round trips', parsePoolKey(poolKey(POOL)).join() === 'A,C,D,E,G');

  check('a rotation is a loop, so where you start it does not matter',
    ringKey(['D', 'A', 'E']) === ringKey(['A', 'E', 'D']), ringKey(['A', 'E', 'D']));
  check('turning it the other way is different practice, and a different key',
    ringKey(['D', 'A', 'E']) !== ringKey(['D', 'E', 'A']));
  check('a ring round trips as the same loop',
    parseRingKey(ringKey(['D', 'A', 'E'])).join() === 'A,E,D');

  check('every new key is recognisable as one',
    [poolKey(POOL), ringKey(RING), chordKey('F'), pairKey('A', 'D')].every(isDrillKey));
  check('and a bare task id is not', !isDrillKey('t1'));

  check('a shape says which shape', describeDrillKey(chordKey('F')).label === 'F shape');
  check('a pool says which shapes, not which drill, so a phone row fits it',
    describeDrillKey(poolKey(['A', 'D'])).label === 'A D',
    describeDrillKey(poolKey(['A', 'D'])).label);
  check('a ring says which loop, in the order it turns',
    describeDrillKey(ringKey(RING)).label === 'A → E → D',
    describeDrillKey(ringKey(RING)).label);
  check('a leftover task id admits it cannot say',
    describeDrillKey('t1').kind === 'retired');
  check('nothing the panel says uses an em dash',
    [chordKey('F'), poolKey(POOL), ringKey(RING), 't1']
      .every((k) => !/[\u2014\u2013]/.test(describeDrillKey(k).label)));

  check('a fallback pool is used when a task never chose one',
    trainerPool(undefined).length === 5 && trainerPool(['A', 'D']).join() === 'A,D');
  check('a ring needs two chords to be a ring',
    rotationRing(['A']).join() === 'D,A,E' && rotationRing(RING).join() === 'D,A,E');
}

console.log('\nWhat each task id used to mean, captured while the tasks are here\n');
{
  const aliases = captureDrillKeyAliases([routineBefore], undefined);
  check('the trainer maps to the pool it drills', aliases.t1 === poolKey(POOL), aliases.t1);
  check('the rotation maps to the ring it turns', aliases.t2 === ringKey(RING), aliases.t2);
  check('a task with no drill is not given a key', aliases.t3 === undefined);

  // The pool is part of the key, so an edited pool is a different drill. The
  // entry has to keep pointing at the shapes the old numbers were played on.
  const edited = {
    ...routineBefore,
    tasks: [{ ...routineBefore.tasks[0], drill: { kind: 'chord-trainer', chords: ['A', 'D'] } }],
  };
  check('an entry is never overwritten once captured',
    captureDrillKeyAliases([edited], aliases).t1 === poolKey(POOL));
  check('capturing nothing new returns the same map, so nothing is written',
    captureDrillKeyAliases([routineBefore], aliases) === aliases);

  const noChords = {
    ...routineBefore,
    tasks: [{ id: 't9', title: 'Perfect', drill: { kind: 'chord-trainer' } }],
  };
  check('a drill that never said which shapes is refused rather than guessed',
    sessionKeyForTask(noChords.tasks[0]) === null);

  const union = mergeDrillKeyAliases({ t1: 'pool:A|D' }, { t2: 'ring:A>E>D' });
  check('two devices merge to the union', union.t1 === 'pool:A|D' && union.t2 === 'ring:A>E>D');
  check('and the older claim wins a conflict',
    mergeDrillKeyAliases({ t1: 'pool:A|D' }, { t1: 'pool:A|D|F' }).t1 === 'pool:A|D');
}

console.log('\nMonths of task-keyed numbers, read back\n');
{
  const aliases = captureDrillKeyAliases([routineBefore], undefined);
  const stored = logs(
    day('2026-06-01', { t1: 40, t2: 22, [pairKey('A', 'D')]: 51 }),
    day('2026-06-02', { t1: 44, t2: 27 }, { drillRuns: { t1: [{ value: 41, at: 1 }, { value: 44, at: 2 }] } }),
    day('2026-06-03', { t1: 46, t2: 31 }),
  );
  const before = JSON.stringify(stored);
  const read = resolveDrillLogs(stored, aliases);

  check('the stored days are not touched', JSON.stringify(stored) === before);
  check('nor is the object they were read from rewritten',
    stored['2026-06-01'].drillResults.t1 === 40);

  check('a log written under the old keys still reads',
    keyDrillHistory(read, poolKey(POOL)).series.join() === '40,44,46',
    JSON.stringify(keyDrillHistory(read, poolKey(POOL))));
  check('and so does the rotation',
    keyDrillHistory(read, ringKey(RING)).best === 31);
  check('the chord pairs are left exactly where they were',
    read['2026-06-01'].drillResults[pairKey('A', 'D')] === 51);

  check('every run moves with the number it summarised',
    runsFor(read['2026-06-02'], poolKey(POOL)).map((r) => r.value).join() === '41,44');

  check('the tempo prescription finds the history',
    drillSeries(read, poolKey(POOL), 300).length === 3);

  const stats = collectDrillStats(read, '2026-06-03');
  const pool = stats.tasks.find((s) => s.key === poolKey(POOL));
  check('Progress finds it under a name a person recognises',
    pool.label === 'A C D E G', pool?.label);
  check('with the whole series behind it', pool.series.length === 3 && pool.best === 46);
  check('and today\'s run called out', pool.today === 46);
  check('no orphan is left over', stats.tasks.every((s) => s.label !== 'A drill since removed'));

  check('resolving twice hands back the same object, so memoised readers hold',
    resolveDrillLogs(stored, aliases) === read);
}

console.log('\nA task id that no longer resolves keeps its number\n');
{
  // Deleted before this build ever ran, so nothing could capture what it was.
  const aliases = captureDrillKeyAliases([routineBefore], undefined);
  const stored = logs(day('2026-05-01', { 'long-gone-task': 37, t1: 40 }));
  const read = resolveDrillLogs(stored, aliases);

  check('the number survives the move', read['2026-05-01'].drillResults['long-gone-task'] === 37);
  const stats = collectDrillStats(read, '2026-05-01');
  const orphan = stats.tasks.find((s) => s.key === 'long-gone-task');
  check('and Progress shows it rather than dropping it', orphan?.best === 37);
  check('honestly named', orphan.label === 'A drill since removed', orphan?.label);
  check('with no unit invented for it', orphan.unit === '');
  check('the readable one is still readable beside it',
    stats.tasks.some((s) => s.key === poolKey(POOL)));
  check('and it is still evidence of a practice day', readEvidence(read).days === 1);
}

console.log('\nRenaming the task, and rebuilding the routine under it\n');
{
  const aliases = captureDrillKeyAliases([routineBefore], undefined);
  const stored = logs(day('2026-06-01', { t1: 40, t2: 22 }), day('2026-06-02', { t1: 44, t2: 27 }));

  const renamed = {
    ...routineBefore,
    tasks: routineBefore.tasks.map((t) =>
      t.id === 't1' ? { ...t, title: 'Shapes, cold' } : t,
    ),
  };
  const afterRename = resolveDrillLogs(stored, captureDrillKeyAliases([renamed], aliases));
  check('a renamed task keeps its history',
    keyDrillHistory(afterRename, poolKey(POOL)).series.join() === '40,44');

  // Regenerated: same practice, brand new task ids, nothing pointing back.
  const regenerated = {
    id: 'r1',
    name: 'Module 4 Daily',
    description: '',
    tasks: [
      { id: 'gen-9a', title: 'Chord Perfect', drill: { kind: 'chord-trainer', durationSec: 300, chords: POOL } },
      { id: 'gen-9b', title: 'Anchor changes', drill: { kind: 'chord-rotation', durationSec: 60, chords: RING } },
    ],
  };
  const after = captureDrillKeyAliases([regenerated], aliases);
  const read = resolveDrillLogs(stored, after);
  check('a regenerated routine keeps its history',
    keyDrillHistory(read, poolKey(POOL)).series.join() === '40,44',
    JSON.stringify(keyDrillHistory(read, poolKey(POOL))));
  check('and the rotation\'s too', keyDrillHistory(read, ringKey(RING)).series.join() === '22,27');
  check('the new task ids write to the same keys the old ones are read under',
    sessionKeyForTask(regenerated.tasks[0]) === poolKey(POOL)
      && sessionKeyForTask(regenerated.tasks[1]) === ringKey(RING));
}

console.log('\nThe day the keys changed under someone mid-practice\n');
{
  const aliases = captureDrillKeyAliases([routineBefore], undefined);
  const stored = logs(
    day('2026-08-10', { t1: 38, [poolKey(POOL)]: 45 }, {
      drillRuns: { t1: [{ value: 38, at: 1 }], [poolKey(POOL)]: [{ value: 45, at: 2 }] },
    }),
  );
  const read = resolveDrillLogs(stored, aliases);
  check('the day summarises to its best across both keys',
    read['2026-08-10'].drillResults[poolKey(POOL)] === 45);
  check('and both runs are still runs',
    runsFor(read['2026-08-10'], poolKey(POOL)).map((r) => r.value).join() === '38,45');
}

console.log('\nChord Perfect can no longer carry the anchor skill\n');
{
  const TODAY = '2026-07-05';
  const anchor = (l) => allStandings(l, TODAY).find((s) => s.skill.id === 'technique.anchor-fingers');

  // A big block of placements, and the two chords the skill needs proven so
  // nothing else is holding it back.
  const proven = { [pairKey('A', 'D')]: 60, [pairKey('D', 'E')]: 60 };
  const perfect = anchor(logs(day('2026-07-01', {
    ...proven,
    [poolKey(POOL)]: ROTATION_BAR * 4,
    [chordKey('A')]: ROTATION_BAR * 2,
  })));
  check('a block of placements is not an anchor rotation',
    perfect.state !== 'solid', `${perfect.state}: ${perfect.evidence}`);
  check('and the app says so rather than showing a number it did not earn',
    perfect.best === null && perfect.evidence === 'No anchor rotation run yet.', perfect.evidence);

  // Three of them, because one run at the bar is a good day and the skill claims
  // more than that. What this suite is about is which drill counts, not how many.
  const rings = ['2026-07-01', '2026-07-02', '2026-07-03'].map((date) =>
    day(date, { ...proven, [ringKey(RING)]: ROTATION_BAR }));
  const turned = anchor(logs(...rings));
  check('rotations at the bar are what make it solid', turned.state === 'solid', turned.evidence);
  check('reading the ring it was turned on', turned.best === ROTATION_BAR);
  check('and one rotation on its own is not enough',
    anchor(logs(rings[0])).state !== 'solid', anchor(logs(rings[0])).evidence);

  // The same defect through the old door: a legacy Chord Perfect number that
  // resolves to a pool must not read as a rotation either.
  const legacy = resolveDrillLogs(
    logs(day('2026-07-01', { ...proven, t1: ROTATION_BAR * 4 })),
    captureDrillKeyAliases([routineBefore], undefined),
  );
  check('nor can an old task-keyed Chord Perfect number', anchor(legacy).state !== 'solid');
}

console.log('\nTuning stops claiming to be measured\n');
{
  const tuning = allStandings({}, '2026-07-05').find((s) => s.skill.id === 'setup.tuning');
  check('the taxonomy no longer says the app grades it',
    tuning.skill.measure.kind === 'measurable', tuning.skill.measure.kind);
  check('so it is not offered a bar it can never reach', tuning.bar === null);
  check('and it says what is actually missing',
    tuning.evidence.startsWith('Not measured yet.'), tuning.evidence);
  check('nothing is gated on it', tuning.blockedBy.length === 0);
}

console.log('\nThe note finder is keyed by the rung it ran\n');
{
  const rung = RUNGS[0].id;
  check('a find key names the rung', findKey(rung) === `find:${rung}`);
  check('and reads back off a windowed key', parseFindKey(withWindow(findKey(rung), 90)) === rung);
  check('it is a drill key', isDrillKey(withWindow(findKey(rung), 60)));
  check('and it counts something, so a window divides out',
    describeDrillKey(findKey(rung)).kind === 'find');
  check('it is labelled with the rung the player would recognise',
    describeDrillKey(findKey(rung)).label === RUNGS[0].label);
  // A rung retired from the ladder still has months of runs filed under it.
  check('a rung the ladder no longer defines still names itself',
    describeDrillKey('find:gone-away').label === 'gone-away');

  // Two windows of one rung are one series, which is the whole reason the
  // window lives on the key rather than beside the value.
  const runs = (value, seconds, findMs) => ({ value, findMs, at: 1 });
  const logs = Object.fromEntries([
    day('2026-08-01', { [withWindow(findKey(rung), 60)]: 9 }, {
      drillRuns: { [withWindow(findKey(rung), 60)]: [runs(9, 60, 4000)] },
    }),
    day('2026-08-02', { [withWindow(findKey(rung), 30)]: 5 }, {
      drillRuns: { [withWindow(findKey(rung), 30)]: [runs(5, 30, 3800)] },
    }),
  ]);
  const series = rungRuns(logs, rung);
  check('both windows fold onto the one rung', series.length === 2, String(series.length));
  check('and the shorter one is read as the rate it was',
    Math.round(series[1].findsPerMin) === 10, String(series[1].findsPerMin));
  check('the find time comes back with it', series[0].medianMs === 4000);
  check('the whole ladder reads in one go',
    Object.keys(finderHistory(logs)).length === RUNGS.length);
  check('two runs is not three, so the rung is not cleared',
    currentRung(finderHistory(logs)).id === rung);
}

console.log('\nNote names are measured, and only by the finder\n');
{
  const rung = RUNGS[0].id;
  const blank = allStandings({}, '2026-08-05').find((s) => s.skill.id === 'theory.note-names');
  check('the taxonomy now says the app can hear it',
    blank.skill.measure.kind === 'measured', blank.skill.measure.kind);
  check('and names the drill', blank.skill.measure.drill === 'note-finder');
  check('the metric refuses to claim the string',
    /string/i.test(blank.skill.measure.metric) && /cannot|not something/i.test(blank.skill.measure.metric),
    blank.skill.measure.metric);
  check('with nothing run it has a bar and no reading', blank.bar === FIND_BAR && blank.best === null);

  // The defect this pins: without its own branch, a measured skill falls
  // through to the chord-change reading, so a good minute of A to D would have
  // reported the note names as solid.
  const changesOnly = Object.fromEntries([
    day('2026-08-01', { [pairKey('A', 'D')]: 60 }),
    day('2026-08-02', { [pairKey('A', 'D')]: 60 }),
    day('2026-08-03', { [pairKey('A', 'D')]: 60 }),
  ]);
  const fromChanges = allStandings(changesOnly, '2026-08-05')
    .find((s) => s.skill.id === 'theory.note-names');
  check('chord changes say nothing about note names', fromChanges.best === null, String(fromChanges.best));

  const found = Object.fromEntries(
    ['2026-08-01', '2026-08-02', '2026-08-03'].map((date) =>
      day(date, { [withWindow(findKey(rung), 60)]: FIND_BAR + 4 })),
  );
  const solid = allStandings(found, '2026-08-05').find((s) => s.skill.id === 'theory.note-names');
  check('three runs at the bar do', solid.state === 'solid', solid.evidence);
  check('and it reads the finder', /note finder/i.test(solid.evidence), solid.evidence);
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
