import { allStandings, nextUp, provenChords, readEvidence, lifetimeBests, CHANGES_BAR, CHORD_BAR }
  from '../src/lib/progression.ts';
import { HELD_RUNS, STALE_DAYS } from '../src/lib/readiness.ts';
import { ALL_SKILLS } from '../src/data/skills.ts';
import { pairKey } from '../src/lib/pairs.ts';
import { chordKey, poolKey, ringKey, sweepKey } from '../src/lib/drillKeys.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?' — '+d:''}`); };

// Days from a fixed start, so a history has real dates and a real gap between
// its runs. `logs([a, b, c])` is three consecutive practice days.
const START = Date.UTC(2026, 6, 1); // 2026-07-01
const iso = (offset) => new Date(START + offset * 86_400_000).toISOString().slice(0, 10);
const logs = (entries, from = 0) => Object.fromEntries(entries.map((e, i) => {
  const date = iso(from + i);
  return [date, { date, routineId: 'r1', completedTaskIds: ['t1'], drillResults: e }];
}));
/** The same result on `n` consecutive days, which is what a streak looks like. */
const repeat = (n, results) => Array.from({ length: n }, () => results);
const TODAY = iso(20);
const find = (st, id) => st.find(s => s.skill.id === id);
/**
 * Standings read the morning after the last session, which is when someone
 * actually opens this app. Blocks about evidence going cold pass their own date.
 */
const dayAfter = (l) => {
  const last = Object.keys(l).sort().pop();
  return last ? iso((Date.parse(`${last}T00:00:00Z`) - START) / 86_400_000 + 1) : TODAY;
};
const stand = (l, today = null, claimed = []) => allStandings(l, today ?? dayAfter(l), claimed);

console.log('\nA learner with nothing\n');
{
  const st = stand({});
  check('every skill has a standing', st.length === ALL_SKILLS.length);
  check('nothing is solid', st.every(s => s.state !== 'solid'));
  check('nothing is proven', st.every(s => !s.proven));
  check('skills with no prerequisites are ready',
    find(st, 'technique.finger-placement').state === 'ready');
  // finger-placement needs per-string energy the app does not have. If an
  // unmeasurable prerequisite could lock a skill, it would gate all eight chords
  // forever and the entire course would read as unavailable.
  check('an unmeasurable prerequisite does not lock anything',
    find(st, 'chord.D').state === 'ready' && find(st, 'chord.D').blockedBy.length === 0,
    `${find(st,'chord.D').state} blocked by ${find(st,'chord.D').blockedBy.map(s=>s.id).join()}`);
  check('a measurable prerequisite does lock',
    find(st, 'technique.anchor-fingers').state === 'locked' &&
    find(st, 'technique.anchor-fingers').blockedBy.map(s=>s.id).sort().join() === 'chord.A,chord.D',
    find(st,'technique.anchor-fingers').blockedBy.map(s=>s.id).join());
  check('nothing to work on yet is an empty list, not a crash', Array.isArray(nextUp(st)));
  check('no chords are claimed as proven', provenChords(st).length === 0);
  check('progress is zero everywhere', st.every(s => s.progress === 0));
}

