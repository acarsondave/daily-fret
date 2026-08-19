// The note finder in the real app, with real notes going into it.
//
// tests/noteFinder.test.mjs drives the ladder, the weighting and the judgement
// directly. This one runs the drill: React, the audio worklet, the pitch
// estimator, the neck, the count on screen and the record it leaves behind.
// Chromium will accept a file as its microphone, so the only thing faked is the
// physical mic.
//
//   node tests/browser/noteFinder.mjs [outputDir]
//
// WHAT IS ACTUALLY ASSERTED. That a note played in the room reaches the screen
// and is counted, and — the half that matters more — that a note the drill did
// not ask for is heard, shown, and not counted. A suite that only proved the
// component mounted would be worth nothing here: this product has already
// shipped a feature where every test passed and the feature did not work,
// because the tests confirmed the code ran rather than that the thing happened.
//
// WHY THE FIXTURE CYCLES. Which position the drill asks for is drawn from the
// player's own history and a roll, so a test cannot pin the question. It pins
// the answers instead: the take sounds every note the opening rung can possibly
// call, in turn, over and over, so whatever is asked is answered within a few
// seconds. The negative take sounds a pitch the rung cannot call at all.
//
// Set PREVIEW_URL for a build.

import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register } from 'node:module';
import { tone, silence, write, addRoom } from './tone.mjs';

register(new URL('../_resolve.mjs', import.meta.url).href);
const { RUNGS, rungPositions, midiAt } = await import('../../src/lib/noteFinder.ts');

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

const DIR = mkdtempSync(join(tmpdir(), 'daily-fret-finder-'));
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// Every pitch the opening rung can ask for, sounded in turn. Long enough for the
// estimator's median window to settle on each, with silence between so the next
// one is a new note rather than the same one continuing.
const OPENING = RUNGS[0];
const CALLABLE = [...new Set(rungPositions(OPENING).map((p) => p.midi))].sort((a, b) => a - b);
const NOTE_SEC = 1.7;
const GAP_SEC = 0.6;

function cycle(midis, seconds) {
  const parts = [silence(0.4)];
  let at = 0.4;
  while (at < seconds) {
    for (const midi of midis) {
      parts.push(tone(hz(midi), NOTE_SEC, 0.38), silence(GAP_SEC));
      at += NOTE_SEC + GAP_SEC;
      if (at >= seconds) break;
    }
  }
  return parts;
}

write(`${DIR}/every-answer.wav`, cycle(CALLABLE, 80).map((p) => addRoom(p, 0.0012, 5)));
// A pitch the opening rung cannot possibly be asking for: the high E string
// open, two octaves above the low E and nowhere in a rung that stops at the
// third fret of the fifth string. It must be heard, shown, and not counted.
write(`${DIR}/wrong-note.wav`, cycle([midiAt(1, 0)], 40));

const RUN_SECONDS = 45;

const account = (extra = {}) => ({
  activeRoutineId: 'r1',
  currentLesson: 'b1-504',
  routines: [{
    id: 'r1', name: 'Module 5 Daily', description: '', isDefault: true,
    tasks: [{
      id: 't1',
      title: 'Note finder',
      duration: '2 mins',
      drill: { kind: 'note-finder', durationSec: RUN_SECONDS },
    }],
  }],
  dailyLogs: {}, strumPatterns: [], songLinks: [], updatedAt: 1,
  ...extra,
});

/** Every way a microphone can refuse, as the tuner suite states them. */
const DENY = () => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) },
  });
};

async function open({
  wav,
  viewport = { width: 1366, height: 900 },
  seed = account(),
  deny = false,
  openDrill = true,
} = {}) {
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
    seed,
  );
  if (deny) await page.addInitScript(DENY);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForSelector('.task-container', { timeout: 25000 });
  if (openDrill) {
    await page.locator('.task-row', { hasText: 'Note finder' }).click();
    await page.waitForSelector('.practice-overlay', { timeout: 15000 });
  }
  return { browser, page, errors };
}

