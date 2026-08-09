import { ALL_SKILLS, getSkill, prerequisitesOf, capabilitySummary, skillsForChord, skillsForLesson }
  from '../src/data/skills.ts';
import { getLessonByCode, CURRICULUM }
  from '../src/data/curriculum.ts';
import { getChordShape } from '../src/data/chordShapes.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?' — '+d:''}`); };

console.log(`\n${ALL_SKILLS.length} skills\n`);

console.log('Integrity\n');
check('ids are unique', new Set(ALL_SKILLS.map(s=>s.id)).size === ALL_SKILLS.length);
const missingReq = ALL_SKILLS.flatMap(s => s.requires.filter(r => !getSkill(r)).map(r => `${s.id}->${r}`));
check('every prerequisite is a real skill', missingReq.length===0, missingReq.join(' '));
const badLessons = ALL_SKILLS.flatMap(s => s.lessons.filter(c => !getLessonByCode(c)).map(c => `${s.id}->${c}`));
check('every lesson code exists in the curriculum', badLessons.length===0, badLessons.join(' '));
const badChords = ALL_SKILLS.flatMap(s => (s.chords ?? []).filter(c => !getChordShape(c)).map(c => `${s.id}->${c}`));
check('every named chord has a diagram', badChords.length===0, badChords.join(' '));
check('every skill has a summary', ALL_SKILLS.every(s => s.summary.length > 10));

// A cycle would make prerequisitesOf loop or a coach recurse forever.
const cycles = [];
for (const s of ALL_SKILLS) {
  if (prerequisitesOf(s.id).some(p => p.id === s.id)) cycles.push(s.id);
}
check('no skill requires itself, directly or through a chain', cycles.length===0, cycles.join(' '));
check('prerequisitesOf is stable for an unknown id', prerequisitesOf('nope.nope').length === 0);
check('prerequisitesOf walks the whole chain',
  prerequisitesOf('rhythm.six-eight').map(s=>s.id).includes('chord.A'),
  prerequisitesOf('rhythm.six-eight').map(s=>s.id).join(' '));

console.log('\nMeasure shapes\n');
for (const s of ALL_SKILLS) {
  const m = s.measure;
  const ok = m.kind === 'measured' ? Boolean(m.drill && m.metric)
    : m.kind === 'measurable' ? Boolean(m.needs && m.metric)
    : Boolean(m.why);
  if (!ok) check(`${s.id} measure is complete`, false, JSON.stringify(m));
}
check('every measure carries its required fields', true);
const DRILLS = ['one-minute-changes','chord-trainer','song','chord-rotation','tuner'];
const badDrill = ALL_SKILLS.filter(s => s.measure.kind==='measured' && !DRILLS.includes(s.measure.drill));
check('every measured skill names a drill kind that exists', badDrill.length===0,
  badDrill.map(s=>`${s.id}:${s.measure.drill}`).join(' '));

console.log('\nCoverage of Grade 1\n');
const g1 = CURRICULUM.tracks.find(t => t.code === 'b1');
const g1Lessons = g1.modules.flatMap(m => m.lessons)
  .map(slug => CURRICULUM.lessons.find(l => l.slug === slug).code);
const covered = new Set(ALL_SKILLS.flatMap(s => s.lessons));
const uncovered = g1Lessons.filter(c => !covered.has(c));
console.log(`  ${g1Lessons.length - uncovered.length} of ${g1Lessons.length} Grade 1 lessons map to a skill`);
console.log(`  uncovered: ${uncovered.join(' ')}`);
check('at least three quarters of Grade 1 maps to a skill',
  (g1Lessons.length - uncovered.length) / g1Lessons.length >= 0.75);

console.log('\nCapability map\n');
const cap = capabilitySummary();
for (const [k, v] of Object.entries(cap)) console.log(`  ${k.padEnd(11)} ${v}`);
check('something is measured today', cap.measured > 0);
check('the work list is not empty', cap.measurable > 0);
check('the totals add up', Object.values(cap).reduce((a,b)=>a+b,0) === ALL_SKILLS.length);

console.log('\n  measurable, and what each needs:');
for (const s of ALL_SKILLS.filter(s => s.measure.kind === 'measurable')) {
  console.log(`    ${s.id.padEnd(28)} ${s.measure.needs.slice(0, 78)}`);
}

console.log('\nLookups\n');
check('skillsForChord finds the Dm work', skillsForChord('Dm').some(s => s.id === 'chord.Dm'));
check('skillsForLesson finds the metronome lesson', skillsForLesson('b1-403').some(s => s.id === 'rhythm.metronome'));
check('an unknown chord returns nothing rather than throwing', skillsForChord('Zdim').length === 0);

console.log(failures===0?'\nALL PASS\n':`\n${failures} FAILURE(S)\n`);
process.exit(failures?1:0);
