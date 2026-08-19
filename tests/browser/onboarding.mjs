// First run, walked end to end in a real browser, with a guitar plugged into the
// microphone.
//
// The old suite proved that seven screens rendered. That is worth almost
// nothing: a wizard that renders is still a wizard. What is worth checking is
// what a person actually spends, so this counts the real taps, the real
// questions and the real words from a cold load with empty storage, and fails if
// any of them creep back up.
//
// The one assertion the whole product rests on is here too. A WAV of four
// plucked strings is fed to Chromium in place of a microphone, and the test
// requires that the note reaches the screen: the right string lit on the
// headstock, the letter drawn, a tally mark left behind. A test that only
// checked the component mounted would have passed against a detector that was
// wired to nothing.
//
//   npm run build && npx vite preview --port 5404 --strictPort
//   PREVIEW_URL=http://localhost:5404/ node tests/browser/onboarding.mjs

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fakeGuitarArgs, writeFakeGuitarWav } from './fakeGuitar.mjs';

const OUT = process.argv[2] ?? 'tests/browser/.shots/onboarding';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5404/';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
};

const VIEWPORTS = [
  { name: 'laptop-1366', width: 1366, height: 768 },
  { name: 'phone-390', width: 390, height: 844 },
];

const wav = writeFakeGuitarWav();
const browser = await chromium.launch({ args: fakeGuitarArgs(wav) });

const sideways = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// What counts as the flow's own words rather than the product's content. The
// chord grid is nine labels on nine drawings, and the session listing is the
// routine describing itself; neither is onboarding talking. The budget that
// matters is the copy written to move someone through the screens.
const CONTENT = [
  '.onboarding-chord',
  '.onboarding-preview-name',
  '.onboarding-preview-chords',
  '.onboarding-preview-by',
  '.onboarding-shape-name',
  '.onboarding-modules',
];

/** Words a person can actually read on screen, ignoring anything only spoken. */
const visibleWords = (page, selector, skip = []) =>
  page.$eval(selector, (root, skipSelectors) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const words = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      let el = node.parentElement;
      let hidden = false;
      while (el && el !== root.parentElement) {
        const style = getComputedStyle(el);
        if (skipSelectors.some((s) => el.matches(s))) {
          hidden = true;
          break;
        }
        if (
          el.classList.contains('sr-only') ||
          el.getAttribute('aria-hidden') === 'true' ||
          style.display === 'none' ||
          style.visibility === 'hidden'
        ) {
          // The note letter is aria-hidden because the same fact is spoken
          // beside it, but it is very much on screen. It is one character.
          if (!el.classList.contains('onboarding-note')) hidden = true;
          break;
        }
        el = el.parentElement;
      }
      if (hidden) continue;
      words.push(...node.textContent.split(/\s+/).filter(Boolean));
    }
    return words;
  }, skip);

// ---------------------------------------------------------------------------
// One cold first run, counted.
// ---------------------------------------------------------------------------

