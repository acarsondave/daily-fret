// Everything the app shows about progress is derived from the daily logs on
// every render rather than stored. That is the right call — a stored total can
// drift from what someone actually did — but it makes the cost of deriving a
// standing property of the product, not an implementation detail. This suite
// holds that cost to something a phone can absorb between frames.
//
// Five years of daily practice is the shape to hold up against: someone who
// stays is exactly the person whose history gets long, and they are the last
// person the app should get slow for.

import { computeXp, levelFor, restAdvice } from '../src/lib/xp.ts';
import { allStandings, nextUp, provenChords, readEvidence } from '../src/lib/progression.ts';
import { buildHistory, weeklyTotals } from '../src/lib/history.ts';
import { evaluateAchievements } from '../src/data/achievements.ts';
import { nudgeDecision, DEFAULT_REMINDER } from '../src/lib/reminders.ts';
import { pairKey } from '../src/lib/pairs.ts';
import { ALL_SKILLS } from '../src/data/skills.ts';
import { trackModules } from '../src/data/curriculum.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?' — '+d:''}`); };
const time = (fn) => { const t0 = performance.now(); const out = fn(); return [out, performance.now() - t0]; };

const CHORDS = ['A', 'D', 'E', 'Am', 'Em', 'G', 'C', 'Dm', 'F'];
const DAYS = 1825; // five years

// A history with the shape a real one has: several pairs a day, a couple of
// task drills, results that drift upward, and days that were missed.
const logs = {};
const routines = [{
  id: 'r1', name: 'Daily', description: '', isDefault: true,
  tasks: [
    { id: 't1', title: 'Chord Perfect', drill: { kind: 'chord-trainer', durationSec: 90, chords: CHORDS } },
    { id: 't2', title: 'Anchors', drill: { kind: 'chord-rotation', durationSec: 60, chords: ['A', 'D', 'E'] } },
    { id: 't3', title: 'Spider walk' },
  ],
}];

{
  const start = new Date('2021-01-01T12:00:00Z');
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    if (i % 9 === 7) { // a missed day roughly weekly
      logs[date] = { date, routineId: 'r1', completedTaskIds: [] };
      continue;
    }
    const drillResults = {};
    for (let p = 0; p < 4; p++) {
      const a = CHORDS[(i + p) % CHORDS.length];
      const b = CHORDS[(i + p + 1) % CHORDS.length];
      drillResults[pairKey(a, b)] = 10 + Math.floor(i / 30) + p;
    }
    drillResults.t1 = 8 + Math.floor(i / 45);
    drillResults.t2 = 12 + Math.floor(i / 60);
    logs[date] = {
      date, routineId: 'r1', completedTaskIds: ['t1', 't2'], drillResults,
      ...(i % 20 === 0 ? { feedback: 'Left hand felt loose today.' } : {}),
    };
  }
}

const dayCount = Object.keys(logs).length;
const resultCount = Object.values(logs).reduce((n, l) => n + Object.keys(l.drillResults ?? {}).length, 0);

console.log(`\nFive years of practice: ${dayCount} days, ${resultCount} recorded results\n`);

console.log('\nPoints and levels\n');
{
  const [xp, ms] = time(() => computeXp(logs));
  check('every day is replayed', xp.days.length > 1500, String(xp.days.length));
  check('the total is real', xp.total > 0);
  check('a best streak was found', xp.bestStreak >= 6, String(xp.bestStreak));
  check('replay stays under 60ms', ms < 60, `${ms.toFixed(1)}ms`);

  const [, again] = time(() => computeXp(logs));
  check('and is not accidentally quadratic on a second pass', again < 60, `${again.toFixed(1)}ms`);

  const [lvl] = time(() => levelFor(xp.total));
  check('the level resolves', lvl.level >= 1, String(lvl.level));
  check('and lands in a named band', lvl.band.title.length > 4, lvl.band.title);
  check('progress stays in range', lvl.progress >= 0 && lvl.progress <= 1);

  check('the breakdown adds up to the total, five years deep',
    Object.values(xp.source).reduce((a, b) => a + b, 0) === xp.total, `${xp.total}`);
  const [advice, adviceMs] = time(() => restAdvice(logs, '2025-12-31'));
  check('rest advice does not walk the whole history', adviceMs < 40, `${adviceMs.toFixed(1)}ms`);
  check('and returns a run', advice.run >= 0);
}

