// The strum timing drill in the real app, with real audio going into it.
//
// tests/timing.test.mjs drives the analyser and the statistics directly. This
// one runs the drill: React, the audio worklet, the microphone, the clock, the
// groove rail on screen. Chromium will accept a file as its microphone
// (--use-file-for-fake-audio-capture), so the only thing faked is the physical
// mic.
//
// The fixture matters more here than in any other suite. The click has to be in
// the microphone feed, because that is what the drill measures against and the
// metronome the page is playing cannot reach a fake capture device. So the wav
// carries the real click (rendered by the shipping metronome code, ported here)
// mixed with synthesised guitar at known offsets, and the page's own metronome
// is set to the same tempo. What is under test is that the drill finds the beat
// in the room, places the strums against it, and says the right thing when it
// cannot.
//
//   node tests/browser/strumTiming.mjs
//
// Set PREVIEW_URL for a build; the layout checks run in chromium and webkit, the
// audio ones in chromium only, matching tests/browser/tuner.mjs.

import { chromium, webkit } from 'playwright';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register } from 'node:module';
import { renderStrum, addRoom, write, VOICINGS, SAMPLE_RATE } from './tone.mjs';

// The click in the fixture has to be the click the app ships, or this suite
// would be proving that the analyser can find a click nobody hears. Reaching
// into the TypeScript source needs the same resolver hook the unit suites run
// under, and it has to be registered before the module is pulled in, so the
// import is dynamic rather than static.
register(new URL('../_resolve.mjs', import.meta.url).href);
const { renderClick, VOICES, accentFor } = await import('../../src/audio/metronome.ts');

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:4173/';
const OUT = process.argv[2] ?? 'tests/browser/.shots';
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
};

/**
 * The one console error that is the app working correctly.
 *
 * src/lib/auth.ts reports a missing or invalid Firebase config and carries on
 * locally, which is exactly what it should do and what every build made outside
 * an environment with real keys will say. Counting it would make this suite fail
 * on where it was run rather than on what it was testing.
 */
const handled = (text) => /Cloud sync unavailable/.test(text);

const DIR = mkdtempSync(join(tmpdir(), 'daily-fret-timing-'));
const BPM = 80;
const PERIOD = 60 / BPM;
const SECONDS = 26;
const BEATS = Math.floor((SECONDS - 2) / PERIOD);

/**
 * A take. `offsetsMs(beat)` is how far off the beat each strum is played.
 * `clickGain` of 0 is the headphones case: guitar with no click in the room.
 */
function take({ offsetsMs = () => 0, clickGain = 1, playing = true }) {
  const lead = 1.2;
  const total = Math.ceil(SECONDS * SAMPLE_RATE);
  const audio = new Float32Array(total);
  let seed = 4242;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let k = 0; k < BEATS; k += 1) {
    const beatAt = lead + k * PERIOD;
    if (clickGain > 0) {
      const samples = renderClick(VOICES[accentFor(k, 4)], SAMPLE_RATE, random);
      const start = Math.round(beatAt * SAMPLE_RATE);
      for (let i = 0; i < samples.length && start + i < total; i += 1) {
        audio[start + i] += samples[i] * clickGain;
      }
    }
    if (!playing) continue;
    renderStrum(audio, Math.round((beatAt + offsetsMs(k) / 1000) * SAMPLE_RATE), VOICINGS.A, {
      amp: 0.5,
      dampAt: PERIOD * 0.9,
      spreadMs: 6,
      seed: 7 + k,
    });
  }
  addRoom(audio, 0.0015, 11);
  return audio;
}

/**
 * A tidy player's wobble, in milliseconds, repeating every eight beats.
 *
 * Not zero, and that is not a detail. A take played to machine precision is
 * refused by the drill on purpose: no pair of hands lands inside a couple of
 * milliseconds of the click every time, so a result that tight is evidence the
 * microphone was measuring the guitar against itself rather than against a
 * click. The fixture has to be a person.
 */
const WOBBLE = [-14, 9, -4, 17, -11, 5, 13, -8];
const tidy = (k) => WOBBLE[k % WOBBLE.length];

// Well inside the in-time window on every beat.
write(`${DIR}/on-beat.wav`, [take({ offsetsMs: tidy })]);
// A player who rushes: 70 ms early on average, which is outside the 50 ms
// window, so the score must be low and the lean must be named.
write(`${DIR}/rushing.wav`, [take({ offsetsMs: (k) => -70 + tidy(k) })]);
// Headphones: the guitar is in the room and the click is not.
write(`${DIR}/no-click.wav`, [take({ clickGain: 0 })]);

const routine = (drill) => ({
  activeRoutineId: 'r1',
  currentLesson: 'b1-403',
  routines: [{
    id: 'r1', name: 'Module 4 Daily', description: '', isDefault: true,
    tasks: [{ id: 't1', title: 'Strum timing', duration: '2 mins', drill }],
  }],
  dailyLogs: {}, strumPatterns: [], songLinks: [], updatedAt: 1,
});

