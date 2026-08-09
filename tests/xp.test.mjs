import { computeXp, levelFor, LEVELS, XP_PER_RESULT, XP_PER_BEST, MAX_STREAK_BONUS } from '../src/lib/xp.ts';
import { evaluateAchievements, ACHIEVEMENTS } from '../src/data/achievements.ts';
import { allStandings, readEvidence } from '../src/lib/progression.ts';
import { pairKey } from '../src/lib/pairs.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?' — '+d:''}`); };
const day = (date, results, tasks = ['t1']) => [date, { date, routineId:'r1', completedTaskIds:tasks, drillResults:results }];
const logs = (...entries) => Object.fromEntries(entries);

console.log('\nPoints come from measured practice and nothing else\n');
{
  check('an empty history is zero', computeXp({}).total === 0);
  const ticksOnly = logs(day('2026-01-01', {}), day('2026-01-02', {}));
  check('ticking tasks with no drill earns nothing', computeXp(ticksOnly).total === 0);
  check('and does not build a streak', computeXp(ticksOnly).bestStreak === 0);
  const one = computeXp(logs(day('2026-01-01', { [pairKey('A','D')]: 30 })));
  check('one drill result earns the base', one.total === XP_PER_RESULT, String(one.total));
  check('the first run of a drill is a baseline, not a best', one.totalBests === 0);
  check('a zero result earns nothing',
    computeXp(logs(day('2026-01-01', { [pairKey('A','D')]: 0 }))).total === 0);
  check('a negative result earns nothing',
    computeXp(logs(day('2026-01-01', { [pairKey('A','D')]: -9 }))).total === 0);
}

console.log('\nBeating yourself is the thing worth rewarding\n');
{
  const x = computeXp(logs(
    day('2026-01-01', { [pairKey('A','D')]: 30 }),
    day('2026-01-02', { [pairKey('A','D')]: 40 }),
    day('2026-01-03', { [pairKey('A','D')]: 35 }),
  ));
  check('only the improvement counts as a best', x.totalBests === 1, String(x.totalBests));
  check('a worse day still earns the base', x.days[2].xp >= XP_PER_RESULT);
  check('the best-day total includes the bonus',
    x.days[1].xp === XP_PER_RESULT + XP_PER_BEST, String(x.days[1].xp));
}

console.log('\nStreaks\n');
{
  const run = (n) => computeXp(logs(...Array.from({length:n}, (_,i) =>
    day(`2026-03-${String(i+1).padStart(2,'0')}`, { [pairKey('A','D')]: 20 }))));
  check('a two-day run has no bonus yet', run(2).days[1].streakBonus === 0);
  check('the third day starts earning it', run(3).days[2].streakBonus > 0);
  check('the streak is measured', run(9).bestStreak === 9, String(run(9).bestStreak));
  check('the bonus is capped so a streak cannot dwarf playing',
    run(31).days.at(-1).streakBonus === MAX_STREAK_BONUS, String(run(31).days.at(-1).streakBonus));
  const broken = computeXp(logs(
    day('2026-03-01', { a: 5 }), day('2026-03-02', { a: 5 }), day('2026-03-05', { a: 5 }),
  ));
  check('a gap resets the streak', broken.bestStreak === 2, String(broken.bestStreak));
  const idleDay = computeXp(logs(
    day('2026-03-01', { a: 5 }), day('2026-03-02', {}), day('2026-03-03', { a: 5 }),
  ));
  check('a day with no measured practice breaks the streak', idleDay.bestStreak === 1, String(idleDay.bestStreak));
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

console.log('\nLevels\n');
{
  check('nothing done is level one', levelFor(0).level.number === 1);
  check('the ladder is ordered', LEVELS.every((l,i) => i===0 || l.at > LEVELS[i-1].at));
  check('the ladder starts at zero', LEVELS[0].at === 0);
  check('progress inside a level is a fraction',
    levelFor(LEVELS[1].at + 1).progress > 0 && levelFor(LEVELS[1].at + 1).progress < 1);
  check('landing exactly on a threshold is the new level',
    levelFor(LEVELS[3].at).level.number === 4);
  const top = levelFor(999999);
  check('the top of the ladder is stable', top.next === null && top.progress === 1);
  check('every level has a title that says something',
    LEVELS.every(l => l.title.length > 4 && !/level/i.test(l.title)));
}

console.log('\nAchievements\n');
{
  const build = (l) => {
    const xp = computeXp(l);
    const ev = readEvidence(l);
    const bests = new Map(ev.pairs);
    for (const [k,v] of ev.tasks) bests.set(k, v);
    return { logs: l, xp, bests, standings: allStandings(l) };
  };
  const none = evaluateAchievements(build({}));
  check('none are earned on an empty history', none.every(a => !a.earned));
  check('every achievement has a goal in the second person',
    ACHIEVEMENTS.every(a => a.goal.length > 15));
  check('ids are unique', new Set(ACHIEVEMENTS.map(a=>a.id)).size === ACHIEVEMENTS.length);

  const started = evaluateAchievements(build(logs(day('2026-05-01', { [pairKey('A','D')]: 12 }))));
  check('the first drill is earned', started.find(a=>a.id==='first-drill').earned);
  check('the gate is not', !started.find(a=>a.id==='the-gate').earned);
  check('but it reports how close', Math.abs(started.find(a=>a.id==='the-gate').progress - 0.4) < 1e-9,
    String(started.find(a=>a.id==='the-gate').progress));

  const gated = evaluateAchievements(build(logs(day('2026-05-01', { [pairKey('A','D')]: 30 }))));
  check('thirty a minute clears the gate', gated.find(a=>a.id==='the-gate').earned);

  const week = evaluateAchievements(build(logs(...Array.from({length:7}, (_,i) =>
    day(`2026-06-0${i+1}`, { [pairKey('A','D')]: 20 })))));
  check('seven days running is earned', week.find(a=>a.id==='week').earned);
  check('thirty days is not', !week.find(a=>a.id==='month').earned);
  check('progress never exceeds one', week.every(a => a.progress <= 1));
}

console.log(failures===0?'\nALL PASS\n':`\n${failures} FAILURE(S)\n`);
process.exit(failures?1:0);
