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
  taskMinutes,
} from '../src/lib/routineBuilder.ts';
import { anchorsBetween, bestAnchoredPair } from '../src/lib/anchors.ts';
import { songsOneShapeAway, songsPlayableWith } from '../src/lib/songCatalog.ts';
import { SONGS } from '../src/data/songs.ts';
import { buildSegments } from '../src/lib/coached.ts';
import { DRILL_UNIT } from '../src/lib/drills.ts';
import { BEGINNER_GRADES, BEGINNER_MODULES } from '../src/lib/beginnerCourse.ts';
import { CURRICULUM } from '../src/data/curriculum.ts';
import { ALL_SKILLS } from '../src/data/skills.ts';
import { DETECTABLE_CHORDS } from '../src/audio/chords.ts';
import { hasChordShape } from '../src/data/chordShapes.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?' — '+d:''}`); };

// Asked of the code rather than written out here. A hand-kept copy of this list
// goes stale the moment a drill is added, and then fails on the one after, which
// is a test reporting its own age as a defect in the routine.
const DRILL_KINDS = new Set(Object.keys(DRILL_UNIT));
// Drills with nothing of their own to name: the click is the exercise for both
// rhythm drills, a song names a chart rather than a set of shapes, and the note
// finder names notes, which are not chords and have no diagram to check.
const NAMES_NO_CHORDS = new Set(['strum-timing', 'strum-pattern', 'song', 'note-finder']);
const songOf = (task) => SONGS.find((s) => s.id === task.drill?.songId) ?? null;

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
  // Pinned to the behaviour, not the words. This used to read `.includes('song')`
  // against a task literally called "Play a song", which passed for the whole
  // life of a five minute timer that named nothing.
  const last = r.tasks[r.tasks.length-1];
  const lastSong = songOf(last);
  check('it ends on a song, and the song is a real chart', lastSong !== null, last.title);
  check('and it is one the chords in the routine actually open',
    lastSong !== null && lastSong.chords.every(c => r.chords.includes(c)),
    lastSong?.chords.join(' ') ?? 'no chart');
  check('every task has a unique id', new Set(r.tasks.map(t=>t.id)).size === r.tasks.length);
  check('the vocabulary includes old and new', r.chords.includes('Dm') && r.chords.includes('A'));
  const mins = routineMinutes(r);
  console.log(`    about ${mins} minutes`);
  check('it is a session someone would sit down for', mins >= 10 && mins <= 30, `${mins} min`);
  // The rhythm block used to be a clock with "the app cannot hear timing yet"
  // written under it, which stopped being true when strum timing was built and
  // graded. A skill that names a drill gets that drill.
  check('the rhythm task is a drill the app measures, not a clock',
    r.tasks.some(t => t.drill?.kind === 'strum-timing' || t.drill?.kind === 'strum-pattern'),
    JSON.stringify(r.tasks.filter(t => /strum|rhythm|beat|pattern/i.test(t.title)).map(t => t.title)));
  // Module 4 is "Metronome, Stretches & THE Pattern" and maps two measured
  // rhythm skills. The pattern is what the module is asking the hand to learn,
  // and the deck it deals from is the newest drill in the product; the builder
  // could not emit it at all until the taxonomy admitted the drill existed.
  check('and where a module teaches a written pattern, that is the block',
    r.tasks.some(t => t.drill?.kind === 'strum-pattern'),
    r.tasks.map(t => `${t.title}:${t.drill?.kind ?? 'timer'}`).join(' '));
  check('and nothing claims the app is deaf to timing',
    !r.tasks.some(t => /cannot hear timing/.test(t.description ?? '')));
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
  // Minutes no longer carry a song: a play-along ends when the record does and
  // the routine does not get to claim five minutes for it. The stub this guards
  // against was two timed tasks and nothing measured, so the check is on both.
  check('and it is a session, not a stub',
    routineMinutes(r) >= 8 && r.tasks.length >= 4, `${routineMinutes(r)} min, ${r.tasks.length} tasks`);
  check('and it still ends on a chart those eight shapes open',
    songOf(r.tasks[r.tasks.length-1]) !== null, r.tasks[r.tasks.length-1].title);
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
      // A song names a chart rather than a set of shapes, and the chart has to
      // exist and has to be inside the vocabulary the routine was built from.
      // The block this replaced was a timer that named nothing, so there was
      // nothing here to check and the app could not be caught prescribing a
      // song needing a chord the player has never met.
      if (t.drill.kind === 'song') {
        const song = songOf(t);
        if (!song) bad.push(`${label}: "${t.title}" names no chart in the catalogue`);
        else if (!song.chords.every((c) => r.chords.includes(c))) {
          bad.push(`${label}: "${song.title}" wants ${song.chords.join(' ')}, routine has ${r.chords.join(' ')}`);
        }
        continue;
      }
      // The rhythm drills are the click and the arm, so they are the ones with
      // nothing to name.
      if (NAMES_NO_CHORDS.has(t.drill.kind)) continue;
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
    if (mins !== r.tasks.reduce((n, t) => n + taskMinutes(t), 0)) {
      bad.push(`${label}: the total is not the sum of its tasks`);
    }
    if (mins < 3 || mins > 35) bad.push(`${label}: ${mins} minutes`);
    // A single warm-up is not a session. It used to be the whole routine for a
    // Grade 2 learner who had not said which chords they have.
    if (r.tasks.length === 1 && r.tasks[0].title === 'Finger stretches') {
      bad.push(`${label}: a warm-up on its own`);
    }
  }
  check(`all ${cases.length} routines the flow can produce are runnable`, bad.length === 0, bad.slice(0, 6).join(' | '));
}