const storedAccount = (page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('daily-fret-storage');
    return raw ? JSON.parse(raw).state.accounts.anonymous : null;
  });

const sideways = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const finds = (page) => page.locator('.nf-read .om-count').innerText().then(Number).catch(() => -1);

// --- The ladder is the setup screen ---------------------------------------

{
  console.log('\nthe drill opens on the rung it will run\n');
  const { browser, page, errors } = await open();
  await page.waitForSelector('.nf-ladder', { timeout: 10000 });
  check('the ladder is drawn', (await page.locator('.nf-rung').count()) === RUNGS.length);
  check('one rung is the one being run', (await page.locator('.nf-rung.is-here').count()) === 1);
  check('and a player with no history is at the bottom of it', await page.evaluate(() => {
    const rungs = [...document.querySelectorAll('.nf-rung')];
    // Drawn bottom-up, so the first rung of the ladder is the last in the DOM.
    return rungs[rungs.length - 1].classList.contains('is-here');
  }));
  check('nothing on an empty neck is drawn as found',
    (await page.locator('.nf-setup-map .nm-wear').count()) === 0);
  check('and the neck is still there to be filled',
    (await page.locator('.nf-setup-map svg').count()) === 1);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${OUT}/finder-setup.png` });
  await browser.close();
}

// --- A played note reaches the screen and is counted -----------------------

let foundPositions = [];
{
  console.log('\na note played in the room is counted\n');
  const { browser, page, errors } = await open({ wav: 'every-answer.wav' });
  await page.locator('.practice-overlay').getByRole('button', { name: /^Start/ }).first().click();
  await page.waitForSelector('.nf-stage', { timeout: 20000 });
  check('a question is on screen', (await page.locator('.nf-letter-name').count()) === 1);
  check('and the string it is asking about is lit',
    (await page.locator('.nm-string.is-lit').count()) === 1);
  check('the answer is not on the neck while it is still being asked',
    (await page.locator('.nm-mark-name').count()) === 0);

  // The outcome, not the mount: the count on screen has to climb.
  await page.waitForFunction(
    () => Number(document.querySelector('.nf-read .om-count')?.textContent ?? 0) >= 1,
    null,
    { timeout: 40000 },
  );
  check('the first find lands', (await finds(page)) >= 1);
  await page.screenshot({ path: `${OUT}/finder-playing.png` });

  await page.waitForFunction(
    () => Number(document.querySelector('.nf-read .om-count')?.textContent ?? 0) >= 3,
    null,
    { timeout: 45000 },
  );
  const counted = await finds(page);
  check('and it keeps counting', counted >= 3, String(counted));

  await page.waitForSelector('.nf-results', { timeout: 40000 });
  const shown = await page.locator('.nf-results .om-ring-value').innerText();
  check('the card reports what was found', Number(shown) >= 3, shown);
  check('and says what the microphone did not settle',
    /string/i.test(await page.locator('.nf-limit').innerText()),
    await page.locator('.nf-limit').innerText());
  check('the run is marked on the neck',
    (await page.locator('.nf-results-map .nm-mark').count()) >= 3);
  await page.screenshot({ path: `${OUT}/finder-results.png` });

  const acc = await storedAccount(page);
  const keys = Object.keys(acc.dailyLogs[Object.keys(acc.dailyLogs)[0]].drillResults ?? {});
  check('the day holds a result under a key naming the rung',
    keys.some((k) => k.startsWith(`find:${RUNGS[0].id}@`)), keys.join(' '));
  const runs = Object.values(acc.dailyLogs[Object.keys(acc.dailyLogs)[0]].drillRuns ?? {})[0] ?? [];
  check('and the run carries how long a find took', typeof runs[0]?.findMs === 'number',
    JSON.stringify(runs[0]));

  foundPositions = Object.keys(acc.noteMap ?? {});
  check('the neck map filled in', foundPositions.length >= 2, foundPositions.join(' '));
  check('and only at positions the opening rung can ask about',
    foundPositions.every((k) => {
      const [s, f] = k.split(':').map(Number);
      return OPENING.strings.includes(s) && f >= OPENING.minFret && f <= OPENING.maxFret;
    }), foundPositions.join(' '));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// --- A note it did not ask for is heard, shown, and not counted ------------

{
  console.log('\na note it did not ask for is not counted\n');
  const { browser, page, errors } = await open({ wav: 'wrong-note.wav' });
  await page.locator('.practice-overlay').getByRole('button', { name: /^Start/ }).first().click();
  await page.waitForSelector('.nf-stage', { timeout: 20000 });

  // Heard: the drill has to show what arrived. This is the assertion that
  // separates "not counted" from "not listening".
  await page.waitForSelector('.nf-miss', { timeout: 25000 });
  const miss = await page.locator('.nf-miss').innerText();
  check('what arrived is shown', /^[A-G]#?\d$/.test(miss.trim()), miss);
  // Which treatment is right depends on what was asked: the high E is the same
  // letter as the low E an octave down and a different letter from everything
  // else the rung can call, so the drawing has to follow the letters rather than
  // a fixed answer.
  const asked = (await page.locator('.nf-letter-name').innerText()).trim();
  const sameLetter = miss.trim().replace(/\d+$/, '') === asked;
  check('a miss on the asked letter reads as the right note in the wrong place',
    (await page.locator('.nf-miss.is-near').count()) === (sameLetter ? 1 : 0),
    `${asked} vs ${miss}`);
  check('and a miss on another letter reads as another note',
    (await page.locator('.nf-miss.is-other').count()) === (sameLetter ? 0 : 1),
    `${asked} vs ${miss}`);
  check('nothing is counted for it', (await finds(page)) === 0, String(await finds(page)));

  await page.waitForTimeout(9000);
  check('and still nothing after nine more seconds of it', (await finds(page)) === 0);
  await page.screenshot({ path: `${OUT}/finder-wrong.png` });

  // Past twice the rung's budget the app gives the answer away, which is a
  // lesson and never a find.
  await page.waitForSelector('.nf-letter.is-revealed', { timeout: 25000 });
  check('the answer is given away rather than the question sticking', true);
  check('the position it names is on the neck',
    (await page.locator('.nm-mark-name').count()) === 1);
  check('and a revealed answer is still not a find', (await finds(page)) === 0);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// --- No microphone: a real answer, and it says it is not counted -----------

{
  console.log('\nwithout a microphone the answer is tapped, and nothing is counted\n');
  const { browser, page, errors } = await open({ deny: true });
  await page.locator('.practice-overlay').getByRole('button', { name: /^Start/ }).first().click();
  await page.waitForSelector('.mic-gate', { timeout: 15000 });
  const way = page.locator('.mic-gate-actions button').nth(1);
  check('the way out names what it actually is', /tap/i.test(await way.innerText()),
    await way.innerText());
  await way.click();

  await page.waitForSelector('.nf-stage', { timeout: 15000 });
  check('the neck has targets on it', (await page.locator('.nf-fret-hit').count()) === 13);
  check('and the screen says nothing is being counted',
    (await page.locator('.drill-uncounted').count()) === 1);
  check('so there is no counter to read', (await page.locator('.nf-read .om-count').count()) === 0);
  await page.screenshot({ path: `${OUT}/finder-tapped.png` });

  // Which fret is the answer is drawn from the player's own history, so the test
  // works the way a player would: try them until one lands.
  let landed = false;
  for (let fret = 0; fret <= 12 && !landed; fret += 1) {
    await page.locator('.nf-fret-hit').nth(fret).click();
    await page.waitForTimeout(120);
    landed = (await page.locator('.nf-letter.is-confirmed').count()) === 1;
  }
  check('the right fret is accepted and named on the neck', landed);

  await page.waitForTimeout(1500);
  const acc = await storedAccount(page);
  check('but a tap never reaches the neck map',
    Object.keys(acc.noteMap ?? {}).length === 0, JSON.stringify(acc.noteMap));
  const log = Object.values(acc.dailyLogs ?? {})[0];
  check('and it is never filed as a result',
    Object.keys(log?.drillResults ?? {}).length === 0, JSON.stringify(log?.drillResults));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// --- The coached run ------------------------------------------------------
//
// The path that matters most, because it is the one the owner will actually
// take: the drill has to be announced, counted in, run and recorded without a
// decision being made about it.

{
  console.log('\ncoached mode runs it without being asked\n');
  const seed = account({
    // The header's Coached control only appears once something has ever been
    // measured, so the seed carries one old result.
    dailyLogs: {
      '2026-08-01': {
        date: '2026-08-01', routineId: 'r1', completedTaskIds: [],
        drillResults: { 'pair:A|D': 24 },
      },
    },
  });
  seed.routines[0].tasks[0].drill = { kind: 'note-finder', durationSec: 16 };
  const { browser, page, errors } = await open({ wav: 'every-answer.wav', seed, openDrill: false });
  await page.getByRole('button', { name: /coached/i }).first().click();
  await page.waitForSelector('.practice-overlay', { timeout: 20000 });

  // Announced, counted in, then the drill itself. No Start button anywhere:
  // that is the whole point of the coached path.
  await page.waitForSelector('.nf-stage', { timeout: 40000 });
  check('the drill runs itself', (await page.locator('.nf-letter-name').count()) === 1);
  check('and no click was started under a question',
    (await page.locator('.metronome-chip.is-on, .metronome-chip.is-playing').count()) === 0);

  await page.waitForSelector('.nf-results, .mic-gate', { timeout: 40000 });
  check('it ends on a card of its own', (await page.locator('.nf-results').count()) === 1);
  check('which hands on without a tap', (await page.locator('.coach-advance').count()) === 1);

  await page.waitForTimeout(7000);
  const acc = await storedAccount(page);
  const today = Object.keys(acc.dailyLogs).sort().pop();
  const keys = Object.keys(acc.dailyLogs[today].drillResults ?? {});
  check('and the day holds what it found', keys.some((k) => k.startsWith('find:')), keys.join(' '));
  check('the neck filled in from the coached run too',
    Object.keys(acc.noteMap ?? {}).length >= 1, JSON.stringify(acc.noteMap));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// --- The record on the note circle ----------------------------------------

const WORN = {
  // Three quick finds is quick; one find is found; nothing else is anything.
  '6:0': { found: 4, bestMs: 1200, recentMs: [1200, 1400, 1300], at: 1 },
  '6:1': { found: 1, bestMs: 6800, recentMs: [6800], at: 2 },
  '5:3': { found: 3, bestMs: 2000, recentMs: [2000, 2100, 2400], at: 3 },
  '5:0': { found: 2, bestMs: 3000, recentMs: [3000, 9000], at: 4 },
};

{
  console.log('\nan undrilled note circle says nothing about the neck\n');
  const { browser, page, errors } = await open({ openDrill: false });
  await page.locator('.progress-launch', { hasText: /^Notes$/ }).click();
  await page.waitForSelector('.note-circle', { timeout: 15000 });
  check('nothing is drawn as found on the ring', (await page.locator('.nc-wear').count()) === 0);
  check('nor on the string', (await page.locator('.nc-neck-wear').count()) === 0);
  check('and the two figures are still there', (await page.locator('.nc-ring').count()) === 1);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${OUT}/circle-empty.png` });
  await browser.close();
}