const DRILL = { kind: 'strum-timing', durationSec: 20, bpm: BPM };

async function openWithAudio(wav, viewport = { width: 1280, height: 1000 }) {
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      `--use-file-for-fake-audio-capture=${DIR}/${wav}`,
    ],
  });
  const ctx = await browser.newContext({ viewport, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => {
    if (!handled(e.message)) errors.push(e.message);
  });
  await page.addInitScript(
    (s) => localStorage.setItem('daily-fret-storage', JSON.stringify({
      state: { currentAccountId: 'anonymous', accounts: { anonymous: s } }, version: 0,
    })),
    routine(DRILL),
  );
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForSelector('.task-container', { timeout: 25000 });
  await page.locator('.task-row', { hasText: 'Strum timing' }).click();
  await page.waitForSelector('.practice-overlay', { timeout: 15000 });
  const start = page.locator('.practice-overlay').getByRole('button', { name: /^Start/ });
  if (await start.count()) await start.first().click();
  return { browser, page, errors };
}

const figures = (page) =>
  page.locator('.st-figure').allInnerTexts().then((rows) => rows.map((r) => r.split('\n')[0].trim()));

/** The number out of a figure, which carries its unit and its sign with it. */
const numeric = (text) =>
  Number(text.replace('\u2212', '-').replace('+', '').replace('\u00b1', '').replace('ms', '').trim());

