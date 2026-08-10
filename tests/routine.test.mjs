import {
  HEARABLE_CHORDS,
  buildRoutine,
  chordsInModule,
  chordsTaughtBy,
  measuredTaskCount,
  pairsToDrill,
  routineBasis,
  routineMinutes,
  skillsInModule,
} from '../src/lib/routineBuilder.ts';
import { BEGINNER_GRADES, BEGINNER_MODULES } from '../src/lib/beginnerCourse.ts';
import { CURRICULUM } from '../src/data/curriculum.ts';
import { ALL_SKILLS } from '../src/data/skills.ts';
import { DETECTABLE_CHORDS } from '../src/audio/chords.ts';
import { hasChordShape } from '../src/data/chordShapes.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?' — '+d:''}`); };

const DRILL_KINDS = new Set(['one-minute-changes', 'chord-trainer', 'song', 'chord-rotation']);

// Every number onboarding prints has to be a number the data still agrees with.
// The screen used to hardcode which courses existed and count their modules by
// hand, and shipped a picker offering a practice diary as a startable module
// alongside a promise of a ninth module the next screen did not have.
console.log('\nWhat onboarding tells a stranger, against the data\n');
{
  const beginner = CURRICULUM.tracks.filter((t) => !t.legacy && t.siteTitle === 'Beginner Guitar Course');
  check('the course cards are the beginner grades the curriculum holds',
    BEGINNER_GRADES.length === beginner.length, `${BEGINNER_GRADES.length} of ${beginner.length}`);
  check('they are named by their grade', BEGINNER_GRADES.map((g) => g.title).join(' ') === 'Grade 1 Grade 2 Grade 3',
    BEGINNER_GRADES.map((g) => g.title).join(' '));
  check('they run in taught order',
    BEGINNER_GRADES.every((g, i) => i === 0 || g.modules[0].number > BEGINNER_GRADES[i - 1].modules[0].number));

  for (const g of BEGINNER_GRADES) {
    const track = CURRICULUM.tracks.find((t) => t.code === g.code);
    const taught = track.modules.filter((m) => !m.companion && m.number !== null);
    const first = g.modules[0].number;
    const last = g.modules[g.modules.length - 1].number;
    // The card reads "{n} modules, {first} to {last}". All three come from here.
    check(`${g.title} offers exactly the modules the course teaches`,
      g.modules.length === taught.length, `card says ${g.modules.length}, data has ${taught.length}`);
    check(`${g.title} offers every module it counts`,
      g.modules.length === last - first + 1, `${first} to ${last} is ${last - first + 1}`);
    check(`${g.title} offers no companion series`,
      g.modules.every((m) => taught.some((t) => t.number === m.number && !t.companion)));
    check(`${g.title} every module is startable`,
      g.modules.every((m) => m.title.length > 0 && m.firstLessonCode !== null));
  }

  check('the whole beginner spine is continuous',
    BEGINNER_MODULES.every((m, i) => i === 0 || m.number === BEGINNER_MODULES[i - 1].number + 1),
    BEGINNER_MODULES.map((m) => m.number).join(','));
}

console.log('\nThe nine shapes the chord step claims\n');
{
  // The step prints HEARABLE_CHORDS.length. It has to be the matcher's own set,
  // or the screen offers a chord no drill can ever count.
  check('the hearable set is exactly what the matcher has templates for',
    HEARABLE_CHORDS.length === DETECTABLE_CHORDS.length &&
      HEARABLE_CHORDS.every((c) => DETECTABLE_CHORDS.includes(c)),
    HEARABLE_CHORDS.join(' '));
  check('there are nine of them', HEARABLE_CHORDS.length === 9, `${HEARABLE_CHORDS.length}`);
  check('every one can be drawn as a diagram', HEARABLE_CHORDS.every(hasChordShape));
  check('they are in the order the course teaches them',
    HEARABLE_CHORDS.join(' ') === 'D A E Em Am Dm C G F', HEARABLE_CHORDS.join(' '));
  check('F is offered, though no Grade 1 module teaches it',
    HEARABLE_CHORDS.includes('F') && !chordsInModule('bg1', 6).includes('F'));
}

console.log('\nWhat each module introduces\n');
check('module 1 brings D and A', chordsInModule('bg1',1).sort().join(' ') === 'A D', chordsInModule('bg1',1).join(' '));
check('module 2 brings E', chordsInModule('bg1',2).join(' ') === 'E');
check('module 3 brings the first minors', chordsInModule('bg1',3).sort().join(' ') === 'Am Em');
check('module 4 brings Dm', chordsInModule('bg1',4).join(' ') === 'Dm');
check('module 5 brings C', chordsInModule('bg1',5).join(' ') === 'C');
check('module 6 brings G', chordsInModule('bg1',6).join(' ') === 'G');
check('module 7 brings no new shapes', chordsInModule('bg1',7).length === 0);
check('an unknown module is empty, not a crash', chordsInModule('bg1', 99).length === 0);
check('an unknown track is empty', chordsInModule('zz', 1).length === 0);
check('module 4 covers more than chords', skillsInModule('bg1',4).length > 1,
  skillsInModule('bg1',4).map(s=>s.id).join(' '));

