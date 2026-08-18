// What the user sees when the disk is full.
//
// The defect this pins: recording a drill result threw out of the click handler
// at Safari's origin cap, no crash screen appeared because a handler is not a
// render, the BPM readout moved anyway, and every result from that point on was
// memory-only and gone on reload. The app said saved and had not saved.
//
// The fake disk below refuses a write the way WebKit actually refuses one: a
// synchronous DOMException named QuotaExceededError, thrown before anything is
// written, leaving the previous value exactly where it was. Anything gentler
// than that would pass against the broken code too.

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

const encoder = new TextEncoder();
const bytes = (s) => encoder.encode(s).length;

class BoundedDisk {
  constructor(capBytes) {
    this.cap = capBytes;
    this.entries = new Map();
  }

  used(excludeKey) {
    let total = 0;
    for (const [key, value] of this.entries) {
      if (key === excludeKey) continue;
      total += bytes(key) + bytes(value);
    }
    return total;
  }

  get length() {
    return this.entries.size;
  }

  key(index) {
    return [...this.entries.keys()][index] ?? null;
  }

  getItem(key) {
    return this.entries.has(key) ? this.entries.get(key) : null;
  }

  setItem(key, value) {
    const next = String(value);
    if (this.used(key) + bytes(key) + bytes(next) > this.cap) {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    }
    this.entries.set(key, next);
  }

  removeItem(key) {
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }
}

const disk = new BoundedDisk(200_000);
globalThis.localStorage = disk;

const { useStore } = await import('../src/store/index.ts');
const { persistenceState, guardedStorage } = await import('../src/store/persistence.ts');

const KEY = 'daily-fret-storage';
const DATE = '2026-08-17';
const TASK = 'task-chord-perfect';
const DRILL = 'pool:A|D|E';

const stored = () => JSON.parse(disk.getItem(KEY)).state.accounts.anonymous;
const memory = () => useStore.getState().accounts.anonymous;
const values = (acc, date) => (acc.dailyLogs[date]?.drillRuns?.[DRILL] ?? []).map((r) => r.value);

console.log('\npersistence: a refused write is admitted, not swallowed\n');

// A morning session on a disk with room, so there is real history to protect.
useStore.getState().recordMeasurements(DATE, TASK, [{ key: DRILL, value: 68 }]);
useStore.getState().settleTask(DATE, TASK);

check('a healthy disk records the run and says saved', () => {
  assert.deepEqual(values(stored(), DATE), [68]);
  assert.equal(persistenceState().status, 'saved');
});

// The disk fills. Cap it at exactly what is already on it, so the next write of
// a larger snapshot is refused and nothing smaller is ever attempted.
const beforeFull = disk.getItem(KEY);
disk.cap = disk.used();

let threw = null;
try {
  useStore.getState().recordMeasurements(DATE, TASK, [{ key: DRILL, value: 81 }]);
  useStore.getState().settleTask(DATE, TASK);
} catch (err) {
  threw = err;
}

check('recording into a full disk does not throw out of the handler', () => {
  assert.equal(threw, null, threw ? `threw ${threw.name}` : '');
});

check('the app says it did not save', () => {
  const state = persistenceState();
  assert.equal(state.status, 'failed');
  assert.equal(state.reason, 'quota');
  assert.ok(state.bytes > 0, 'reports the size of the snapshot it could not write');
});

check('the morning session is still on disk, not evicted to make room', () => {
  assert.equal(disk.getItem(KEY), beforeFull);
  assert.deepEqual(values(stored(), DATE), [68]);
});

check('the session keeps working in memory', () => {
  assert.deepEqual(values(memory(), DATE), [68, 81]);
});

// The user clears space elsewhere and plays one more rep.
disk.cap = 200_000;
useStore.getState().recordMeasurements(DATE, TASK, [{ key: DRILL, value: 84 }]);

check('room frees up and the app says saved again', () => {
  assert.equal(persistenceState().status, 'saved');
});

check('the writes made while full are on disk once a write lands', () => {
  assert.deepEqual(values(stored(), DATE), [68, 81, 84]);
});

// Blocked cookies: touching localStorage throws before any method is called.
check('storage the browser refuses to hand over is reported, not fatal', () => {
  const blocked = guardedStorage(() => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  });
  assert.equal(blocked.getItem(KEY), null);
  blocked.setItem(KEY, '{}');
  const state = persistenceState();
  assert.equal(state.status, 'failed');
  assert.equal(state.reason, 'unavailable');
});

console.log(failures ? `\n${failures} failed\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
