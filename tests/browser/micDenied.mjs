// Declining the microphone must leave a drill you can still run.
//
// Onboarding tells people "without it the drills still run, on a timer, and
// nothing is counted". For a long time that sentence was simply false: the three
// chord drills rendered a microphone icon, the browser's error and a Try again
// button, and that was the entire screen. Anyone who declined at the browser
// level had a generated routine they could not run at all, on the strength of a
// promise the app made and did not keep.
//
// So this asserts the promise, clause by clause. The drill still runs. The clock
// actually moves. Nothing is counted, and it says so rather than showing a zero.
// The block lands on the day as time played.
//
//   node tests/browser/micDenied.mjs
//
// Set PREVIEW_URL to point at a build.

import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5199/';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const CHANGES_TASK = {
  id: 't1',
  title: 'A to D changes',
  duration: '1 min',
  drill: { kind: 'one-minute-changes', chords: ['A', 'D'], durationSec: 5 },
};

const account = {
  activeRoutineId: 'r1',
  routines: [{ id: 'r1', name: 'Denied', description: '', isDefault: true, tasks: [CHANGES_TASK] }],
  dailyLogs: {}, strumPatterns: [], songLinks: [], userSongs: [], updatedAt: 1, capoFret: 0,
};

// No fake device and no permission grant: getUserMedia is refused outright,
// which is what a person who pressed Block actually has.
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, permissions: [] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 180)));

await page.addInitScript((s) => {
  localStorage.setItem('daily-fret-storage', JSON.stringify({
    state: { currentAccountId: 'anonymous', accounts: { anonymous: s } }, version: 0,
  }));
}, account);

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
await page.waitForSelector('.task-container', { timeout: 25000 });

console.log('\nThe microphone is refused\n');

await page.locator('.task-row', { hasText: 'A to D changes' }).locator('.task-go').click();
await page.waitForTimeout(1200);

// Scoped to the overlay on purpose. The task row behind it carries the aria
// label "Start A to D changes", so an unscoped match resolves to a button the
// overlay is covering and the click waits forever on an element it can never
// reach.
const overlay = page.locator('.practice-overlay');
const startBtn = overlay.getByRole('button', { name: /^start/i }).first();
if (await startBtn.count()) {
  await startBtn.click();
  await page.waitForTimeout(3000);
}

const gate = page.locator('.mic-gate');
check('the drill says the microphone did not open', (await gate.count()) > 0,
  `${await gate.count()} gates`);

const timerBtn = overlay.getByRole('button', { name: /timer|without the mic|run it anyway/i }).first();
check('and offers to run it on a timer instead', (await timerBtn.count()) > 0);

console.log('\nRunning it on the timer\n');
{
  if (!(await timerBtn.count())) {
    check('a timer control was found to press', false, 'cannot continue');
  } else {
    await timerBtn.click();
    await page.waitForTimeout(1200);

    // The clock is the whole promise. Read it twice and require it to move,
    // because a frozen countdown next to the word "timer" is the same lie in a
    // different font.
    const readClock = () =>
      page.evaluate(() => {
        const el = document.querySelector('.om-timer, .drill-timer, .om-count, [class*="timer"]');
        return el ? (el.textContent ?? '').trim() : null;
      });
    const first = await readClock();
    await page.waitForTimeout(2200);
    const second = await readClock();
    check('the clock is really running', first !== null && first !== second,
      `${first} then ${second}`);

    check('and nothing is counted, said rather than shown as a zero',
      (await page.locator('.drill-uncounted').count()) > 0);

    // Let the 5 second block finish.
    await page.waitForTimeout(5000);
    check('the run ends on its own', (await page.getByText(/time is up/i).count()) > 0);
  }
}

console.log('\nWhat reached the day\n');
{
  const log = await page.evaluate(() => {
    const raw = localStorage.getItem('daily-fret-storage');
    if (!raw) return null;
    const acc = JSON.parse(raw).state.accounts.anonymous;
    const day = Object.values(acc.dailyLogs ?? {})[0];
    return day ?? null;
  });

  check('the block is on the record as time played',
    (log?.timeSpent ?? log?.minutesPracticed ?? 0) > 0 || (log?.completedTaskIds?.length ?? 0) > 0,
    JSON.stringify(log)?.slice(0, 200));

  // The other half of the promise, and the half that protects every number in
  // the app: an unheard run must never become a measurement.
  const results = log?.drillResults ?? {};
  check('and nothing was written as a measurement',
    Object.keys(results).length === 0, JSON.stringify(results));
}

check('no uncaught page errors', errors.length === 0, errors.join(' | '));

await ctx.close();
await browser.close();

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
