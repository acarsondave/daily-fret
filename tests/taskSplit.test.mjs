// One task, one exercise.
//
// Some tasks bundled several different pieces of work: a changes task over
// three chords is three separate pairs, and a timed task with two strumming
// blocks is two patterns. The owner wants to practise one set of changes on its
// own, so every such task is split into atomic ones, both for new tasks and for
// the routines already saved. Nothing recorded against the combined task may be
// lost: a day that completed it still completed all of its parts.

import {
  isCombined,
  splitTask,
  splitRoutine,
  splitRoutines,
  mergeTaskSplits,
  completedSet,
  isTaskDone,
} from '../src/lib/taskSplit.ts';
import { buildSegments, restSecondsAfter } from '../src/lib/coached.ts';
import { buildHistory } from '../src/lib/history.ts';
import { buildRoutine } from '../src/lib/routineBuilder.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${d ? ' — ' + d : ''}`); };

// The owner's own routine, as it was exported on 13 July.
const OWNER = {
  id: 'r_10min',
  name: '20-Min Muscle Memory',
  description: '',
  chords: ['A', 'D', 'E', 'Am', 'Em'],
  tasks: [
    { id: 't1', title: 'Spider Exercises', duration: '5 mins', description: '1st fret start. Low E to high E.' },
    { id: 'cp', title: 'Chord Perfect Training', duration: '1', drill: { kind: 'chord-trainer', durationSec: 60, chords: ['A', 'D', 'E', 'Am', 'Em'] } },
    { id: 't3', title: 'Chord Speed Training', duration: '3', description: 'A, D, E transitions. Goal: 65+ cpm.', drill: { kind: 'one-minute-changes', durationSec: 60, chords: ['A', 'D', 'E'] } },
    {
      id: 'strum', title: 'Strumming Practice', duration: '2', description: 'Practice the current strumming patterns available.',
      blocks: [
        { id: 'b1', label: 'Strumming Pattern 1', durationSec: 60, pattern: 'D-DUD-', note: 'D DU D' },
        { id: 'b2', label: 'Strumming Pattern 2', durationSec: 60, pattern: 'D-DUDUD-', note: 'D DUDU D' },
      ],
    },
    { id: 'song', title: 'Song Practice', duration: '5', drill: { kind: 'song', songId: 'wild-thing' } },
  ],
};

console.log('\nWhat counts as combined\n');
{
  const [spider, perfect, changes, strum, song] = OWNER.tasks;
  check('a plain timer is one exercise', !isCombined(spider, OWNER));
  check('Chord Perfect over a pool is one exercise', !isCombined(perfect, OWNER));
  check('a changes task over three chords is three', isCombined(changes, OWNER));
  check('a timed task with two blocks is two', isCombined(strum, OWNER));
  check('a song is one exercise', !isCombined(song, OWNER));
  check('a changes task over one pair is one',
    !isCombined({ id: 'x', title: 'A and D', drill: { kind: 'one-minute-changes', chords: ['A', 'D'] } }, OWNER));
  check('a changes task with one explicit pair is one',
    !isCombined({ id: 'x', title: 'x', drill: { kind: 'one-minute-changes', pairs: [{ from: 'Am', to: 'E' }] } }, OWNER));
  check('a single-block timer is one',
    !isCombined({ id: 'x', title: 'x', blocks: [{ id: 'b', label: 'Only', durationSec: 60 }] }, OWNER));
}

console.log('\nSplitting a changes task\n');
{
  const parts = splitTask(OWNER.tasks[2], OWNER);
  check('one part per pair', parts.length === 3, parts.map((p) => p.title).join(' | '));
  check('each part is a single change',
    parts.every((p) => p.drill.kind === 'one-minute-changes' && p.drill.pairs.length === 1 && p.drill.chords.length === 2));
  check('in the order the session used to play them',
    parts.map((p) => `${p.drill.pairs[0].from}${p.drill.pairs[0].to}`).join(' ') === 'AD AE DE');
  check('each keeps the drill length', parts.every((p) => p.drill.durationSec === 60));
  check('each part names its pair', parts[0].title === 'Chord Speed Training · A ↔ D', parts[0].title);
  check('ids are stable, so a second run of the migration agrees with the first',
    JSON.stringify(splitTask(OWNER.tasks[2], OWNER).map((p) => p.id)) === JSON.stringify(parts.map((p) => p.id)));
  check('ids are unique', new Set(parts.map((p) => p.id)).size === 3);
  check('each remembers the exercise it came from',
    parts.every((p) => p.group?.id === 't3' && p.group?.title === 'Chord Speed Training'));
  check('the description survives', parts.every((p) => p.description === OWNER.tasks[2].description));
  check('the planned minutes are per part now', parts.every((p) => p.duration === '1'), parts.map((p) => p.duration).join(','));

  const explicit = splitTask(
    { id: 'm3', title: 'Module 3 Changes', drill: { kind: 'one-minute-changes', durationSec: 60, pairs: [{ from: 'Am', to: 'E' }, { from: 'Em', to: 'D' }, { from: 'Am', to: 'Em' }] } },
    OWNER,
  );
  check('explicit pairs split in their written order',
    explicit.map((p) => `${p.drill.pairs[0].from}-${p.drill.pairs[0].to}`).join(' ') === 'Am-E Em-D Am-Em');

  const vocab = splitTask({ id: 'v', title: 'Changes', drill: { kind: 'one-minute-changes', durationSec: 45 } }, OWNER);
  check('a changes task with no chords of its own splits across the routine vocabulary', vocab.length === 10, `${vocab.length}`);
  check('and each part pins its pair, so it no longer depends on the routine', vocab.every((p) => p.drill.chords.length === 2));
}

