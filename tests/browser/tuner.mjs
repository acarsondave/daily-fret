// The tuner, in both engines, under every way it can fail to hear.
//
// This suite exists because of one bug report: "that tuner section is not even
// working, just stuck at listening and doesn't really even open". Two separate
// code paths produced that sentence, and neither raised an error anywhere:
//
//   1. The tuner's chunk stalled. The Suspense fallback said "Listening…" over
//      the whole screen, forever, with no close button.
//   2. The overlay shell's stylesheet only ever arrived with the drill
//      components, so a tuner opened before any drill had `position: static`
//      and laid itself out below the fold. Everything was in the DOM and
//      nothing was on screen, which is exactly "doesn't really even open".
//   3. WebKit refused to start the AudioContext (it is created after
//      `await getUserMedia`, by which point the click has expired) and left the
//      resume() promise pending rather than rejecting it, so start() never
//      returned. The tuner opened and sat there reading "listening".
//
// Every check below is one of those, or one of the states next to them.
//
//   node tests/browser/tuner.mjs [outputDir]
//
// Against the shared dev server by default; set PREVIEW_URL for a build.

import { chromium, webkit } from 'playwright';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFixtures } from './tone.mjs';

const OUT = process.argv[2] ?? 'tests/browser/.shots';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5199/';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const account = {
  activeRoutineId: 'r1',
  currentLesson: 'b1-403',
  routines: [{
    id: 'r1', name: 'Module 4 Daily', description: '', isDefault: true,
    tasks: [
      { id: 't1', title: 'Chord Perfect', duration: '10 mins', drill: { kind: 'chord-trainer', durationSec: 90, chords: ['Am', 'Em'] } },
      { id: 't2', title: 'Spider walk', duration: '5 mins' },
    ],
  }],
  dailyLogs: {}, strumPatterns: [], songLinks: [], updatedAt: 1,
};
const seed = { currentAccountId: 'anonymous', accounts: { anonymous: account } };

// --- the conditions a microphone can be in --------------------------------

const MIC = {
  // Refused outright. Safari never re-prompts after this, so the surface has to
  // carry the way back itself.
  denied: () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')),
      },
    });
  },
  // Nothing plugged in.
  missing: () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => Promise.reject(new DOMException('None', 'NotFoundError')),
      },
    });
  },
  // Held by another app or tab, which on a Mac is the commonest of all.
  busy: () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => Promise.reject(new DOMException('Busy', 'NotReadableError')),
      },
    });
  },
  // No capture API at all: what a page served over plain http actually sees.
  absent: () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  },
  // The regression that matters most. Permission is granted and the graph
  // builds, but the route will not start and resume() never settles. Anything
  // that awaits it hangs; the surface must say so instead. This is WebKit's
  // documented behaviour for a denied resume, reproduced in both engines.
  refusedRoute: () => {
    const Ctor = window.AudioContext;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        // A real audio track with no device behind it, so the graph builds in
        // headless engines that have no microphone to offer.
        getUserMedia: async () => new Ctor().createMediaStreamDestination().stream,
      },
    });
    Object.defineProperty(Ctor.prototype, 'state', { configurable: true, get: () => 'suspended' });
    Ctor.prototype.resume = () => new Promise(() => {});
  },
};

async function open(launcher, { mic, viewport, route } = {}) {
  const browser = await launcher.launch(
    launcher === chromium
      ? { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }
      : {},
  );
  const ctx = await browser.newContext({
    viewport: viewport ?? { width: 1366, height: 680 },
    permissions: launcher === chromium ? ['microphone'] : undefined,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));
  await page.addInitScript(
    (s) => localStorage.setItem('daily-fret-storage', JSON.stringify({ state: s, version: 0 })),
    seed,
  );
  if (mic) await page.addInitScript(MIC[mic]);

  // The dev server is shared and can be mid-restart; one retry rather than a
  // flaky suite.
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
  } catch {
    await page.waitForTimeout(2500);
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
  }
  await page.waitForSelector('.task-container', { timeout: 25000 });
  await page.waitForTimeout(800);
  // Registered after the page is up: Playwright dispatches route handlers in
  // order, so a handler that never settles would hold the navigation itself.
  if (route) await page.route('**/Tuner*', route);
  await page.locator('.progress-launch', { hasText: /^Tune$/ }).click({ force: true });
  return { browser, page, errors };
}