console.log('\nCompetence\n');
{
  const [evidence, evMs] = time(() => readEvidence(logs));
  check('evidence is gathered under 60ms', evMs < 60, `${evMs.toFixed(1)}ms`);
  check('pairs were found', evidence.pairs.size > 0, String(evidence.pairs.size));

  const [standings, stMs] = time(() => allStandings(logs, []));
  check('every skill gets a standing', standings.length === ALL_SKILLS.length, String(standings.length));
  check('standings resolve under 80ms', stMs < 80, `${stMs.toFixed(1)}ms`);

  const [proven] = time(() => provenChords(standings));
  check('chords come out proven after five years', proven.length > 0, proven.join(' '));
  const [next] = time(() => nextUp(standings, 12));
  check('next-up never exceeds what was asked for', next.length <= 12, String(next.length));
  const codes = trackModules('bg1').flatMap((m) => m.lessons.map((l) => l.code));
  check('the beginner course still resolves its lesson codes', codes.length > 100, String(codes.length));
}

console.log('\nHistory\n');
{
  const [history, hMs] = time(() => buildHistory(logs, routines));
  check('every practised day is readable', history.length > 1500, String(history.length));
  check('built under 80ms', hMs < 80, `${hMs.toFixed(1)}ms`);
  check('newest first', history[0].date > history[history.length - 1].date);
  check('a day carries its results', history[0].results.length > 0);

  const [weeks, wMs] = time(() => weeklyTotals(history));
  check('weeks are charted under 40ms', wMs < 40, `${wMs.toFixed(1)}ms`);
  check('five years is about 260 weeks', weeks.length > 200 && weeks.length < 400, String(weeks.length));
}

console.log('\nAwards\n');
{
  const xp = computeXp(logs);
  const evidence = readEvidence(logs);
  const bests = new Map(evidence.pairs);
  for (const [k, v] of evidence.tasks) bests.set(k, v);
  const standings = allStandings(logs, []);

  const [earned, aMs] = time(() => evaluateAchievements({ xp, bests, standings }));
  check('every award is evaluated', earned.length >= 9, String(earned.length));
  // The "twenty days in a month" award scans a sliding window over every
  // practised day. With five years of them that is the one with room to go
  // quadratic, so it is the one worth timing.
  check('including the sliding-window one, under 80ms', aMs < 80, `${aMs.toFixed(1)}ms`);
  check('progress never exceeds one', earned.every((a) => a.progress >= 0 && a.progress <= 1));
  check('some are earned after five years', earned.some((a) => a.earned));
}

console.log('\nThe reminder decision, which runs on every visit\n');
{
  const [, nMs] = time(() => nudgeDecision(logs, DEFAULT_REMINDER, '2026-01-01', 23 * 60));
  // Bounded at ten days by design: this one is called on a timer, so walking
  // the whole history here would be a cost paid twice a minute forever.
  check('bounded regardless of history length', nMs < 5, `${nMs.toFixed(2)}ms`);
}

console.log('\nThe whole Progress panel in one go\n');
{
  const [, total] = time(() => {
    const xp = computeXp(logs);
    const evidence = readEvidence(logs);
    const bests = new Map(evidence.pairs);
    for (const [k, v] of evidence.tasks) bests.set(k, v);
    const standings = allStandings(logs, []);
    evaluateAchievements({ xp, bests, standings });
    weeklyTotals(buildHistory(logs, routines));
    return null;
  });
  // Everything Progress shows, derived from scratch. Memoisation means this is
  // paid once per change to the logs rather than per render, but it still has
  // to fit inside an interaction someone is watching.
  check('everything derives in under 200ms', total < 200, `${total.toFixed(1)}ms`);
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