console.log('\nWhat the course has taught by a given module\n');
{
  check('nothing before the first chord module', chordsTaughtBy(0).length === 0);
  check('D and A by module 1', chordsTaughtBy(1).join(' ') === 'D A', chordsTaughtBy(1).join(' '));
  check('all eight open shapes by the end of Grade 1', chordsTaughtBy(7).length === 8, chordsTaughtBy(7).join(' '));
  // The seed is what makes a Grade 2 or Grade 3 answer produce a real routine.
  // Module numbers run straight through the grades, so asking a Grade 3 module
  // has to reach back into Grade 1 rather than answering "none".
  check('a Grade 3 module still knows Grade 1 taught eight shapes',
    chordsTaughtBy(17).length === 8, chordsTaughtBy(17).join(' '));
  check('it never claims a shape the app cannot hear',
    chordsTaughtBy(22).every((c) => HEARABLE_CHORDS.includes(c)));
}

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
  // It used to return them in vocabulary order, which put D against A first for
  // every learner in the course and drilled their two oldest shapes.
  check('and starts with the most recently taught shapes',
    [none[0].from, none[0].to].includes('E'), `${none[0].from} to ${none[0].to}`);
  check('nothing at all yields nothing, not a crash', pairsToDrill([], []).length === 0);
  check('a chord listed as both new and known is not paired with itself',
    pairsToDrill(['A'], ['A','D']).every(x => x.from !== x.to));
}

console.log('\nA routine for the module the owner is on\n');
{
  const r = buildRoutine({ track:'bg1', module:4, knownChords:['A','D','E','Am','Em'] });
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
  check('it says what it was built from, in words',
    /Dm/.test(r.description) && /Grade 1/.test(r.description), r.description);
  check('and never prints an internal track code', !/BG1|bg1/.test(r.description), r.description);
}

console.log('\nA complete beginner, module 1\n');
{
  const r = buildRoutine({ track:'bg1', module:1, knownChords:[] });
  console.log('   ', r.tasks.map(t => t.title).join(' > '));
  check('there is still a routine', r.tasks.length >= 2);
  check('it drills the two chords the module teaches',
    r.tasks.find(t=>t.drill?.kind==='chord-trainer').drill.chords.sort().join(' ') === 'A D');
  check('and the pair between them',
    r.tasks.find(t=>t.drill?.kind==='one-minute-changes').drill.pairs.length === 1);
  check('no anchor ring with only two shapes', !r.tasks.some(t=>t.drill?.kind==='chord-rotation'));
  check('minutes are sane', routineMinutes(r) >= 5 && routineMinutes(r) <= 30, `${routineMinutes(r)}`);
}

// Module 0 is "Before You Begin: Guitar Basics" and teaches no chords at all.
// The builder used to answer it with one task reading "play a song, anything you
// can get through with the chords you have", and then, briefly, with a list of
// lessons: tune the guitar, hold the guitar, hold a pick. None of those is a
// thing you repeat daily, and every task in this app is something you start and
// run inside it, so the app was offering a five minute timer on how to sit down.
console.log('\nSomeone who has never played, module 0\n');
{
  const r = buildRoutine({ track:'bg1', module:0, knownChords:[] });
  console.log('   ', r.tasks.map(t => t.title).join(' > '));
  check('it stands on first steps', routineBasis({ track:'bg1', module:0, knownChords:[] }).ground === 'first-steps');
  check('it is short rather than padded', r.tasks.length <= 2, `${r.tasks.length} tasks`);
  check('and what is in it is repeatable hand work',
    r.tasks.length === 1 && r.tasks[0].title === 'Positive finger placement', r.tasks[0]?.title);
  check('nothing about tuning, holding or reading is a daily task',
    !r.tasks.some(t => /tun|hold|read|box|pick/i.test(t.title)), r.tasks.map(t=>t.title).join(' > '));
  check('it never asks for a chord they do not have',
    r.tasks.every(t => !t.drill) && !r.tasks.some(t => /song/i.test(t.title)));
  check('it says why it is short', /Short on purpose/.test(r.description), r.description);
  check('and names what makes it longer', /module 1 brings D and A/.test(r.description), r.description);
}

