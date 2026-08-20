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
// and is counted; that a note the drill did not ask for is heard, shown, and not
// counted; that a position the player has never recalled is lit and that playing
// a lit answer is never filed as a recall; and that the right letter an octave
// from the answer is a different position and is reported as one, over a whole
// run of them. A suite that only proved the component mounted
// would be worth nothing here: this product has already shipped a feature where
// every test passed and the feature did not work, because the tests confirmed
// the code ran rather than that the thing happened.
//
// WHY THE FIXTURES CYCLE. Which position the drill asks for is drawn from the
// player's own history and a roll, so a test cannot pin the question. It pins
// the answers instead: a take sounds every note the rung in question can call,
// in turn, over and over, so whatever is asked is answered within a few seconds.
//
// Set PREVIEW_URL for a build.

import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register } from 'node:module';
import { tone, silence, write, addRoom } from './tone.mjs';

register(new URL('../_resolve.mjs', import.meta.url).href);
const { RUNGS, getRung, rungPositions, midiAt, positionKey, rungWindow } =
  await import('../../src/lib/noteFinder.ts');

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

// The rung a player with no history runs: the six open strings, which is what
// the course teaches by name and the only thing it has taught about where a note
// is by the time anyone meets this drill.
const OPENING = RUNGS[0];
const SPOTS = rungPositions(OPENING);
const CALLABLE = [...new Set(SPOTS.map((p) => p.midi))].sort((a, b) => a - b);

// A rung with fretted questions on it, pinned by id where a case needs one: the
// octave rule is only worth proving where the same note really does live at two
// frets a player might reach for.
const MIXED = getRung('low-naturals');
const MIXED_SPOTS = rungPositions(MIXED);
// One cycle of every answer has to come round inside a rung's own budget, or the
// drill lights the answer before the take reaches it and a recall the test is
// waiting for arrives as a placement instead. Six answers at this length is
// eight seconds against the shortest budget of nine.
const NOTE_SEC = 1.0;
const GAP_SEC = 0.35;

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

const take = (name, midis, seconds) =>
  write(`${DIR}/${name}.wav`, cycle(midis, seconds).map((p) => addRoom(p, 0.0012, 5)));

take('every-answer', CALLABLE, 110);
take('mixed-answer', [...new Set(MIXED_SPOTS.map((p) => p.midi))], 110);
// F, which no open string sounds, so the opening rung cannot be asking for it
// wherever the roll lands. It must be heard, shown, and not counted.
take('wrong-note', [midiAt(6, 1) + 24], 60);
// The same F, sounding without a break for the length of a run. A string that
// has been struck once reads at full confidence for about four seconds
// (measured), which is longer than the gap between two questions, so this is the
// shape of what the microphone hears when the answer to the last question is
// still ringing under the next one.
write(`${DIR}/sustain.wav`, [addRoom(tone(hz(midiAt(6, 1) + 24), 70, 0.38), 0.0012, 5)]);
// The octave above every answer the fretted rung can call, and nothing else.
// None of these is any position's own pitch, so whatever is asked, what arrives
// is the right letter in the wrong place and must be reported as one.
take('octave-away', MIXED_SPOTS.map((p) => p.midi + 12), 110);

const RUN_SECONDS = 45;

const account = ({ rungId, seconds = RUN_SECONDS, ...extra } = {}) => ({
  activeRoutineId: 'r1',
  currentLesson: 'b1-504',
  routines: [{
    id: 'r1', name: 'Module 5 Daily', description: '', isDefault: true,
    tasks: [{
      id: 't1',
      title: 'Note finder',
      duration: '2 mins',
      drill: { kind: 'note-finder', durationSec: seconds, ...(rungId ? { rungId } : {}) },
    }],
  }],
  dailyLogs: {}, strumPatterns: [], songLinks: [], updatedAt: 1,
  ...extra,
});

