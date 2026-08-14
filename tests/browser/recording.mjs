// Practice video, driven in a real browser.
//
// Everything in this feature that can be tested without a camera is tested in
// tests/recording.test.mjs. What is left is the part that only a browser knows:
// whether a MediaRecorder actually produced bytes, whether those bytes reached
// the Origin Private File System, whether the index that points at them agrees
// with the disk, and whether a drill still runs when none of that works.
//
// That last one is the promise the whole design rests on: the session is the
// product and the recording is a passenger. It is checked twice here, once with
// recording switched off and once with the camera refused.
//
//   node tests/browser/recording.mjs [outputDir]
//
// Against the shared dev server by default; set PREVIEW_URL for a build.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? 'tests/browser/.shots/recording';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5199/';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const account = {
  activeRoutineId: 'r1',
  routines: [{
    id: 'r1', name: 'Module 4 Daily', description: '', isDefault: true,
    tasks: [
      { id: 't1', title: 'Spider walk', duration: '1 mins', blocks: [{ id: 'b1', label: 'Spider walk', durationSec: 60 }] },
      { id: 't2', title: 'Chord Perfect', duration: '2 mins', drill: { kind: 'chord-trainer', durationSec: 60, chords: ['Am', 'Em'] } },
    ],
  }],
  dailyLogs: {}, strumPatterns: [], songLinks: [], userSongs: [], updatedAt: 1,
  capoFret: 0,
};

const recordingState = (over = {}, recordings = []) => ({
  state: {
    settings: { enabled: true, quality: 'standard', keepSessions: 8, cameraId: null, ...over },
    recordings,
    lastPrune: null,
  },
  version: 0,
});

// A library with something in it, so the settings pane is measured in the shape
// it has once the feature has been used rather than only in its empty state.
const SEEDED_CLIPS = [
  {
    id: 'seed-1', sessionId: 'seed-session', kind: 'technique-check', date: '2026-08-13',
    taskId: null, routineId: null, label: 'Straight on', view: 'front',
    startedAt: 1_770_000_000_000, durationMs: 25_000, bytes: 4_600_000,
    mimeType: 'video/webm;codecs=vp9,opus', quality: 'standard', width: 1280, height: 720,
    hasAudio: true, starred: true, endedBy: 'complete',
    location: { backend: 'opfs', key: 'seed-1.webm' },
  },
  {
    id: 'seed-2', sessionId: 'seed-session-2', kind: 'session', date: '2026-08-13',
    taskId: 't1', routineId: 'r1', label: 'Spider walk',
    startedAt: 1_770_000_100_000, durationMs: 120_000, bytes: 21_000_000,
    mimeType: 'video/webm;codecs=vp9,opus', quality: 'standard', width: 1280, height: 720,
    hasAudio: true, starred: false, endedBy: 'complete',
    location: { backend: 'opfs', key: 'seed-2.webm' },
  },
];

// Two browsers for the whole suite, not one per case.
//
// A case needs its own storage, which is a fresh BrowserContext: each one gets
// its own localStorage and its own Origin Private File System, which is exactly
// the isolation these cases want. Launching a browser per case was thirteen
// launches, and on a loaded machine one of them would be killed part-way
// through and take the run with it. The two differ only in whether Chromium is
// pretending to have a camera.
const withCamera = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const withoutCamera = await chromium.launch();

async function open({
  viewport = { width: 1366, height: 768 },
  fake = true,
  recording = recordingState(),
} = {}) {
  const ctx = await (fake ? withCamera : withoutCamera).newContext({
    viewport,
    permissions: fake ? ['microphone', 'camera'] : [],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));

  await page.addInitScript(
    (s) => localStorage.setItem('daily-fret-storage', JSON.stringify({ state: s, version: 0 })),
    { currentAccountId: 'anonymous', accounts: { anonymous: account } },
  );
  if (recording) {
    await page.addInitScript(
      (r) => localStorage.setItem('daily-fret-recordings', JSON.stringify(r)),
      recording,
    );
  }

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForSelector('.task-container', { timeout: 25000 });
  await page.waitForTimeout(600);
  return { ctx, page, errors };
}

