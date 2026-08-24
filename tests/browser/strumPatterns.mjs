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
  // A handle on the browser taking the speakers away mid-drill, which is what a
  // camera opening does and what filming a session made routine. Modelled the
  // way the real thing behaves and not the way the spec reads: the context is
  // left suspended with NO statechange fired, and resume() neither succeeds nor
  // rejects. Both are observed browser behaviour, and both are why an app that
  // waits to be told never finds out.
  await page.addInitScript(() => {
    const Native = window.AudioContext;
    const made = [];
    window.AudioContext = function (...args) {
      const ctx = new Native(...args);
      made.push(ctx);
      return ctx;
    };
    window.AudioContext.prototype = Native.prototype;
    // The recoverable version: the route is taken and given back. This is the
    // ordinary case when a camera opens, and the drill must ride it out.
    window.__blipClick = (ms) => {
      for (const ctx of made) {
        ctx.resume = () => new Promise(() => {});
        Native.prototype.suspend.call(ctx);
      }
      setTimeout(() => {
        for (const ctx of made) {
          delete ctx.resume;
          Native.prototype.resume.call(ctx);
        }
      }, ms);
      return made.length;
    };
    window.__freezeClick = () => {
      for (const ctx of made) {
        ctx.resume = () => new Promise(() => {});
        Native.prototype.suspend.call(ctx);
      }
      return made.length;
    };
  });
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

// --- the click goes away ----------------------------------------------------