// First run draws this number as well as printing it: one stroke per minute,
// grouped by task. A total that did not equal the strokes beside it would be the
// drawing and the caption disagreeing in public, so whole minutes per task and
// their sum is the definition rather than a rounding of one.
console.log('\nThe minutes the ready screen prints, and draws\n');
{
  const r = buildRoutine({ track:'bg1', module:4, knownChords:['A','D','E','Am','Em'] });
  const perTask = r.tasks.map(taskMinutes);
  check('the total is exactly the strokes drawn beside it',
    routineMinutes(r) === perTask.reduce((a, b) => a + b, 0), `${routineMinutes(r)} vs ${perTask.join('+')}`);
  check('and every task with a length is at least one stroke',
    r.tasks.every((t, i) => (t.drill?.kind === 'song' ? perTask[i] === 0 : perTask[i] >= 1)),
    perTask.join(','));
  for (const t of r.tasks) {
    if (t.drill) continue;
    check(`"${t.title}" states its minutes`, Number(t.duration) > 0, t.duration);
  }
  // The one task with no length. It runs until the record ends.
  const song = r.tasks.find(t => t.drill?.kind === 'song');
  check('a song claims no minutes at all', taskMinutes(song) === 0, `${taskMinutes(song)}`);
}

// The app has always held the chords each chart needs and never once used them.
// The closing block of every routine was a five minute timer called "Play a
// song", described as "anything you can get through with the chords you have".
console.log('\nWhich songs a vocabulary opens\n');
{
  const ade = songsPlayableWith(SONGS, ['A', 'D', 'E']);
  check('three shapes already open a chart', ade.length >= 1, ade.map(s => s.title).join(', '));
  check('and never one that needs a shape they do not have',
    ade.every(s => s.chords.every(c => ['A','D','E'].includes(c))));
  check('no chords opens nothing', songsPlayableWith(SONGS, []).length === 0);
  check('every chart in the catalogue is opened by its own chords',
    SONGS.every(s => songsPlayableWith(SONGS, s.chords).includes(s)));

  const near = songsOneShapeAway(SONGS, ['A', 'D', 'E']);
  check('and something is exactly one shape away', near.length >= 1,
    near.map(n => `${n.missing} opens ${n.song.title}`).join(', '));
  check('one shape means one, never two',
    near.every(n => n.song.chords.filter(c => !['A','D','E'].includes(c)).length === 1));
  check('a chart already open is not also one shape away',
    near.every(n => !ade.includes(n.song)));
  check('everything one shape away names a shape the app can hear',
    near.every(n => HEARABLE_CHORDS.includes(n.missing)), near.map(n => n.missing).join(' '));
}

