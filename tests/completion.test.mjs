// What it takes for a task to count as done.
//
// The app listens to a guitar and times drills, and then used to ask the player
// to confirm they had practised. Everything downstream treated that tick as
// evidence, which it never was. These are the rules that replaced it, and the
// cases worth pinning are all the awkward ones: a drill left half-way, a minute
// where the microphone heard nothing, the same drill run twice, and the player
// disagreeing with the record.

import {
  applyMeasurement,
  applyMeasurements,
  applyStated,
  applyTime,
  blankLog,
  clearRecord,
  isComplete,
  recordFor,
  runsFor,
  settle,
  MIN_RECORDED_SECONDS,
} from '../src/store/completion.ts';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail ? `: ${detail}` : ''}`);
};

const AT = 1_700_000_000_000;
// Every measurement states the key it belongs under. There is no longer a
// default, because the default used to be the task id and that is the whole
// defect: a number filed under a row of a list stops meaning anything the
// moment the list is rebuilt.
const POOL = 'pool:A|D|E';
const fresh = () => blankLog('2026-08-09', 'r1');
const ran = (seconds, reachedEnd, done = reachedEnd) => ({
  elapsedSeconds: seconds,
  reachedEnd,
  done,
});

console.log('\nA drill the app heard\n');
{
  let log = applyMeasurement(fresh(), 't1', { key: 'pair:A|D', value: 42 }, AT);
  check('the number is kept under its own key', log.drillResults['pair:A|D'] === 42);
  check('and the task is not done on the strength of one pair', !isComplete(log, 't1'));
  check('the evidence says it was measured', recordFor(log, 't1').evidence === 'measured');

  log = settle(log, 't1');
  check('settling a measured task completes it', isComplete(log, 't1'));

  const again = settle(log, 't1');
  check('settling twice changes nothing', again.completedTaskIds.length === 1);
}

console.log('\nA minute where nothing was heard\n');
{
  let log = applyMeasurement(fresh(), 't1', { key: POOL, value: 0 }, AT);
  check('no result is written', log.drillResults === undefined);
  check('but the attempt is on the record', recordFor(log, 't1').evidence === 'silent');
  log = settle(log, 't1');
  check('and it does not count as practice', !isComplete(log, 't1'));
}

console.log('\nThe same drill, run twice\n');
{
  let log = applyMeasurement(fresh(), 't1', { key: POOL, value: 40 }, AT);
  log = applyMeasurement(log, 't1', { key: POOL, value: 31 }, AT + 60_000);
  check('the better number stands', log.drillResults[POOL] === 40);
  check('and the day says when it was last run', recordFor(log, 't1').at === AT + 60_000);

  const silent = applyMeasurement(log, 't1', { key: POOL, value: 0 }, AT + 120_000);
  check('a later silent run cannot erase what was heard',
    recordFor(silent, 't1').evidence === 'measured');
  check('and cannot delete the number either', silent.drillResults[POOL] === 40);
}

console.log('\nEvery run, not just the best one\n');
{
  let log = applyMeasurement(fresh(), 't1', { key: POOL, value: 38 }, AT);
  log = applyMeasurement(log, 't1', { key: POOL, value: 41 }, AT + 60_000);
  log = applyMeasurement(log, 't1', { key: POOL, value: 39 }, AT + 120_000);
  const runs = runsFor(log, POOL);
  check('three runs are three runs', runs.length === 3);
  check('in the order they happened', runs.map((r) => r.value).join() === '38,41,39');
  check('each carrying when it was', runs[1].at === AT + 60_000);
  check('while the day still summarises to its best', log.drillResults[POOL] === 41);

  const silent = applyMeasurement(log, 't1', { key: POOL, value: 0 }, AT + 180_000);
  check('a run nothing was heard in is not counted as a run',
    runsFor(silent, POOL).length === 3);

  const old = { date: '2026-01-04', routineId: 'r1', completedTaskIds: [], drillResults: { t1: 30 } };
  const reconstructed = runsFor(old, 't1');
  check('an old day still answers the question', reconstructed.length === 1);
  check('at the value it recorded', reconstructed[0].value === 30);
  check('and admits it does not know when', reconstructed[0].at === undefined);
  check('a day with nothing recorded has no runs', runsFor(fresh(), 't1').length === 0);
}

console.log('\nA task the microphone will never hear\n');
{
  const full = settle(applyTime(fresh(), 't2', ran(300, true), AT), 't2');
  check('a timer that ran out completes the task', isComplete(full, 't2'));
  check('with the time it ran for', recordFor(full, 't2').seconds === 300);
  check('recorded as timed, not as measured', recordFor(full, 't2').evidence === 'timed');
  check('and not as anything the player asserted', recordFor(full, 't2').stated === undefined);

  const skipped = settle(applyTime(fresh(), 't2', ran(190, false), AT), 't2');
  check('skipping is not doing', !isComplete(skipped, 't2'));
  check('but the time really spent is kept', recordFor(skipped, 't2').seconds === 190);
  check('and the day knows the clock never ran out', recordFor(skipped, 't2').ranToEnd === false);
}

console.log('\nCounting a short block anyway\n');
{
  const counted = applyTime(fresh(), 't2', ran(190, false, true), AT);
  check('it is filed as the player\'s word', recordFor(counted, 't2').stated === true);
  check('and not as a clock that ran out', recordFor(counted, 't2').ranToEnd === false);
  check('settling then completes it', isComplete(settle(counted, 't2'), 't2'));
}

console.log('\nWalking straight back out\n');
{
  const nothing = applyTime(fresh(), 't2', ran(MIN_RECORDED_SECONDS - 1, false), AT);
  check('a couple of seconds is not a record', recordFor(nothing, 't2') === undefined);

  const enough = applyTime(fresh(), 't2', ran(MIN_RECORDED_SECONDS, false), AT);
  check('long enough to mean something is', recordFor(enough, 't2').seconds === MIN_RECORDED_SECONDS);
}

console.log('\nTime adding up across runs\n');
{
  let log = applyTime(fresh(), 't2', ran(120, false), AT);
  log = applyTime(log, 't2', ran(180, true), AT + 1000);
  check('the seconds sum', recordFor(log, 't2').seconds === 300);
  check('and one run reaching the end is enough', recordFor(log, 't2').ranToEnd === true);
}

console.log('\nMeasured beats timed\n');
{
  let log = applyMeasurement(fresh(), 't1', { key: POOL, value: 44 }, AT);
  log = applyTime(log, 't1', ran(60, true), AT + 1000);
  check('a timer cannot demote a measurement', recordFor(log, 't1').evidence === 'measured');
  check('though the time is still counted', recordFor(log, 't1').seconds === 60);
}

console.log('\nThe player correcting the record\n');
{
  const stated = applyStated(fresh(), 't3', AT);
  check('saying so does not complete on its own', !isComplete(stated, 't3'));
  check('it is stored as their word', recordFor(stated, 't3').stated === true);
  check('with no evidence claimed', recordFor(stated, 't3').evidence === undefined);
  check('and settling completes it', isComplete(settle(stated, 't3'), 't3'));

  const measured = settle(applyMeasurement(fresh(), 't1', { key: POOL, value: 40 }, AT), 't1');
  const cleared = clearRecord(measured, 't1');
  check('clearing takes the completion back', !isComplete(cleared, 't1'));
  check('and forgets how it came about', recordFor(cleared, 't1') === undefined);
  check('but never deletes what was heard', cleared.drillResults[POOL] === 40);
  check('leaving no empty map behind', !('taskRecords' in cleared));

  const twoTasks = clearRecord(applyStated(applyStated(fresh(), 'a', AT), 'b', AT), 'a');
  check('clearing one leaves the other', Object.keys(twoTasks.taskRecords).join() === 'b');
}

console.log('\nA day recorded before any of this existed\n');
{
  const old = { date: '2026-01-04', routineId: 'r1', completedTaskIds: ['t1'], drillResults: { t1: 20 } };
  check('an old completion is still a completion', isComplete(old, 't1'));
  check('with nothing invented about how it happened', recordFor(old, 't1') === undefined);
  check('and settling makes no claim on it', settle(old, 't1') === old);

  const touched = settle(applyMeasurement(old, 't1', { key: POOL, value: 25 }, AT), 't1');
  check('the number it was recorded with is left exactly where it was',
    touched.drillResults.t1 === 20);
  check('and today lands under the key that names what was played',
    touched.drillResults[POOL] === 25);
  check('without duplicating the completion', touched.completedTaskIds.length === 1);
}

console.log('\nOne run of a drill that measured several things\n');
{
  // Chord Perfect: a block score across its pool, and what each shape earned.
  const log = applyMeasurements(fresh(), 't1', [
    { key: POOL, value: 21 },
    { key: 'chord:A', value: 9 },
    { key: 'chord:D', value: 12 },
    { key: 'chord:E', value: 0 },
  ], AT);
  check('every number lands under its own key',
    log.drillResults[POOL] === 21 && log.drillResults['chord:A'] === 9
      && log.drillResults['chord:D'] === 12);
  check('a shape nothing was heard on is not given a zero',
    log.drillResults['chord:E'] === undefined);
  check('and one run is one run for each of them',
    runsFor(log, POOL).length === 1 && runsFor(log, 'chord:A').length === 1);
  check('the task is measured, on the strength of what was heard',
    recordFor(log, 't1').evidence === 'measured');
  check('and they all share the run\'s timestamp', recordFor(log, 't1').at === AT);
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