console.log('\nSplitting a timed task with blocks\n');
{
  const parts = splitTask(OWNER.tasks[3], OWNER);
  check('one part per block', parts.length === 2);
  check('named by the block', parts.map((p) => p.title).join(' | ') === 'Strumming Pattern 1 | Strumming Pattern 2');
  // Kept as a one-block timer rather than flattened to a duration, because a
  // block carries its seconds, its pattern, its note and its tempo, and a plain
  // task has room for none of them.
  check('each part is its own block, unchanged',
    parts.every((p, i) => !p.drill && p.blocks?.length === 1 && p.blocks[0] === OWNER.tasks[3].blocks[i]));
  check('with no stale duration beside it', parts.every((p) => p.duration === undefined));
  check('both remember the task they came from', parts.every((p) => p.group?.id === 'strum'));
}

console.log('\nA routine\n');
{
  const { routine, splits } = splitRoutine(OWNER);
  check('every task is atomic afterwards', routine.tasks.every((t) => !isCombined(t, routine)));
  check('five tasks become eight', routine.tasks.length === 8, `${routine.tasks.length}`);
  check('parts take the place of the task they replace, in order',
    routine.tasks.map((t) => t.id).join(' ') === 't1 cp t3:A>D t3:A>E t3:D>E strum:b1 strum:b2 song',
    routine.tasks.map((t) => t.id).join(' '));
  check('the split is recorded', JSON.stringify(splits.t3) === JSON.stringify(['t3:A>D', 't3:A>E', 't3:D>E']));
  check('untouched tasks keep their identity', routine.tasks[0] === OWNER.tasks[0]);
  check('a routine with nothing to split comes back as the same object',
    splitRoutine(routine).routine === routine);
  const all = splitRoutines([OWNER, routine], undefined);
  check('a list of routines with nothing to split elsewhere keeps its identity',
    splitRoutines(all.routines, all.splits).routines === all.routines);
  check('and so does the split map', splitRoutines(all.routines, all.splits).splits === all.splits);
  check('the segments a session runs are unchanged by the split',
    JSON.stringify(buildSegments(OWNER).map((s) => [s.kind, s.from, s.to, s.seconds])) ===
      JSON.stringify(buildSegments(routine).map((s) => [s.kind, s.from, s.to, s.seconds])));
  check('and no task runs more than one exercise',
    Object.values(Object.groupBy(buildSegments(routine), (s) => s.taskId))
      .every((segs) => segs.length === 1 || segs.every((s) => s.kind === 'song' || s.kind === 'patterns')));
}

console.log('\nThe coached session keeps its pacing\n');
{
  const { routine } = splitRoutine(OWNER);
  const segs = buildSegments(routine);
  const p1 = segs.findIndex((s) => s.title === 'Strumming Pattern 1');
  check('two parts of one former timed task still run straight on', restSecondsAfter(segs[p1], segs[p1 + 1]) === 0);
  const changes = segs.filter((s) => s.kind === 'changes');
  check('a changes part is announced by the exercise, not the pair',
    changes.every((s) => s.announce === 'Chord Speed Training'), changes.map((s) => s.announce).join(','));
  check('a block part is announced by its own name', segs[p1].announce === 'Strumming Pattern 1');
}

console.log('\nHistory recorded against the combined task\n');
{
  const { routine, splits } = splitRoutine(OWNER);
  const log = { date: '2026-07-13', routineId: 'r_10min', completedTaskIds: ['t1', 't3', 'strum'] };
  const done = completedSet(log, splits);
  check('a completed combined task completes every part', ['t3:A>D', 't3:A>E', 't3:D>E', 'strum:b1', 'strum:b2'].every((id) => done.has(id)));
  check('and still answers for itself', done.has('t3'));
  check('an unrelated task is not dragged along', !done.has('song'));
  check('isTaskDone reads through the split', isTaskDone(log, 't3:A>E', splits));
  check('an empty day is empty', completedSet(undefined, splits).size === 0);
  check('the stored day is untouched', log.completedTaskIds.length === 3);

  const days = buildHistory({ [log.date]: log }, [routine], splits);
  check('history counts the parts that day completed', days[0].completed === 6, `${days[0].completed}`);
  check('against the routine as it now stands', days[0].planned === 8, `${days[0].planned}`);

  // A split of a split: a routine migrated on one device and split again after
  // an edit on another. Completion must follow the whole chain.
  const deeper = { ...splits, 't3:A>D': ['t3:A>D:x'] };
  check('completion follows a chain of splits', completedSet(log, deeper).has('t3:A>D:x'));
}

console.log('\nTwo devices\n');
{
  const a = { t3: ['t3:A>D', 't3:A>E'] };
  const b = { strum: ['strum:b1', 'strum:b2'], t3: ['something-else'] };
  const m = mergeTaskSplits(a, b);
  check('both sides survive', m.t3 && m.strum);
  check('an entry is never overwritten', JSON.stringify(m.t3) === JSON.stringify(a.t3));
  check('nothing to merge returns what there was', mergeTaskSplits(a, undefined) === a);
}

console.log('\nThe routine builder writes atomic tasks\n');
{
  const r = buildRoutine({ track: 'bg1', module: 4, knownChords: ['A', 'D', 'E', 'Am', 'Em'] });
  check('nothing it builds is combined', r.tasks.every((t) => !isCombined(t, r)),
    r.tasks.filter((t) => isCombined(t, r)).map((t) => t.title).join(','));
  const changes = r.tasks.filter((t) => t.drill?.kind === 'one-minute-changes');
  check('the changes arrive as one task per pair', changes.length >= 2 && changes.every((t) => t.drill.pairs.length === 1),
    changes.map((t) => t.title).join(' | '));
  check('sharing one exercise', new Set(changes.map((t) => t.group?.id)).size === 1);
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