if (run('silent')) {
console.log('\nWhen the click stops playing mid-run\n');
  // The drill deals against the metronome's own count, so a click that has gone
  // silent leaves it with nothing to deal on. It used to say nothing at all: the
  // run loop gave up on a missing count before it reached the line that reports
  // one, so the screen written for exactly this — and the button that can free
  // the audio, which needs a real tap and cannot come from anywhere else — could
  // never be reached. The player got a card that never moved and a countdown
  // that ran out.
  const { browser, page, errors } = await open({ wav: 'eighths.wav', drill: drillFor([EIGHTHS], 60) });
  await page.waitForSelector('.sp-current:not(.is-waiting)', { timeout: 40000 });
  const frozen = await page.evaluate(() => window.__freezeClick());
  check('the browser has taken the speakers', frozen > 0, `${frozen} contexts`);

  await page.waitForSelector('.sp-deaf', { timeout: 20000 });
  check('the drill says so rather than sitting there', true);
  const title = await page.locator('.sp-deaf-title').innerText();
  check('and says which of the two it is', /click is not playing/i.test(title), title);
  const action = await page.locator('.sp-deaf .practice-btn').innerText();
  check('offering the one thing that can fix it', /turn the click on/i.test(action), action);
  check('drawn as the muted speaker, not as a sentence about one',
    (await page.locator('.sp-deaf .sp-diagram').count()) === 1);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

if (run('blip')) {
console.log('\nWhen the click drops out and comes straight back\n');
  // A camera opening takes the audio route for about a second and the app asks
  // for it back once a second, so this is the common case, not the rare one. The
  // drill has to ride it out: reporting a click that is already returning would
  // throw away the deal in progress and put a wall in front of a player who
  // heard nothing more than a hiccup.
  const { browser, page, errors } = await open({ wav: 'eighths.wav', drill: drillFor([EIGHTHS], 60) });
  await page.waitForSelector('.sp-current:not(.is-waiting)', { timeout: 40000 });
  // Well past the grace, measured from the start of the run, before anything is
  // taken away. That is the difference the assertion below turns on.
  await page.waitForTimeout(9000);
  // Held for three seconds, which is longer than a camera takes and well inside
  // the grace. The old rule spent the grace on the run rather than on the
  // silence, so by this point in a run it had already been used up and any gap
  // at all was reported as a click that had gone.
  await page.evaluate(() => window.__blipClick(3000));

  // Sampled through the outage, not after it. The wall goes up while the audio
  // is away and this is the only window it can be seen in.
  let walled = false;
  for (let i = 0; i < 6; i += 1) {
    await page.waitForTimeout(400);
    if (await page.locator('.sp-deaf').count()) walled = true;
  }
  check('the drill does not give up on it', walled === false);
  await page.waitForTimeout(2000);
  check('and the audio came back on its own', await page.evaluate(() => window.dailyFretAudio().audible));
  check('the run is still going', (await page.locator('.sp-current:not(.is-waiting)').count()) === 1);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

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
  // A coached session opens straight into the run and never shows the deck
  // screen, so the seconds spent finding the click are the only place the whole
  // deck can be read. It costs no practice time and shortens nothing: the card
  // still switches on the bar, with one bar of warning.
  await page.waitForSelector('.sp-current.is-waiting', { timeout: 30000 });
  const onDeck = await page.locator('.sp-waiting .pattern-bar').count();
  check('the whole deck is on screen while the click is being found',
    onDeck === 2, String(onDeck));
  const first = await page.locator('.sp-current').getAttribute('aria-label');

  await page.waitForSelector('.sp-current:not(.is-waiting)', { timeout: 40000 });
  check('and it is gone the moment the run starts',
    (await page.locator('.sp-waiting').count()) === 0);

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

// --- a two-bar phrase --------------------------------------------------------
//
// Sixteen slots, and the app decides which bar of its own click the phrase
// starts on, which a wav rendered before the page loaded cannot know. So the
// take is straight eighths again: it sounds every slot whichever way the phrase
// is rotated against it, so "every sounded slot was struck" and "the ghosts read
// as added strums" are both true at any rotation. What this section is for is
// the arithmetic that would otherwise fail silently: sixteen slots read as one
// bar are sixteenth notes, which plays the phrase at double speed and scores a
// good take as a total miss.

if (run('phrase')) {
console.log('\nA two-bar phrase\n');
  const PHRASE = 'D-DU-UD-D-DU-UDU';
  const KEY = `pattern:${PHRASE}~${BPM}`;
  const { browser, page, errors } = await open({
    wav: 'eighths.wav',
    drill: drillFor([PHRASE], 26),
  });
  await page.waitForSelector('.sp-current:not(.is-waiting)', { timeout: 40000 });
  const marks = await page.locator('.sp-current .pb-pick-mark').count();
  check('the phrase is drawn as sixteen slots', marks === SLOTS_PER_BAR * 2, String(marks));
  check('with one bar line through it',
    (await page.locator('.sp-current .pb-barline').count()) === 1);
  check('and the count marks both downbeats',
    (await page.locator('.sp-current .pb-stem.is-one').count()) === 2,
    String(await page.locator('.sp-current .pb-stem.is-one').count()));
  // The arm crosses the bar line rather than restarting at it. Read off the
  // element the drill actually writes to, because that is the only place the
  // phase of a two-bar phrase is expressed.
  check('the arm travels the whole phrase, both sides of the bar line',
    await page.evaluate(async () => {
      const arm = document.querySelector('.sp-current .pb-arm');
      let before = false;
      let after = false;
      for (let i = 0; i < 200; i += 1) {
        const at = parseFloat(arm.style.left);
        if (Number.isFinite(at)) {
          if (at < 45) before = true;
          if (at > 55) after = true;
        }
        if (before && after) return true;
        await new Promise((r) => setTimeout(r, 60));
      }
      return false;
    }));
  await page.screenshot({ path: `${OUT}/patterns-phrase-1366.png` });

  await page.waitForSelector('.sp-row', { timeout: 90000 });
  check('the result reports all sixteen slots',
    (await page.locator('.sp-row .pb-pick-mark').count()) === SLOTS_PER_BAR * 2,
    String(await page.locator('.sp-row .pb-pick-mark').count()));
  check('and nothing in either bar is reported as never struck',
    (await page.locator('.sp-row .pb-pick-mark.is-missed').count()) === 0,
    String(await page.locator('.sp-row .pb-pick-mark.is-missed').count()));
  const day = await stored(page);
  check('the phrase is filed under its own key, sixteen characters and all',
    Object.keys(day?.drillResults ?? {}).join(' ') === KEY,
    Object.keys(day?.drillResults ?? {}).join(' '));
  check('and it scored like a run that was on the click',
    (day?.drillResults?.[KEY] ?? 0) >= 80, String(day?.drillResults?.[KEY]));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// --- the stage holds still --------------------------------------------------

/**
 * The drill opens straight into a run in coached mode, and for the first few
 * seconds it has no beat grid: the card is drawn but nothing is being measured
 * against it yet. That wait used to be a taller stage than the run, because the
 * rest of the deck was stacked under the drawn card, so the whole stage jumped
 * at whatever moment the grid happened to fit. A card being read with both
 * hands on the guitar must not move under the reader.
 *
 * Measured on the phone frame as well as the laptop, because the stack was a
 * column and a column costs a phone most.
 */
if (run('stage')) for (const [label, viewport] of [
  ['1366x900', { width: 1366, height: 900 }],
  ['390x780', { width: 390, height: 780 }],
]) {
  console.log(`\nThe stage does not change shape when the click is found (${label})\n`);
  const { browser, page, errors } = await open({
    wav: 'eighths.wav',
    // Four cards, so anything that draws the rest of the deck draws three bars.
    drill: drillFor([DOWNS, EIGHTHS, 'D-DU-UD-', 'D-DUDUD-'], 20),
    viewport,
  });

  const cueBox = () => page.evaluate(() => {
    const cue = document.querySelector('.sp-stage .drill-cue');
    const read = document.querySelector('.sp-stage .drill-read');
    const meter = document.querySelector('.signal-meter');
    if (!cue) return null;
    const r = cue.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      height: Math.round(r.height),
      readHeight: read ? Math.round(read.getBoundingClientRect().height) : -1,
      meter: meter ? `${meter.className}|${Math.round(meter.getBoundingClientRect().height)}` : 'none',
    };
  });

  await page.waitForSelector('.sp-current.is-waiting', { timeout: 20000 });
  const waiting = await cueBox();
  // Counted here rather than after the run starts: the deck stack this replaces
  // only ever existed during the wait, so an assertion taken later would pass
  // whether or not it was there.
  const barsWhileWaiting = await page.locator('.sp-stage .drill-cue .pattern-bar').count();
  await page.screenshot({ path: `${OUT}/patterns-waiting-${label}.png` });

  // The same card, now live: same element, same box, brought up to full weight.
  await page.waitForSelector('.sp-current:not(.is-waiting)', { timeout: 45000 });
  const playing = await cueBox();

  check(`${label}: the card sits in the same place before and after`,
    waiting !== null && playing !== null && waiting.top === playing.top,
    `${JSON.stringify(waiting)} then ${JSON.stringify(playing)}`);
  check(`${label}: and the stage is the same height`,
    waiting !== null && playing !== null && waiting.height === playing.height,
    `${waiting?.height}px then ${playing?.height}px`);
  check(`${label}: one card is drawn while the click is being found, not the deck`,
    barsWhileWaiting === 1, String(barsWhileWaiting));

  // The arm crosses the strings sixty times a second. It has to do that on the
  // compositor: `left` is a layout property, and moving it every frame
  // invalidates the lane on the one screen where a microphone, a metronome and
  // often a camera are already running.
  const arm = await page.evaluate(async () => {
    const el = document.querySelector('.sp-current .pb-arm');
    if (!el) return null;
    const read = () => ({
      left: getComputedStyle(el).left,
      transform: getComputedStyle(el).transform,
    });
    const first = read();
    await new Promise((r) => setTimeout(r, 260));
    const second = read();
    return { first, second };
  });
  check(`${label}: the arm is actually moving`,
    arm !== null && arm.first.transform !== arm.second.transform,
    JSON.stringify(arm));
  check(`${label}: and it moves without touching layout`,
    arm !== null && arm.first.left === '0px' && arm.second.left === '0px',
    `left ${arm?.first.left} then ${arm?.second.left}`);

  check(`${label}: no page errors`, errors.length === 0, errors.join(' | '));
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