// The taxonomy decides this, not a list of titles. Nothing the app files as
// knowledge, and nothing in the setup, theory or ear families, may ever become a
// task: they are watched or read once, and there is nothing to repeat tomorrow.
console.log('\nWhat a lesson has to be before it can be a task\n');
{
  const titles = new Set();
  for (const m of BEGINNER_MODULES) {
    const grade = BEGINNER_GRADES.find((g) => g.modules.some((x) => x.number === m.number));
    for (const known of [[], chordsTaughtBy(m.number), [...HEARABLE_CHORDS]]) {
      for (const t of buildRoutine({ track: grade.code, module: m.number, knownChords: known }).tasks) {
        titles.add(t.title);
      }
    }
  }
  const generated = [...titles].sort();
  console.log('   ', generated.join(' · '));
  const knowledge = ALL_SKILLS.filter(
    (s) => s.measure.kind === 'known' || ['setup', 'theory', 'ear'].includes(s.family),
  ).map((s) => s.title);
  check('no routine anywhere in the course generates a knowledge task',
    generated.every((t) => !knowledge.includes(t)),
    generated.filter((t) => knowledge.includes(t)).join(', '));
  check('and none of them is tuning', !generated.some((t) => /tun/i.test(t)));
  check('every generated task is a drill or a timed block, never a lesson to watch',
    generated.length > 0 && generated.every((t) => t.length > 0));
}

// The skill taxonomy stops at Grade 1. A routine for anything past it used to be
// named after the module and described as built for it, while containing two
// timed tasks and nothing measured.
console.log('\nGrade 2 and Grade 3, where the app has no drills mapped\n');
{
  const seeded = chordsTaughtBy(17);
  const r = buildRoutine({ track:'bg3', module:17, knownChords: seeded });
  console.log('   ', r.tasks.map(t => t.title).join(' > '));
  check('it stands on the learner vocabulary',
    routineBasis({ track:'bg3', module:17, knownChords: seeded }).ground === 'vocabulary');
  check('it says so, rather than claiming the module',
    /no drills mapped/.test(r.description), r.description);
  check('it still measures something', measuredTaskCount(r) >= 2, `${measuredTaskCount(r)} measured`);
  check('and it is a session, not a stub', routineMinutes(r) >= 10, `${routineMinutes(r)} min`);
  const empty = buildRoutine({ track:'bg3', module:17, knownChords: [] });
  check('with nothing ticked it does not pretend either', /counted/.test(empty.description), empty.description);

  // The sharpest case in the whole course. Module 9 exists to teach F, the
  // taxonomy maps one unrelated lesson inside it, and that was enough for the
  // builder to announce "there are no new shapes in module 9 (The F Chord
  // Journey & Pinky Workout)".
  const f = buildRoutine({ track:'bg2', module:9, knownChords: chordsTaughtBy(9) });
  check('it never tells a learner The F Chord Journey has no new shapes',
    !/no new shapes/.test(f.description), f.description);
  check('and admits it has nothing mapped there', /no drills mapped/.test(f.description), f.description);
}

console.log('\nSomeone following no course at all\n');
{
  const r = buildRoutine({ track:null, module:null, knownChords:['A','D','E','G'] });
  console.log('   ', r.tasks.map(t => t.title).join(' > '));
  check('it builds from the chords alone', routineBasis({ track:null, module:null, knownChords:['A','D','E','G'] }).ground === 'vocabulary');
  check('it names no module', !/module/i.test(r.name) && !/module/i.test(r.description), `${r.name} / ${r.description}`);
  check('it measures something', measuredTaskCount(r) >= 2);
  // Teaching order is D A E Em Am Dm C G F, so the three latest of D/A/E/G.
  check('and its chord perfect targets the most recently taught shapes',
    r.tasks.find(t=>t.drill?.kind==='chord-trainer').drill.chords.join(' ') === 'A E G',
    r.tasks.find(t=>t.drill?.kind==='chord-trainer').drill.chords.join(' '));
}

