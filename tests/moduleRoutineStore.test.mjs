// Real Zustand actions and persistence; no Firebase/network/browser required.
import assert from 'node:assert/strict';
import { MODULE_6 } from '../src/lib/moduleRoutine.ts';
import { splitRoutine, completedSet } from '../src/lib/taskSplit.ts';

class MemoryDisk {
  entries = new Map();
  writes = [];
  getItem(key) { return this.entries.get(key) ?? null; }
  setItem(key, value) { this.entries.set(key, value); this.writes.push(JSON.parse(value)); }
  removeItem(key) { this.entries.delete(key); }
}
globalThis.localStorage = new MemoryDisk();
const { useStore, defaultUserData } = await import('../src/store/index.ts');
const original = splitRoutine({
  id: 'r1', name: 'Module 5 Daily', description: 'My description', chords: ['C', 'D', 'Dm'],
  tasks: [
    { id: 'changes', title: 'Changes', drill: { kind: 'one-minute-changes', chords: ['C', 'D', 'Dm'] } },
    { id: 'dm', title: 'Dm', drill: { kind: 'chord-trainer', chords: ['Dm'] } },
    { id: 'spider', title: 'Spider', duration: '2' },
    { id: 'song', title: 'Song old', drill: { kind: 'song', songId: 'old' } },
  ],
});
const other = { id: 'r2', name: 'Other', description: '', tasks: [{ id: 'other', title: 'Other' }] };
const logs = { '2026-10-01': {
  date: '2026-10-01', routineId: 'r1', completedTaskIds: ['changes', 'dm', 'song'],
  drillResults: { dm: 24, 'pair:D|Dm': 1 }, taskRecords: { dm: { evidence: 'measured', at: 1 } },
} };
const seed = () => {
  useStore.setState({ currentAccountId: 'anonymous', accounts: { anonymous: {
    ...structuredClone(defaultUserData), routines: structuredClone([original.routine, other]),
    activeRoutineId: 'r1', dailyLogs: structuredClone(logs), taskSplits: original.splits,
    drillKeyAliases: { dm: 'pool:Dm' }, currentLesson: 'b1-504', updatedAt: 1,
  } } });
  localStorage.writes = [];
};
const acc = () => useStore.getState().accounts.anonymous;
const actions = () => useStore.getState();
const snapshots = (account = acc()) => Object.values(account.moduleRoutineArchive ?? {}).map((entry) => entry.snapshot);
const archived = (routine, account = acc()) => snapshots(account).some((r) => JSON.stringify(r) === JSON.stringify(routine));
let failures = 0;
const check = (label, run) => {
  try { seed(); run(); console.log(`  ok    ${label}`); }
  catch (error) { failures++; console.log(`  FAIL  ${label}: ${error.message}`); }
};

