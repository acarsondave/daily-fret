// A session that runs past midnight.
//
// Two defects, one cause: the date was read on every render. A drill measured
// against one date and settled against the next, and a settle finds nothing to
// settle on a day that holds no measurement, so the day the practice actually
// happened on ended up with no record of it at all. The same clock decided
// whether a paused session could be resumed, so a session paused at 23:50 was
// unresumable ten minutes later and its saved progress was never cleared.
//
// The first half is pinned in the browser (tests/browser/midnight.mjs), where
// the render that recomputed the date actually happens. This half pins the two
// pure rules underneath it: what a split-date settle does, and when a paused
// session is still the same sitting.

import assert from 'node:assert/strict';
import { applyMeasurements, blankLog, isComplete, settle } from '../src/store/completion.ts';
import { isResumable, RESUME_WINDOW_MS } from '../src/lib/coached.ts';

let failures = 0;
const check = (label, fn) => {
  try {
    fn();
    console.log(`  ok    ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${label}: ${err.message}`);
  }
};

const EVE = '2026-08-17';
const MORNING = '2026-08-18';
const TASK = 't1';
const DRILL = 'pair:A>D';
const AT = Date.parse('2026-08-17T23:59:40Z');

console.log('\nwhy the date has to be pinned\n');

// What used to happen: the measurement lands on the evening, the settle arrives
// after a re-render and lands on the next morning.
{
  const evening = applyMeasurements(blankLog(EVE, 'r1'), TASK, [{ key: DRILL, value: 34 }], AT);
  const morning = settle(blankLog(MORNING, 'r1'), TASK);

  check('the split settle leaves the morning empty, which is correct of it', () => {
    assert.equal(isComplete(morning, TASK), false);
  });

  check('and leaves the evening unsettled, so the practice counts nowhere', () => {
    assert.equal(isComplete(evening, TASK), false);
  });
}

// What happens now: both halves belong to the date the session started on.
{
  const evening = settle(
    applyMeasurements(blankLog(EVE, 'r1'), TASK, [{ key: DRILL, value: 34 }], AT),
    TASK,
  );

  check('pinned to the start date, the evening is settled and complete', () => {
    assert.equal(isComplete(evening, TASK), true);
  });

  check('and the number is on the day it was played', () => {
    assert.equal(evening.drillResults[DRILL], 34);
  });
}

console.log('\nwhen a paused session is still the same sitting\n');

const PAUSED_AT = Date.parse('2026-08-17T23:50:00Z');
const progress = { date: EVE, startedAt: PAUSED_AT };
const minutes = (n) => PAUSED_AT + n * 60_000;

check('paused at 23:50, reopened at 23:55, on the same date', () =>
  assert.equal(isResumable(progress, minutes(5), EVE), true));

check('paused at 23:50, reopened at 00:10, the case that used to fail', () =>
  assert.equal(isResumable(progress, minutes(20), MORNING), true));

check('still waiting the next morning, eleven hours on', () =>
  assert.equal(isResumable(progress, minutes(660), MORNING), true));

check('but not a day later', () =>
  assert.equal(isResumable(progress, PAUSED_AT + RESUME_WINDOW_MS + 1, MORNING), false));

check('and not from a clock that has been set backwards', () =>
  assert.equal(isResumable(progress, PAUSED_AT - 60_000, EVE), false));

// Progress saved by a build that did not stamp a start time. It has only its
// date, so it is judged the way it always was rather than guessed at.
check('older progress still resumes on its own date', () =>
  assert.equal(isResumable({ date: EVE }, minutes(5), EVE), true));

check('and older progress from another day does not', () =>
  assert.equal(isResumable({ date: EVE }, minutes(20), MORNING), false));

console.log(failures ? `\n${failures} failed\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
