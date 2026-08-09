import { buildRoutine, chordsInModule, pairsToDrill, skillsInModule, routineMinutes }
  from '../src/lib/routineBuilder.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?' — '+d:''}`); };

console.log('\nWhat each module introduces\n');
check('module 1 brings D and A', chordsInModule('b1',1).sort().join(' ') === 'A D', chordsInModule('b1',1).join(' '));
check('module 2 brings E', chordsInModule('b1',2).join(' ') === 'E');
check('module 3 brings the first minors', chordsInModule('b1',3).sort().join(' ') === 'Am Em');
check('module 4 brings Dm', chordsInModule('b1',4).join(' ') === 'Dm');
check('module 5 brings C', chordsInModule('b1',5).join(' ') === 'C');
check('module 6 brings G', chordsInModule('b1',6).join(' ') === 'G');
check('module 7 brings no new shapes', chordsInModule('b1',7).length === 0);
check('an unknown module is empty, not a crash', chordsInModule('b1', 99).length === 0);
check('an unknown track is empty', chordsInModule('zz', 1).length === 0);
check('module 4 covers more than chords', skillsInModule('b1',4).length > 1,
  skillsInModule('b1',4).map(s=>s.id).join(' '));

console.log('\nWhich pairs are worth drilling\n');
{
  const p = pairsToDrill(['Dm'], ['A','D','E','Am','Em']);
  check('every new chord is paired against every known one', p.length === 5, `${p.length} pairs`);
  check('all of them involve the new shape', p.every(x => x.from==='Dm' || x.to==='Dm'));
  const two = pairsToDrill(['Am','Em'], ['A','D','E']);
  check('two new chords pair against the old ones and each other', two.length === 7, `${two.length}`);
  check('and the new pair is in there', two.some(x => [x.from,x.to].sort().join()==='Am,Em'));
  const none = pairsToDrill([], ['A','D','E']);
  check('a consolidation module drills what is already there', none.length === 3, `${none.length}`);
  check('nothing at all yields nothing, not a crash', pairsToDrill([], []).length === 0);
  check('a chord listed as both new and known is not paired with itself',
    pairsToDrill(['A'], ['A','D']).every(x => x.from !== x.to));
}

console.log('\nA routine for the module the owner is on\n');
{
  const r = buildRoutine({ track:'b1', module:4, knownChords:['A','D','E','Am','Em'] });
  console.log('   ', r.tasks.map(t => t.title).join(' > '));
  check('it has a name', r.name.length > 0, r.name);
  check('it warms up first', r.tasks[0].title.includes('stretch'), r.tasks[0].title);
  check('the new shape is drilled', r.tasks.some(t => t.drill?.kind === 'chord-trainer'));
  check('changes are drilled on pairs involving Dm',
    r.tasks.find(t => t.drill?.kind === 'one-minute-changes').drill.pairs.every(p => p.from==='Dm'||p.to==='Dm'));
  check('it does not run to a shift', r.tasks.find(t=>t.drill?.kind==='one-minute-changes').drill.pairs.length <= 3);
  check('it ends on something musical', r.tasks[r.tasks.length-1].title.includes('song'));
  check('every task has a unique id', new Set(r.tasks.map(t=>t.id)).size === r.tasks.length);
  check('the vocabulary includes old and new', r.chords.includes('Dm') && r.chords.includes('A'));
  const mins = routineMinutes(r);
  console.log(`    about ${mins} minutes`);
  check('it is a session someone would sit down for', mins >= 10 && mins <= 30, `${mins} min`);
  check('the timed rhythm task admits it is timed',
    r.tasks.some(t => /cannot hear timing/.test(t.description ?? '')));
}

console.log('\nA complete beginner, module 1\n');
{
  const r = buildRoutine({ track:'b1', module:1, knownChords:[] });
  console.log('   ', r.tasks.map(t => t.title).join(' > '));
  check('there is still a routine', r.tasks.length >= 2);
  check('it drills the two chords the module teaches',
    r.tasks.find(t=>t.drill?.kind==='chord-trainer').drill.chords.sort().join(' ') === 'A D');
  check('and the pair between them',
    r.tasks.find(t=>t.drill?.kind==='one-minute-changes').drill.pairs.length === 1);
  check('no anchor ring with only two shapes', !r.tasks.some(t=>t.drill?.kind==='chord-rotation'));
  check('minutes are sane', routineMinutes(r) >= 5 && routineMinutes(r) <= 30, `${routineMinutes(r)}`);
}

console.log('\nEdge cases\n');
{
  const consolidation = buildRoutine({ track:'b1', module:7, knownChords:['A','D','E','Am','Em','Dm','C','G'] });
  check('a module with no new chords still builds', consolidation.tasks.length >= 2,
    consolidation.tasks.map(t=>t.title).join(' > '));
  check('and drills what is there', consolidation.tasks.some(t=>t.drill?.kind==='one-minute-changes'));
  const unknown = buildRoutine({ track:'zz', module:1, knownChords:[] });
  check('an unknown track builds something rather than throwing', unknown.tasks.length >= 1);
  const named = buildRoutine({ track:'b1', module:4, knownChords:['A'], routineName:'Mornings' });
  check('a given name is used', named.name === 'Mornings');
}

console.log(failures===0?'\nALL PASS\n':`\n${failures} FAILURE(S)\n`);
process.exit(failures?1:0);