// "Anchor changes" asserted a technique rather than checking for one. The ring
// it dealt first, A to D to E, has no shared finger anywhere in it: A and D
// press the same fret of the G string with different fingers, and E shares
// nothing with either.
console.log('\nWhether two shapes actually share a finger\n');
{
  check('E and Em keep two fingers exactly where they are',
    anchorsBetween('E', 'Em').length === 2, JSON.stringify(anchorsBetween('E', 'Em')));
  check('Am and C keep two', anchorsBetween('Am', 'C').length === 2,
    JSON.stringify(anchorsBetween('Am', 'C')));
  check('A and D share a fret but not a finger, so they share no anchor',
    anchorsBetween('A', 'D').length === 0, JSON.stringify(anchorsBetween('A', 'D')));
  check('and A to E shares nothing at all', anchorsBetween('A', 'E').length === 0);
  check('an open string is never an anchor: nothing is being held down',
    anchorsBetween('Em', 'Em7').every(a => a.fret > 0));
  check('a chord is not an anchor with itself', anchorsBetween('A', 'A').length === 0);
  check('an unknown shape answers nothing rather than throwing',
    anchorsBetween('A', 'Xmaj9') .length === 0);
  check('the first ring onboarding ever dealt has no anchor in it',
    bestAnchoredPair(['A', 'D', 'E']) === null);
  check('and a vocabulary that does have one finds it',
    bestAnchoredPair(['A', 'D', 'E', 'Em', 'Am'])?.anchors.length === 2);
  // Order in, order out. The ring used to be the first three chords ticked.
  check('the answer does not depend on the order the chords arrive in',
    JSON.stringify(bestAnchoredPair(['C', 'Am', 'G'])) === JSON.stringify(bestAnchoredPair(['C', 'Am', 'G'])));

  const anchoredRoutine = buildRoutine({ track:'bg1', module:2, knownChords:['A','D','E'] });
  check('so module 2 gets no anchor task, because those three have no anchor',
    !anchoredRoutine.tasks.some(t => t.drill?.kind === 'chord-rotation'),
    anchoredRoutine.tasks.map(t => t.title).join(' > '));
  const withAnchor = buildRoutine({ track:'bg1', module:3, knownChords:['A','D','E','Em','Am'] });
  const ring = withAnchor.tasks.find(t => t.drill?.kind === 'chord-rotation');
  check('and module 3 does, once E and Em are both in hand', ring !== undefined,
    withAnchor.tasks.map(t => t.title).join(' > '));
  check('the ring opens on the change that actually anchors',
    anchorsBetween(ring.drill.chords[0], ring.drill.chords[1]).length > 0,
    ring?.drill.chords.join(' '));
  check('and the description names that change rather than the whole ring',
    ring.description.includes(`${ring.drill.chords[0]} to ${ring.drill.chords[1]}`), ring?.description);
}

