// The routines already saved, split where the store meets them.
//
// Three doors bring routines into the store: the copy on disk, a cloud read,
// and every write the app makes. All three have to leave nothing combined, and
// none of them may lose a day: a completion recorded against a task that is now
// three still counts for all three. Quick paths remembers a selection by task
// id, so a selection saved before the split has to come back pointing at the
// parts.

import assert from 'node:assert/strict';

let failures = 0;
const check = (label, fn) => {
  try {
    fn();
    console.log(`  ok    ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${label}: ${err.message}`);
  }
};

class MemoryDisk {
  constructor() { this.entries = new Map(); }
  getItem(key) { return this.entries.has(key) ? this.entries.get(key) : null; }
  setItem(key, value) { this.entries.set(key, String(value)); }
  removeItem(key) { this.entries.delete(key); }
  clear() { this.entries.clear(); }
}

const DATE = '2026-07-13';
const routine = () => ({
  id: 'r1',
  name: '20-Min Muscle Memory',
  description: '',
  chords: ['A', 'D', 'E'],
  tasks: [
    { id: 't1', title: 'Spider Exercises', duration: '5' },
    { id: 't3', title: 'Chord Speed Training', duration: '3', drill: { kind: 'one-minute-changes', durationSec: 60, chords: ['A', 'D', 'E'] } },
    {
      id: 'strum', title: 'Strumming Practice',
      blocks: [
        { id: 'b1', label: 'Strumming Pattern 1', durationSec: 60, pattern: 'D-DUD-' },
        { id: 'b2', label: 'Strumming Pattern 2', durationSec: 60, pattern: 'D-DUDUD-' },
      ],
    },
  ],
});
const oldAccount = () => ({
  routines: [routine()],
  dailyLogs: {
    [DATE]: {
      date: DATE,
      routineId: 'r1',
      completedTaskIds: ['t1', 't3'],
      drillResults: { 'pair:A|D': 57, 'pair:D|E': 64 },
      taskRecords: { t3: { evidence: 'measured', at: 1 } },
    },
  },
  activeRoutineId: 'r1',
  quickPaths: { r1: ['t3', 't1'] },
  updatedAt: 100,
});

// Written before the store module loads, which is when a real page reads it.
globalThis.localStorage = new MemoryDisk();
localStorage.setItem('daily-fret-storage', JSON.stringify({
  state: { currentAccountId: 'anonymous', accounts: { anonymous: oldAccount() } },
  version: 0,
}));

const { useStore } = await import('../src/store/index.ts');
const { completedSet } = await import('../src/lib/taskSplit.ts');
const acc = () => useStore.getState().accounts[useStore.getState().currentAccountId];

console.log('\nThe copy on disk\n');
check('the combined tasks are split on load', () => {
  assert.deepEqual(acc().routines[0].tasks.map((t) => t.id),
    ['t1', 't3:A>D', 't3:A>E', 't3:D>E', 'strum:b1', 'strum:b2']);
});
check('the split is recorded', () => {
  assert.deepEqual(acc().taskSplits.t3, ['t3:A>D', 't3:A>E', 't3:D>E']);
});
check('the stored day is exactly as it was', () => {
  assert.deepEqual(acc().dailyLogs[DATE], oldAccount().dailyLogs[DATE]);
});
check('and it still completed every part of the task it completed', () => {
  const done = completedSet(acc().dailyLogs[DATE], acc().taskSplits);
  for (const id of ['t3:A>D', 't3:A>E', 't3:D>E']) assert.ok(done.has(id), id);
});
check('the migration is not stamped as an edit', () => {
  assert.equal(acc().updatedAt, 100);
});
check('and it reached the disk, so a reload does not repeat it', () => {
  const saved = JSON.parse(localStorage.getItem('daily-fret-storage')).state.accounts.anonymous;
  assert.equal(saved.routines[0].tasks.length, 6);
});
check('a remembered quick path points at the parts', () => {
  assert.deepEqual(acc().quickPaths.r1, ['t3:A>D', 't3:A>E', 't3:D>E', 't1']);
});

console.log('\nA cloud read\n');
check('a routine arriving combined is split on arrival', () => {
  useStore.getState().syncFromRemote('cloud', { ...oldAccount(), taskSplits: undefined, updatedAt: 200 });
  const cloud = useStore.getState().accounts.cloud;
  assert.equal(cloud.routines[0].tasks.length, 6);
  assert.deepEqual(cloud.taskSplits.strum, ['strum:b1', 'strum:b2']);
});
check('split maps from two devices are unioned', () => {
  useStore.getState().syncFromRemote('cloud', {
    ...useStore.getState().accounts.cloud,
    taskSplits: { other: ['other:x', 'other:y'] },
    updatedAt: 300,
  });
  const cloud = useStore.getState().accounts.cloud;
  assert.ok(cloud.taskSplits.other && cloud.taskSplits.t3);
});

console.log('\nEvery write\n');
check('adding a combined task adds its parts', () => {
  useStore.getState().addTask('r1', {
    id: 'new', title: 'Module 4 Changes',
    drill: { kind: 'one-minute-changes', durationSec: 60, pairs: [{ from: 'Am', to: 'E' }, { from: 'Em', to: 'D' }] },
  });
  const ids = acc().routines[0].tasks.map((t) => t.id);
  assert.deepEqual(ids.slice(-2), ['new:Am>E', 'new:Em>D']);
});
check('editing a task into a combined one splits it in place', () => {
  useStore.getState().updateTask('r1', 't1', {
    drill: { kind: 'one-minute-changes', durationSec: 60, chords: ['G', 'C', 'D'] },
  });
  const ids = acc().routines[0].tasks.map((t) => t.id);
  assert.deepEqual(ids.slice(0, 3), ['t1:G>C', 't1:G>D', 't1:C>D']);
  assert.deepEqual(acc().taskSplits.t1, ['t1:G>C', 't1:G>D', 't1:C>D']);
});
check('adding a routine splits its tasks', () => {
  useStore.getState().addRoutine({ ...routine(), id: 'r2', name: 'Copy' });
  const r2 = acc().routines.find((r) => r.id === 'r2');
  assert.equal(r2.tasks.length, 6);
});

console.log('\nQuick paths\n');
check('a selection is remembered per routine', () => {
  useStore.getState().setQuickPath('r2', ['t1']);
  assert.deepEqual(acc().quickPaths.r2, ['t1']);
});
check('and the other routine\'s selection followed its own split of t1', () => {
  assert.deepEqual(acc().quickPaths.r1, ['t3:A>D', 't3:A>E', 't3:D>E', 't1:G>C', 't1:G>D', 't1:C>D']);
});

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
