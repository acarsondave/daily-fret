// Watching back what was filmed.
//
// tests/browser/recording.mjs proves bytes reach the disk. That is not the same
// as proving the feature works, and the difference is the whole point of this
// file: a recorder that writes a corrupt container passes a byte-count test and
// fails a human. So the central assertion here is that the stored bytes decode
// into a video the browser will actually play, with a real duration and real
// dimensions, reached the way the owner reaches it.
//
// The rest is the loop around that: a clip he can keep, a clip he can delete,
// and the honest state for a row whose footage has gone missing underneath it.
//
//   node tests/browser/footage.mjs [outputDir]
//
// Against the shared dev server by default; set PREVIEW_URL for a build.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? 'tests/browser/.shots/footage';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5199/';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` · ${detail}` : ''}`);
};

const account = {
  activeRoutineId: 'r1',
  routines: [{
    id: 'r1', name: 'Module 4 Daily', description: '', isDefault: true,
    tasks: [
      { id: 't1', title: 'Spider walk', duration: '1 mins', blocks: [{ id: 'b1', label: 'Spider walk', durationSec: 60 }] },
    ],
  }],
  dailyLogs: {}, strumPatterns: [], songLinks: [], userSongs: [], updatedAt: 1,
  capoFret: 0,
};

const recordingState = (recordings = []) => ({
  state: {
    settings: { enabled: true, quality: 'standard', keepSessions: 8, cameraId: null },
    recordings,
    lastPrune: null,
  },
  version: 0,
});

// A row whose bytes are not on disk. Not a contrived case: the index is in
// localStorage and the footage is in the origin's private file system, and
// clearing site data can take one and leave the other.
const ORPHAN = {
  id: 'orphan-1', sessionId: 'orphan-session', kind: 'session', date: '2026-08-13',
  taskId: 't1', routineId: 'r1', label: 'Spider walk',
  startedAt: 1_770_000_000_000, durationMs: 60_000, bytes: 8_000_000,
  mimeType: 'video/webm;codecs=vp9,opus', quality: 'standard', width: 1280, height: 720,
  hasAudio: true, starred: false, endedBy: 'device-lost',
  location: { backend: 'opfs', key: 'nothing-here.webm' },
};

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

async function open({ viewport = { width: 1366, height: 768 }, recording = recordingState() } = {}) {
  const ctx = await browser.newContext({ viewport, permissions: ['microphone', 'camera'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));

  await page.addInitScript(
    (s) => localStorage.setItem('daily-fret-storage', JSON.stringify({ state: s, version: 0 })),
    { currentAccountId: 'anonymous', accounts: { anonymous: account } },
  );
  await page.addInitScript(
    (r) => localStorage.setItem('daily-fret-recordings', JSON.stringify(r)),
    recording,
  );

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForSelector('.task-container', { timeout: 25000 });
  await page.waitForTimeout(600);
  return { ctx, page, errors };
}

const sideways = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const library = (page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('daily-fret-recordings');
    return raw ? JSON.parse(raw).state : null;
  });

async function film(page) {
  await page.locator('.task-row', { hasText: 'Spider walk' }).locator('.task-go').click();
  await page.waitForSelector('.practice-overlay', { timeout: 20000 });
  await page.waitForSelector('.capture-pill', { timeout: 20000 });
  // Long enough for several MediaRecorder chunks, so the container has real
  // structure rather than a single flush.
  await page.waitForTimeout(7000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2500);
}

// --- the loop closes: film it, then watch it --------------------------------
{
  console.log('\nfilmed, then watched\n');
  const { ctx, page, errors } = await open();

  check('no shelf is advertised before anything is filmed',
    (await page.locator('.progress-launch', { hasText: /Footage/ }).count()) === 0);

  await film(page);

  const lib = await library(page);
  check('a clip was filed', lib?.recordings?.length === 1, String(lib?.recordings?.length));

  check('now the shelf is offered',
    (await page.locator('.progress-launch', { hasText: /Footage/ }).count()) === 1);

  await page.locator('.progress-launch', { hasText: /Footage/ }).click();
  await page.waitForSelector('.reclib', { timeout: 15000 });

  check('the day it was filmed is named', (await page.locator('.reclib-day-title').count()) >= 1,
    await page.locator('.reclib-day-title').first().innerText());
  check('and what was being played', /Spider walk/.test(await page.locator('.reclib-sitting-title').first().innerText()));

  await page.locator('.reclib-clip-open').first().click();
  await page.waitForSelector('.reclib-video', { timeout: 15000 });

  // The assertion this whole file exists for.
  const decoded = await page.evaluate(async () => {
    const v = document.querySelector('.reclib-video');
    if (!v) return { ok: false, why: 'no video element' };
    if (v.readyState < 1) {
      await new Promise((res) => {
        const done = () => res();
        v.addEventListener('loadedmetadata', done, { once: true });
        setTimeout(done, 8000);
      });
    }
    // MediaRecorder's container carries no duration, so the app forces the
    // browser to work it out. That resolves a moment after the metadata does.
    if (!Number.isFinite(v.duration)) {
      await new Promise((res) => {
        const settle = () => { if (Number.isFinite(v.duration)) res(); };
        v.addEventListener('durationchange', settle);
        setTimeout(res, 8000);
      });
    }
    return {
      ok: true,
      readyState: v.readyState,
      duration: v.duration,
      width: v.videoWidth,
      height: v.videoHeight,
      src: v.currentSrc.slice(0, 5),
    };
  });

  check('the stored bytes decode into a video', decoded.readyState >= 1, `readyState ${decoded.readyState}`);
  check('with a real duration', Number.isFinite(decoded.duration) && decoded.duration > 1,
    `${decoded.duration}s`);
  check('and real dimensions', decoded.width > 0 && decoded.height > 0,
    `${decoded.width}x${decoded.height}`);
  check('played from a blob, not refetched over the network', decoded.src === 'blob:', decoded.src);

  // Seeking is what a technique review actually does: jump to the bit where the
  // chord change happens. A container that plays from zero but cannot seek is
  // half broken and would look fine in a screenshot.
  const seeked = await page.evaluate(async () => {
    const v = document.querySelector('.reclib-video');
    const target = Math.min(2, (v.duration || 3) / 2);
    v.currentTime = target;
    await new Promise((res) => {
      v.addEventListener('seeked', res, { once: true });
      setTimeout(res, 5000);
    });
    return v.currentTime;
  });
  check('and it seeks', seeked > 0.2, `landed at ${seeked}s`);

  await page.screenshot({ path: `${OUT}/footage-1366.png` });
  check('no console errors', errors.length === 0, errors.join(' ~ '));
  await ctx.close();
}