// The whole point of the model. Every check below is the same question asked of
// a different history: how many runs does it take before the app is willing to
// say a skill is yours.
console.log('\nOne good minute is not a skill\n');
{
  const one = stand(logs([{ [pairKey('A','D')]: 88 }]));
  const a = find(one, 'chord.A');
  check('a single run miles over the bar is not solid', a.state === 'working', a.state);
  check('and the row says how many more it wants',
    /Two more at 20 or better make it held/.test(a.evidence), a.evidence);
  check('one run banks one run', a.runs === 1, String(a.runs));
  check('it is not proven either', !a.proven);
  check('nor does it unlock what sat behind it',
    find(one, 'technique.anchor-fingers').state === 'locked',
    find(one, 'technique.anchor-fingers').state);
  check('and it stays on the list of things to work on',
    nextUp(one, 40).some(s => s.skill.id === 'chord.A'));

  const two = stand(logs([{ [pairKey('A','D')]: 88 }, { [pairKey('A','D')]: 40 }]));
  check('two runs are still not solid', find(two, 'chord.A').state === 'working');
  check('but the app counts them', find(two, 'chord.A').runs === 2, String(find(two,'chord.A').runs));

  const three = stand(logs([
    { [pairKey('A','D')]: 88 }, { [pairKey('A','D')]: 40 }, { [pairKey('A','D')]: 34 },
  ]));
  const solidA = find(three, 'chord.A');
  check('the third run is the one that makes it solid', solidA.state === 'solid', solidA.state);
  check('and the evidence is the three runs, not the record',
    /88, 40 and 34/.test(solidA.evidence), solidA.evidence);
  check('the pair it was shown on is named', /With D/.test(solidA.evidence), solidA.evidence);
  check('both chords in the pair are solid', find(three, 'chord.D').state === 'solid');
  check('and only now does the skill behind them open',
    find(three, 'technique.anchor-fingers').state !== 'locked',
    find(three, 'technique.anchor-fingers').state);
  check('a solid skill is off the work list',
    !nextUp(three, 40).some(s => s.skill.id === 'chord.A'));
  check('the rule the app states is the rule it runs', HELD_RUNS === 3);
}

console.log('\nA dip resets it, and a personal best cannot carry it\n');
{
  // 22, 21, 14, 24, 26 against a bar of 20. Four of the five cleared, the run in
  // the middle did not, and two clearing runs since is not three.
  const dipped = stand(logs([
    { [pairKey('A','D')]: 22 }, { [pairKey('A','D')]: 21 }, { [pairKey('A','D')]: 14 },
    { [pairKey('A','D')]: 24 }, { [pairKey('A','D')]: 26 },
  ]));
  check('a run under the bar breaks the streak', find(dipped, 'chord.A').state === 'working',
    find(dipped, 'chord.A').evidence);
  check('and the count restarts from the dip', find(dipped, 'chord.A').runs === 2,
    String(find(dipped, 'chord.A').runs));
  // The exact defect this replaced: readEvidence took a lifetime Math.max, so
  // 88 once made the chord solid forever no matter what came after.
  const lucky = stand(logs([
    { [pairKey('A','D')]: 88 }, { [pairKey('A','D')]: 12 }, { [pairKey('A','D')]: 11 },
  ]));
  check('one lucky minute a month ago does not outrank two bad runs since',
    find(lucky, 'chord.A').state === 'working', find(lucky, 'chord.A').state);
  check('and what is reported is the latest run, not the record',
    /12 changes|11 on your last run|11 changes|^With D: 11/.test(find(lucky, 'chord.A').evidence),
    find(lucky, 'chord.A').evidence);
  check('the record is still kept, it just decides nothing',
    find(lucky, 'chord.A').best === 88, String(find(lucky, 'chord.A').best));
  check('and the bar drawn for it is not full',
    find(lucky, 'chord.A').progress < 1, String(find(lucky, 'chord.A').progress));
}

console.log('\nEvidence goes cold\n');
{
  // Held on three runs, then nothing for longer than a held result stands.
  const cold = stand(logs(repeat(3, { [pairKey('A','D')]: 30 })), iso(2 + STALE_DAYS + 1));
  const a = find(cold, 'chord.A');
  check('a held skill that has not been run in a fortnight lapses', a.state === 'lapsed', a.state);
  check('and says what brings it back',
    /One run at 20 or better brings it back/.test(a.evidence), a.evidence);
  check('it is not counted as solid', a.state !== 'solid');
  check('but it is still proven, so nothing behind it re-locks', a.proven &&
    find(cold, 'technique.anchor-fingers').state !== 'locked',
    find(cold, 'technique.anchor-fingers').state);
  check('and the song list does not take back a chord over a fortnight off',
    provenChords(cold).includes('A'));
  const next = nextUp(cold, 40);
  check('a lapsed skill is back on the work list', next.some(s => s.skill.id === 'chord.A'));
  check('and near the top of it, because one run fixes it',
    next.findIndex(s => s.skill.id === 'chord.A') < 3,
    next.slice(0,4).map(s => `${s.skill.id}(${s.state})`).join(' '));
  // One day inside the window is the same skill with the same history, and it
  // must not read differently.
  const fresh = stand(logs(repeat(3, { [pairKey('A','D')]: 30 })), iso(2 + STALE_DAYS));
  check('a day earlier it is still held', find(fresh, 'chord.A').state === 'solid');
}

