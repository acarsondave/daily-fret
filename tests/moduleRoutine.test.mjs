// The Module 6 update, applied to a routine shaped like the owner's real one.
//
// The update rewrites the one thing the player practises from every day, so
// every rule the owner gave is pinned here: what goes, what stays, what is
// added and why, and that nothing he earned is lost on the way.

import {
  MODULE_6,
  planModuleUpdate,
  moduleUpdateDue,
  lessonOrder,
} from '../src/lib/moduleRoutine.ts';
import { getChordShape } from '../src/data/chordShapes.ts';
import { pairKey } from '../src/lib/pairs.ts';
import { splitRoutine, splitTask } from '../src/lib/taskSplit.ts';
import { pickKey, parsePickKey, describeDrillKey, isDrillKey, countedDrillKey } from '../src/lib/drillKeys.ts';
import { buildSegments } from '../src/lib/coached.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${d ? ' - ' + d : ''}`); };

const t = (id, title, extra = {}) => ({ id, title, ...extra });
const module5 = {
  id: 'r_10min',
  name: 'Module 5 Daily',
  description: '',
  chords: ['A', 'D', 'E', 'Am', 'Dm', 'Em', 'C'],
  tasks: [
    t('spider', 'Spider', { duration: '3' }),
    t('cp', 'Chord Perfect', { drill: { kind: 'chord-trainer', chords: ['Dm', 'C'], durationSec: 150 } }),
    t('sweep', 'Chord Sweep', { drill: { kind: 'chord-rotation', chords: ['C', 'Am', 'Dm'], durationSec: 60 } }),
    t('m5', 'Module 5 Changes', {
      drill: { kind: 'one-minute-changes', pairs: [{ from: 'Am', to: 'C' }, { from: 'C', to: 'Em' }, { from: 'Dm', to: 'Em' }] },
    }),
    t('strum', 'Strumming Patterns', { drill: { kind: 'strum-pattern', durationSec: 180, bpm: 85 } }),
    t('caya', 'Come As You Are Riff', { duration: '2' }),
    t('sun', 'Sunshine Of Your Love', { duration: '2' }),
    t('sna', 'Seven Nation Army Riff', { duration: '2' }),
    t('505', 'Song 505', { drill: { kind: 'song', songId: '505-arctic-monkeys' } }),
    t('lucky', 'Song Get Lucky', { drill: { kind: 'song', songId: 'get-lucky' } }),
    t('mine', 'Warm-up jam', { duration: '2' }),
  ],
};
const log = (date, results) => ({ date, routineId: 'r_10min', completedTaskIds: [], drillResults: results });
const logs = {
  '2026-10-01': log('2026-10-01', { [pairKey('A', 'D')]: 22, [pairKey('D', 'E')]: 48, [pairKey('Am', 'C')]: 33, 'spider': 1 }),
  '2026-10-04': log('2026-10-04', { [pairKey('A', 'D')]: 25, [pairKey('D', 'Em')]: 31, [pairKey('D', 'E')]: 51 }),
};
const today = '2026-10-11';

const { routine: next, changes } = planModuleUpdate(module5, MODULE_6, logs);
const titles = next.tasks.map((x) => x.title);
const has = (re) => next.tasks.some((x) => re.test(x.title));

console.log('\nModule 6 G grip\n');
{
  const g = getChordShape('G', 'two-finger');
  check('two-finger G mutes string five', g?.frets.join() === '3,-1,0,0,0,3');
  check('two-finger G uses fingers 2 and 3', g?.fingers.filter((f) => f > 0).join() === '2,3');
  check('the traditional G stays available', getChordShape('G')?.frets.join() === '3,2,0,0,0,3');
}
console.log('\nWhat goes\n');
{
  check('every song is removed', !next.tasks.some((x) => x.id === '505' || x.id === 'lucky'));
  check('Seven Nation Army is removed', !has(/seven nation/i));
  check('the Dm sweep is removed', !next.tasks.some((x) => x.id === 'sweep'));
  check('no drill anywhere still asks for Dm',
    !next.tasks.some((x) => JSON.stringify(x.drill ?? {}).includes('"Dm"')), titles.join(' | '));
  check('each removal says why', changes.removed.every((r) => r.reason && r.task));
  check('removed tasks are reported, not silently dropped', changes.removed.length === 4, String(changes.removed.length));
}