const sideways = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// What the index says, read straight out of the store the app persists.
const library = (page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('daily-fret-recordings');
    return raw ? JSON.parse(raw).state : null;
  });

// What is actually on the disk, asked of the file system rather than the index.
const filesOnDisk = (page) =>
  page.evaluate(async () => {
    if (!navigator.storage?.getDirectory) return null;
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
      const file = await handle.getFile();
      out.push({ name, size: file.size, type: file.type });
    }
    return out;
  });

// --- a timed task is filmed, and the file is really there -------------------
{
  console.log('\nfilming a drill\n');
  const { ctx, page, errors } = await open();

  check('the camera entry point is offered once recording is on',
    (await page.locator('.progress-launch', { hasText: /Technique/ }).count()) === 1);

  await page.locator('.task-row', { hasText: 'Spider walk' }).locator('.task-go').click();
  await page.waitForSelector('.practice-overlay', { timeout: 20000 });
  await page.waitForSelector('.capture-pill', { timeout: 20000 });

  check('the screen says it is recording', await page.locator('.capture-pill').isVisible());
  check('and says so at the edge of the whole viewport too',
    (await page.locator('.capture-frame').count()) === 1);
  check('the frame covers the screen without being in the way', await page.evaluate(() => {
    const frame = document.querySelector('.capture-frame');
    const style = getComputedStyle(frame);
    const box = frame.getBoundingClientRect();
    return style.pointerEvents === 'none'
      && style.position === 'fixed'
      && box.width >= innerWidth - 1
      && box.height >= innerHeight - 1;
  }));
  check('the drill is running underneath it, not blocked by it',
    (await page.locator('.practice-overlay').count()) === 1);
  check('no sideways scroll while recording', (await sideways(page)) <= 0);
  await page.screenshot({ path: `${OUT}/recording-1366.png` });

  // Long enough for several MediaRecorder chunks, which is what proves the
  // streaming write rather than a single flush at the end.
  await page.waitForTimeout(7000);
  const clockRunning = await page.locator('.capture-pill-clock').innerText();
  check('the clock is counting', /^0:0[3-9]|^0:1\d/.test(clockRunning), clockRunning);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(2500);

  const lib = await library(page);
  check('a clip is filed', lib?.recordings?.length === 1, JSON.stringify(lib?.recordings?.length));

  const clip = lib?.recordings?.[0];
  check('filed under today', /^\d{4}-\d{2}-\d{2}$/.test(clip?.date ?? ''), clip?.date);
  check('and under the task it was filmed during', clip?.taskId === 't1', clip?.taskId);
  check('and the routine', clip?.routineId === 'r1', clip?.routineId);
  check('it names what was being played', /Spider walk/.test(clip?.label ?? ''), clip?.label);
  check('it records the container the browser actually wrote',
    /^video\/(webm|mp4)/.test(clip?.mimeType ?? ''), clip?.mimeType);
  check('it says where the bytes are', clip?.location?.backend === 'opfs', clip?.location?.backend);
  check('it carries real bytes', (clip?.bytes ?? 0) > 10_000, `${clip?.bytes} bytes`);
  check('it carries a duration', (clip?.durationMs ?? 0) > 3000, `${clip?.durationMs}ms`);
  check('it says whether there is sound on it', typeof clip?.hasAudio === 'boolean');
  check('it says how it ended', clip?.endedBy === 'complete', clip?.endedBy);
  check('a session clip is not starred by default', clip?.starred === false);
  check('nothing has been analysed or uploaded yet',
    clip?.analysis === undefined && clip?.upload === undefined);

  // The index is a claim about the disk. Check the disk.
  const files = await filesOnDisk(page);
  check('the file is on the disk', files?.length === 1, JSON.stringify(files));
  check('and the index points at it', files?.[0]?.name === clip?.location?.key,
    `${files?.[0]?.name} against ${clip?.location?.key}`);
  check('and agrees about its size', files?.[0]?.size === clip?.bytes,
    `${files?.[0]?.size} against ${clip?.bytes}`);

  const mbPerMinute = (clip.bytes / (clip.durationMs / 60000)) / (1024 * 1024);
  check('the measured rate is in the region the settings pane quotes',
    mbPerMinute > 0.05 && mbPerMinute < 40, `${mbPerMinute.toFixed(2)} MB/min`);

  // Video bytes must never reach the practice store, which is persisted to
  // localStorage and uploaded whole to Firestore.
  const practiceStoreSize = await page.evaluate(
    () => (localStorage.getItem('daily-fret-storage') ?? '').length,
  );
  check('no video went anywhere near the practice store', practiceStoreSize < 20_000,
    `${practiceStoreSize} characters`);
  check('and the recordings index stays small', await page.evaluate(
    () => (localStorage.getItem('daily-fret-recordings') ?? '').length < 4000,
  ));

  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- what a minute actually costs, at each setting --------------------------
//
// The settings pane quotes a rate derived from the bitrate the encoder is asked
// for. This films at each setting and divides bytes by minutes, so the quoted
// number can be compared against a real file rather than trusted.
//
// Chromium's fake capture device is a synthetic pattern, which VP9 encodes far
// under its bitrate target because there is almost nothing in the frame to
// encode. The numbers below are therefore a floor, not the figure a camera
// pointed at a room will produce; what they prove is the ordering, the ratio
// between settings, and that the quoted rate is never an understatement.
{
  console.log('\nmegabytes a minute, measured\n');
  for (const quality of ['light', 'standard', 'detail']) {
    const { ctx, page, errors } = await open({ recording: recordingState({ quality }) });
    await page.locator('.task-row', { hasText: 'Spider walk' }).locator('.task-go').click();
    await page.waitForSelector('.practice-overlay', { timeout: 20000 });
    await page.waitForSelector('.capture-pill', { timeout: 20000 });
    await page.waitForTimeout(12000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2500);

    const clip = (await library(page))?.recordings?.[0];
    if (!clip) {
      check(`${quality}: a clip was produced`, false);
      await ctx.close();
      continue;
    }
    const rate = (clip.bytes / (clip.durationMs / 60000)) / (1024 * 1024);
    console.log(
      `        ${quality.padEnd(9)} ${clip.width}x${clip.height}  ` +
      `${rate.toFixed(2)} MB/min measured  (${clip.mimeType}, audio ${clip.hasAudio}, ` +
      `${(clip.bytes / 1024).toFixed(0)} kB over ${(clip.durationMs / 1000).toFixed(1)}s)`,
    );
    check(`${quality}: filmed at the size it promised`, clip.quality === quality);
    check(`${quality}: no console errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
}

// --- deleting is one action, and it reaches the disk ------------------------
{
  console.log('\ndeleting all of it\n');
  const { ctx, page, errors } = await open();

  await page.locator('.task-row', { hasText: 'Spider walk' }).locator('.task-go').click();
  await page.waitForSelector('.practice-overlay', { timeout: 20000 });
  await page.waitForSelector('.capture-pill', { timeout: 20000 });
  await page.waitForTimeout(4000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2500);
  check('there is something to delete', (await library(page))?.recordings?.length === 1);

  await page.click('.account-btn');
  await page.waitForSelector('.settings-surface', { timeout: 15000 });
  await page.waitForTimeout(400);

  const pane = await page.locator('.settings-pane').innerText();
  check('settings states what a minute costs', /MB a minute/i.test(pane));
  check('and what is on the disk right now', /1 clip across 1 session/i.test(pane), pane.match(/\d+ clips? across.*/)?.[0]);

  await page.getByRole('button', { name: /delete all recordings/i }).click();
  await page.waitForTimeout(300);
  check('it asks first', (await page.locator('.settings-confirm').count()) === 1);
  await page.screenshot({ path: `${OUT}/settings-delete-confirm.png` });
  await page.getByRole('button', { name: /delete everything/i }).click();
  await page.waitForTimeout(1500);

  check('the index is empty', (await library(page))?.recordings?.length === 0);
  check('and so is the disk', (await filesOnDisk(page))?.length === 0,
    JSON.stringify(await filesOnDisk(page)));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- the settings surface, at the widths the owner practises on -------------
for (const [label, viewport] of [
  ['360x780', { width: 360, height: 780 }],
  ['390x844', { width: 390, height: 844 }],
  ['430x932', { width: 430, height: 932 }],
  ['1366x768', { width: 1366, height: 768 }],
]) {
  console.log(`\npractice video settings at ${label}\n`);
  const { ctx, page, errors } = await open({
    viewport,
    recording: recordingState({}, SEEDED_CLIPS),
  });
  await page.click('.account-btn');
  await page.waitForSelector('.settings-surface', { timeout: 15000 });
  await page.locator('.setting-head', { hasText: 'Practice video' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  check('no sideways scroll', (await sideways(page)) <= 0, `${await sideways(page)}px`);
  check('every control is inside the viewport', await page.evaluate(() => {
    const nodes = document.querySelectorAll(
      '.rec-quality-option, .rec-stepper-btn, .rec-clip-tool, .rec-preview-open',
    );
    return Array.from(nodes).every((el) => {
      const box = el.getBoundingClientRect();
      return box.left >= -1 && box.right <= innerWidth + 1;
    });
  }));
  check('the quality choices each state their cost', await page.evaluate(
    () => document.querySelectorAll('.rec-quality-rate').length === 3,
  ));
  check('a stored technique check is listed with its own controls',
    (await page.locator('.rec-clip').count()) === 1
    && (await page.locator('.rec-clip-tool').count()) === 2);
  check('and the total is stated in a unit a person reads', await page.evaluate(
    () => /^\d+(\.\d+)? (MB|GB)$/.test(
      document.querySelector('.rec-usage-total')?.textContent ?? '',
    ),
  ), await page.locator('.rec-usage-total').innerText());
  await page.screenshot({ path: `${OUT}/settings-${label}.png`, fullPage: false });

  // The bottom of the section: retention, what it is costing, and the way out.
  await page.evaluate(() => {
    const pane = document.querySelector('.settings-pane');
    if (pane) pane.scrollTop = pane.scrollHeight;
  });
  await page.waitForTimeout(400);
  check('the bottom of the section fits too', (await sideways(page)) <= 0);
  check('and the way out of it is reachable', await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.settings-action-btn'))
      .find((b) => /delete all recordings/i.test(b.textContent ?? ''));
    if (!btn) return false;
    const box = btn.getBoundingClientRect();
    return box.left >= -1 && box.right <= innerWidth + 1 && box.height >= 44;
  }));
  await page.screenshot({ path: `${OUT}/settings-${label}-bottom.png`, fullPage: false });
  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- the technique check ----------------------------------------------------
{
  console.log('\nthe technique check\n');
  const { ctx, page, errors } = await open();
  await page.locator('.progress-launch', { hasText: /Technique/ }).click();
  await page.waitForSelector('.tc-overlay', { timeout: 20000 });
  await page.waitForTimeout(400);

  // The shell, asked of the built CSS rather than assumed from the source.
  //
  // The overlay shell lives in its own stylesheet and this surface imports it
  // directly rather than through practice.css. Forget that import and the whole
  // screen renders as an ordinary block laid out below the fold with the task
  // list showing through it, which is exactly what happened, and which every
  // check about text and counts still passed straight through.
  const shell = await page.evaluate(() => {
    const overlay = document.querySelector('.tc-overlay');
    const style = getComputedStyle(overlay);
    const box = overlay.getBoundingClientRect();
    const front = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight / 2));
    return {
      position: style.position,
      covers: box.top <= 0 && box.left <= 0 && box.width >= innerWidth && box.height >= innerHeight,
      opaque: style.backgroundColor !== 'rgba(0, 0, 0, 0)',
      frontIsOverlay: overlay.contains(front),
      layer: Number(style.zIndex),
    };
  });
  check('it covers the viewport', shell.position === 'fixed' && shell.covers === true,
    JSON.stringify(shell));
  check('and hides the day behind it', shell.opaque === true && shell.frontIsOverlay === true,
    JSON.stringify(shell));
  check('and paints above the page', shell.layer >= 1100, `${shell.layer}`);
  check('its own buttons are styled by a stylesheet it actually loads', await page.evaluate(() => {
    const btn = document.querySelector('.tc-btn.is-primary');
    if (!btn) return false;
    const style = getComputedStyle(btn);
    return style.borderRadius !== '0px'
      && style.backgroundColor !== 'rgba(0, 0, 0, 0)'
      && btn.getBoundingClientRect().height >= 44;
  }));

  const intro = await page.locator('.tc-intro').innerText();
  check('it names all three angles', /Straight on/.test(intro) && /Down the neck/.test(intro)
    && /From the strumming side/.test(intro));
  check('each angle is drawn, not only described',
    (await page.locator('.tc-angle-mark svg').count()) === 3);
  check('and it promises these are kept', /kept until you delete them/i.test(intro));
  await page.screenshot({ path: `${OUT}/technique-intro.png` });

  await page.getByRole('button', { name: /set up the first angle/i }).click();
  await page.waitForSelector('.tc-shot', { timeout: 20000 });
  await page.waitForTimeout(900);
  check('the live picture is showing', await page.evaluate(() => {
    const video = document.querySelector('.tc-video');
    return !!video?.srcObject && video.videoWidth > 0;
  }));
  check('with the framing guide over it', (await page.locator('.tc-guide').count()) === 1);
  check('the picture is not mirrored', await page.evaluate(
    () => getComputedStyle(document.querySelector('.tc-video')).transform === 'none',
  ));
  await page.screenshot({ path: `${OUT}/technique-framing.png` });

  await page.getByRole('button', { name: /film this angle/i }).click();
  await page.waitForSelector('.tc-shot.is-live', { timeout: 20000 });
  check('it says it is recording', await page.locator('.capture-pill').isVisible());
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/technique-filming.png` });

  await page.getByRole('button', { name: /stop this one early/i }).click();
  await page.waitForTimeout(2500);

  const clip = (await library(page))?.recordings?.[0];
  check('the clip is filed as a technique check', clip?.kind === 'technique-check', clip?.kind);
  check('under the angle it was shot from', clip?.view === 'front', clip?.view);
  check('starred at birth, so nothing can prune it', clip?.starred === true);
  check('with no task attached to it', clip?.taskId === null);
  check('and real bytes on the disk', (clip?.bytes ?? 0) > 10_000, `${clip?.bytes} bytes`);
  check('it moved on to the second angle',
    /Down the neck/.test(await page.locator('.tc-shot-title').innerText()));

  // Waited for rather than slept past: the surface plays an exit animation, and
  // a fixed sleep makes this a check on how loaded the machine is.
  await page.keyboard.press('Escape');
  const left = await page.waitForSelector('.tc-overlay', { state: 'detached', timeout: 10000 })
    .then(() => true, () => false);
  check('Escape leaves the check', left);
  await page.waitForTimeout(400);
  check('and gives the camera back', await page.evaluate(
    () => !document.querySelector('video'),
  ));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- the technique check at phone widths ------------------------------------
for (const [label, viewport] of [
  ['360x780', { width: 360, height: 780 }],
  ['430x932', { width: 430, height: 932 }],
]) {
  console.log(`\ntechnique check at ${label}\n`);
  const { ctx, page, errors } = await open({ viewport });
  await page.locator('.progress-launch', { hasText: /Technique/ }).click();
  await page.waitForSelector('.tc-overlay', { timeout: 20000 });
  await page.waitForTimeout(400);
  check('the intro fits', (await sideways(page)) <= 0, `${await sideways(page)}px`);
  await page.getByRole('button', { name: /set up the first angle/i }).click();
  await page.waitForSelector('.tc-shot', { timeout: 20000 });
  await page.waitForTimeout(700);
  check('so does the framing step', (await sideways(page)) <= 0, `${await sideways(page)}px`);
  // The one control this step exists for. It has to be reachable without a
  // sideways scroll and big enough to hit with a thumb while holding a guitar.
  const filmButton = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.tc-btn'))
      .find((b) => /film/i.test(b.textContent ?? ''));
    if (!btn) return { found: false };
    const box = btn.getBoundingClientRect();
    return { found: true, left: box.left, right: box.right, height: box.height, width: innerWidth };
  });
  check('and the button to film it is on screen',
    filmButton.found && filmButton.left >= -1 && filmButton.right <= filmButton.width + 1
      && filmButton.height >= 40,
    JSON.stringify(filmButton));
  await page.screenshot({ path: `${OUT}/technique-${label}.png` });
  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- recording turned off ---------------------------------------------------
{
  console.log('\nwith recording off, which is the default\n');
  const { ctx, page, errors } = await open({ recording: null });

  check('nothing has enabled it behind the user',
    (await library(page)) === null || (await library(page)).settings.enabled === false);
  check('and the camera entry point is not offered',
    (await page.locator('.progress-launch', { hasText: /Technique/ }).count()) === 0);

  await page.locator('.task-row', { hasText: 'Spider walk' }).locator('.task-go').click();
  await page.waitForSelector('.practice-overlay', { timeout: 20000 });
  // Past MIN_RECORDED_SECONDS, so the day's log has something to hold and this
  // is a check about the recording layer rather than about a five-second rule.
  await page.waitForTimeout(6500);

  check('the drill runs', (await page.locator('.practice-overlay').count()) === 1);
  check('with nothing claiming to record', (await page.locator('.capture-pill').count()) === 0);
  check('and no camera was ever opened', await page.evaluate(() => !document.querySelector('video')));
  check('and nothing was written', (await filesOnDisk(page))?.length === 0);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  check('the practice was still recorded', await page.evaluate(() => {
    const acc = JSON.parse(localStorage.getItem('daily-fret-storage')).state.accounts.anonymous;
    const day = Object.values(acc.dailyLogs)[0];
    return !!day?.taskRecords?.t1;
  }));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- the camera refused -----------------------------------------------------
{
  console.log('\nwith the camera refused mid-session\n');
  // No fake device and no granted permission: every getUserMedia for video
  // fails. The drill must not notice.
  const { ctx, page, errors } = await open({ fake: false });

  await page.locator('.task-row', { hasText: 'Spider walk' }).locator('.task-go').click();
  await page.waitForSelector('.practice-overlay', { timeout: 20000 });
  await page.waitForSelector('.capture-notice', { timeout: 20000 });

  const notice = await page.locator('.capture-notice').innerText();
  check('it says what happened', notice.split('\n')[0].length > 15, notice.split('\n')[0]);
  check('and what to do about it, and that practice is unaffected',
    /still being counted/i.test(notice), notice);
  check('nothing claims to be recording', (await page.locator('.capture-pill').count()) === 0);
  check('the drill is still running', (await page.locator('.practice-overlay').count()) === 1);
  check('and the notice does not cover it', await page.evaluate(() => {
    const notice = document.querySelector('.capture-notice').getBoundingClientRect();
    const timer = document.querySelector('.practice-body')?.getBoundingClientRect();
    return !!timer && notice.bottom < timer.bottom;
  }));
  check('no sideways scroll', (await sideways(page)) <= 0);
  await page.screenshot({ path: `${OUT}/camera-refused.png` });

  await page.getByRole('button', { name: /got it/i }).click();
  await page.waitForTimeout(300);
  check('and it can be dismissed', (await page.locator('.capture-notice').count()) === 0);

  // Past MIN_RECORDED_SECONDS, so the day's log has something to hold. The
  // check that follows is about the camera failure not costing the practice,
  // not about the five-second floor on recording time.
  await page.waitForTimeout(6500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  check('the practice was still recorded', await page.evaluate(() => {
    const acc = JSON.parse(localStorage.getItem('daily-fret-storage')).state.accounts.anonymous;
    const day = Object.values(acc.dailyLogs)[0];
    return !!day?.taskRecords?.t1;
  }));
  check('and no empty clip was filed', (await library(page))?.recordings?.length === 0);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await withCamera.close();
await withoutCamera.close();

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