console.log('\nThe owner\'s real shape: A/D/E consolidated, minors coming along\n');
{
  // Nine sessions, the way they actually accumulate: the pairs he has drilled
  // for weeks are repeated, the ones he met last week are not.
  const st = stand(logs([
    { [pairKey('A','D')]: 32, [pairKey('D','E')]: 28 },
    { [pairKey('A','D')]: 35, [pairKey('D','E')]: 31, [pairKey('A','E')]: 24 },
    { [pairKey('A','D')]: 31, [pairKey('D','E')]: 33, [pairKey('A','E')]: 26 },
    { [pairKey('A','E')]: 29, [ringKey(['D','A','E'])]: 26 },
    { [pairKey('Am','Em')]: 21, [ringKey(['D','A','E'])]: 27 },
    { [pairKey('Am','Em')]: 23, [sweepKey(['D','A','E'])]: 31 },
    { [pairKey('Am','Em')]: 22, [pairKey('D','Em')]: 19 },
    { [pairKey('Dm','Am')]: 12 },
    { [pairKey('Dm','Am')]: 14 },
  ], 5), iso(20), ['technique.finger-placement']);

  check('a chord drilled for weeks reads as solid', find(st, 'chord.A').state === 'solid',
    find(st, 'chord.A').evidence);
  check('a chord met last week is still working', find(st, 'chord.Dm').state === 'working',
    find(st, 'chord.Dm').evidence);
  check('an untouched chord is ready, not working', find(st, 'chord.C').state === 'ready',
    find(st, 'chord.C').evidence);
  check('the changes skill clears Justin\'s gate on three runs of one pair',
    find(st, 'changes.one-minute').state === 'solid', find(st, 'changes.one-minute').evidence);
  check('anchor rotation reads the rings and sweeps together',
    find(st, 'technique.anchor-fingers').state === 'solid',
    find(st, 'technique.anchor-fingers').evidence);
  check('proven chords are the ones actually shown three times',
    provenChords(st).sort().join(' ') === 'A Am D E Em', provenChords(st).sort().join(' '));
  check('Dm is not claimed as proven', !provenChords(st).includes('Dm'));

  const next = nextUp(st);
  console.log('    next up:', next.map(s => `${s.skill.id}(${s.state} ${Math.round(s.progress*100)}%)`).join(' '));
  check('there is something to work on at all', next.length > 0);
  check('what to work on is led by something already under way',
    next[0]?.state !== 'ready', next[0]?.skill.id);
  check('nothing already solid is offered as next', next.every(s => s.state !== 'solid'));
  check('nothing unmeasurable is offered as next',
    next.every(s => s.skill.measure.kind === 'measured'));
  check('nothing without a bar is offered as next', next.every(s => s.bar !== null),
    next.filter(s=>s.bar===null).map(s=>s.skill.id).join(' '));
  check('the list is ordered by how close to done each one is',
    next.every((s, i) => i === 0 || next[i-1].progress >= s.progress || next[i-1].state !== s.state),
    next.map(s => s.progress.toFixed(2)).join(' '));

  const eightGrips = find(st, 'chords.grips-review');
  check('the eight-grips review counts only the chords that are holding',
    eightGrips.best === 5 && eightGrips.state !== 'solid', eightGrips.evidence);
}