{
  console.log('\na drilled one draws what was found, and only that\n');
  const { browser, page, errors } = await open({
    openDrill: false,
    seed: account({ noteMap: WORN }),
  });
  await page.locator('.progress-launch', { hasText: /^Notes$/ }).click();
  await page.waitForSelector('.note-circle', { timeout: 15000 });
  // One tick per place a note lives on the neck, never one per note, and the
  // whole band once anything has been measured: four lit of seventy-eight is a
  // reading and four floating specks is not.
  check('the band covers every position on the neck',
    (await page.locator('.nc-wear').count()) === 78,
    String(await page.locator('.nc-wear').count()));
  check('only what has been found is lit',
    (await page.locator('.nc-wear:not(.is-unasked)').count()) === Object.keys(WORN).length,
    String(await page.locator('.nc-wear:not(.is-unasked)').count()));
  check('and the quick ones are drawn differently from the rest',
    (await page.locator('.nc-wear.is-quick').count()) === 2,
    String(await page.locator('.nc-wear.is-quick').count()));
  // The string below draws a twelve-fret window from the anchor's own fret, not
  // the whole neck, so it shows the record for what it is currently showing. The
  // circle opens on A, which on the sixth string is the fifth fret, so the two
  // finds at the nut are outside the window and correctly absent.
  check('the string draws only the window it is drawing',
    (await page.locator('.nc-neck-wear').count()) === 0,
    String(await page.locator('.nc-neck-wear').count()));
  // On the fifth string A is the open string, so the window starts at the nut
  // and both of that string's finds fall inside it.
  await page.locator('.nc-string').nth(1).click();
  await page.waitForTimeout(300);
  check('and shows them where they do fall inside it',
    (await page.locator('.nc-neck-wear').count()) === 2,
    String(await page.locator('.nc-neck-wear').count()));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${OUT}/circle-worn.png` });
  await browser.close();
}

// --- The gesture, demonstrated once ---------------------------------------

{
  console.log('\nthe tap gesture shows itself once and then stops\n');
  const { browser, page, errors } = await open({ openDrill: false });
  await page.locator('.progress-launch', { hasText: /^Notes$/ }).click();
  await page.waitForSelector('.note-circle', { timeout: 15000 });
  const before = await page.locator('.nc-count-value').innerText();
  await page.waitForSelector('.nc-demo', { timeout: 8000 });
  check('the figure shows the tap rather than describing it', true);
  await page.waitForFunction(
    (was) => document.querySelector('.nc-count-value')?.textContent !== was,
    before,
    { timeout: 8000 },
  );
  check('and the walk really moves, so what is shown is the mechanic itself',
    (await page.locator('.nc-count-value').innerText()) !== before);
  check('there is no explanatory copy on the surface',
    (await page.locator('.note-circle p:not(.sr-only)').count()) === 0);

  // Reopened, it stays quiet: a demonstration that replays after the behaviour
  // is learned has become decoration.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.locator('.progress-launch', { hasText: /^Notes$/ }).click();
  await page.waitForSelector('.note-circle', { timeout: 15000 });
  await page.waitForTimeout(3000);
  check('it does not play again', (await page.locator('.nc-demo').count()) === 0);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// --- The shape of it, on the screens the owner practises on ----------------

for (const [label, viewport] of [
  ['360x780', { width: 360, height: 780 }],
  ['390x844', { width: 390, height: 844 }],
  ['1366x680', { width: 1366, height: 680 }],
]) {
  console.log(`\nthe drill at ${label}\n`);
  const { browser, page, errors } = await open({ viewport, wav: 'every-answer.wav' });
  await page.waitForSelector('.nf-ladder', { timeout: 15000 });
  check('the setup fits the screen', (await sideways(page)) <= 0, String(await sideways(page)));
  await page.screenshot({ path: `${OUT}/finder-setup-${label}.png` });

  await page.locator('.practice-overlay').getByRole('button', { name: /^Start/ }).first().click();
  await page.waitForSelector('.nf-stage', { timeout: 20000 });
  await page.waitForTimeout(1200);
  check('and so does the question', (await sideways(page)) <= 0, String(await sideways(page)));
  await page.screenshot({ path: `${OUT}/finder-playing-${label}.png` });
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();

  const circle = await open({ viewport, openDrill: false, seed: account({ noteMap: WORN }) });
  await circle.page.locator('.progress-launch', { hasText: /^Notes$/ }).click();
  await circle.page.waitForSelector('.note-circle', { timeout: 15000 });
  await circle.page.waitForTimeout(600);
  check('the note circle fits it too', (await sideways(circle.page)) <= 0,
    String(await sideways(circle.page)));
  await circle.page.screenshot({ path: `${OUT}/circle-worn-${label}.png` });
  await circle.browser.close();
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