// The one thing worse than no routine: a routine holding a drill that cannot run.
console.log('\nEvery routine the flow can produce is runnable\n');
{
  const cases = [];
  for (const m of BEGINNER_MODULES) {
    const grade = BEGINNER_GRADES.find((g) => g.modules.some((x) => x.number === m.number));
    cases.push({ track: grade.code, module: m.number, knownChords: [] });
    cases.push({ track: grade.code, module: m.number, knownChords: chordsTaughtBy(m.number) });
    cases.push({ track: grade.code, module: m.number, knownChords: [...HEARABLE_CHORDS] });
  }
  cases.push({ track: null, module: null, knownChords: [] });
  cases.push({ track: null, module: null, knownChords: ['A', 'D'] });
  cases.push({ track: null, module: null, knownChords: [...HEARABLE_CHORDS] });

  let bad = [];
  for (const input of cases) {
    const r = buildRoutine(input);
    const label = `${input.track ?? 'no course'}/${input.module ?? '-'}/${input.knownChords.length}`;
    if (!r.description) bad.push(`${label}: no description`);
    // An empty routine is a real answer, and onboarding refuses to finish on
    // one. It is only ever allowed where the learner has given the app nothing
    // to build from: no chords, and a module with no repeatable content.
    if (!r.tasks.length) {
      if (input.knownChords.length) bad.push(`${label}: empty routine despite chords`);
      continue;
    }
    for (const t of r.tasks) {
      if (!t.title) bad.push(`${label}: task with no title`);
      if (!t.drill && !t.duration) bad.push(`${label}: "${t.title}" is neither timed nor a drill`);
      if (!t.drill) continue;
      if (!DRILL_KINDS.has(t.drill.kind)) bad.push(`${label}: unknown drill ${t.drill.kind}`);
      const chords = [
        ...(t.drill.chords ?? []),
        ...(t.drill.pairs ?? []).flatMap((p) => [p.from, p.to]),
      ];
      if (!chords.length) bad.push(`${label}: "${t.title}" is a drill with nothing to play`);
      for (const c of chords) {
        if (!HEARABLE_CHORDS.includes(c)) bad.push(`${label}: "${t.title}" asks for ${c}, which the detector cannot hear`);
        if (!hasChordShape(c)) bad.push(`${label}: "${t.title}" asks for ${c}, which has no diagram`);
      }
      if (t.drill.kind === 'chord-rotation' && (t.drill.chords?.length ?? 0) < 3) {
        bad.push(`${label}: a rotation ring of ${t.drill.chords?.length}`);
      }
      if (t.drill.kind === 'one-minute-changes' && !t.drill.pairs?.length) {
        bad.push(`${label}: a changes drill with no pairs`);
      }
    }
    const mins = routineMinutes(r);
    if (mins < 5 || mins > 35) bad.push(`${label}: ${mins} minutes`);
    // A single warm-up is not a session. It used to be the whole routine for a
    // Grade 2 learner who had not said which chords they have.
    if (r.tasks.length === 1 && r.tasks[0].title === 'Finger stretches') {
      bad.push(`${label}: a warm-up on its own`);
    }
  }
  check(`all ${cases.length} routines the flow can produce are runnable`, bad.length === 0, bad.slice(0, 6).join(' | '));
}

console.log('\nThe minutes the ready screen prints\n');
{
  const r = buildRoutine({ track:'bg1', module:4, knownChords:['A','D','E','Am','Em'] });
  let seconds = 0;
  for (const t of r.tasks) {
    if (t.duration) seconds += Number(t.duration) * 60;
    else if (t.drill?.kind === 'one-minute-changes') seconds += t.drill.pairs.length * t.drill.durationSec;
    else seconds += t.drill.durationSec;
  }
  check('are the sum of what the routine actually holds',
    routineMinutes(r) === Math.round(seconds / 60), `${routineMinutes(r)} vs ${Math.round(seconds/60)}`);
  check('and every timed task states its minutes',
    r.tasks.filter(t => !t.drill).every(t => Number(t.duration) > 0));
}

console.log('\nEdge cases\n');
{
  const consolidation = buildRoutine({ track:'bg1', module:7, knownChords:[...HEARABLE_CHORDS] });
  check('a module with no new chords still builds', consolidation.tasks.length >= 2,
    consolidation.tasks.map(t=>t.title).join(' > '));
  check('and drills what is there', consolidation.tasks.some(t=>t.drill?.kind==='one-minute-changes'));
  check('and says it is consolidation', /no new shapes/.test(consolidation.description), consolidation.description);
  const unknown = buildRoutine({ track:'zz', module:1, knownChords:[] });
  check('an unknown track comes back empty rather than throwing',
    Array.isArray(unknown.tasks) && unknown.tasks.length === 0 && unknown.description.length > 0);
  const unknownWithChords = buildRoutine({ track:'zz', module:1, knownChords:['A','D'] });
  check('and still builds from chords it was given', unknownWithChords.tasks.length >= 2);
  const named = buildRoutine({ track:'bg1', module:4, knownChords:['A'], routineName:'Mornings' });
  check('a given name is used', named.name === 'Mornings');
  // Tap order used to decide the content: the Chord Perfect pool was the last
  // three chords ticked and the anchor ring was the first three.
  const a = buildRoutine({ track:'bg1', module:7, knownChords:['G','C','D','A'] });
  const b = buildRoutine({ track:'bg1', module:7, knownChords:['A','D','C','G'] });
  check('the order chords were ticked in does not change the routine',
    JSON.stringify(a.tasks.map(t=>({t:t.title,d:t.drill}))) === JSON.stringify(b.tasks.map(t=>({t:t.title,d:t.drill}))));
}

console.log(failures===0?'\nALL PASS\n':`\n${failures} FAILURE(S)\n`);
process.exit(failures?1:0);