console.log('\nThree runs means three runs of the same thing\n');
{
  // Three different pairs, one run each, all over the gate. Nothing here has
  // been repeated, so nothing here is repeatable.
  const spread = stand(logs([
    { [pairKey('A','D')]: 34 }, { [pairKey('D','E')]: 33 }, { [pairKey('A','E')]: 36 },
  ]));
  check('one run each on three pairs does not clear the gate',
    find(spread, 'changes.one-minute').state !== 'solid',
    find(spread, 'changes.one-minute').evidence);
  check('nor does it make any of the chords solid',
    ['chord.A','chord.D','chord.E'].every(id => find(spread, id).state === 'working'));

  // A rotation is one drill whichever key it was written under, so the sweep it
  // is now and the ring it used to be count toward one streak.
  const rotation = stand(logs([
    { [ringKey(['D','A','E'])]: 26 },
    { [sweepKey(['D','A','E'])]: 28 },
    { [sweepKey(['D','A','E'])]: 27 },
  ]));
  check('a rotation renamed mid-history is still one drill',
    find(rotation, 'technique.anchor-fingers').state === 'solid',
    find(rotation, 'technique.anchor-fingers').evidence);

  // Two keys on one day is one day of practice. Counting it as two would let a
  // single session bank two thirds of a streak.
  const sameDay = stand(logs([
    { [ringKey(['D','A','E'])]: 26, [sweepKey(['D','A','E'])]: 28 },
    { [sweepKey(['D','A','E'])]: 27 },
  ]));
  check('two rotations in one session are one run, not two',
    find(sameDay, 'technique.anchor-fingers').runs === 2,
    String(find(sameDay, 'technique.anchor-fingers').runs));
}

console.log('\nProgress is progress toward being able to do it again\n');
{
  const at = (entries) => find(stand(logs(entries)), 'chord.A').progress;
  const none = at([{ [chordKey('A')]: 1 }]);
  const one = at([{ [pairKey('A','D')]: 30 }]);
  const two = at([{ [pairKey('A','D')]: 30 }, { [pairKey('A','D')]: 30 }]);
  const three = at(repeat(3, { [pairKey('A','D')]: 30 }));
  const under = at([{ [pairKey('A','D')]: 10 }]);
  check('a run at half the bar is about a fifth of the way', Math.abs(under - 0.125) < 1e-9,
    String(under));
  check('and each banked run moves it up', under < one && one < two && two < three,
    [under, one, two, three].map(n => n.toFixed(2)).join(' '));
  check('only three runs running fills the bar', three === 1 && two < 1,
    `${two.toFixed(2)} then ${three.toFixed(2)}`);
  check('no evidence at all is zero, not a fraction', none === 0, String(none));
}

console.log('\nSelf-report, for the things the app cannot hear\n');
{
  const bare = stand({});
  check('an unclaimed knowledge skill is not solid', find(bare, 'theory.tab').state !== 'solid');
  const claimed = stand({}, TODAY, ['theory.tab']);
  check('claiming it makes it solid', find(claimed, 'theory.tab').state === 'solid');
  check('and the evidence says who said so',
    /you have marked/i.test(find(claimed, 'theory.tab').evidence), find(claimed, 'theory.tab').evidence);
  check('claiming does not fabricate a number', find(claimed, 'theory.tab').best === null);
  // Claiming a measurable skill is allowed: a player who has had A under their
  // hand for a year should not have to grind a drill to say so. What is not
  // allowed is the app presenting that as something it measured.
  const claimedChord = find(stand({}, TODAY, ['chord.A']), 'chord.A');
  check('a chord you say you have is accepted', claimedChord.state === 'solid');
  check('but it is marked as your word, not a measurement', claimedChord.source === 'claimed');
  check('and the evidence says so',
    /you have said/i.test(claimedChord.evidence), claimedChord.evidence);
  check('a claim opens what sits behind it, or the course would stall',
    find(stand({}, TODAY, ['chord.A','chord.D']), 'technique.anchor-fingers').state !== 'locked');
  const contradicted = find(stand(logs([{ [pairKey('A','D')]: 8 }]), TODAY, ['chord.A']), 'chord.A');
  check('a real number overrides the claim', contradicted.state !== 'solid');
  check('and the standing switches to measured', contradicted.source === 'measured', contradicted.evidence);
}