const text = (page, sel) => page.locator(sel).first().innerText().catch(() => null);
const sideways = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const [name, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
  // --- it opens, and never says it is listening while it is not ------------
  {
    console.log(`\n${name}: the tuner opens\n`);
    const { browser, page, errors } = await open(launcher, { mic: 'denied' });
    await page.waitForSelector('.tuner-overlay, .tuner-blocked', { timeout: 10000 });
    // Not `isVisible()`: that passed throughout the bug. The overlay was in the
    // DOM and laid out below the fold, so the only honest check is where it is.
    const box = await page.evaluate(() => {
      const el = document.querySelector('.tuner-overlay');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { position: getComputedStyle(el).position, top: r.top, left: r.left, w: r.width, h: r.height };
    });
    check('the overlay covers the viewport', Boolean(box) && box.position === 'fixed'
      && box.top === 0 && box.left === 0
      && box.w >= 1360 && box.h >= 670, JSON.stringify(box));
    check('the loading gate is gone', (await page.locator('.tuner-gate').count()) === 0);
    const body = await page.locator('.tuner-overlay').innerText();
    check('nothing on it claims to be listening', !/listening/i.test(body), body.replace(/\n/g, ' ').slice(0, 120));
    check('no console errors', errors.length === 0, errors.join(' | '));
    await browser.close();
  }

  // --- a refused audio route is stated, not spun on ------------------------
  {
    console.log(`\n${name}: the browser will not start audio\n`);
    const { browser, page, errors } = await open(launcher, { mic: 'refusedRoute' });
    await page.waitForSelector('.tuner-overlay', { timeout: 10000 });
    await page.waitForTimeout(1500);
    const guidance = (await text(page, '.tuner-guidance')) ?? '';
    check('it does not hang on opening the microphone', !/asking for the microphone/i.test(guidance), guidance);
    check('it says audio is paused', /paused audio/i.test(guidance), guidance);
    check('and offers the one thing that fixes it',
      (await page.locator('.tuner-action', { hasText: 'Let the tuner hear' }).count()) === 1);
    check('the instrument is shown as not hearing',
      (await page.locator('.headstock.is-deaf').count()) === 1);
    check('no console errors', errors.length === 0, errors.join(' | '));
    await browser.close();
  }

  // --- each refusal names itself and its own way out ----------------------
  for (const [mic, expected] of [
    ['denied', /blocked for this site/i],
    ['missing', /no microphone found/i],
    ['busy', /something else is using the microphone/i],
    ['absent', /secure connection|cannot record audio/i],
  ]) {
    console.log(`\n${name}: microphone ${mic}\n`);
    const { browser, page, errors } = await open(launcher, { mic });
    await page.waitForSelector('.tuner-blocked', { timeout: 10000 });
    const title = (await text(page, '.tuner-blocked-title')) ?? '';
    check('it names the problem', expected.test(title), title);
    const body = (await text(page, '.tuner-blocked-body')) ?? '';
    check('and names a recovery', body.length > 20, body.slice(0, 90));
    check('no raw engine error text', !/undefined is not an object|Cannot read propert/i.test(body), body);
    check('no console errors', errors.length === 0, errors.join(' | '));
    await browser.close();
  }

  // --- a chunk that never arrives is bounded ------------------------------
  {
    console.log(`\n${name}: the tuner's code stalls\n`);
    const { browser, page, errors } = await open(launcher, {
      mic: 'denied',
      route: () => new Promise(() => {}),
    });
    await page.waitForSelector('.tuner-gate', { timeout: 10000 });
    check('there is a way out from the first frame',
      (await page.locator('.tuner-gate-close').count()) === 1);
    const label = (await text(page, '.app-loader-label')) ?? '';
    check('the wait does not claim to be listening', !/listening/i.test(label), label);
    await page.waitForTimeout(6000);
    check('the wait is bounded', (await page.locator('.tuner-gate-panel').count()) === 1);
    check('and the whole app has not been replaced',
      (await page.locator('.error-fallback').count()) === 0);
    check('Escape leaves', await page.keyboard.press('Escape')
      .then(() => page.waitForTimeout(300))
      .then(async () => (await page.locator('.tuner-gate').count()) === 0));
    check('no console errors', errors.length === 0, errors.join(' | '));
    await browser.close();
  }

  // --- a chunk that is refused says so, and keeps the app -----------------
  {
    console.log(`\n${name}: the tuner's code is refused\n`);
    const { browser, page } = await open(launcher, {
      mic: 'denied',
      route: (r) => r.abort('failed'),
    });
    await page.waitForSelector('.tuner-gate-panel', { timeout: 15000 });
    const title = (await text(page, '.tuner-gate-title')) ?? '';
    check('it says the tuner did not load', /did not load/i.test(title), title);
    check('the rest of the app survives', (await page.locator('.error-fallback').count()) === 0);
    check('the day is still behind it', (await page.locator('.task-container').count()) === 1);
    await browser.close();
  }
}