console.log('\nWhat stays\n');
{
  check('the finger exercise stays, first', next.tasks[0].id === 'spider');
  check('both kept riffs stay', has(/come as you are/i) && has(/sunshine/i));
  check('C work stays: Chord Perfect keeps C and loses only Dm',
    next.tasks.find((x) => x.id === 'cp')?.drill?.chords?.join() === 'C');
  check('Module 5 Changes keeps its two C pairs and drops Dm to Em',
    next.tasks.find((x) => x.id === 'm5')?.drill?.pairs?.map((p) => `${p.from}-${p.to}`).join() === 'Am-C,C-Em');
  check('a task the app does not recognise is never touched',
    JSON.stringify(next.tasks.find((x) => x.id === 'mine')) === JSON.stringify(module5.tasks.at(-1)));
  check('kept tasks keep their ids, so their history still counts',
    ['spider', 'cp', 'm5', 'strum', 'caya', 'sun', 'mine'].every((id) => next.tasks.some((x) => x.id === id)));
  check('the 4/4 strumming carries over until it is held', next.tasks.some((x) => x.id === 'strum'));
}

console.log('\nWhat is added\n');
{
  const added = (re) => changes.added.find((a) => re.test(a.task.title));
  check('alternate picking, from the course', added(/picking/i)?.source === 'module' &&
    added(/picking/i)?.task.drill?.kind === 'alternate-picking');
  check('G Chord Perfect, from the course', added(/\bG\b/)?.task.drill?.chords?.join() === 'G');
  const d = added(/\bD\b/);
  check('D Chord Perfect, from your numbers', d?.source === 'carry' && d?.task.drill?.chords?.join() === 'D');
  const m6 = changes.added.find((a) => a.task.drill?.kind === 'one-minute-changes');
  const pairs = m6?.task.drill?.pairs?.map((p) => `${p.from}-${p.to}`) ?? [];
  check("Justin's three pairs are there", ['G-C', 'G-D', 'C-D'].every((p) => pairs.includes(p)), pairs.join());
  check('and the weakest D change in his history joins them', pairs.includes('A-D'), pairs.join());
  check('a strong D change is not added', !pairs.includes('D-E'));
  const six = changes.added.find((a) => a.task.drill?.kind === 'strum-pattern');
  check('6/8 strumming deals only 6/8 cards', six?.task.drill?.patterns?.every((p) => p.startsWith('68.')));
  check('6/8 strumming starts below the grading ceiling', (six?.task.drill?.bpm ?? 999) <= 120, String(six?.task.drill?.bpm));
  check('both 6/8 songs are added',
    ['fade-into-you', 'this-years-love'].every((id) => changes.added.some((a) => a.task.drill?.songId === id)));
  check('note names are light: one minute, at most',
    (changes.added.find((a) => a.task.drill?.kind === 'note-finder')?.task.drill?.durationSec ?? 0) <= 60);
  check('G joins the working chords and Dm does not leave them',
    next.chords.includes('G') && next.chords.includes('Dm'));
  check('the routine is named for the module', /module 6/i.test(next.name), next.name);
  check('songs close the session', next.tasks.at(-1).drill?.kind === 'song' && next.tasks.at(-2).drill?.kind === 'song');
  check('every new task is tagged with where it came from, for the next module to read',
    changes.added.every((a) => next.tasks.find((x) => x.id === a.task.id)?.source === a.source));
}

console.log('\nIt runs in coached mode\n');
{
  const segs = buildSegments(next, []);
  check('alternate picking is its own measured segment', segs.some((s) => s.kind === 'picking'));
  check('6/8 strumming is a pattern segment in 6/8',
    segs.some((s) => s.kind === 'patterns' && s.patterns?.[0]?.startsWith('68.')));
}