// --- keeping and deleting ----------------------------------------------------
{
  console.log('\nkeeping and deleting\n');
  const { ctx, page } = await open();
  await film(page);
  await page.locator('.progress-launch', { hasText: /Footage/ }).click();
  await page.waitForSelector('.reclib', { timeout: 15000 });

  await page.locator('.reclib-act').first().click();
  await page.waitForTimeout(300);
  check('keeping a clip sticks in the index',
    (await library(page))?.recordings?.[0]?.starred === true);

  await page.locator('.reclib-act.is-danger').first().click();
  check('deleting asks first', (await page.locator('.reclib-confirm').count()) === 1);

  await page.locator('.reclib-confirm-no').click();
  await page.waitForTimeout(200);
  check('and can be backed out of', (await library(page))?.recordings?.length === 1);

  await page.locator('.reclib-act.is-danger').first().click();
  await page.locator('.reclib-confirm-yes').click();
  await page.waitForTimeout(1200);

  check('deleting removes the entry', (await library(page))?.recordings?.length === 0,
    String((await library(page))?.recordings?.length));

  const onDisk = await page.evaluate(async () => {
    if (!navigator.storage?.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    let count = 0;
    for await (const [, handle] of root.entries()) {
      if (handle.kind !== 'directory') continue;
      for await (const _ of handle.entries()) count++;
    }
    return count;
  });
  check('and the bytes with it', onDisk === 0 || onDisk === null, String(onDisk));

  check('the shelf empties honestly',
    (await page.locator('.empty-state').count()) === 1
    || (await page.locator('.reclib-clip').count()) === 0);
  await ctx.close();
}

// --- a row whose footage has gone -------------------------------------------
{
  console.log('\nfootage that is no longer there\n');
  const { ctx, page, errors } = await open({ recording: recordingState([ORPHAN]) });

  await page.locator('.progress-launch', { hasText: /Footage/ }).click();
  await page.waitForSelector('.reclib', { timeout: 15000 });

  check('a clip cut short says so on its row',
    /disconnected/.test(await page.locator('.reclib-cut').first().innerText()),
    await page.locator('.reclib-cut').first().innerText());

  await page.locator('.reclib-clip-open').first().click();
  await page.waitForSelector('.reclib-status.is-warn', { timeout: 15000 });
  const said = await page.locator('.reclib-status.is-warn').innerText();
  check('a missing file is explained, not a blank player', /gone/.test(said), said);
  check('and no broken video element is left on screen',
    (await page.locator('.reclib-video').count()) === 0);
  check('no console errors', errors.length === 0, errors.join(' ~ '));
  await ctx.close();
}

// --- the widths he practises on ---------------------------------------------
{
  console.log('\non a phone\n');
  for (const width of [360, 390, 430]) {
    const { ctx, page, errors } = await open({
      viewport: { width, height: 844 },
      recording: recordingState([ORPHAN]),
    });
    await page.locator('.progress-launch', { hasText: /Footage/ }).click();
    await page.waitForSelector('.reclib', { timeout: 15000 });
    await page.waitForTimeout(300);

    check(`${width}: no sideways scroll`, (await sideways(page)) <= 0);
    check(`${width}: every control is on screen`, await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.reclib button')];
      return nodes.length > 0 && nodes.every((n) => {
        const b = n.getBoundingClientRect();
        return b.left >= -1 && b.right <= innerWidth + 1;
      });
    }));
    check(`${width}: no console errors`, errors.length === 0, errors.join(' ~ '));
    await page.screenshot({ path: `${OUT}/footage-${width}.png` });
    await ctx.close();
  }
}

await browser.close();
console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
