// The spine, driven in a real browser.
//
// tests/browser/recording.mjs proves bytes reach the disk. That is not the same
// as proving the feature works, and the difference is what this file is for: a
// recorder that writes a corrupt container passes a byte-count test and fails a
// human. So the central assertion is that the stored bytes decode into a video
// the browser will actually play and seek, reached the way the owner reaches it.
//
// The rest is the loop around that: the weekly rule that decides whether a
// session is filmed at all, a clip he can keep, one he can delete, and the
// honest state for a row whose footage has gone missing underneath it.
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

const recordingState = (recordings = [], over = {}) => ({
  state: {
    settings: {
      enabled: true, cadence: 'weekly', quality: 'standard',
      // Weekly films on a named day. Say the day is today, or every assertion
      // below would pass or fail according to the calendar.
      filmDay: new Date().getDay(),
      keepSessions: 8, cameraId: null, ...over,
    },
    recordings,
    lastPrune: null,
  },
  version: 0,
});

const DAY = 86_400_000;

/** A row whose bytes are not on disk: the index and the footage can diverge. */
const orphan = (over = {}) => ({
  id: 'orphan-1', sessionId: 'orphan-session', kind: 'session', date: '2026-08-13',
  taskId: 't1', routineId: 'r1', label: 'Spider walk',
  startedAt: Date.now() - 30 * DAY, durationMs: 60_000, bytes: 8_000_000,
  mimeType: 'video/webm;codecs=vp9,opus', quality: 'standard', width: 1280, height: 720,
  hasAudio: true, starred: false, endedBy: 'device-lost',
  location: { backend: 'opfs', key: 'nothing-here.webm' },
  ...over,
});

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

async function film(page, seconds = 7) {
  await page.locator('.task-row', { hasText: 'Spider walk' }).locator('.task-go').click();
  await page.waitForSelector('.practice-overlay', { timeout: 20000 });
  await page.waitForTimeout(seconds * 1000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2500);
}

const openShelf = async (page) => {
  await page.locator('.progress-launch', { hasText: /Footage/ }).click();
  await page.waitForSelector('.spine', { timeout: 15000 });
};

// --- the weekly rule ---------------------------------------------------------
//
// The rule is a named day, and every session on it. It used to be one take per
// rolling six days measured from the last clip, which walked the filming day
// backwards through the week and stopped after the first session, so a day with
// two sessions in it kept the warm-up and threw away the run that went well.
{
  console.log('\nhow often it films\n');
  const { ctx, page } = await open();

  await film(page);
  check('the day it was told to film, it films', (await library(page))?.recordings?.length === 1,
    String((await library(page))?.recordings?.length));

  // The change the owner asked for. A second session on the filming day is a
  // second take, not a duplicate.
  //
  // Deliberately without a reload between them. The seed is installed by
  // addInitScript, which runs on every navigation, so reloading would put the
  // empty library back and the count would read 1 whatever the rule did. The old
  // assertion here expected 1 and so could never tell the two apart.
  await film(page, 7);
  check('and a second session that same day films too',
    (await library(page))?.recordings?.length === 2,
    String((await library(page))?.recordings?.length));
  await ctx.close();
}

{
  // Any other day, nothing. Told to film tomorrow, it does not film today.
  const { ctx, page } = await open({
    recording: recordingState([], { filmDay: (new Date().getDay() + 1) % 7 }),
  });
  await film(page, 4);
  check('a session on any other day is not filmed',
    (await library(page))?.recordings?.length === 0,
    String((await library(page))?.recordings?.length));
  await ctx.close();
}

{
  const { ctx, page } = await open({
    recording: recordingState([orphan({ startedAt: Date.now() - 9 * DAY })]),
  });
  await film(page, 4);
  check('an old clip in the library does not hold the day back',
    (await library(page))?.recordings?.length === 2,
    String((await library(page))?.recordings?.length));
  await ctx.close();
}

{
  const { ctx, page } = await open({ recording: recordingState([], { cadence: 'manual' }) });
  await film(page, 4);
  check('on manual it never films a session', (await library(page))?.recordings?.length === 0,
    String((await library(page))?.recordings?.length));
  await ctx.close();
}