console.log('\nOnce, and only once\n');
{
  const again = planModuleUpdate(next, MODULE_6, logs);
  check('applying it twice changes nothing', JSON.stringify(again.routine) === JSON.stringify(next));
  const acc = { routines: [module5], activeRoutineId: 'r_10min', currentLesson: 'b1-504' };
  check('a Module 5 player is offered it', moduleUpdateDue(acc, MODULE_6, Date.now()) === true);
  check('not once accepted', !moduleUpdateDue({ ...acc, moduleUpdates: { [MODULE_6.id]: { outcome: 'accepted', at: 1 } } }, MODULE_6, Date.now()));
  check('not while snoozed', !moduleUpdateDue({ ...acc, moduleUpdates: { [MODULE_6.id]: { outcome: 'snoozed', at: 1, until: Date.now() + 1000 } } }, MODULE_6, Date.now()));
  check('again once the snooze runs out', moduleUpdateDue({ ...acc, moduleUpdates: { [MODULE_6.id]: { outcome: 'snoozed', at: 1, until: Date.now() - 1 } } }, MODULE_6, Date.now()));
  check('not for a beginner on Module 2', !moduleUpdateDue({ ...acc, currentLesson: 'b1-201', routines: [{ ...module5, name: 'Daily' }] }, MODULE_6, Date.now()));
  check('not for a routine already updated', !moduleUpdateDue({ ...acc, routines: [next] }, MODULE_6, Date.now()));
  check('lesson codes order by grade then number', lessonOrder('b1-608') > lessonOrder('b1-504') && lessonOrder('b2-801') > lessonOrder('b1-608'));
}

console.log('\nThe actual atomic routine\n');
{
  const atomic = splitRoutine(planModuleUpdate(splitRoutine(module5).routine, MODULE_6, logs).routine).routine;
  const again = planModuleUpdate(atomic, MODULE_6, logs);
  check('planning again after the store split is an exact no-op', JSON.stringify(again.routine) === JSON.stringify(atomic));
  check('repeated planning reports no additions', again.changes.added.length === 0);
  const edited = { ...atomic, name: 'My edited routine', tasks: atomic.tasks.slice(1).reverse() };
  check('an already applied version preserves subsequent edits',
    JSON.stringify(planModuleUpdate(edited, MODULE_6, logs).routine) === JSON.stringify(edited));
  check('split changes preserve module provenance',
    atomic.tasks.filter((task) => task.group?.id === 'm6-changes').every((task) => task.source === 'module'));
  const parts = splitTask({ id: 'blocks', title: 'Blocks', source: 'carry', blocks: [
    { id: 'a', label: 'A', durationSec: 60 }, { id: 'b', label: 'B', durationSec: 60 },
  ] });
  check('split timer blocks preserve carry provenance', parts.every((task) => task.source === 'carry'));
  const dmLogs = { '2026-10-05': log('2026-10-05', { [pairKey('D', 'Dm')]: 1, [pairKey('A', 'D')]: 20 }) };
  const safe = planModuleUpdate(module5, MODULE_6, dmLogs).routine;
  const pairs = safe.tasks.find((task) => task.id === 'm6-changes').drill.pairs;
  check('the weakest carry cannot reintroduce graduated Dm', pairs.every((p) => p.from !== 'Dm' && p.to !== 'Dm'));
  check('the next eligible weak D pair carries instead', pairs.some((p) => pairKey(p.from, p.to) === pairKey('A', 'D')));
}

console.log('\nThe picking key\n');
{
  check('round-trips', parsePickKey(pickKey(72)) === 70 && pickKey(72) === 'pick:70');
  check('is a drill key, and a share rather than a count', isDrillKey('pick:70') && !countedDrillKey('pick:70'));
  check('reads as a tempo in Progress', /70 BPM/.test(describeDrillKey('pick:70').label));
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
