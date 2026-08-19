// What a cloud read is allowed to do to a session that is still running.
//
// The defect: `syncFromRemote` merged every other field by falling back to the
// local copy and then wrote `coachProgress: data.coachProgress ?? null`. A
// coached session paused on this device — the phone propped on the music stand,
// mid-routine, five segments in — was discarded the moment any equal-or-newer
// snapshot arrived from the cloud without one, which is what every write from
// the laptop looks like. The session cannot be reconstructed: the segment index
// and the results so far live nowhere else.
//
// So the rule pinned here is that an in-progress session is only ever replaced
// by a newer in-progress session, and the awkward case is the one the old code
// got right by accident: a session genuinely started on another device after
// this one, which must win.

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
  constructor() {
    this.entries = new Map();
  }

  getItem(key) {
    return this.entries.has(key) ? this.entries.get(key) : null;
  }

  setItem(key, value) {
    this.entries.set(key, String(value));
  }

  removeItem(key) {
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }
}

globalThis.localStorage = new MemoryDisk();

const { useStore } = await import('../src/store/index.ts');

const UID = 'user-1';
const DATE = '2026-08-18';

const session = (startedAt, index) => ({
  routineId: 'r1',
  date: DATE,
  index,
  results: [],
  startedAt,
});

const account = (updatedAt, coachProgress) => ({
  routines: [],
  dailyLogs: {},
  activeRoutineId: 'r1',
  coachProgress,
  updatedAt,
});

/** Put a local account in place, then hand the store a cloud snapshot. */
const sync = (local, remote) => {
  useStore.setState((state) => ({ accounts: { ...state.accounts, [UID]: local } }));
  useStore.getState().syncFromRemote(UID, remote);
  return useStore.getState().accounts[UID];
};

const STARTED = Date.UTC(2026, 7, 18, 19, 30);

console.log('\nA paused session and a cloud read\n');

check('a newer cloud write with no session of its own leaves the local one alone', () => {
  const merged = sync(account(100, session(STARTED, 4)), account(200, undefined));
  assert.ok(merged.coachProgress, 'the paused session was discarded');
  assert.equal(merged.coachProgress.index, 4);
});

check('and an explicit null from the cloud does not clear it either', () => {
  const merged = sync(account(100, session(STARTED, 4)), account(200, null));
  assert.ok(merged.coachProgress, 'the paused session was discarded');
  assert.equal(merged.coachProgress.index, 4);
});

check('a session started later on another device wins', () => {
  const merged = sync(
    account(100, session(STARTED, 4)),
    account(200, session(STARTED + 600_000, 1)),
  );
  assert.equal(merged.coachProgress.index, 1);
});

check('and one started earlier there does not', () => {
  const merged = sync(
    account(100, session(STARTED, 4)),
    account(200, session(STARTED - 600_000, 1)),
  );
  assert.equal(merged.coachProgress.index, 4);
});

check('a cloud session arrives when this device has none', () => {
  const merged = sync(account(100, undefined), account(200, session(STARTED, 2)));
  assert.equal(merged.coachProgress.index, 2);
});

check('neither side having one is still nothing', () => {
  const merged = sync(account(100, undefined), account(200, undefined));
  assert.equal(merged.coachProgress ?? null, null);
});

// Progress saved by a build from before `startedAt` existed carries only the
// date it was filed under, so that is what has to order it.
check('an older session with only a date is ordered by the date', () => {
  const dated = { routineId: 'r1', date: '2026-08-01', index: 6, results: [] };
  const merged = sync(account(100, dated), account(200, { ...dated, date: '2026-08-19', index: 1 }));
  assert.equal(merged.coachProgress.index, 1);
});

check('and does not lose to a remote copy from an earlier day', () => {
  const dated = { routineId: 'r1', date: '2026-08-19', index: 6, results: [] };
  const merged = sync(account(100, dated), account(200, { ...dated, date: '2026-08-01', index: 1 }));
  assert.equal(merged.coachProgress.index, 6);
});

// The one case the old line existed for: a strictly newer local copy already
// short-circuits above it, so this is only about the branch that does merge.
check('a strictly newer local account is not touched at all', () => {
  const merged = sync(account(300, session(STARTED, 4)), account(200, session(STARTED + 1, 1)));
  assert.equal(merged.coachProgress.index, 4);
});

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
