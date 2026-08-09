import { allStandings, nextUp, provenChords, readEvidence, byModule, CHANGES_BAR, CHORD_BAR }
  from '../src/lib/progression.ts';
import { ALL_SKILLS } from '../src/data/skills.ts';
import { pairKey } from '../src/lib/pairs.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?' — '+d:''}`); };
const logs = (entries) => Object.fromEntries(entries.map((e, i) => {
  const date = `2026-07-${String(i + 1).padStart(2, '0')}`;
  return [date, { date, routineId: 'r1', completedTaskIds: ['t1'], drillResults: e }];
}));
const find = (st, id) => st.find(s => s.skill.id === id);

console.log('\nA learner with nothing\n');
{
  const st = allStandings({});
  check('every skill has a standing', st.length === ALL_SKILLS.length);
  check('nothing is solid', st.every(s => s.state !== 'solid'));
  check('skills with no prerequisites are ready',
    find(st, 'technique.finger-placement').state === 'ready');
  check('skills with prerequisites are locked', find(st, 'chord.D').state === 'locked');
  check('a locked skill says what is blocking it',
    find(st, 'chord.D').blockedBy.map(s=>s.id).join() === 'technique.finger-placement');
  check('nothing to work on yet is an empty list, not a crash', Array.isArray(nextUp(st)));
  check('no chords are claimed as proven', provenChords(st).length === 0);
  check('progress is zero everywhere', st.every(s => s.progress === 0));
}

console.log('\nThe owner\'s real shape: A/D/E consolidated, minors coming along\n');
{
  const st = allStandings(logs([
    { [pairKey('A','D')]: 88, [pairKey('D','E')]: 90, [pairKey('A','E')]: 75 },
    { [pairKey('Am','Em')]: 52, [pairKey('D','Em')]: 60, [pairKey('Am','E')]: 42 },
    { [pairKey('Dm','Am')]: 18, 'task-rotation': 60 },
  ]), ['technique.finger-placement']);

  check('a chord used at speed reads as solid', find(st, 'chord.A').state === 'solid',
    find(st, 'chord.A').evidence);
  check('a chord only just started is still working', find(st, 'chord.Dm').state === 'working',
    find(st, 'chord.Dm').evidence);
  check('an untouched chord is ready, not working', find(st, 'chord.C').state === 'ready',
    find(st, 'chord.C').evidence);
  check('the changes skill clears Justin\'s gate', find(st, 'changes.one-minute').state === 'solid',
    find(st, 'changes.one-minute').evidence);
  check('anchor rotation reads the task-keyed result', find(st, 'technique.anchor-fingers').best === 60,
    find(st, 'technique.anchor-fingers').evidence);
  check('proven chords are the ones actually proven',
    provenChords(st).sort().join(' ') === 'A Am D E Em', provenChords(st).sort().join(' '));
  check('Dm is not claimed as proven', !provenChords(st).includes('Dm'));

  const next = nextUp(st);
  console.log('    next up:', next.map(s => `${s.skill.id}(${Math.round(s.progress*100)}%)`).join(' '));
  check('what to work on is led by something already under way',
    next[0].state === 'working', next[0]?.skill.id);
  check('nothing already solid is offered as next', next.every(s => s.state !== 'solid'));
  check('nothing unmeasurable is offered as next',
    next.every(s => s.skill.measure.kind === 'measured'));
  check('nothing without a bar is offered as next', next.every(s => s.bar !== null),
    next.filter(s=>s.bar===null).map(s=>s.skill.id).join(' '));

  const eightGrips = find(st, 'chords.grips-review');
  check('the eight-grips review counts the chords that qualify',
    eightGrips.best === 5 && eightGrips.state !== 'solid', eightGrips.evidence);
}

console.log('\nSelf-report, for the things the app cannot hear\n');
{
  const bare = allStandings({});
  check('an unclaimed knowledge skill is not solid', find(bare, 'theory.tab').state !== 'solid');
  const claimed = allStandings({}, ['theory.tab']);
  check('claiming it makes it solid', find(claimed, 'theory.tab').state === 'solid');
  check('and the evidence says who said so',
    /you have marked/i.test(find(claimed, 'theory.tab').evidence), find(claimed, 'theory.tab').evidence);
  check('claiming does not fabricate a number', find(claimed, 'theory.tab').best === null);
  // Claiming a measurable skill is allowed: a player who has had A under their
  // hand for a year should not have to grind a drill to say so. What is not
  // allowed is the app presenting that as something it measured.
  const claimedChord = allStandings({}, ['chord.A']).find(s=>s.skill.id==='chord.A');
  check('a chord you say you have is accepted', claimedChord.state === 'solid');
  check('but it is marked as your word, not a measurement', claimedChord.source === 'claimed');
  check('and the evidence says so',
    /you have said/i.test(claimedChord.evidence), claimedChord.evidence);
  const contradicted = allStandings(logs([{ [pairKey('A','D')]: 8 }]), ['chord.A'])
    .find(s=>s.skill.id==='chord.A');
  check('a real number overrides the claim', contradicted.state !== 'solid');
  check('and the standing switches to measured', contradicted.source === 'measured', contradicted.evidence);
}

console.log('\nUnmeasurable skills say so instead of scoring zero\n');
{
  const st = allStandings({});
  const rhythm = find(st, 'rhythm.patterns');
  check('a measurable-but-unbuilt skill has no bar', rhythm.bar === null);
  check('and explains what is missing', /not measured yet/i.test(rhythm.evidence), rhythm.evidence);
  check('it is never offered as next up', !nextUp(st, 50).some(s => s.skill.id === 'rhythm.patterns'));
}

console.log('\nEdge cases\n');
{
  check('a log with no drillResults does not crash',
    allStandings({ '2026-01-01': { date:'2026-01-01', routineId:'r', completedTaskIds:[] } }).length > 0);
  check('a corrupt pair key is ignored, not fatal',
    allStandings(logs([{ 'pair:': 40, 'pair:A': 20, 'nonsense': 5 }])).length > 0);
  const ev = readEvidence(logs([{ [pairKey('A','D')]: 30 }, { [pairKey('A','D')]: 88 }]));
  check('the best across days wins, not the last', ev.pairs.get(pairKey('A','D')) === 88);
  check('practice days are counted', ev.days === 2);
  check('an unknown claimed skill is harmless', allStandings({}, ['not.a.skill']).length === ALL_SKILLS.length);
  const negative = allStandings(logs([{ [pairKey('A','D')]: -5 }]));
  check('a negative result does not read as progress',
    find(negative, 'chord.A').progress >= 0, String(find(negative, 'chord.A').progress));
}

console.log('\nGrouping by module\n');
{
  const st = allStandings(logs([{ [pairKey('A','D')]: 88 }]));
  const mods = byModule(st, ['b1-105','b1-108','b1-110','b1-402','b1-403']);
  console.log('   ', mods.map(m => `module ${m.module}: ${m.solid}/${m.total}`).join('  '));
  check('modules come back in order', mods.map(m=>m.module).join() === '1,4');
  check('a skill lands in exactly one module',
    mods.reduce((n,m)=>n+m.total,0) === new Set(mods.flatMap(m=>m.skills)).size);
  check('lessons outside the given set are ignored', byModule(st, []).length === 0);
}

console.log(failures===0?'\nALL PASS\n':`\n${failures} FAILURE(S)\n`);
process.exit(failures?1:0);
