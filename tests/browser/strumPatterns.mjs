// The strum-pattern drill in the real app, with real audio going into it.
//
// tests/patternDeck.test.mjs drives the deck and the honesty rule directly, and
// tests/strumPattern.test.mjs drives the matcher. This one runs the drill:
// React, the audio worklet, the microphone, the metronome, the bar on screen.
// Chromium will accept a file as its microphone, so the only thing faked is the
// physical mic.
//
//   node tests/browser/strumPatterns.mjs
//
// WHY EVERY TAKE IS BEAT-PERIODIC. The drill takes its bar line from the click
// the player is hearing, which is the app's own metronome, and the take's clicks
// come out of a wav that started whenever the capture device opened. The two run
// at the same tempo with an arbitrary constant phase between them, so which beat
// of the take the app calls beat one is not something a test can pin down.
//
// Rather than pretend otherwise, the takes here are patterns whose bar repeats
// every beat: straight eighths, and all downs. Rotating one of those by a beat
// leaves it unchanged, so the assertions are true whichever beat the app lands
// on. Where a take drops a strum, the drop is asserted by what it is (one up
// strum, and only that one) rather than by which slot index it comes out at.
//
// Set PREVIEW_URL for a build.

import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register } from 'node:module';
import { renderStrum, addRoom, write, VOICINGS, SAMPLE_RATE } from './tone.mjs';