check('accept persists the prior version in the same write as the replacement', () => {
  actions().acceptModuleUpdate(MODULE_6);
  assert.ok(archived(original.routine));
  assert.ok(localStorage.writes.length > 0);
  for (const write of localStorage.writes) {
    const saved = write.state.accounts.anonymous;
    if (saved.routines[0].module === MODULE_6.id) assert.ok(archived(original.routine, saved));
  }
});
check('Undo restores exactly the original routine, never a mix, and leaves other routines alone', () => {
  actions().acceptModuleUpdate(MODULE_6);
  actions().setActiveRoutine('r2');
  actions().undoModuleUpdate(MODULE_6);
  assert.deepEqual(acc().routines, [original.routine, other]);
  assert.equal(acc().activeRoutineId, 'r2');
  assert.deepEqual(acc().dailyLogs, logs);
  assert.deepEqual(acc().drillKeyAliases, { dm: 'pool:Dm' });
  for (const id of original.splits.changes) assert.ok(completedSet(acc().dailyLogs['2026-10-01'], acc().taskSplits).has(id));
  assert.equal(acc().currentLesson, 'b1-608'); // Routine Undo is not course-history Undo.
});
check('Undo preserves both the original archive and the edited updated routine', () => {
  actions().acceptModuleUpdate(MODULE_6);
  actions().updateTask('r1', 'm6-g-perfect', { title: 'My G practice', description: 'Personal note' });
  actions().addTask('r1', { id: 'new', title: 'My new exercise' });
  actions().updateRoutine('r1', { name: 'My renamed module' });
  const edited = structuredClone(acc().routines[0]);
  actions().recordMeasurements('2026-10-02', 'm6-g-perfect', [{ key: 'pool:G', value: 25 }]);
  const earned = structuredClone(acc().dailyLogs);
  actions().undoModuleUpdate(MODULE_6);
  assert.deepEqual(acc().routines[0], original.routine);
  assert.deepEqual(acc().dailyLogs, earned);
  assert.ok(archived(original.routine));
  assert.ok(archived(edited));
  const saved = JSON.parse(localStorage.getItem('daily-fret-storage')).state.accounts.anonymous;
  assert.ok(archived(edited, saved));
});
check('re-accept and repeated Undo never erase older archives or duplicate tasks', () => {
  actions().acceptModuleUpdate(MODULE_6);
  const first = structuredClone(acc().routines[0]);
  actions().acceptModuleUpdate(MODULE_6);
  assert.deepEqual(acc().routines[0], first);
  actions().undoModuleUpdate(MODULE_6);
  const archive = structuredClone(acc().moduleRoutineArchive);
  assert.ok(archive && Object.keys(archive).length > 0);
  actions().undoModuleUpdate(MODULE_6);
  assert.deepEqual(acc().moduleRoutineArchive, archive);
  actions().acceptModuleUpdate(MODULE_6);
  for (const [key, entry] of Object.entries(archive)) assert.deepEqual(acc().moduleRoutineArchive[key], entry);
  assert.deepEqual(acc().routines[0], first);
});
check('a stale snooze cannot discard an accepted Undo receipt', () => {
  actions().acceptModuleUpdate(MODULE_6);
  actions().snoozeModuleUpdate(MODULE_6, Date.now() + 1000);
  actions().undoModuleUpdate(MODULE_6);
  assert.deepEqual(acc().routines[0], original.routine);
});
check('sync unions local and remote module archives rather than dropping a version', () => {
  actions().acceptModuleUpdate(MODULE_6);
  const local = structuredClone(acc().moduleRoutineArchive);
  assert.ok(local);
  const remoteEntry = { module: MODULE_6.id, reason: 'undo', at: 1, snapshot: other };
  actions().syncFromRemote('anonymous', { ...acc(), moduleRoutineArchive: { remote: remoteEntry }, updatedAt: acc().updatedAt + 1 });
  assert.deepEqual(acc().moduleRoutineArchive, { ...local, remote: remoteEntry });
});
check('Undo after the updated routine was deleted does not consume the recovery receipt', () => {
  actions().acceptModuleUpdate(MODULE_6);
  actions().deleteRoutine('r1');
  const receipt = structuredClone(acc().moduleUpdates);
  actions().undoModuleUpdate(MODULE_6);
  assert.deepEqual(acc().moduleUpdates, receipt);
  assert.deepEqual(acc().routines, [other]);
});
check('Undo writes a tombstone so Firestore merge cannot resurrect acceptance', () => {
  actions().acceptModuleUpdate(MODULE_6);
  const cloudReceipt = structuredClone(acc().moduleUpdates[MODULE_6.id]);
  actions().undoModuleUpdate(MODULE_6);
  // Firestore setDoc(..., { merge: true }) recursively retains absent keys.
  const mergedReceipt = { ...cloudReceipt, ...acc().moduleUpdates?.[MODULE_6.id] };
  assert.equal(mergedReceipt.outcome, 'undone');
});
check('an older remote snapshot still contributes immutable archive entries', () => {
  actions().acceptModuleUpdate(MODULE_6);
  const live = structuredClone(acc().routines);
  const entry = { module: MODULE_6.id, reason: 'undo', at: 1, snapshot: other };
  actions().syncFromRemote('anonymous', { routines: [other], moduleRoutineArchive: { remote: entry }, updatedAt: 0 });
  assert.deepEqual(acc().routines, live);
  assert.deepEqual(acc().moduleRoutineArchive.remote, entry);
});
console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exitCode = failures ? 1 : 0;