// --- guided tuning, driven by real audio -----------------------------------
//
// Chromium only: feeding a file in as the microphone is a Chromium flag. What is
// under test here is the sequencing and the hysteresis, which are engine
// independent; the engine-specific risks (the audio route, the chunk) are
// covered in both above.

const WAVS = writeFixtures(mkdtempSync(join(tmpdir(), 'daily-fret-tuner-')));

async function openWithAudio(wav, viewport = { width: 1366, height: 680 }) {
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      `--use-file-for-fake-audio-capture=${WAVS}/${wav}`,
    ],
  });
  const ctx = await browser.newContext({ viewport, permissions: ['microphone'] });
  const page = await ctx.newPage();
  await page.addInitScript(
    (s) => localStorage.setItem('daily-fret-storage', JSON.stringify({ state: s, version: 0 })),
    seed,
  );
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForSelector('.task-container', { timeout: 25000 });
  await page.waitForTimeout(700);
  await page.locator('.progress-launch', { hasText: /^Tune$/ }).click({ force: true });
  await page.waitForSelector('.headstock', { timeout: 15000 });
  return { browser, page };
}

const targetString = (page) =>
  page.locator('.headstock-peg.is-target').first().getAttribute('aria-label')
    .then((l) => (l ? /string (\d)/.exec(l)?.[1] ?? null : null))
    .catch(() => null);
const settledCount = (page) => page.locator('.headstock-machine.is-settled').count();

{
  console.log('\nguided: it leads before anything is played\n');
  const { browser, page } = await openWithAudio('silence.wav');
  await page.waitForTimeout(1600);
  check('it points at the thickest string first', (await targetString(page)) === '6');
  check('and says so in words', /Play the E string/.test(await text(page, '.tuner-guidance')),
    await text(page, '.tuner-guidance'));
  await browser.close();
}

{
  console.log('\nguided: settling one hands on to the next\n');
  const { browser, page } = await openWithAudio('advance.wav');
  await page.waitForFunction(() => document.querySelectorAll('.headstock-machine.is-settled').length >= 1,
    null, { timeout: 20000 });
  check('the low E goes green', (await settledCount(page)) >= 1);
  check('and the tuner moves to the A on its own', (await targetString(page)) === '5', await targetString(page));
  await page.waitForFunction(() => document.querySelectorAll('.headstock-machine.is-settled').length >= 2,
    null, { timeout: 20000 });
  check('the A goes green too', (await settledCount(page)) >= 2);
  check('and it moves on again', (await targetString(page)) === '4', await targetString(page));
  await browser.close();
}