// The click in the fixture has to be the click the app ships, or this suite
// would be proving that the analyser can find a click nobody hears.
register(new URL('../_resolve.mjs', import.meta.url).href);
const { renderClick, VOICES, accentFor } = await import('../../src/audio/metronome.ts');
const { parsePattern, SLOTS_PER_BAR } = await import('../../src/lib/strumPattern.ts');

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:4173/';
const OUT = process.argv[2] ?? 'tests/browser/.shots';
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail ? ` - ${detail}` : ''}`);
};

/** The one console error that is the app working correctly outside a keyed build. */
const handled = (text) => /Cloud sync unavailable/.test(text);

const DIR = mkdtempSync(join(tmpdir(), 'daily-fret-patterns-'));
const BPM = 80;
const BEAT = 60 / BPM;
const EIGHTH = BEAT / 2;
const SECONDS = 46;

const EIGHTHS = 'DUDUDUDU';
const DOWNS = 'D-D-D-D-';

/**
 * A tidy player's wobble, in milliseconds, repeating every eight slots.
 *
 * Not zero. A take played to machine precision is not a person, and the point of
 * driving the real analyser is that a person is what it has to cope with.
 */
const WOBBLE = [-11, 7, -4, 13, -9, 4, 10, -6];

/** A down sweeps low to high across the strings; an up catches the top three. */
const OPEN_ONLY = (frets, keep) => frets.map((f, i) => (keep.includes(i) ? f : -1));

function strike(audio, atSec, { up, amp, seed }) {
  const frets = VOICINGS.Am;
  const order = up ? [5, 4, 3] : [0, 1, 2, 3, 4, 5];
  order.forEach((string, i) => {
    if (frets[string] < 0) return;
    renderStrum(audio, Math.round((atSec + (i * 7) / 1000) * SAMPLE_RATE), OPEN_ONLY(frets, [string]), {
      amp,
      // Each stroke decays inside its own slot rather than ringing across the
      // next two, which is what a strummed pattern with the hand back on the
      // strings actually sounds like. It also matters here: through the fake
      // capture device an up strum buried under the previous down's ring is not
      // recovered, where the analyser's own bench recovers it, so a longer decay
      // would be testing Chromium's audio path rather than the drill.
      dampAt: EIGHTH * 0.6,
      spreadMs: 0,
      seed: seed + string,
    });
  });
}

/**
 * A take: the click the app ships, and a guitar playing `pattern` over it.
 *
 * `upAmp` is the level of the up strums against 0.5 for the downs. The floor
 * below which an up strum stops being detectable is measured against the real
 * analyser in tests/strumPattern.test.mjs, at about two thirds; this path runs
 * through a fake capture device and is not the place to re-derive it, so the
 * quiet take sits at a tenth of the downs, far under any reading of the floor.
 */
function take({ pattern, upAmp = 0.36, drop = () => false }) {
  const slots = parsePattern(pattern).slots;
  const lead = 0.6;
  const total = Math.ceil(SECONDS * SAMPLE_RATE);
  const audio = new Float32Array(total);
  let seed = 4242;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const beats = Math.floor((SECONDS - lead - 1) / BEAT);
  for (let b = 0; b < beats; b += 1) {
    const samples = renderClick(VOICES[accentFor(b, 4)], SAMPLE_RATE, random);
    const start = Math.round((lead + b * BEAT) * SAMPLE_RATE);
    for (let i = 0; i < samples.length && start + i < total; i += 1) audio[start + i] += samples[i];
  }
  const bars = Math.floor(beats / 4);
  for (let bar = 0; bar < bars; bar += 1) {
    for (let slot = 0; slot < SLOTS_PER_BAR; slot += 1) {
      const stroke = slots[slot];
      if (!stroke || drop(slot)) continue;
      const at = lead + bar * 4 * BEAT + slot * EIGHTH + WOBBLE[slot] / 1000;
      strike(audio, at, {
        up: stroke === 'U',
        amp: stroke === 'U' ? upAmp : 0.5,
        seed: 7 + bar * 8 + slot,
      });
    }
  }
  addRoom(audio, 0.0015, 11);
  return audio;
}

write(`${DIR}/eighths.wav`, [take({ pattern: EIGHTHS })]);
// The classic beginner failure, on one up strum: the arm stops before it and
// never gets there. Every bar, so the slot reads as never struck.
write(`${DIR}/dropped-up.wav`, [take({ pattern: EIGHTHS, drop: (slot) => slot === 7 })]);
// Every up strum played far under the level the microphone can pick out of a
// down strum's decay. Not a playing problem, and must not be reported as one.
write(`${DIR}/quiet-ups.wav`, [take({ pattern: EIGHTHS, upAmp: 0.05 })]);
write(`${DIR}/switching.wav`, [take({ pattern: EIGHTHS })]);

const routine = (drill) => ({
  activeRoutineId: 'r1',
  currentLesson: 'b1-501',
  routines: [{
    id: 'r1', name: 'Module 5 Daily', description: '', isDefault: true,
    tasks: [{ id: 't1', title: 'Strum patterns', duration: '2 mins', drill }],
  }],
  dailyLogs: {}, strumPatterns: [], songLinks: [], updatedAt: 1,
});

const drillFor = (patterns, durationSec) => ({
  kind: 'strum-pattern',
  durationSec,
  bpm: BPM,
  patterns,
  bars: 4,
});

async function open({ wav, drill, viewport = { width: 1366, height: 900 }, start = true }) {
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      ...(wav ? [`--use-file-for-fake-audio-capture=${DIR}/${wav}`] : []),
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
    routine(drill),
  );
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForSelector('.task-container', { timeout: 25000 });
  await page.locator('.task-row', { hasText: 'Strum patterns' }).click();
  await page.waitForSelector('.practice-overlay', { timeout: 15000 });
  if (start) {
    await page.locator('.practice-overlay').getByRole('button', { name: /^Start/ }).first().click();
  }
  return { browser, page, errors };
}

const stored = (page) =>
  page.evaluate(() => {
    const acc = JSON.parse(localStorage.getItem('daily-fret-storage')).state.accounts.anonymous;
    const key = Object.keys(acc.dailyLogs).sort().pop();
    return acc.dailyLogs[key] ?? null;
  });

/**
 * Words a surface asks the player to read, counted as a number to hold down.
 *
 * A screen that grew text since the last pass has regressed, and the drill's
 * whole claim is that its eight slots say what a paragraph would have. Bare
 * numbers do not count: a countdown is read at a glance, not read.
 */
const wordsIn = (page, selector) =>
  page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return -1;
    return (root.innerText || '')
      .split(/\s+/)
      .filter((w) => /[a-z]/i.test(w)).length;
  }, selector);

/** ONLY=quiet runs one section. The whole suite takes several minutes. */
const ONLY = process.env.ONLY ?? '';
const run = (name) => !ONLY || name.includes(ONLY);

// --- the deck ---------------------------------------------------------------

if (run('deck')) {
console.log('\nThe deck a run deals from\n');
  const deck = [DOWNS, 'D-D-D-DU', EIGHTHS, 'D-DUDUD-'];
  const { browser, page, errors } = await open({ drill: drillFor(deck, 20), start: false });
  await page.waitForSelector('.sp-deck', { timeout: 15000 });
  check('every card in the deck is on screen',
    (await page.locator('.sp-card').count()) === deck.length,
    String(await page.locator('.sp-card').count()));
  check('each card is its own eight slots',
    (await page.locator('.sp-card .pattern-bar.is-deck').count()) === deck.length);
  check('a card nobody has played is drawn as an outline', await page.evaluate(() => {
    const path = document.querySelector('.pattern-bar.is-new .pb-pick-mark.is-down .pb-pick path');
    return path ? getComputedStyle(path).fill === 'none' : false;
  }));
  check('and no card claims to be automatic yet',
    (await page.locator('.sp-card.is-automatic').count()) === 0);
  check('the deck reads without a paragraph under it',
    (await page.locator('.sp-setup p').count()) === 0);
  const deckWords = await wordsIn(page, '.sp-setup');
  check(`the deck is four names and a button (${deckWords} words)`, deckWords <= 16, String(deckWords));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${OUT}/patterns-deck-1366.png` });
  await browser.close();
}

