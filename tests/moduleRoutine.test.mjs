// The Module 6 update, applied to a routine shaped like the owner's real one.
//
// The update rewrites the one thing the player practises from every day, so
// every rule the owner gave is pinned here: what goes, what stays, what is
// added and why, and that nothing he earned is lost on the way.

import {
  MODULE_6,
  MODULE_6_SONGS,
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
  check('both Module 6 songs are added: Fade Into You and Stand By Me',
    ['fade-into-you', 'stand-by-me'].every((id) => changes.added.some((a) => a.task.drill?.songId === id)));
  check("This Year's Love is no longer added", !changes.added.some((a) => a.task.drill?.songId === 'this-years-love'));
  check('Stand By Me is its own task, named for the song',
    changes.added.find((a) => a.task.drill?.songId === 'stand-by-me')?.task.id === 'm6-stand-by-me' &&
    changes.added.find((a) => a.task.drill?.songId === 'stand-by-me')?.task.title === 'Song: Stand By Me');
  check('6/8 strumming keeps Justin\'s B1-604 cards, not a song\'s strum',
    six?.task.drill?.patterns?.includes('68.D--UD-D--UD-') && !six?.task.drill?.patterns?.includes('68.D-DUDU'));
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

console.log('\nSwapping This Year\'s Love for Stand By Me in a routine already on Module 6\n');
{
  // The routine as the first Module 6 update left it: This Year's Love is the
  // closing song, and the player may have edited the routine since.
  const tyl = { id: 'm6-this-years-love', title: "Song: This Year's Love", source: 'module', drill: { kind: 'song', songId: 'this-years-love' } };
  const fade = { id: 'm6-fade-into-you', title: 'Song: Fade Into You', source: 'module', drill: { kind: 'song', songId: 'fade-into-you' } };
  const before = {
    id: 'r_10min', name: 'My Module 6', description: '', module: MODULE_6.id, chords: ['A', 'C', 'G'],
    tasks: [
      { id: 'spider', title: 'Spider', duration: '3' },
      { id: 'mine-song', title: 'Song: my own', drill: { kind: 'song', songId: 'u_mine' } },
      fade,
      tyl,
      { id: 'after', title: 'Cool down', duration: '1' },
    ],
  };
  const { routine: after, changes: swap } = planModuleUpdate(before, MODULE_6_SONGS, logs);
  check('it revises the first Module 6 update and nothing else', MODULE_6_SONGS.revises === MODULE_6.id);
  check("This Year's Love goes, and is reported", !after.tasks.some((x) => x.drill?.songId === 'this-years-love') &&
    swap.removed.length === 1 && swap.removed[0].task.id === 'm6-this-years-love');
  check('Stand By Me takes its exact place', after.tasks[3]?.id === 'm6-stand-by-me' && after.tasks[3]?.drill?.songId === 'stand-by-me',
    after.tasks.map((x) => x.id).join());
  check('and is tagged as course material', after.tasks[3]?.source === 'module' && swap.added.length === 1 && swap.added[0].source === 'module');
  check('every other task is exactly as it was, in order',
    JSON.stringify(after.tasks.filter((x) => x.id !== 'm6-stand-by-me')) === JSON.stringify(before.tasks.filter((x) => x !== tyl)));
  check('his own song is not touched', after.tasks.some((x) => x.id === 'mine-song'));
  check('name, module, chords and id are untouched',
    after.name === before.name && after.module === MODULE_6.id && after.chords.join() === before.chords.join() && after.id === before.id);
  const again = planModuleUpdate(after, MODULE_6_SONGS, logs);
  check('applying it twice is applying it once', JSON.stringify(again.routine) === JSON.stringify(after) &&
    again.changes.added.length === 0 && again.changes.removed.length === 0);
  const split = splitRoutine(after).routine;
  check('a no-op after the store split too', JSON.stringify(planModuleUpdate(split, MODULE_6_SONGS, logs).routine) === JSON.stringify(split));

  const acc = { routines: [before], activeRoutineId: 'r_10min', currentLesson: 'b1-608', moduleUpdates: { [MODULE_6.id]: { outcome: 'accepted', at: 1 } } };
  check('a routine on Module 6 with This Year\'s Love is offered the swap', moduleUpdateDue(acc, MODULE_6_SONGS, Date.now()));
  check('and the first Module 6 update is not offered again', !moduleUpdateDue(acc, MODULE_6, Date.now()));
  check('not once accepted', !moduleUpdateDue({ ...acc, moduleUpdates: { ...acc.moduleUpdates, [MODULE_6_SONGS.id]: { outcome: 'accepted', at: 2 } } }, MODULE_6_SONGS, Date.now()));
  check('not while snoozed', !moduleUpdateDue({ ...acc, moduleUpdates: { [MODULE_6_SONGS.id]: { outcome: 'snoozed', at: 2, until: Date.now() + 1000 } } }, MODULE_6_SONGS, Date.now()));
  check('not once the routine already has it', !moduleUpdateDue({ ...acc, routines: [after] }, MODULE_6_SONGS, Date.now()));
  check('not to a Module 5 routine, which gets Stand By Me from the module update itself',
    !moduleUpdateDue({ routines: [module5], activeRoutineId: 'r_10min', currentLesson: 'b1-504' }, MODULE_6_SONGS, Date.now()));
  check('a Module 5 routine is left alone by it', JSON.stringify(planModuleUpdate(module5, MODULE_6_SONGS, logs).routine) === JSON.stringify(module5));
  check('a fresh Module 6 routine has nothing to swap', !moduleUpdateDue({ routines: [next], activeRoutineId: 'r_10min', currentLesson: 'b1-608' }, MODULE_6_SONGS, Date.now()));

  // He deleted This Year's Love himself: the song he asked for still arrives,
  // at the end of the songs.
  const deleted = { ...before, tasks: before.tasks.filter((x) => x !== tyl) };
  const filled = planModuleUpdate(deleted, MODULE_6_SONGS, logs).routine;
  check('without This Year\'s Love, Stand By Me joins after the last song',
    filled.tasks.map((x) => x.id).join() === 'spider,mine-song,m6-fade-into-you,m6-stand-by-me,after', filled.tasks.map((x) => x.id).join());
  // He already added Stand By Me by hand: no second copy.
  const own = { ...before, tasks: [...before.tasks, { id: 'u1', title: 'SBM', drill: { kind: 'song', songId: 'stand-by-me' } }] };
  const once = planModuleUpdate(own, MODULE_6_SONGS, logs);
  check('never a second Stand By Me', once.routine.tasks.filter((x) => x.drill?.songId === 'stand-by-me').length === 1 && once.changes.added.length === 0);
}

console.log('\nThe picking key\n');
{
  check('round-trips', parsePickKey(pickKey(72)) === 70 && pickKey(72) === 'pick:70');
  check('is a drill key, and a share rather than a count', isDrillKey('pick:70') && !countedDrillKey('pick:70'));
  check('reads as a tempo in Progress', /70 BPM/.test(describeDrillKey('pick:70').label));
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