{
  console.log('\nguided: a green string is not undone by a wobble\n');
  const { browser, page } = await openWithAudio('hysteresis.wav');
  await page.waitForFunction(() => document.querySelectorAll('.headstock-machine.is-settled').length === 1,
    null, { timeout: 20000 });
  check('it settles', (await settledCount(page)) === 1);

  // 8 cents flat: inside the hysteresis band, so the tick must hold.
  await page.waitForFunction(
    () => /cents flat/.test(document.querySelector('.tuner-readout-unit')?.textContent ?? ''),
    null, { timeout: 20000 });
  const wobble = Number((await text(page, '.tuner-readout-value')).replace('\u2212', '-'));
  check('a small drift is reported honestly', wobble <= -4 && wobble >= -12, String(wobble));
  check('and stays inside the hysteresis band', wobble > -12, String(wobble));
  check('and does not pull the tick', (await settledCount(page)) === 1);

  // 30 cents flat: past the threshold, held, so it must.
  await page.waitForFunction(() => document.querySelectorAll('.headstock-machine.is-settled').length === 0,
    null, { timeout: 25000 });
  check('a real drift does pull it', (await settledCount(page)) === 0);
  // Back to the first string in the sequence that is not done. In this fixture
  // only the A was ever settled, so that is the low E; in a real session where
  // the sequence had run, the string that just drifted is the one it lands on
  // (which the all-six case below proves).
  check('and it goes back to leading', (await targetString(page)) === '6', await targetString(page));
  await browser.close();
}

{
  console.log('\nguided: finishing is a resting point, not an exit\n');
  const { browser, page } = await openWithAudio('allsix-then-drift.wav');
  await page.waitForFunction(() => document.querySelectorAll('.headstock-machine.is-settled').length === 6,
    null, { timeout: 40000 });
  check('all six go green', (await settledCount(page)) === 6);
  check('and it says so', /All six/.test(await text(page, '.tuner-guidance')), await text(page, '.tuner-guidance'));
  await page.waitForFunction(() => document.querySelectorAll('.headstock-machine.is-settled').length === 5,
    null, { timeout: 25000 });
  check('a string going out afterwards is noticed', (await settledCount(page)) === 5);
  check('the finished state clears', (await page.locator('.tuner-overlay.is-done').count()) === 0);
  check('and it points at the string that moved', (await targetString(page)) === '4', await targetString(page));
  await browser.close();
}

{
  console.log('\nthe number people already know how to read\n');
  const { browser, page } = await openWithAudio('flat.wav');
  await page.waitForFunction(
    () => /cents/.test(document.querySelector('.tuner-readout-unit')?.textContent ?? ''),
    null, { timeout: 20000 });
  const value = await text(page, '.tuner-readout-value');
  check('it is signed the universal way', value.startsWith('\u2212'), value);
  // Within a couple of cents of the tone in the file. The remaining offset is
  // the fake-capture path resampling 44.1k to the context rate, not the
  // estimator: an exactly-in-tune fixture reads 0.
  const read = Number(value.replace('\u2212', '-'));
  check('and reads what a player would expect', read <= -35 && read >= -41, value);
  check('the direction is in words too', /cents flat/i.test(await text(page, '.tuner-readout-unit')),
    await text(page, '.tuner-readout-unit'));
  check('and the action is named', /Tighten/.test(await text(page, '.tuner-guidance')),
    await text(page, '.tuner-guidance'));
  // The axis declares its own range and its own compression, so a puck near the
  // end cannot silently disagree with the number.
  check('the axis states its range', /50/.test(await text(page, '.tuner-track-scale')));
  check('and shows where 25 cents falls', (await page.locator('.tuner-track-tick').count()) === 2);
  await browser.close();
}

// --- the shape of it, on both screens the owner practises on ---------------
for (const [label, viewport] of [
  ['390x844', { width: 390, height: 844 }],
  ['430x932', { width: 430, height: 932 }],
  ['1366x680', { width: 1366, height: 680 }],
]) {
  console.log(`\nchromium: the instrument at ${label}\n`);
  const { browser, page, errors } = await open(chromium, { mic: 'denied', viewport });
  await page.waitForSelector('.tuner-blocked', { timeout: 10000 });
  check('a refusal fits the screen', (await sideways(page)) <= 0);
  await page.screenshot({ path: `${OUT}/tuner-denied-${label}.png` });
  await browser.close();

  const live = await open(chromium, { viewport });
  await live.page.waitForSelector('.headstock', { timeout: 10000 });
  await live.page.waitForTimeout(900);
  check('six pegs are reachable', (await live.page.locator('.headstock-peg').count()) === 6);
  check('the instrument fits the screen', (await sideways(live.page)) <= 0);
  await live.page.screenshot({ path: `${OUT}/tuner-live-${label}.png` });
  check('no console errors', errors.length === 0, errors.join(' | '));
  await live.browser.close();
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