// --- a clean run ------------------------------------------------------------

if (run('clean')) {
console.log('\nA clean run of straight eighths\n');
  const { browser, page, errors } = await open({
    wav: 'eighths.wav',
    drill: drillFor([EIGHTHS], 16),
  });
  // The bar appears before the click is heard, unlit and with no arm on it, so
  // the stage is never blank under a running clock. The arm only joins once
  // there is a grid to move it against; drawing one earlier would have the drill
  // inventing the beat it exists to measure. Wait for the live card, not the
  // first card.
  await page.waitForSelector('.sp-current', { timeout: 30000 });
  check('a bar is on screen before anything is heard', true);
  check('and it carries no arm yet',
    (await page.locator('.sp-current.is-waiting .pb-arm').count()) === 0);
  await page.waitForSelector('.sp-current:not(.is-waiting)', { timeout: 30000 });
  check('the arm is drawn once the click is found',
    (await page.locator('.sp-current .pb-arm').count()) === 1);
  check('and it is actually moving', await page.evaluate(async () => {
    const arm = document.querySelector('.sp-current .pb-arm');
    const first = arm.style.left;
    await new Promise((r) => setTimeout(r, 180));
    return arm.style.left !== first && arm.style.opacity === '1';
  }));
  // The requirement, as a number. Everything the drill says while both hands
  // are on the guitar it says by drawing; the only glyphs left are the seconds
  // on the clock, which are read at a glance rather than read.
  const playingWords = await wordsIn(page, '.sp-stage');
  check(`nothing on the playing screen has to be read (${playingWords} words)`,
    playingWords === 0, String(playingWords));

  await page.waitForFunction(
    () => document.querySelectorAll('.sp-current .pb-stroke.is-struck').length >= 4,
    null, { timeout: 30000 },
  );
  check('strums land in their slots as they are played',
    (await page.locator('.sp-current .pb-stroke.is-struck').count()) >= 4);
  check('every stroke is drawn inside the bar it belongs to', await page.evaluate(() => {
    const lane = document.querySelector('.sp-current .pb-lane').getBoundingClientRect();
    return [...document.querySelectorAll('.sp-current .pb-stroke')].every((s) => {
      const r = s.getBoundingClientRect();
      return r.left >= lane.left - 8 && r.right <= lane.right + 8;
    });
  }));
  await page.screenshot({ path: `${OUT}/patterns-live-1366.png` });

  await page.waitForSelector('.sp-row', { timeout: 40000 });
  check('the result is the eight slots, not a percentage',
    (await page.locator('.sp-results .pattern-bar').count()) >= 1 &&
      (await page.locator('.sp-results .om-ring-value').count()) === 0);
  check('nothing was dropped', (await page.locator('.sp-row .pb-pick-mark.is-missed').count()) === 0,
    String(await page.locator('.sp-row .pb-pick-mark.is-missed').count()));
  check('and the ups were heard, so nothing is said about their level',
    (await page.locator('.sp-note').count()) === 0);
  const resultWords = await wordsIn(page, '.sp-results');
  check(`the result is a name and two buttons (${resultWords} words)`,
    resultWords <= 8, String(resultWords));

  const day = await stored(page);
  const keys = Object.keys(day?.drillResults ?? {});
  check('the run is filed under the pattern and the tempo it was played at',
    keys.length > 0 && keys.every((k) => k === `pattern:${EIGHTHS}~${BPM}`), keys.join(' '));
  check('and it scored like a run that was on the click',
    (day?.drillResults?.[`pattern:${EIGHTHS}~${BPM}`] ?? 0) >= 80,
    String(day?.drillResults?.[`pattern:${EIGHTHS}~${BPM}`]));
  const runs = day?.drillRuns?.[`pattern:${EIGHTHS}~${BPM}`] ?? [];
  check('every run carries the bar its pattern settled on',
    runs.length > 0 && runs.every((r) => 'settledBar' in r), JSON.stringify(runs));
  check('the day records that the app measured something',
    day?.taskRecords?.t1?.evidence === 'measured', JSON.stringify(day?.taskRecords));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${OUT}/patterns-result-1366.png` });
  await browser.close();
}

// --- one up strum that never happened ---------------------------------------

if (run('dropped')) {
console.log('\nA run that drops an up strum\n');
  const { browser, page, errors } = await open({
    wav: 'dropped-up.wav',
    drill: drillFor([EIGHTHS], 16),
  });
  await page.waitForSelector('.sp-row', { timeout: 50000 });
  const missed = await page.locator('.sp-row .pb-pick-mark.is-missed').count();
  check('exactly one slot is reported as never struck', missed === 1, String(missed));
  check('and it is an up strum',
    (await page.locator('.sp-row .pb-pick-mark.is-missed.is-up').count()) === 1);
  // The whole reason the result is eight slots. A percentage says the run was
  // worse; only the row says which stroke the arm is stopping before.
  check('the dropped slot is dimmed rather than marked wrong', await page.evaluate(() => {
    const mark = document.querySelector('.sp-row .pb-pick-mark.is-missed');
    if (!mark) return false;
    const muted = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim();
    // The token as the browser resolves it, so the check is that the mark took
    // the muted colour rather than any error colour, whatever the notation.
    const probe = document.createElement('span');
    probe.style.color = muted;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(mark).color === resolved;
  }));
  check('one missing up is a dropped strum, not a level problem',
    (await page.locator('.sp-note').count()) === 0);
  const day = await stored(page);
  const score = day?.drillResults?.[`pattern:${EIGHTHS}~${BPM}`] ?? 0;
  check(`a dropped strum costs its share and no more (${score}%)`,
    score > 50 && score < 100, String(score));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${OUT}/patterns-dropped-1366.png` });
  await browser.close();
}