// --- filmed, then watched ----------------------------------------------------
{
  console.log('\nfilmed, then watched\n');
  const { ctx, page, errors } = await open();

  check('no shelf is advertised before anything is filmed',
    (await page.locator('.progress-launch', { hasText: /Footage/ }).count()) === 0);

  await film(page);
  check('now the shelf is offered',
    (await page.locator('.progress-launch', { hasText: /Footage/ }).count()) === 1);

  await openShelf(page);

  check('the screen opens on a stated fact, not a file count',
    /Filmed on/.test(await page.locator('.spine-fact').first().innerText()),
    await page.locator('.spine-fact').first().innerText());
  check('the month is named', (await page.locator('.spine-month-name').count()) >= 1,
    await page.locator('.spine-month-name').first().innerText());
  check('the month carries a density row, one tick per day',
    (await page.locator('.spine-month').first().locator('.spine-tick').count()) >= 28,
    String(await page.locator('.spine-month').first().locator('.spine-tick').count()));
  check('lit ticks match filmed days',
    (await page.locator('.spine-tick.is-on').count()) === 1,
    String(await page.locator('.spine-tick.is-on').count()));
  check('the day sits on the spine', (await page.locator('.spine-day').count()) === 1);
  check('and names what was played',
    /Spider walk/.test(await page.locator('.take-name').first().innerText()),
    await page.locator('.take-name').first().innerText());

  // The still is the thing that stops this being a file list.
  await page.waitForSelector('.poster-img', { timeout: 20000 });
  const poster = await page.evaluate(async () => {
    const img = document.querySelector('.poster-img');
    // The src being a data URL says the decode produced something; naturalWidth
    // only says so once the browser has read it back, which is a beat later.
    if (!img.complete || img.naturalWidth === 0) {
      await new Promise((res) => {
        img.addEventListener('load', res, { once: true });
        img.addEventListener('error', res, { once: true });
        setTimeout(res, 8000);
      });
    }
    return { src: img.src.slice(0, 15), w: img.naturalWidth, h: img.naturalHeight };
  });
  check('a real still was decoded out of the clip', poster.w > 0 && poster.h > 0,
    `${poster.w}x${poster.h}`);
  check('and it is a cached data URL, not a live object URL',
    poster.src.startsWith('data:image'), poster.src);

  await page.locator('.take').first().click();
  await page.waitForSelector('.stage-video', { timeout: 15000 });

  const decoded = await page.evaluate(async () => {
    const v = document.querySelector('.stage-video');
    if (!v) return { readyState: -1 };
    if (v.readyState < 1) {
      await new Promise((res) => {
        v.addEventListener('loadedmetadata', res, { once: true });
        setTimeout(res, 8000);
      });
    }
    if (!Number.isFinite(v.duration)) {
      await new Promise((res) => {
        v.addEventListener('durationchange', () => { if (Number.isFinite(v.duration)) res(); });
        setTimeout(res, 8000);
      });
    }
    return {
      readyState: v.readyState, duration: v.duration,
      width: v.videoWidth, height: v.videoHeight, src: v.currentSrc.slice(0, 5),
    };
  });

  check('the stored bytes decode into a video', decoded.readyState >= 1,
    `readyState ${decoded.readyState}`);
  check('with a real duration', Number.isFinite(decoded.duration) && decoded.duration > 1,
    `${decoded.duration}s`);
  check('and real dimensions', decoded.width > 0 && decoded.height > 0,
    `${decoded.width}x${decoded.height}`);
  check('played from a blob', decoded.src === 'blob:', decoded.src);

  const seeked = await page.evaluate(async () => {
    const v = document.querySelector('.stage-video');
    v.currentTime = Math.min(2, (v.duration || 3) / 2);
    await new Promise((res) => {
      v.addEventListener('seeked', res, { once: true });
      setTimeout(res, 5000);
    });
    return v.currentTime;
  });
  check('and it seeks', seeked > 0.2, `landed at ${seeked}s`);

  check('a practice take offers no comparison',
    (await page.locator('.stage-act', { hasText: /Hold against/ }).count()) === 0);

  await page.screenshot({ path: `${OUT}/spine-1366.png`, fullPage: true });
  check('no console errors', errors.length === 0, errors.join(' ~ '));
  await ctx.close();
}