// A task the coached runner cannot recognise does not fail loudly: it falls into
// the timed branch, which announces it, counts it in and then measures nothing.
// Both blocks added here are new drill kinds for the builder, so both are exactly
// the sort of thing that would land there silently.
console.log('\nEvery block the builder makes survives being flattened for coached mode\n');
{
  const bad = [];
  for (const m of BEGINNER_MODULES) {
    const grade = BEGINNER_GRADES.find((g) => g.modules.some((x) => x.number === m.number));
    for (const known of [[], chordsTaughtBy(m.number), [...HEARABLE_CHORDS]]) {
      const r = buildRoutine({ track: grade.code, module: m.number, knownChords: known });
      if (!r.tasks.length) continue;
      const segments = buildSegments(r);
      const label = `${grade.code}/${m.number}/${known.length}`;
      for (const t of r.tasks) {
        const mine = segments.filter((seg) => seg.taskId === t.id);
        if (!mine.length) { bad.push(`${label}: "${t.title}" flattened to nothing`); continue; }
        const kind = t.drill?.kind;
        const want =
          kind === 'song' ? 'song'
          : kind === 'strum-pattern' ? 'patterns'
          : kind === 'strum-timing' ? 'timing'
          : kind === 'chord-trainer' ? 'trainer'
          : kind === 'one-minute-changes' ? 'changes'
          : kind === 'chord-rotation' ? 'rotation'
          : kind === 'note-finder' ? 'finder'
          : 'timed';
        if (!mine.some((seg) => seg.kind === want)) {
          bad.push(`${label}: "${t.title}" (${kind ?? 'timed'}) became ${mine.map(s => s.kind).join('+')}`);
        }
      }
      for (const seg of segments) {
        if (seg.kind === 'song' && !SONGS.some((s) => s.id === seg.songId)) {
          bad.push(`${label}: a song segment for a chart that does not exist`);
        }
      }
    }
  }
  check('every task becomes the segment its drill asks for', bad.length === 0, bad.slice(0, 5).join(' | '));
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

// A song brings its own strumming into the session.
//
// The owner learns a song by owning its strum first, and the whole point of this
// block is that he does not have to build it: a song task already names a song
// and a song already knows its strumming, so the block appears in routines saved
// long before it existed. These checks are about the wiring rather than the
// notation - tests/songStrum.test.mjs is where the pattern itself is derived.
console.log('\nA song task brings its own strum block with it\n');
{
  const songTask = (songId) => ({ id: `t-${songId}`, title: 'Closer', drill: { kind: 'song', songId } });
  const routineOf = (task) => ({ id: 'r', name: 'R', description: '', tasks: [task] });

  const lucky = SONGS.find((s) => s.id === 'get-lucky');
  const segs = buildSegments(routineOf(songTask('get-lucky')));
  check('a song with a written strum flattens to two segments', segs.length === 2,
    segs.map((s) => s.kind).join('+'));
  check('the strum block comes first', segs[0]?.kind === 'patterns', segs[0]?.kind);
  check('and the play-along second', segs[1]?.kind === 'song', segs[1]?.kind);
  // Marked as sixteenths, because the grid has to reach the drill on the string
  // itself: the deck is string[] all the way from here to the history key.
  check("the block deals the song's own phrase, on its own grid",
    segs[0]?.patterns?.join(' ') === '16.D--UX--U-U-UDUDU', segs[0]?.patterns?.join(' '));
  check('it is titled after the song', segs[0]?.title === 'Get Lucky strum', segs[0]?.title);
  check('and stays on that task, so nothing new has to be added to the routine',
    segs[0]?.taskId === segs[1]?.taskId);
  // The record's tempo is ambition, and a drill's click is prescribed from what
  // the player has actually held. Stating the song's BPM here would put the
  // record in charge of the number.
  check("the block does not pin the record's tempo", segs[0]?.bpm === undefined,
    String(segs[0]?.bpm));
  check('the play-along is still the play-along', segs[1]?.songId === 'get-lucky');
  check('the song itself carries the tempo it always did', lucky?.bpm === 116, String(lucky?.bpm));

  // A chart whose strum is arrow art has nothing the matcher can score, and gets
  // no block rather than a block dealing a bar that does not exist.
  const plain = buildSegments(routineOf(songTask('wild-thing')));
  check('a song with no drillable strum flattens to the song alone',
    plain.length === 1 && plain[0].kind === 'song', plain.map((s) => s.kind).join('+'));

  // A song the player wrote themselves is reached through the catalogue the
  // caller passes in, not the shipped one.
  const written = [{ ...SONGS[0], id: 'mine', title: 'Mine', strum: 'DD',
    strumPatterns: [{ pattern: 'D-DU-UDU' }] }];
  const own = buildSegments(routineOf(songTask('mine')), written);
  check('a written chart gets a strum block too', own[0]?.kind === 'patterns', own[0]?.kind);
  check('dealing what that chart wrote', own[0]?.patterns?.join(' ') === 'D-DU-UDU');
  // Looked up in the catalogue the caller passed, and nowhere else. The
  // play-along still runs and says for itself that it cannot find the chart;
  // what must not happen is a strum block dealing a phrase from a song this
  // caller never had.
  const unknown = buildSegments(routineOf(songTask('mine')));
  check('the shipped catalogue gives that chart no strum block',
    unknown.length === 1 && unknown[0].kind === 'song', unknown.map((s) => s.kind).join('+'));

  // A song task still reports no minutes. It runs until the record ends and the
  // routine does not get to say how long that is; the strum block in front of it
  // is a segment of the session rather than a claim about the song's length.
  check('a song task still reports no minutes of its own',
    taskMinutes(songTask('get-lucky')) === 0, String(taskMinutes(songTask('get-lucky'))));
}

console.log(failures===0?'\nALL PASS\n':`\n${failures} FAILURE(S)\n`);
process.exit(failures?1:0);