// --- up strums under the detection floor ------------------------------------

if (run('quiet')) {
console.log('\nA run whose up strums are too quiet to hear\n');
  const { browser, page, errors } = await open({
    wav: 'quiet-ups.wav',
    drill: drillFor([EIGHTHS], 16),
  });
  await page.waitForSelector('.sp-row', { timeout: 50000 });
  const note = (await page.locator('.sp-note').count())
    ? await page.locator('.sp-note').innerText()
    : '';
  check('the drill says the up strums were too quiet to hear',
    /too quiet to hear/i.test(note), note || 'no note at all');
  check('and never says they were missed',
    (await page.locator('.sp-row .pb-pick-mark.is-missed').count()) === 0);
  check('every up slot is drawn as an absence of evidence',
    (await page.locator('.sp-row .pb-pick-mark.is-unheard').count()) === 4,
    String(await page.locator('.sp-row .pb-pick-mark.is-unheard').count()));
  check('the downs around them are still solid',
    (await page.locator('.sp-row .pb-pick-mark.is-sounded.is-down').count()) === 4);
  const day = await stored(page);
  check('nothing was written to the history',
    Object.keys(day?.drillResults ?? {}).length === 0,
    JSON.stringify(day?.drillResults));
  check('but the day records that the drill ran and heard nothing',
    day?.taskRecords?.t1?.evidence === 'silent', JSON.stringify(day?.taskRecords));
  const quietWords = await wordsIn(page, '.sp-results');
  check(`the one sentence the picture cannot carry is the only one (${quietWords} words)`,
    quietWords <= 16, String(quietWords));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${OUT}/patterns-quiet-1366.png` });
  await browser.close();
}

// --- the switch between patterns --------------------------------------------

if (run('switch')) {
console.log('\nThe switch from one pattern to the next\n');
  const { browser, page, errors } = await open({
    wav: 'switching.wav',
    drill: drillFor([DOWNS, EIGHTHS], 26),
  });
  await page.waitForSelector('.sp-current', { timeout: 30000 });
  const first = await page.locator('.sp-current').getAttribute('aria-label');

  await page.waitForSelector('.sp-next', { timeout: 40000 });
  check('the next pattern comes up beside the one being played', true);
  check('and it is beside it, not under it', await page.evaluate(() => {
    const now = document.querySelector('.sp-current').getBoundingClientRect();
    const soon = document.querySelector('.sp-next').getBoundingClientRect();
    return soon.left >= now.right - 2 && Math.abs(soon.top - now.top) < now.height;
  }));
  const queued = await page.locator('.sp-next .pattern-bar').getAttribute('aria-label');
  check('the card coming up is a different one', queued && !queued.endsWith(first ?? ''),
    `${first} -> ${queued}`);
  check('the arm keeps going through the changeover',
    (await page.locator('.sp-current .pb-arm').count()) === 1);
  await page.screenshot({ path: `${OUT}/patterns-switch-1366.png` });

  await page.waitForFunction(
    (was) => {
      const bar = document.querySelector('.sp-current');
      return bar && bar.getAttribute('aria-label') !== was;
    },
    first, { timeout: 40000 },
  );
  check('the deal changes over without the drill stopping',
    (await page.locator('.sp-current').getAttribute('aria-label')) !== first);
  check('and the card that was queued is the one now being played',
    (await page.locator('.sp-current').getAttribute('aria-label')) ===
      (queued ?? '').replace(/^Next\. /, ''));

  await page.waitForSelector('.sp-row', { timeout: 60000 });
  check('both patterns are reported',
    (await page.locator('.sp-row').count()) === 2,
    String(await page.locator('.sp-row').count()));
  const day = await stored(page);
  check('each under its own key',
    Object.keys(day?.drillResults ?? {}).sort().join(' ') ===
      [`pattern:${DOWNS}~${BPM}`, `pattern:${EIGHTHS}~${BPM}`].sort().join(' '),
    Object.keys(day?.drillResults ?? {}).join(' '));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// --- the frames the owner actually practises on -----------------------------

if (run('frames')) for (const [label, viewport] of [
  ['1366x572', { width: 1366, height: 572 }],
  ['1440x900', { width: 1440, height: 900 }],
  ['390x780', { width: 390, height: 780 }],
]) {
  console.log(`\nThe drill on a ${label} frame\n`);
  const { browser, page, errors } = await open({
    wav: 'eighths.wav',
    drill: drillFor([DOWNS, EIGHTHS], 16),
    viewport,
    start: false,
  });
  await page.waitForSelector('.sp-deck', { timeout: 15000 });
  await page.screenshot({ path: `${OUT}/patterns-deck-${label}.png` });
  check(`${label}: the deck fits`, await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth <= 0));

  await page.locator('.practice-overlay').getByRole('button', { name: /^Start/ }).first().click();
  await page.waitForSelector('.sp-next', { timeout: 45000 });
  const sideways = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${label}: the bar and the card beside it fit`, sideways <= 0, `${sideways}px over`);
  check(`${label}: every pick is inside the lane`, await page.evaluate(() => {
    const lane = document.querySelector('.sp-current .pb-lane').getBoundingClientRect();
    return [...document.querySelectorAll('.sp-current .pb-pick-mark')].every((m) => {
      const r = m.getBoundingClientRect();
      return r.left >= lane.left - 20 && r.right <= lane.right + 20;
    });
  }));
  await page.screenshot({ path: `${OUT}/patterns-live-${label}.png` });

  await page.waitForSelector('.sp-row', { timeout: 60000 });
  const after = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${label}: the result card fits too`, after <= 0, `${after}px over`);
  check(`${label}: and does not run off the bottom`, await page.evaluate(() => {
    const card = document.querySelector('.sp-results').getBoundingClientRect();
    return card.bottom <= window.innerHeight + 1 && card.top >= -1;
  }));
  await page.screenshot({ path: `${OUT}/patterns-result-${label}.png` });
  check(`${label}: no page errors`, errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