// --- keeping and deleting ----------------------------------------------------
{
  console.log('\nkeeping and deleting\n');
  const { ctx, page } = await open();
  await film(page);
  await openShelf(page);
  await page.locator('.take').first().click();
  await page.waitForSelector('.stage', { timeout: 15000 });

  await page.locator('.stage-act', { hasText: /^Keep$/ }).click();
  await page.waitForTimeout(300);
  check('keeping a clip sticks in the index',
    (await library(page))?.recordings?.[0]?.starred === true);

  await page.locator('.stage-act.is-danger').click();
  check('deleting asks first', (await page.locator('.stage-confirm').count()) === 1);
  await page.locator('.stage-confirm-no').click();
  await page.waitForTimeout(200);
  check('and can be backed out of', (await library(page))?.recordings?.length === 1);

  await page.locator('.stage-act.is-danger').click();
  await page.locator('.stage-confirm-yes').click();
  await page.waitForTimeout(1500);

  check('deleting removes the entry', (await library(page))?.recordings?.length === 0,
    String((await library(page))?.recordings?.length));

  const left = await page.evaluate(async () => {
    if (!navigator.storage?.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    let files = 0;
    for await (const [name, handle] of root.entries()) {
      if (handle.kind !== 'directory' || name === 'posters') continue;
      for await (const _ of handle.entries()) files++;
    }
    return files;
  });
  check('and the bytes with it', left === 0 || left === null, String(left));

  const posters = await page.evaluate(async () => {
    if (!navigator.storage?.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    try {
      const dir = await root.getDirectoryHandle('posters');
      let n = 0;
      for await (const _ of dir.entries()) n++;
      return n;
    } catch { return 0; }
  });
  check('the still goes with the clip, not left behind', posters === 0 || posters === null,
    String(posters));
  await ctx.close();
}

// --- footage that is no longer there -----------------------------------------
{
  console.log('\nfootage that is no longer there\n');
  const { ctx, page, errors } = await open({ recording: recordingState([orphan()]) });
  await openShelf(page);

  await page.locator('.take').first().click();
  await page.waitForSelector('.stage-note.is-gone', { timeout: 15000 });
  const said = await page.locator('.stage-note.is-gone').innerText();
  check('a missing file is explained, not a blank player', /gone/.test(said), said);
  check('and no broken video element is left on screen',
    (await page.locator('.stage-video').count()) === 0);
  check('a clip cut short says why', /disconnected/.test(await page.locator('.stage-cut').innerText()),
    await page.locator('.stage-cut').innerText());
  check('no console errors', errors.length === 0, errors.join(' ~ '));
  await ctx.close();
}

// --- holding one technique take against another ------------------------------
//
// Two index rows over one real file. The comparison is about whether two clips
// play in step from one control, and seeding rows that point at nothing would
// have proved only that two empty boxes appear, which is what the first version
// of this case actually did.
{
  console.log('\nholding one take against another\n');
  const { ctx, page, errors } = await open();
  await film(page);

  const filmed = (await library(page))?.recordings?.[0];
  check('there is real footage to compare', !!filmed?.location?.key, filmed?.location?.key);

  const base = {
    kind: 'technique-check', taskId: null, routineId: null, view: 'neck',
    label: 'Down the neck', durationMs: filmed.durationMs, bytes: filmed.bytes,
    mimeType: filmed.mimeType, quality: 'standard',
    width: filmed.width, height: filmed.height, hasAudio: filmed.hasAudio,
    starred: true, endedBy: 'complete', location: filmed.location,
  };
  const rows = [
    { ...base, id: 'n1', sessionId: 'c2', date: '2026-08-14', startedAt: Date.now() - 2 * DAY },
    { ...base, id: 'n0', sessionId: 'c1', date: '2026-06-14', startedAt: Date.now() - 62 * DAY },
    { ...base, id: 'f0', sessionId: 'c1', view: 'front', label: 'Straight on',
      date: '2026-06-14', startedAt: Date.now() - 62 * DAY },
  ];
  // Through a later init script, not a plain write: the seeding script added in
  // open() runs again on every navigation and would put the empty library back.
  await page.addInitScript(
    (r) => {
      const raw = JSON.parse(localStorage.getItem('daily-fret-recordings'));
      raw.state.recordings = r;
      localStorage.setItem('daily-fret-recordings', JSON.stringify(raw));
    },
    rows,
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.task-container', { timeout: 25000 });
  await page.waitForTimeout(600);
  await openShelf(page);

  check('two months are on the spine', (await page.locator('.spine-month').count()) === 2,
    String(await page.locator('.spine-month').count()));
  check('the rail lists both', (await page.locator('.spine-rail-mark').count()) === 2,
    String(await page.locator('.spine-rail-mark').count()));

  await page.locator('.take', { hasText: 'Down the neck' }).first().click();
  await page.waitForSelector('.stage-video', { timeout: 15000 });

  check('a technique take offers an earlier one to hold it against',
    (await page.locator('.stage-act', { hasText: /Hold against/ }).count()) === 1);

  await page.locator('.stage-act', { hasText: /Hold against/ }).click();
  await page.waitForSelector('.stage.is-paired .stage-screen.is-past .stage-video', { timeout: 15000 });

  check('two screens appear', (await page.locator('.stage-screen').count()) === 2,
    String(await page.locator('.stage-screen').count()));
  check('both are real video', (await page.locator('.stage-video').count()) === 2,
    String(await page.locator('.stage-video').count()));
  check('and it says how far apart they are',
    /apart/i.test(await page.locator('.stage-gap').innerText()),
    await page.locator('.stage-gap').innerText());
  check('only one carries controls, so one scrubber drives both',
    (await page.locator('.stage-video[controls]').count()) === 1,
    String(await page.locator('.stage-video[controls]').count()));

  // The mechanic itself: move the lead and the follower goes with it.
  const stepped = await page.evaluate(async () => {
    const [past, now] = [...document.querySelectorAll('.stage-video')];
    const lead = now.hasAttribute('controls') ? now : past;
    const follow = lead === now ? past : now;
    for (const v of [lead, follow]) {
      if (v.readyState < 1) {
        await new Promise((res) => {
          v.addEventListener('loadedmetadata', res, { once: true });
          setTimeout(res, 8000);
        });
      }
      if (!Number.isFinite(v.duration)) {
        await new Promise((res) => {
          v.addEventListener('durationchange', () => { if (Number.isFinite(v.duration)) res(); });
          setTimeout(res, 8000);
        });
      }
    }
    lead.currentTime = 3;
    await new Promise((res) => {
      lead.addEventListener('seeked', res, { once: true });
      setTimeout(res, 5000);
    });
    await new Promise((res) => setTimeout(res, 600));
    return { lead: lead.currentTime, follow: follow.currentTime };
  });
  check('scrubbing one moves the other', Math.abs(stepped.lead - stepped.follow) < 0.5,
    `lead ${stepped.lead.toFixed(2)}s, follower ${stepped.follow.toFixed(2)}s`);

  await page.screenshot({ path: `${OUT}/compare-1366.png` });

  // A front-angle take has nothing earlier of its own and must not be offered
  // the neck take: two camera positions differ for reasons that are not playing.
  await page.locator('.stage-act', { hasText: /On its own/ }).click();
  await page.waitForTimeout(200);
  // Escape belongs to the stage, not to the screen underneath it: closing the
  // whole shelf here would lose the reader's place on the spine.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('Escape closes the clip, not the whole shelf',
    (await page.locator('.stage').count()) === 0 && (await page.locator('.spine').count()) === 1,
    `stage ${await page.locator('.stage').count()}, spine ${await page.locator('.spine').count()}`);
  await page.locator('.take', { hasText: 'Straight on' }).first().click();
  await page.waitForSelector('.stage', { timeout: 15000 });
  check('an angle with no earlier take of its own offers no comparison',
    (await page.locator('.stage-act', { hasText: /Hold against/ }).count()) === 0);

  check('no console errors', errors.length === 0, errors.join(' ~ '));
  await ctx.close();
}

// --- the widths he practises on ----------------------------------------------
{
  console.log('\non a phone\n');
  for (const width of [360, 390, 430]) {
    const { ctx, page, errors } = await open({
      viewport: { width, height: 844 },
      recording: recordingState([orphan()]),
    });
    await openShelf(page);
    await page.waitForTimeout(400);

    check(`${width}: no sideways scroll`, (await sideways(page)) <= 0);
    check(`${width}: every control is on screen`, await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.spine button')];
      return nodes.length > 0 && nodes.every((n) => {
        const b = n.getBoundingClientRect();
        return b.left >= -1 && b.right <= innerWidth + 1;
      });
    }));

    await page.locator('.take').first().click();
    await page.waitForTimeout(500);
    check(`${width}: the stage fits too`, (await sideways(page)) <= 0);
    check(`${width}: no console errors`, errors.length === 0, errors.join(' ~ '));
    await page.screenshot({ path: `${OUT}/spine-${width}.png`, fullPage: true });
    await ctx.close();
  }
}

await browser.close();
console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
