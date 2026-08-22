// Closing the page mid-recording must not leak the clip.
//
// The bug this pins down was found on the owner's own machine, not by a test:
// 29 files in the recordings directory, 15 rows in the index, and 469 MB of
// video that could not be watched, could not be deleted from the library, and
// counted against the browser's quota until it would have refused the next
// recording. More than half of everything the app had ever filmed there.
//
// The cause is that a clip's file is created at the start of a take and its
// index row is only written after a clean stop. Reload or close the tab in
// between and React's cleanups never run, so the bytes stay and the row never
// arrives.
//
// What is asserted here is the thing the owner would notice: after a reload
// mid-take, the clip is in the library, it points at a real file, and there is
// nothing on the disk that the library does not know about.
//
//   node tests/browser/orphanReclaim.mjs
//
// Set PREVIEW_URL to point at a build.

import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5199/';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const TIMED_TASK = {
  id: 't1', title: 'Spider walk', duration: '5 mins',
  blocks: [{ id: 'b1', label: 'Spider walk', durationSec: 300 }],
};

/** The local YYYY-MM-DD the app files a day under, which is the key the notice is answered for. */
const TODAY = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

const account = {
  activeRoutineId: 'r1',
  routines: [{ id: 'r1', name: 'Orphans', description: '', isDefault: true, tasks: [TIMED_TASK] }],
  dailyLogs: {}, strumPatterns: [], songLinks: [], userSongs: [], updatedAt: 1, capoFret: 0,
};

const browser = await chromium.launch({
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

// One context for the whole run, because the Origin Private File System belongs
// to it. A fresh context would hand each step an empty disk and the leak this
// file exists to catch would be invisible.
const ctx = await browser.newContext({
  viewport: { width: 1366, height: 768 },
  permissions: ['microphone', 'camera'],
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));

// Seeded only when absent: an init script runs on every navigation, and this
// test reloads on purpose, so seeding unconditionally would wipe the very row
// the reload is supposed to have written.
await page.addInitScript((s) => {
  if (localStorage.getItem('daily-fret-storage')) return;
  localStorage.setItem('daily-fret-storage', JSON.stringify({
    state: { currentAccountId: 'anonymous', accounts: { anonymous: s } }, version: 0,
  }));
}, account);
await page.addInitScript((r) => {
  if (localStorage.getItem('daily-fret-recordings')) return;
  localStorage.setItem('daily-fret-recordings', JSON.stringify(r));
}, {
  state: {
    settings: {
      enabled: true, cadence: 'every-session', quality: 'light', keepSessions: 8, cameraId: null,
      // Today's filming notice already answered. Without it the surface opens on
      // the notice, the block behind it never starts and no camera is ever asked
      // for, so the reload below interrupts a take that was never running: this
      // whole file went dark the day the notice landed.
      filmNoticeOn: TODAY, filmSkipOn: null,
    },
    recordings: [], lastPrune: null,
  },
  version: 0,
});

const library = () =>
  page.evaluate(() => {
    const raw = localStorage.getItem('daily-fret-recordings');
    return raw ? JSON.parse(raw).state : null;
  });

const filesOnDisk = () =>
  page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    let dir;
    try {
      dir = await root.getDirectoryHandle('daily-fret-recordings');
    } catch {
      return [];
    }
    const out = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file') continue;
      out.push({ name, size: (await handle.getFile()).size });
    }
    return out;
  });

console.log('\nA reload in the middle of a take\n');

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
await page.waitForSelector('.task-container', { timeout: 25000 });
await page.locator('.task-row', { hasText: 'Spider walk' }).locator('.task-go').click();

// Past one checkpoint, which is what actually makes an interrupted take
// survivable.
//
// A writable stream is not a pipe to the file: Chromium buffers into a sibling
// swap file and only moves it into place at close(), so before the first
// checkpoint the real file is zero bytes however long the camera has been
// running. The first version of this test waited six seconds, saw 137 KB in the
// swap, and passed a fix that filed a row against an empty file. Waiting past a
// checkpoint is the difference between testing that the code ran and testing
// that the footage is there.
await page.waitForTimeout(38_000);

const midTake = await filesOnDisk();
const real = midTake.filter((f) => f.name.endsWith('.webm'));
check('the take is really in the file, not only in a swap',
  real.length === 1 && real[0].size > 0,
  JSON.stringify(midTake));

// The whole point. This is what closing the tab, reloading, or the browser
// discarding the page all look like to the app.
await page.reload({ waitUntil: 'domcontentloaded', timeout: 25000 });
await page.waitForSelector('.task-container', { timeout: 25000 });
await page.waitForTimeout(800);

const after = await library();
const onDisk = await filesOnDisk();
const rows = after?.recordings ?? [];

check('the interrupted clip is in the library', rows.length === 1, `${rows.length} rows`);
check('and it says how it ended', rows[0]?.endedBy === 'interrupted', rows[0]?.endedBy);
check('and it claims the bytes that actually landed',
  rows[0]?.bytes > 0, String(rows[0]?.bytes));
check('and it has a duration rather than a zero',
  rows[0]?.durationMs > 1000, `${rows[0]?.durationMs}ms`);

// The leak itself, stated as the disk stating it.
const claimed = new Set(rows.map((r) => r.location.key));
// Swap files belong to the browser, not to us: it discards them itself, and the
// app has no handle on them to delete.
const orphans = onDisk.filter((f) => !claimed.has(f.name) && !f.name.endsWith('.crswap'));
const orphanBytes = orphans.reduce((n, f) => n + f.size, 0);
check('nothing is left on the disk that the library cannot see',
  orphans.length === 0,
  `${orphans.length} orphans, ${(orphanBytes / 1048576).toFixed(1)} MB`);

// A row is only worth having if it plays. The container was cut off mid-write,
// so this is the assertion that says the salvage is footage and not a stub.
const decoded = await page.evaluate(async () => {
  const raw = JSON.parse(localStorage.getItem('daily-fret-recordings'));
  const rec = raw.state.recordings[0];
  if (!rec) return { ok: false, why: 'no row' };
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('daily-fret-recordings');
  const blob = await (await dir.getFileHandle(rec.location.key)).getFile();
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  const result = await new Promise((res) => {
    video.onerror = () => res({ ok: false, why: `decode error ${video.error?.code}` });
    video.onloadedmetadata = () => res({ ok: true, w: video.videoWidth, h: video.videoHeight });
    setTimeout(() => res({ ok: false, why: 'timed out' }), 12000);
  });
  URL.revokeObjectURL(url);
  return result;
});
check('and the salvaged file is a video that decodes',
  decoded.ok && decoded.w > 0, JSON.stringify(decoded));

check('no console errors through any of it', errors.length === 0, errors.join(' | '));

await ctx.close();
await browser.close();

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