console.log('\nUnmeasurable skills say so instead of scoring zero\n');
{
  const st = stand({});
  const rhythm = find(st, 'rhythm.patterns');
  check('a measurable-but-unbuilt skill has no bar', rhythm.bar === null);
  check('and explains what is missing', /not measured yet/i.test(rhythm.evidence), rhythm.evidence);
  check('it is never offered as next up', !nextUp(st, 50).some(s => s.skill.id === 'rhythm.patterns'));
}

console.log('\nEdge cases\n');
{
  check('a log with no drillResults does not crash',
    stand({ '2026-01-01': { date:'2026-01-01', routineId:'r', completedTaskIds:[] } }).length > 0);
  check('a corrupt pair key is ignored, not fatal',
    stand(logs([{ 'pair:': 40, 'pair:A': 20, 'nonsense': 5 }])).length > 0);

  const ev = readEvidence(logs([{ [pairKey('A','D')]: 30 }, { [pairKey('A','D')]: 88 }]));
  check('every run is kept, not just the best', ev.pairs.get(pairKey('A','D')).length === 2);
  check('and in the order they were played',
    ev.pairs.get(pairKey('A','D')).map(r => r.value).join() === '30,88',
    ev.pairs.get(pairKey('A','D')).map(r => r.value).join());
  // Object key order is not a promise about dates, and the rule counts back from
  // the latest run, so a history read out of order would count the wrong ones.
  const shuffled = readEvidence({
    [iso(2)]: { date: iso(2), routineId:'r', drillResults: { [pairKey('A','D')]: 31 } },
    [iso(0)]: { date: iso(0), routineId:'r', drillResults: { [pairKey('A','D')]: 12 } },
    [iso(1)]: { date: iso(1), routineId:'r', drillResults: { [pairKey('A','D')]: 22 } },
  });
  check('a history handed over out of order is sorted',
    shuffled.pairs.get(pairKey('A','D')).map(r => r.value).join() === '12,22,31',
    shuffled.pairs.get(pairKey('A','D')).map(r => r.value).join());
  check('practice days are counted', ev.days === 2);
  check('the awards still see one lifetime best per drill',
    lifetimeBests(ev).get(pairKey('A','D')) === 88, String(lifetimeBests(ev).get(pairKey('A','D'))));
  check('an unknown claimed skill is harmless', stand({}, TODAY, ['not.a.skill']).length === ALL_SKILLS.length);

  // A stored zero is a run the microphone never heard. Counting it as a failed
  // run would let a blocked mic wipe out a real streak.
  const muted = stand(logs([
    { [pairKey('A','D')]: 30 }, { [pairKey('A','D')]: 31 },
    { [pairKey('A','D')]: 0 }, { [pairKey('A','D')]: 32 },
  ]));
  check('a run the mic never heard does not break a streak',
    find(muted, 'chord.A').state === 'solid', find(muted, 'chord.A').evidence);
  const negative = stand(logs([{ [pairKey('A','D')]: -5 }]));
  check('a negative result does not read as progress',
    find(negative, 'chord.A').progress >= 0, String(find(negative, 'chord.A').progress));
  check('nor as a measurement', find(negative, 'chord.A').best === null,
    String(find(negative, 'chord.A').best));

  // Chord Perfect counts placements per block. Its number is not a change rate
  // and must never be read as one.
  const pool = stand(logs(repeat(3, { [poolKey(['A','D','E'])]: 60 })));
  check('a pool score cannot make a chord solid', find(pool, 'chord.A').state !== 'solid');
  check('nor an anchor rotation', find(pool, 'technique.anchor-fingers').state !== 'solid');
}

// Grouping by module used to be tested here against byModule, which derived the
// module from the first digit of a lesson code and was wrong for every track but
// bg1. It is gone; tests/journey.test.mjs asserts module membership against the
// curriculum, which is the thing that actually knows.

console.log(failures===0?'\nALL PASS\n':`\n${failures} FAILURE(S)\n`);
process.exit(failures?1:0);