/**
 * A neck where the opening rung has already been recalled, so nothing is lit.
 *
 * `slow` leans the deal: a position recalled once and slowly is asked three
 * times as often as one that is quick, which is how a run reaches a particular
 * kind of position inside its minute without pinning the roll.
 */
function recalledNeck(slow = [], spots = SPOTS) {
  const map = {};
  for (const p of spots) {
    const key = positionKey(p.stringPosition, p.fret);
    const isSlow = slow.some((s) => s.stringPosition === p.stringPosition && s.fret === p.fret);
    map[key] = isSlow
      ? { found: 1, bestMs: 4200, recentMs: [4200], at: 1 }
      : { found: 6, bestMs: 900, recentMs: [900, 950, 1000], at: 1 };
  }
  return map;
}

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
  settled = false,
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
  // The note circle demonstrates its own gesture on a first look, and the
  // demonstration walks the selected note. A block asserting what the string
  // below is drawing has to open on a circle that has already been seen, or it
  // is asserting against a moving anchor.
  if (settled) {
    await page.addInitScript(() => localStorage.setItem('daily-fret-note-circle-seen', 'yes'));
  }
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

/**
 * How far past the bottom of the frame something sits, in pixels.
 *
 * The practice surface does not scroll, so anything below the fold is simply
 * unreachable. This is how a Start button ended up three hundred pixels off the
 * bottom of a laptop window while every other assertion in this file passed.
 */
const spills = (page, selector) =>
  page.evaluate((sel) => {
    const body = document.querySelector('.practice-body');
    const el = document.querySelector(sel);
    if (!body || !el) return NaN;
    return Math.round(el.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom);
  }, selector);

const recalled = (page) =>
  page.locator('.nf-read .om-count').innerText().then(Number).catch(() => -1);
const shown = (page) =>
  page.locator('.nf-read .nf-shown-value').innerText().then(Number).catch(() => 0);

const start = async (page) => {
  await page.locator('.practice-overlay').getByRole('button', { name: /^Start/ }).first().click();
  await page.waitForSelector('.nf-stage', { timeout: 20000 });
};

// --- The ladder, and what the drill is, before a note is played ------------