for (const vp of VIEWPORTS) {
  console.log(`\n${vp.name}: a cold first run\n`);
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    permissions: ['microphone'],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    // The preview build carries no Firebase key, so the sync layer refuses to
    // start. That is the environment, not this flow.
    if (m.type() === 'error' && !/firebase|auth\/invalid-api-key/i.test(m.text())) {
      errors.push(m.text());
    }
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  let taps = 0;
  const tap = async (locator) => {
    taps += 1;
    await locator.click();
  };
  // Taps split two ways on purpose. Lighting a chord by hand is the fallback
  // for someone with no guitar to hand; a player with one lights them by
  // playing, and the flow's own cost is what it takes to move between screens.
  let chordTaps = 0;
  const words = [];
  const content = [];
  const questions = [];
  const record = async () => {
    const own = await visibleWords(page, '.onboarding-body', CONTENT);
    const all = await visibleWords(page, '.onboarding-body');
    words.push(...own);
    content.push(...all);
    questions.push(...all.filter((w) => w.includes('?')));
  };

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.onboarding-panel', { timeout: 15000 });

  // --- one: the note -------------------------------------------------------
  await page.waitForTimeout(400);
  await record();
  await page.screenshot({ path: `${OUT}/${vp.name}-1-note-rest.png` });
  check('the first screen is the instrument, not a paragraph about it',
    (await page.locator('.headstock').count()) === 1);
  check('and it asks for one thing, with one control',
    (await page.locator('.onboarding-body button:visible').count()) === 1,
    `${await page.locator('.onboarding-body button:visible').count()} controls`);
  check('nothing is claimed to be live before it is',
    (await page.locator('.headstock.is-deaf').count()) === 1);
  check('no course is named before a note has been played',
    !(await page.locator('.onboarding-body').innerText()).toLowerCase().includes('justinguitar'));
  check('no sideways scroll', (await sideways(page)) <= 0, `${await sideways(page)}px`);

  await tap(page.getByRole('button', { name: /^listen$/i }));

  // The plucked WAV is four strings, each ringing and dying. This is the claim
  // the whole product rests on: a note played in the room reaches the screen.
  await page.waitForSelector('.onboarding-note.is-on', { timeout: 20000 });
  const heard = (await page.locator('.onboarding-note').innerText()).trim();
  check('a note played into the microphone is named on screen',
    /^[A-G]#?$/.test(heard), JSON.stringify(heard));
  check('and the string it was played on is lit on the headstock',
    (await page.locator('.headstock-string.is-active').count()) === 1);
  check('and the machine head for that string with it',
    (await page.locator('.headstock-machine.is-active').count()) === 1);
  const spoken = await page.locator('.onboarding-heard .sr-only').innerText();
  check('the same fact reaches a screen reader, naming the string',
    /heard [A-G]#?, your .+ string/i.test(spoken), JSON.stringify(spoken));
  await page.screenshot({ path: `${OUT}/${vp.name}-1-note-live.png` });

  await page.waitForSelector('.onboarding-mark:nth-child(3)', { timeout: 20000 });
  check('three notes leave three tally marks',
    (await page.locator('.onboarding-mark').count()) === 3);
  check('and only three: the marks stop at the bar they set',
    (await page.locator('.onboarding-mark').count()) <= 3);
  await record();
  await page.screenshot({ path: `${OUT}/${vp.name}-1-note-done.png` });

  await tap(page.getByRole('button', { name: /^next/i }));

  // --- two: the chords you have -------------------------------------------
  await page.waitForSelector('.onboarding-chord', { timeout: 20000 });
  await page.waitForTimeout(1800);
  check('all nine hearable shapes are offered',
    (await page.locator('.onboarding-chord').count()) === 9);
  check('and none of them is ticked on the player’s behalf before they play',
    (await page.locator('.onboarding-chord[aria-pressed]').count()) === 9);

  // Tapping is the path for someone with no guitar to hand, and it has to work.
  for (const chord of ['A', 'D', 'E']) {
    const card = page.locator('.onboarding-chord').filter({ hasText: new RegExp(`^${chord}$`) }).first();
    if ((await card.getAttribute('aria-pressed')) === 'false') {
      chordTaps += 1;
      await card.click();
    }
  }
  await page.waitForTimeout(400);
  check('a tapped shape lights', (await page.locator('.onboarding-chord.is-on').count()) >= 3);
  const derived = await page.locator('.onboarding-derived').innerText();
  check('the module is stated as a fact rather than asked as a question',
    /module \d+/i.test(derived) && !derived.includes('?'), JSON.stringify(derived));
  check('and the statement can be corrected',
    (await page.getByRole('button', { name: /not there/i }).count()) === 1);
  await record();
  await page.screenshot({ path: `${OUT}/${vp.name}-2-chords.png` });
  check('no sideways scroll', (await sideways(page)) <= 0, `${await sideways(page)}px`);

  await tap(page.getByRole('button', { name: /^next/i }));

  // --- three: tomorrow -----------------------------------------------------
  await page.waitForSelector('.onboarding-preview-item', { timeout: 15000 });
  // The strip draws itself in and the rows land under it. Screenshots taken
  // before that settles were showing a half-assembled screen and hiding real
  // defects in it.
  await page.waitForTimeout(1100);
  const readyText = await page.locator('.onboarding-body').innerText();
  const rows = await page.locator('.onboarding-preview-item').count();
  check('the session is listed', rows >= 2, `${rows} tasks`);

  // The session is drawn, one stroke per minute, and the number beside the
  // strip is a count of those strokes. A drawing and a caption disagreeing in
  // public is the failure this replaces: the screen used to print "about 27
  // minutes" in a sentence and show nothing.
  const printed = Number((await page.locator('.onboarding-total').innerText()).match(/\d+/)[0]);
  const strokes = await page.locator('.onboarding-comb-stroke').count();
  const openStrokes = await page.locator('.onboarding-comb-stroke.is-open').count();
  check('the minutes are drawn, not stated', strokes > 0, `${strokes} strokes`);
  check('and the number beside them counts them',
    strokes - openStrokes === printed, `${strokes - openStrokes} strokes vs ${printed} printed`);

  // The word "counted" used to sit on every row as a pill beside a mark that
  // already said it. The mark carries it now, so the fact has to reach a screen
  // reader some other way, and it does.
  const spokenRows = await page.locator('.onboarding-preview-item .sr-only').allInnerTexts();
  check('and every row says whether it is counted or timed, without printing it',
    spokenRows.length === rows &&
      spokenRows.every((t) => /counted|timer|play-along/i.test(t)),
    JSON.stringify(spokenRows));
  check('nothing on the screen prints the word "counted" as a label',
    (await page.locator('.onboarding-preview-item').allInnerTexts())
      .every((t) => !/^counted$/im.test(t)));

  // The single most motivating thing a beginner app can say, and the app has
  // held the answer since the chord grid: these shapes, this song, by name.
  // Which shapes get lit depends on what the fake guitar plays, so both real
  // answers are checked: a chart the vocabulary opens, or the nearest one and
  // the single shape standing in front of it. What is never acceptable is the
  // block this replaced, a five minute clock that named nothing.
  const songRow = page.locator('.onboarding-preview-item.is-song');
  const horizon = page.locator('.onboarding-horizon');
  const hasSong = (await songRow.count()) === 1;
  check('the session names a chart, or the screen names the next one',
    hasSong || (await horizon.count()) === 1,
    `song ${await songRow.count()}, horizon ${await horizon.count()}`);
  check('and nothing anywhere offers "play a song" as a block',
    !/play a song/i.test(readyText), readyText);

  if (hasSong) {
    const songTitle = await songRow.locator('.onboarding-preview-name').innerText();
    check('the chart is a real title', songTitle.trim().length > 2, songTitle);
    check('with its shapes drawn rather than listed',
      (await songRow.locator('.chord-diagram').count()) >= 2,
      `${await songRow.locator('.chord-diagram').count()} diagrams`);
    check('and every drawn shape is named beside it',
      (await songRow.locator('.onboarding-shape-name').allInnerTexts()).length ===
        (await songRow.locator('.chord-diagram').count()));
  }

  if ((await horizon.count()) === 1) {
    check('the next chart is one shape away, and the shape is drawn',
      (await horizon.locator('.chord-diagram').count()) === 1);
    check('and it is drawn as one they do not have yet',
      (await horizon.locator('.onboarding-shapes.is-muted').count()) === 1);
    check('and the chart it opens is named',
      (await horizon.locator('.onboarding-horizon-text').innerText()).trim().length > 6,
      await horizon.locator('.onboarding-horizon-text').innerText());
  }

  check('it says what the routine was built from', /built|first steps/i.test(readyText));
  check('and never prints an internal track code', !/\bbg[123]\b/i.test(readyText));
  await record();
  await page.screenshot({ path: `${OUT}/${vp.name}-3-ready.png`, fullPage: true });

  await tap(page.getByRole('button', { name: /start the session/i }));

  // The last act of setting up is the first act of practice, not a task list.
  await page.waitForSelector('.practice-overlay', { timeout: 20000 });
  check('finishing starts the coached session rather than dropping to a list',
    (await page.locator('.practice-overlay').count()) === 1);

  // --- what it cost --------------------------------------------------------
  console.log(
    `\n  measured: ${taps} taps to move through it (+${chordTaps} tapping chords a player would ` +
    `have played), ${questions.length} questions, ${words.length} words of its own ` +
    `(${content.length} including the chord grid and the session listing)\n`,
  );
  check('three screens', true, '1 note, 2 chords, 3 tomorrow');
  check('no question is asked anywhere in the flow', questions.length === 0,
    questions.join(' '));
  check('four taps carry a player from a cold load into a running session',
    taps === 4, `${taps} taps`);
  // Tightened from eighty when the summary stopped describing the session and
  // started drawing it. Two sentences of prose became a strip of strokes and a
  // number, and the budget follows the screen down rather than banking the
  // headroom for the next paragraph.
  check('and the flow spends under seventy-five words of its own getting them there',
    words.length < 75, `${words.length} words`);
  check('no console errors through the whole flow', errors.length === 0,
    errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------------------
// Interrupted and resumed. A first session is exactly the kind that gets one.
// ---------------------------------------------------------------------------
{
  console.log('\ninterrupted and resumed\n');
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['microphone'],
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.onboarding-panel');
  await page.getByRole('button', { name: /^listen$/i }).click();
  await page.waitForSelector('.onboarding-mark:nth-child(3)', { timeout: 20000 });
  await page.getByRole('button', { name: /^next/i }).click();
  await page.waitForSelector('.onboarding-chord');
  const card = page.locator('.onboarding-chord').filter({ hasText: /^C$/ }).first();
  if ((await card.getAttribute('aria-pressed')) === 'false') await card.click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.onboarding-panel');
  // Waits for the screen rather than for the panel around it. A resume lands on
  // the chord grid, which lives in its own chunk, so asserting the instant the
  // panel exists was racing a network fetch and only ever passed by luck.
  await page.waitForSelector('.onboarding-chord', { timeout: 15000 });
  check('a reload comes back to the screen it was on',
    (await page.locator('.onboarding-chord').count()) === 9);
  check('with the shapes it had already lit',
    (await page.locator('.onboarding-chord.is-on').count()) >= 1);
  await page.screenshot({ path: `${OUT}/resumed.png` });
  await ctx.close();
}

// ---------------------------------------------------------------------------
// The microphone refused. A separate browser: the fake-device flags above make
// Chromium accept every capture request, and the point of this case is the one
// where it does not.
// ---------------------------------------------------------------------------
{
  console.log('\nmicrophone declined\n');
  const strict = await chromium.launch();
  const ctx = await strict.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.onboarding-panel');
  await page.getByRole('button', { name: /^listen$/i }).click();
  await page.waitForSelector('.onboarding-blocked', { timeout: 20000 });
  const blocked = await page.locator('.onboarding-blocked').innerText();
  check('the refusal names itself in plain words', blocked.length > 20, blocked.split('\n')[0]);
  check('and says what carrying on actually costs, which the app now honours',
    /timer/i.test(blocked) && /nothing will be counted/i.test(blocked), blocked);
  check('and there is a way on regardless',
    await page.getByRole('button', { name: /^carry on/i }).isVisible());
  await page.screenshot({ path: `${OUT}/mic-blocked.png` });

  await page.getByRole('button', { name: /^carry on/i }).click();
  await page.waitForSelector('.onboarding-chord');
  const card = page.locator('.onboarding-chord').filter({ hasText: /^D$/ }).first();
  await card.click();
  await page.locator('.onboarding-chord').filter({ hasText: /^A$/ }).first().click();
  await page.getByRole('button', { name: /^next/i }).click();
  await page.waitForSelector('.onboarding-preview-item');
  await page.waitForTimeout(1100);
  // Refused, and the screen has to say so without a sentence doing all the
  // work. The strokes for the counted blocks are drawn hollow, and the same
  // fact is spoken, because "would be counted" and "are counted" are different
  // claims and this app does not blur them.
  const hollow = await page.locator('.onboarding-comb-stroke.is-waiting').count();
  const filled = await page.locator('.onboarding-comb-stroke.is-counted').count();
  check('the counted blocks are drawn empty, because nothing is counting',
    hollow > 0 && filled === 0, `${hollow} waiting, ${filled} counted`);
  const readySpoken = await page.locator('.onboarding-shape .sr-only').innerText();
  check('and the summary says the counting is waiting on the microphone',
    /once the microphone is on/i.test(readySpoken), readySpoken);
  await page.screenshot({ path: `${OUT}/mic-blocked-ready.png` });
  await ctx.close();
  await strict.close();
}

// ---------------------------------------------------------------------------
// The day's screen, before anything has been measured and after two sessions.
// ---------------------------------------------------------------------------

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
};

const ROUTINE = {
  id: 'r1',
  name: 'Module 4 Daily',
  description: 'Grade 1. Built around Am, the new shape in module 4.',
  isDefault: true,
  chords: ['A', 'D', 'E'],
  tasks: [
    { id: 't1', title: 'Chord Perfect', drill: { kind: 'chord-trainer', durationSec: 90, chords: ['A', 'D', 'E'] } },
    { id: 't2', title: 'A and D changes', drill: { kind: 'one-minute-changes', durationSec: 60, chords: ['A', 'D'] } },
    { id: 't3', title: 'Play a song', duration: '5' },
  ],
};

const withState = (dailyLogs) => ({
  currentAccountId: 'anonymous',
  accounts: {
    anonymous: {
      activeRoutineId: 'r1',
      routines: [ROUTINE],
      dailyLogs,
      strumPatterns: [],
      songLinks: [],
      updatedAt: 1,
    },
  },
});

async function openApp(state, viewport, extraInit) {
  const ctx = await browser.newContext({ viewport, permissions: ['microphone'] });
  const page = await ctx.newPage();
  await page.addInitScript(
    ({ s, extra }) => {
      localStorage.setItem('daily-fret-storage', JSON.stringify({ state: s, version: 0 }));
      if (extra) for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
    },
    { s: state, extra: extraInit ?? null },
  );
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  return { ctx, page };
}

{
  console.log('\nthe day’s screen: nothing measured yet\n');
  // Onboarding finished: a routine exists, and not one drill has been run.
  for (const vp of VIEWPORTS) {
    const { ctx, page } = await openApp(withState({}), { width: vp.width, height: vp.height });
    await page.waitForSelector('.ledger', { timeout: 15000 });
    const values = await page.locator('.ledger-value').allInnerTexts();
    check(`${vp.name}: the figures are reserved, not zeroed`,
      values.length === 3 && values.every((v) => v.trim() === '__'), values.join(','));
    check(`${vp.name}: and one line says what will fill them`,
      (await page.locator('.ledger-line').innerText()).trim() ===
        'Nothing measured yet. The first run sets the bar.',
      await page.locator('.ledger-line').innerText());
    // One primary, not two: the header's coached button stands down while the
    // ledger is carrying the only thing worth pressing.
    check(`${vp.name}: exactly one primary action on the screen`,
      (await page.locator('.ledger-start, .progress-launch.is-primary').count()) === 1,
      `${await page.locator('.ledger-start, .progress-launch.is-primary').count()} found`);
    check(`${vp.name}: no sideways scroll`, (await sideways(page)) <= 0);
    await page.screenshot({ path: `${OUT}/${vp.name}-4-never-practised.png` });
    await ctx.close();
  }
}

{
  console.log('\nthe day’s screen: a second session\n');
  const logs = {
    [daysAgo(2)]: {
      date: daysAgo(2),
      routineId: 'r1',
      completedTaskIds: ['t1', 't2'],
      drillResults: { 'pair:A|D': 31, 'pool:A|D|E': 44 },
    },
    [daysAgo(1)]: {
      date: daysAgo(1),
      routineId: 'r1',
      completedTaskIds: ['t1', 't2'],
      drillResults: { 'pair:A|D': 38, 'pool:A|D|E': 46 },
    },
  };

  for (const vp of VIEWPORTS) {
    const { ctx, page } = await openApp(withState(logs), { width: vp.width, height: vp.height });
    await page.waitForSelector('.ledger', { timeout: 15000 });
    const lead = await page.locator('.ledger-line.is-delta').innerText();
    check(`${vp.name}: the delta leads`, /^\+7\b/.test(lead.trim()), JSON.stringify(lead));
    check(`${vp.name}: and names the drill and the day it beat`,
      /A ↔ D/.test(lead) && /(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day/.test(lead), lead);
    check(`${vp.name}: nothing welcomes anybody back`,
      !/welcome|back|great|well done/i.test(await page.locator('.task-container').innerText()));
    check(`${vp.name}: and nothing is celebrated in a modal`,
      (await page.locator('.modal-backdrop').count()) === 0);
    check(`${vp.name}: exactly one streak cell lands`,
      (await page.locator('.streak-block.is-landing').count()) === 1,
      `${await page.locator('.streak-block.is-landing').count()} cells`);

    // The figures count out of their underscores, and land on the real numbers.
    await page.waitForTimeout(1200);
    const values = (await page.locator('.ledger-value').allInnerTexts()).map((v) => v.trim());
    check(`${vp.name}: the figures land on what was measured`,
      values[0] === '38' && values[1] === '46' && values[2] === '2', values.join(','));
    check(`${vp.name}: no sideways scroll`, (await sideways(page)) <= 0);
    await page.screenshot({ path: `${OUT}/${vp.name}-5-second-session.png` });

    // Once a day. A second visit is not a second confirmation.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ledger');
    check(`${vp.name}: and they do not count up again on the next visit today`,
      (await page.locator('.streak-block.is-landing').count()) === 0);
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// The camera, on the day it is earned. It used to be asked for on day zero,
// before there was a session to film and before the microphone had proved
// itself. It is now the second thought on the sheet that opens when a session
// has just been finished.
// ---------------------------------------------------------------------------
{
  console.log('\nthe camera, after a finished session\n');
  const today = iso(new Date());
  const done = {
    [today]: {
      date: today,
      routineId: 'r1',
      completedTaskIds: ['t1', 't2', 't3'],
      drillResults: { 'pair:A|D': 33, 'pool:A|D|E': 41 },
    },
  };
  const { ctx, page } = await openApp(withState(done), { width: 390, height: 844 });
  await page.waitForSelector('.jotter-content', { timeout: 15000 });
  check('the sheet that opens after a session carries the offer',
    (await page.locator('.film-offer').count()) === 1);
  const offer = await page.locator('.film-offer').innerText();
  check('and it is specific about what it would add, not a list of promises',
    /cannot see how your hands/i.test(offer), JSON.stringify(offer));
  check('nothing is turned on by the offer being looked at',
    await page.evaluate(() => {
      const raw = localStorage.getItem('daily-fret-recordings');
      return raw === null || JSON.parse(raw).state?.settings?.enabled !== true;
    }));
  check('declining is a control, not a footnote',
    await page.getByRole('button', { name: /not this/i }).isVisible());
  await page.screenshot({ path: `${OUT}/film-offer.png` });

  await page.getByRole('button', { name: /not this/i }).click();
  check('and a no is a complete answer',
    (await page.locator('.film-offer').count()) === 0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.jotter-content', { timeout: 15000 });
  check('which is not asked again tomorrow',
    (await page.locator('.film-offer').count()) === 0);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// A returning signed-in player on a second device. Nothing local yet, and the
// cloud copy on its way: the wizard used to open over it and be yanked away
// mid-question when the sync landed.
// ---------------------------------------------------------------------------
{
  console.log('\nsigned in, on a second device\n');
  const { ctx, page } = await openApp({}, { width: 390, height: 844 }, {
    'daily-fret-had-session': '1',
  });
  await page.waitForSelector('.task-container', { timeout: 15000 });
  check('the first run flow does not open over a sync in flight',
    (await page.locator('.onboarding-panel').count()) === 0);
  check('the list shows its own shape arriving instead',
    (await page.locator('.task-skeleton').count()) === 3);
  await page.screenshot({ path: `${OUT}/syncing.png` });
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
