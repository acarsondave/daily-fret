import { buildHistory, labelForKey, weeklyTotals } from '../src/lib/history.ts';
import { pairKey } from '../src/lib/pairs.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?' — '+d:''}`); };

const ROUTINES = [{ id:'r1', name:'Module 4 Daily', description:'', isDefault:true, tasks:[
  { id:'t1', title:'Chord Perfect', drill:{kind:'chord-trainer',durationSec:90} },
  { id:'t2', title:'Anchor Changes', drill:{kind:'chord-rotation',durationSec:60} },
  { id:'t3', title:'Spider Walk' },
]}];
const day = (date, results, extra = {}) =>
  [date, { date, routineId:'r1', completedTaskIds:['t1'], drillResults:results, ...extra }];
const logs = (...e) => Object.fromEntries(e);

console.log('\nReading a day back\n');
{
  const h = buildHistory(logs(
    day('2026-07-01', { [pairKey('A','D')]: 40, t1: 22 }),
    day('2026-07-02', { [pairKey('A','D')]: 55, t1: 20 }, { feedback: 'Left hand felt loose.' }),
  ), ROUTINES);
  check('newest first', h[0].date === '2026-07-02', h.map(d=>d.date).join(' '));
  check('the day names its routine', h[0].routineName === 'Module 4 Daily');
  check('the date reads as a date', /July/.test(h[0].label), h[0].label);
  check('a pair reads as a pair', h[0].results.find(r=>r.key.startsWith('pair:')).label === 'A to D');
  check('a task result reads as its task', h[0].results.find(r=>r.key==='t1').label === 'Chord Perfect');
  check('units come from the drill kind', h[0].results.find(r=>r.key==='t1').unit === 'placed');
  check('a personal best is marked', h[0].results.find(r=>r.key.startsWith('pair:')).isBest);
  check('and knows what it beat', h[0].results.find(r=>r.key.startsWith('pair:')).previousBest === 40);
  check('a day that was not a best is not marked', !h[0].results.find(r=>r.key==='t1').isBest);
  check('the first ever run is not a best', !h[1].results.some(r => r.isBest));
  check('a note is kept', h[0].feedback === 'Left hand felt loose.');
  check('results are ordered by size', h[0].results[0].value >= h[0].results[1].value);
  check('the best count is right', h[0].bests === 1, String(h[0].bests));
}

console.log('\nWhat the history refuses to invent\n');
{
  const h = buildHistory(logs(
    day('2026-07-01', {}, { completedTaskIds: [] }),
    day('2026-07-02', { t1: 10 }),
  ), ROUTINES);
  check('an empty log is not listed as practice', h.length === 1, String(h.length));
  const noted = buildHistory(logs(day('2026-07-03', {}, { completedTaskIds: [], feedback: 'Rest day.' })), ROUTINES);
  check('but a day with only a note is kept', noted.length === 1);
  const zero = buildHistory(logs(day('2026-07-04', { t1: 0, t2: -3 })), ROUTINES);
  check('zero and negative results are not shown', zero[0].results.length === 0);
  const orphan = buildHistory(logs(day('2026-07-05', { 'gone-task': 12 })), ROUTINES);
  check('a result whose task was deleted is kept, and says so',
    orphan[0].results[0].label === 'A drill since removed', orphan[0].results[0].label);
  const noRoutine = buildHistory(logs(['2026-07-06', { date:'2026-07-06', routineId:'nope', completedTaskIds:['x'], drillResults:{} }]), ROUTINES);
  check('a missing routine does not crash the day', noRoutine.length === 1 && noRoutine[0].routineName === null);
  check('an empty history is an empty list', buildHistory({}, ROUTINES).length === 0);
  check('no routines at all still works', buildHistory(logs(day('2026-07-07', { t1: 5 })), []).length === 1);
}

console.log('\nLabels\n');
{
  check('a pair key', labelForKey(pairKey('Dm','Am'), ROUTINES).label === 'Am to Dm');
  check('a task with no drill has no unit', labelForKey('t3', ROUTINES).unit === '');
  check('an unknown key is named honestly', labelForKey('zzz', ROUTINES).label === 'A drill since removed');
}

console.log('\nWeeks\n');
{
  const h = buildHistory(logs(
    day('2026-07-06', { t1: 5 }), day('2026-07-08', { t1: 5 }), day('2026-07-13', { t1: 5 }),
  ), ROUTINES);
  const w = weeklyTotals(h);
  check('days group into their week', w.length === 2, JSON.stringify(w));
  check('the first week has two', w[0].count === 2, JSON.stringify(w));
  check('weeks come back in order', w[0].week < w[1].week);
  check('a Sunday belongs to the week that started on Monday',
    weeklyTotals(buildHistory(logs(day('2026-07-12', { t1: 5 })), ROUTINES))[0].week === '2026-07-06');
}

// A month away used to produce no bars at all, so the chart drew a broken run
// of practice as an unbroken one. Time has to be continuous or it says nothing.
console.log('\nWeeks off are still weeks\n');
{
  const h = buildHistory(logs(day('2026-06-01', { t1: 5 }), day('2026-07-06', { t1: 5 })), ROUTINES);
  const w = weeklyTotals(h);
  check('the gap is drawn, not skipped', w.length === 6, JSON.stringify(w.map(x=>x.count)));
  check('and drawn as zero', w.slice(1, -1).every((x) => x.count === 0), JSON.stringify(w));
  check('the ends still hold the practice', w[0].count === 1 && w[w.length-1].count === 1);

  const trailing = weeklyTotals(h, '2026-07-27');
  check('a run that stopped keeps running to now', trailing.length === 9, String(trailing.length));
  check('and the last weeks are empty', trailing.slice(-3).every((x) => x.count === 0));
  check('a "now" already covered adds nothing', weeklyTotals(h, '2026-07-06').length === 6);
  check('a "now" in the past never truncates the history',
    weeklyTotals(h, '2026-01-01').length === 6);
  check('one practised week is one week', weeklyTotals(buildHistory(logs(day('2026-07-06',{t1:5})), ROUTINES)).length === 1);
  check('no days, no weeks', weeklyTotals([]).length === 0);
}

// The routine is read as it stands now, so an edited routine could report
// "5 of 3 done" about a day it knows nothing about.
console.log('\nWhat a day can claim about its plan\n');
{
  const full = buildHistory(logs(['2026-07-01', {
    date: '2026-07-01', routineId: 'r1', completedTaskIds: ['t1','t2'], drillResults: { t1: 9 },
  }]), ROUTINES);
  check('a plan it fits inside is reported', full[0].planned === 3 && full[0].completed === 2);

  const shrunk = buildHistory(logs(['2026-07-02', {
    date: '2026-07-02', routineId: 'r1', completedTaskIds: ['a','b','c','d','e'], drillResults: { t1: 9 },
  }]), ROUTINES);
  check('a plan smaller than the day is dropped, not printed', shrunk[0].planned === null,
    String(shrunk[0].planned));
  check('the day still says what it completed', shrunk[0].completed === 5);
}

console.log(failures===0?'\nALL PASS\n':`\n${failures} FAILURE(S)\n`);
process.exit(failures?1:0);