{
  console.log('\nthe drill opens on the rung it will run, and shows what it is\n');
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

  // The drill is demonstrated rather than described: a note is named and lights
  // where it lives. This is the whole answer to "I do not know where the notes
  // are", so it is asserted rather than assumed.
  await page.waitForSelector('.nf-setup-map .nm-mark.is-show', { timeout: 8000 });
  check('a position is named and lit on the board', true);
  check('and the letter it is called is on it',
    (await page.locator('.nf-setup-map .nm-mark-name').count()) === 1);
  // SVG text, so textContent rather than innerText.
  const first = await page.locator('.nf-setup-map .nm-mark-name').evaluate((el) => el.textContent);
  await page.waitForFunction(
    (was) => document.querySelector('.nf-setup-map .nm-mark-name')?.textContent !== was,
    first,
    { timeout: 8000 },
  );
  check('and it walks, so what is shown is the drill itself rather than a picture', true);

  // The board is the rung's own stretch of neck, not all twelve frets: the
  // opening rung stops at the third, and drawing twelve was what made a fret
  // unreadable.
  const numbers = await page.locator('.nf-setup-map .nm-number').count();
  check('the board is cropped to the frets this rung asks about', numbers <= 6, String(numbers));
  check('all six strings are there, so a string can be found by where it sits',
    (await page.locator('.nf-setup-map .nm-string').count()) === 6);
  check('and the ones this rung uses are the lit ones',
    (await page.locator('.nf-setup-map .nm-string.is-lit').count()) === OPENING.strings.length);

  // Whose question this is. The first rung is a course lesson and says which;
  // the ladder above it is the app's own and says nothing, which is the app
  // declining to claim a fit it does not have.
  await page.waitForSelector('.nf-rung-lesson', { timeout: 10000 });
  const named = (await page.locator('.nf-rung-lesson').innerText()).trim();
  check('the rung the course teaches names the lesson', named.length > 0, named);
  check('and it is not just the rung name again',
    named !== (await page.locator('.nf-rung-name').innerText()).trim(), named);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${OUT}/finder-setup.png` });
  await browser.close();
}

{
  console.log('\nthe rungs the app built for itself claim no lesson\n');
  const { browser, page, errors } = await open({ seed: account({ rungId: 'whole-neck' }) });
  await page.waitForSelector('.nf-ladder', { timeout: 10000 });
  await page.waitForTimeout(1500);
  check('nothing on this rung is attributed to the course',
    (await page.locator('.nf-rung-lesson').count()) === 0);
  check('and the rung still says what it is',
    (await page.locator('.nf-rung-name').innerText()).trim().length > 0);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// --- A first run: nothing is known, so everything is shown -----------------

{
  console.log('\nnothing recalled yet, so the answers are lit and playing them is not a recall\n');
  const { browser, page, errors } = await open({ wav: 'every-answer.wav' });
  await start(page);
  check('a question is on screen', (await page.locator('.nf-letter-name').count()) === 1);
  check('and the string it is asking about is lit',
    (await page.locator('.nm-string.is-lit').count()) === 1);
  check('the answer is lit too, because nothing here has ever been recalled',
    (await page.locator('.nm-mark.is-show').count()) === 1);

  // The outcome, not the mount: the shown tally on screen has to climb.
  await page.waitForFunction(
    () => Number(document.querySelector('.nf-read .nf-shown-value')?.textContent ?? 0) >= 2,
    null,
    { timeout: 40000 },
  );
  check('playing what is lit is counted', (await shown(page)) >= 2);
  check('and never as a recall', (await recalled(page)) === 0, String(await recalled(page)));
  await page.screenshot({ path: `${OUT}/finder-shown.png` });

  await page.waitForSelector('.nf-results', { timeout: RUN_SECONDS * 1000 + 20000 });
  check('the card reports the recall count, which is nothing',
    (await page.locator('.nf-results .om-ring-value').innerText()) === '0');
  check('and says how many were played to a lit answer',
    (await page.locator('.nf-results .nf-shown-value').count()) === 1);
  await page.screenshot({ path: `${OUT}/finder-results-shown.png` });

  await page.waitForTimeout(1200);
  const acc = await storedAccount(page);
  const entries = Object.entries(acc.noteMap ?? {});
  check('the neck map filled in', entries.length >= 2, JSON.stringify(acc.noteMap));
  check('every entry says it was shown, not recalled',
    entries.every(([, f]) => f.shown >= 1 && f.found === 0), JSON.stringify(acc.noteMap));
  check('and only at positions the opening rung can ask about',
    entries.every(([k]) => {
      const [s, f] = k.split(':').map(Number);
      return OPENING.strings.includes(s) && f >= OPENING.minFret && f <= OPENING.maxFret;
    }), entries.map(([k]) => k).join(' '));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// --- A neck already recalled: nothing is lit, and finds are finds -----------

{
  console.log('\nonce a position has been recalled it is asked with nothing drawn\n');
  // Longer than the other blocks: this one waits for a third recall, and a run
  // that ends before the count gets there says nothing either way.
  const LONG = 75;
  const { browser, page, errors } = await open({
    wav: 'every-answer.wav',
    seed: account({ seconds: LONG, noteMap: recalledNeck() }),
  });
  await start(page);
  check('the answer is not on the neck while it is still being asked',
    (await page.locator('.nm-mark.is-show').count()) === 0);

  await page.waitForFunction(
    () => Number(document.querySelector('.nf-read .om-count')?.textContent ?? 0) >= 1,
    null,
    { timeout: 40000 },
  );
  check('the first recall lands', (await recalled(page)) >= 1);
  await page.screenshot({ path: `${OUT}/finder-playing.png` });

  await page.waitForFunction(
    () => Number(document.querySelector('.nf-read .om-count')?.textContent ?? 0) >= 3,
    null,
    { timeout: LONG * 1000 },
  );
  const counted = await recalled(page);
  check('and it keeps counting', counted >= 3, String(counted));

  await page.waitForSelector('.nf-results', { timeout: LONG * 1000 + 20000 });
  const card = await page.locator('.nf-results .om-ring-value').innerText();
  check('the card reports what was recalled', Number(card) >= 3, card);
  check('and says what the microphone did not settle',
    /string/i.test(await page.locator('.nf-limit').innerText()),
    await page.locator('.nf-limit').innerText());
  check('the run is marked on the neck',
    (await page.locator('.nf-results-map .nm-mark').count()) >= 3);
  await page.screenshot({ path: `${OUT}/finder-results.png` });

  await page.waitForTimeout(1200);
  const acc = await storedAccount(page);
  const keys = Object.keys(acc.dailyLogs[Object.keys(acc.dailyLogs)[0]].drillResults ?? {});
  check('the day holds a result under a key naming the rung',
    keys.some((k) => k.startsWith(`find:${OPENING.id}@`)), keys.join(' '));
  const runs = Object.values(acc.dailyLogs[Object.keys(acc.dailyLogs)[0]].drillRuns ?? {})[0] ?? [];
  check('and the run carries how long a recall took', typeof runs[0]?.findMs === 'number',
    JSON.stringify(runs[0]));
  const moved = Object.values(acc.noteMap).filter((f) => f.found > 6);
  check('the recalls are filed as recalls', moved.length >= 3, JSON.stringify(acc.noteMap));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// --- The octave is a different position and is reported as one -------------
//
// A pass on this drill loosened the judgement to the pitch class wherever a
// rung's own frets left one place the note could be, on the theory that a
// monophonic estimator mis-octaves a low string. This one does not
// (tests/pitch.test.mjs asserts zero octave errors across the range on signals
// built to trip a naive detector), so the loosening was buying nothing but the
// twelfth fret being accepted when the nut was asked for. It came back out, and
// this is what holds it out.

{
  console.log('\nan octave away is a different position and is counted as one\n');
  const before = recalledNeck([], MIXED_SPOTS);
  const { browser, page, errors } = await open({
    wav: 'octave-away.wav',
    seed: account({ rungId: MIXED.id, noteMap: before }),
  });
  await start(page);
  // Heard: the drill has to show what arrived. This is what separates "not
  // counted" from "not listening".
  await page.waitForSelector('.nf-miss', { timeout: 30000 });
  check('what arrived is shown',
    /^[A-G]#?\d$/.test((await page.locator('.nf-miss').innerText()).trim()),
    await page.locator('.nf-miss').innerText());

  await page.waitForSelector('.nf-results', { timeout: RUN_SECONDS * 1000 + 20000 });
  check('nothing was counted for a whole run of them',
    (await page.locator('.nf-results .om-ring-value').innerText()) === '0');
  await page.waitForTimeout(1200);
  const acc = await storedAccount(page);
  const moved = Object.entries(acc.noteMap ?? {})
    .filter(([k, f]) => f.found > before[k].found || (f.shown ?? 0) > 0);
  check('and the neck recorded nothing anywhere', moved.length === 0, JSON.stringify(moved));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// --- A note it did not ask for, and what happens when nothing comes --------

{
  console.log('\na note it did not ask for is not counted, and the answer arrives anyway\n');
  const { browser, page, errors } = await open({
    wav: 'wrong-note.wav',
    seed: account({ noteMap: recalledNeck() }),
  });
  await start(page);

  await page.waitForSelector('.nf-miss', { timeout: 25000 });
  const miss = await page.locator('.nf-miss').innerText();
  check('what arrived is shown', /^[A-G]#?\d$/.test(miss.trim()), miss);
  check('nothing is counted for it', (await recalled(page)) === 0, String(await recalled(page)));

  await page.waitForTimeout(6000);
  check('and still nothing after six more seconds of it', (await recalled(page)) === 0);
  await page.screenshot({ path: `${OUT}/finder-wrong.png` });

  // Past the rung's own budget the app lights the answer rather than dropping
  // the question, and a note played to a light is never a recall.
  await page.waitForSelector('.nm-mark.is-show', { timeout: 25000 });
  check('the answer is lit rather than the question sticking',
    (await page.locator('.nm-mark-name').count()) >= 1);
  check('and a lit answer is still not a recall', (await recalled(page)) === 0);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// --- The answer to the last question is not this question's wrong note -----

{
  console.log('\na note that was already sounding is not judged against the next question\n');
  const { browser, page, errors } = await open({
    wav: 'sustain.wav',
    seed: account({ rungId: MIXED.id, noteMap: recalledNeck([], MIXED_SPOTS) }),
  });
  await start(page);

  // Judged once, as the wrong note it is.
  await page.waitForSelector('.nf-miss', { timeout: 30000 });
  check('the note is heard and reported once', true);
  // The recall does not come, so the answer is lit and the question stays open.
  await page.waitForSelector('.nm-mark.is-show', { timeout: 25000 });
  check('the answer is lit rather than the question being dropped', true);
  // And then the next question. The note has not stopped: this is exactly the
  // moment a real player's last answer is still ringing.
  await page.waitForSelector('.nm-mark.is-show', { state: 'detached', timeout: 25000 });

  check('the next question does not open on a wrong note nobody played',
    (await page.locator('.nf-miss').count()) === 0);
  await page.waitForTimeout(4000);
  check('and it stays that way while the same note goes on sounding',
    (await page.locator('.nf-miss').count()) === 0);
  check('nothing was counted for any of it', (await recalled(page)) === 0);
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
  const drawn = rungWindow(OPENING);
  const hits = await page.locator('.nf-fret-hit').count();
  check('there is a target for every fret the rung draws',
    hits === drawn.to - drawn.from + 1, String(hits));
  check('and the screen says nothing is being counted',
    (await page.locator('.drill-uncounted').count()) === 1);
  check('so there is no counter to read', (await page.locator('.nf-read .om-count').count()) === 0);
  await page.screenshot({ path: `${OUT}/finder-tapped.png` });

  // Which fret is the answer is drawn from the player's own history, so the test
  // works the way a player would: try them until one lands.
  let landed = false;
  for (let fret = 0; fret < hits && !landed; fret += 1) {
    await page.locator('.nf-fret-hit').nth(fret).click();
    await page.waitForTimeout(140);
    landed = (await page.locator('.nf-letter.is-recalled, .nf-letter.is-placed').count()) === 1;
  }
  check('the right fret is accepted', landed);

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
    noteMap: recalledNeck(),
  });
  // Long enough for the take to come round to whatever is asked. A run that
  // recalls nothing files no number at all by design (store/completion.ts), so
  // a segment too short to answer anything would be asserting the wrong thing.
  seed.routines[0].tasks[0].drill = { kind: 'note-finder', durationSec: 30 };
  const { browser, page, errors } = await open({ wav: 'every-answer.wav', seed, openDrill: false });
  await page.getByRole('button', { name: /coached/i }).first().click();
  await page.waitForSelector('.practice-overlay', { timeout: 20000 });

  // Announced, counted in, then the drill itself. No Start button anywhere:
  // that is the whole point of the coached path.
  await page.waitForSelector('.nf-stage', { timeout: 40000 });
  check('the drill runs itself', (await page.locator('.nf-letter-name').count()) === 1);
  check('and no click was started under a question',
    (await page.locator('.metronome-chip.is-on, .metronome-chip.is-playing').count()) === 0);

  await page.waitForSelector('.nf-results, .mic-gate', { timeout: 60000 });
  check('it ends on a card of its own', (await page.locator('.nf-results').count()) === 1);
  check('which hands on without a tap', (await page.locator('.coach-advance').count()) === 1);

  await page.waitForTimeout(7000);
  const acc = await storedAccount(page);
  const today = Object.keys(acc.dailyLogs).sort().pop();
  const keys = Object.keys(acc.dailyLogs[today].drillResults ?? {});
  check('and the day holds what it found', keys.some((k) => k.startsWith('find:')), keys.join(' '));
  check('the neck moved from the coached run too',
    Object.values(acc.noteMap).some((f) => f.found > 6 || f.shown > 0), JSON.stringify(acc.noteMap));
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
    settled: true,
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

  // The mechanic itself, checked rather than assumed: the second demonstrated
  // tap has to hand the near end the note the far end was on. A demonstration
  // that showed the gesture with a stale near end would be teaching the wrong
  // move, and it would look exactly like this one.
  await page.waitForTimeout(4500);
  const ends = await page.evaluate(() => ({
    near: document.querySelector('.nc-note.is-from .nc-note-name')?.textContent ?? null,
    far: document.querySelector('.nc-note.is-to .nc-note-name')?.textContent ?? null,
  }));
  check('the second tap takes its near end from where the first one left off',
    ends.near === 'E' && ends.far === 'G', JSON.stringify(ends));
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

// --- Shown and recalled, told apart on the record --------------------------

{
  console.log('\nthe neck tells a position it has shown from one it has been given\n');
  const { browser, page, errors } = await open({
    openDrill: false,
    seed: account({
      noteMap: {
        '6:0': { found: 3, bestMs: 1200, recentMs: [1200, 1400, 1300], at: 1 },
        '6:1': { found: 0, bestMs: 0, recentMs: [], shown: 4, at: 2 },
      },
    }),
  });
  await page.locator('.task-row', { hasText: 'Note finder' }).click();
  await page.waitForSelector('.nf-setup-map', { timeout: 15000 });
  check('the recalled position is drawn as wear',
    (await page.locator('.nf-setup-map .nm-wear').count()) === 1);
  check('the shown one is drawn, and not as wear',
    (await page.locator('.nf-setup-map .nm-seen').count()) === 1);
  check('and nothing is being demonstrated over a board with a record on it',
    (await page.locator('.nf-setup-map .nm-mark.is-show').count()) === 0);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${OUT}/finder-record.png` });
  await browser.close();
}