console.log('\nThe drill hears the click in the room\n');
{
  const { browser, page, errors } = await openWithAudio('on-beat.wav');
  await page.waitForSelector('.groove-rail', { timeout: 20000 });
  check('the rail is the first thing on screen', true);

  // The centre line answers a click it actually heard. The pulse is remounted
  // per click, so its presence at all is the app hearing the room.
  await page.waitForFunction(
    () => document.querySelectorAll('.groove-mark').length >= 4,
    null, { timeout: 20000 },
  );
  check('strums land on the rail as they are played',
    (await page.locator('.groove-mark').count()) >= 4);
  check('and the newest one is marked as such',
    (await page.locator('.groove-mark.is-age-0').count()) === 1);
  check('the run gets a groove band once there is a run to describe',
    (await page.locator('.groove-band').count()) === 1);

  await page.screenshot({ path: `${OUT}/timing-live-1280.png` });
  await page.waitForSelector('.om-ring-value', { timeout: 25000 });
  const score = Number((await page.locator('.om-ring-value').innerText()).trim());
  check(`playing on the click scores high (${score}% in time)`, score >= 85, `${score}`);
  const [lean, spread, beats] = await figures(page);
  check('the lean is reported inside the resolution the drill claims',
    Math.abs(numeric(lean)) <= 25, lean);
  check('the spread is a real number, not a suspiciously perfect one',
    numeric(spread) > 0, spread);
  check('and the beats counted look like a block of playing at this tempo',
    /^\d+\/\d+$/.test(beats) && Number(beats.split('/')[1]) >= 12, beats);
  check('the finished block is drawn as a trace',
    (await page.locator('.groove-tick').count()) >= 12);
  check('and the footnote states what in time means',
    /within 50 ms of the click/.test(await page.locator('.st-footnote').innerText()));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${OUT}/timing-result-1280.png` });
  await browser.close();
}

console.log('\nA player who is rushing is told so, and not marked in time\n');
{
  const { browser, page, errors } = await openWithAudio('rushing.wav');
  await page.waitForSelector('.om-ring-value', { timeout: 40000 });
  const score = Number((await page.locator('.om-ring-value').innerText()).trim());
  const [lean] = await figures(page);
  const leanMs = numeric(lean);

  // The take is played 70 ms early with a tidy player's wobble on top. A strum
  // is timed when its sound arrives, which for this fixture's sweep is about
  // 18 ms after the pick, so the honest answer is somewhere near 52 ms early.
  // This is the end-to-end accuracy check: everything from the loudspeaker in
  // the wav to the number on the card.
  check(`the lean is measured, not guessed (${lean} ms for 70 ms early)`,
    leanMs < -35 && leanMs > -75, lean);
  check('and the drill names the direction rather than handing out a grade',
    /ahead of the click/.test(await page.locator('.st-call').first().innerText()));
  check('never scolding',
    !/bad|wrong|poor|fail/i.test(await page.locator('.st-call').first().innerText()));
  // Half a wobble either side of 52 ms early straddles the 50 ms window, so a
  // little under half the beats land inside it. What must not happen is this
  // reading like the take that was on the click.
  check(`rushing scores far below playing on the click (${score}%)`, score <= 70, `${score}`);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log('\nOn headphones it refuses rather than inventing a beat\n');
{
  const { browser, page, errors } = await openWithAudio('no-click.wav');
  await page.waitForSelector('.st-deaf', { timeout: 30000 });
  const body = await page.locator('.st-deaf').innerText();
  check('it says it cannot hear the click', /cannot hear the click/i.test(body), body.slice(0, 80));
  check('and says what to do about it', /speakers/i.test(body));
  check('no groove band was ever drawn', (await page.locator('.groove-band').count()) === 0);
  check('and no number is on screen', (await page.locator('.st-figure-value').count()) === 0);
  await page.screenshot({ path: `${OUT}/timing-deaf-1280.png` });

  await page.waitForSelector('.om-ring-value', { timeout: 30000 });
  check('the result refuses to score it',
    (await page.locator('.om-ring-value').innerText()).trim() === '--');
  check('and says why', /never reached the microphone/i.test(await page.locator('.om-context').innerText()),
    await page.locator('.om-context').innerText());
  const stored = await page.evaluate(() => {
    const acc = JSON.parse(localStorage.getItem('daily-fret-storage')).state.accounts.anonymous;
    const key = Object.keys(acc.dailyLogs).sort().pop();
    return acc.dailyLogs[key] ?? null;
  });
  check('nothing was written to the history',
    !stored?.drillResults || Object.keys(stored.drillResults).length === 0,
    JSON.stringify(stored?.drillResults));
  check('but the day records that the drill ran and heard nothing',
    stored?.taskRecords?.t1?.evidence === 'silent', JSON.stringify(stored?.taskRecords));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// --- the live rail on the smallest phone the owner practises on -------------
//
// The setup screen is checked in both engines below, but the rail only exists
// while audio is arriving, so the one viewport where it can actually overflow
// has to be driven with a real take.

for (const [label, viewport] of [
  ['360', { width: 360, height: 780 }],
  ['390', { width: 390, height: 844 }],
  ['430', { width: 430, height: 932 }],
]) {
  console.log(`\nThe rail on a ${label}px phone\n`);
  const { browser, page, errors } = await openWithAudio('on-beat.wav', viewport);
  await page.waitForFunction(
    () => document.querySelectorAll('.groove-mark').length >= 3,
    null, { timeout: 25000 },
  );
  const sideways = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${label}: the live rail fits`, sideways <= 0, `${sideways}px over`);
  const inside = await page.evaluate(() => {
    const rail = document.querySelector('.groove-rail').getBoundingClientRect();
    return [...document.querySelectorAll('.groove-mark')]
      .every((m) => {
        const r = m.getBoundingClientRect();
        return r.left >= rail.left - 1 && r.right <= rail.right + 1;
      });
  });
  check(`${label}: every mark is inside it`, inside);
  check(`${label}: the three figures stay on one row`, await page.evaluate(() => {
    const tops = [...document.querySelectorAll('.st-figure')].map((f) => Math.round(f.getBoundingClientRect().top));
    return tops.length === 3 && new Set(tops).size === 1;
  }));
  await page.screenshot({ path: `${OUT}/timing-live-${label}.png` });

  await page.waitForSelector('.om-ring-value', { timeout: 30000 });
  const afterResult = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${label}: the result card fits too`, afterResult <= 0, `${afterResult}px over`);
  check(`${label}: its figures are still on one row`, await page.evaluate(() => {
    const tops = [...document.querySelectorAll('.st-figure')].map((f) => Math.round(f.getBoundingClientRect().top));
    return tops.length === 3 && new Set(tops).size === 1;
  }));
  await page.screenshot({ path: `${OUT}/timing-result-${label}.png` });
  check(`${label}: no page errors`, errors.length === 0, errors.join(' | '));
  await browser.close();
}

// --- the shape of it, on every screen the owner practises on ----------------
//
// No audio here, so both engines run it: what is under test is the layout of
// the rail and the readout, which is engine business.

console.log('\nThe shape of it\n');
for (const [name, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
  for (const [label, viewport] of [
    ['360x780', { width: 360, height: 780 }],
    ['390x844', { width: 390, height: 844 }],
    ['430x932', { width: 430, height: 932 }],
    ['1280x900', { width: 1280, height: 900 }],
  ]) {
    const browser = await launcher.launch();
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !handled(m.text())) errors.push(m.text().slice(0, 160));
    });
    page.on('pageerror', (e) => {
      if (!handled(String(e))) errors.push(`PAGEERROR ${String(e).slice(0, 160)}`);
    });
    await page.addInitScript(
      (s) => localStorage.setItem('daily-fret-storage', JSON.stringify({
        state: { currentAccountId: 'anonymous', accounts: { anonymous: s } }, version: 0,
      })),
      routine(DRILL),
    );
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForSelector('.task-container', { timeout: 25000 });
    await page.locator('.task-row', { hasText: 'Strum timing' }).click();
    await page.waitForSelector('.st-setup', { timeout: 15000 });

    const sideways = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${name} ${label}: the setup screen fits`, sideways <= 0, `${sideways}px over`);
    check(`${name} ${label}: it states the headphones limit up front`,
      /speakers, not headphones/i.test(await page.locator('.st-setup').innerText()));

    if (name === 'chromium' && label === '390x844') {
      await page.screenshot({ path: `${OUT}/timing-setup-390.png`, fullPage: true });
    }
    check(`${name} ${label}: no console errors`, errors.length === 0, errors.join(' | '));
    await browser.close();
  }
}

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures ? 1 : 0);