// --- The shape of it, on the screens the owner practises on ----------------

for (const [label, viewport] of [
  ['360x780', { width: 360, height: 780 }],
  ['390x844', { width: 390, height: 844 }],
  ['1366x680', { width: 1366, height: 680 }],
  ['1366x768', { width: 1366, height: 768 }],
  // The tallest frame is the tightest one to run in: past 780 the stage stops
  // splitting into two columns and everything takes its full size again.
  ['1366x900', { width: 1366, height: 900 }],
]) {
  console.log(`\nthe drill at ${label}\n`);
  const { browser, page, errors } = await open({ viewport, wav: 'every-answer.wav' });
  await page.waitForSelector('.nf-ladder', { timeout: 15000 });
  await page.waitForTimeout(700);
  check('the setup fits the screen', (await sideways(page)) <= 0, String(await sideways(page)));
  const startSpill = await spills(page, '.nf-setup .practice-btn');
  check('and the way into the drill is on it', startSpill <= 0, `${startSpill}px below the fold`);
  await page.screenshot({ path: `${OUT}/finder-setup-${label}.png` });

  await start(page);
  await page.waitForTimeout(1200);
  check('and so does the question', (await sideways(page)) <= 0, String(await sideways(page)));
  const stageSpill = await spills(page, '.nf-stage');
  check('with the clock and the count still on the screen', stageSpill <= 0,
    `${stageSpill}px below the fold`);
  await page.screenshot({ path: `${OUT}/finder-playing-${label}.png` });
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();

  const circle = await open({
    viewport, openDrill: false, settled: true, seed: account({ noteMap: WORN }),
  });
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
