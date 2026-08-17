// A practice session that runs through midnight, in a real browser.
//
// The reported defect: the date was read on every render, so a run started at
// 23:59 measured against one date and settled against the next after the
// countdown re-rendered. A settle on a day that holds no measurement changes
// nothing, so the day the practice actually happened on kept no record of it.
// A paused coached session had the same clock deciding whether it could be
// resumed, so pausing ten minutes before midnight made it unresumable ten
// minutes later, and its saved progress was left behind forever.
//
// The clock here is moved, not stubbed to a fixed value: the page starts twenty
// seconds before midnight on a real Date and the test walks it across, so the
// countdown, the auto-advance and the store all see the same crossing a
// late-night session sees.
//
//   PREVIEW_URL=http://localhost:5401/ node tests/browser/midnight.mjs

import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5199/';
const KEY = 'daily-fret-storage';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};

const routine = {
  id: 'r1', name: 'Late session', description: '', isDefault: true,
  tasks: [
    // Two blocks, so the overlay itself re-renders between them: the first
    // block is recorded, the surface advances, and only the second one settles
    // the task. That gap is where midnight used to get in.
    {
      id: 't1', title: 'Spider walk', duration: '1',
      blocks: [
        { id: 'b1', label: 'Low strings', durationSec: 15 },
        { id: 'b2', label: 'High strings', durationSec: 15 },
      ],
    },
    { id: 't2', title: 'Finger stretches', duration: '15 sec' },
  ],
};

const accountWith = (extra) => ({
  activeRoutineId: 'r1',
  routines: [routine],
  dailyLogs: {}, strumPatterns: [], songLinks: [], userSongs: [], updatedAt: 1,
  ...extra,
});

// Hand the page a clock it starts twenty seconds before midnight and that the
// test can wind forward. Everything that reads the time reads this one, which
// is the point: the bug was two reads of the same clock landing on either side
// of it.
const fakeClock = (secondsBeforeMidnight) => (before) => {
  const Real = Date;
  const midnight = new Real();
  midnight.setHours(24, 0, 0, 0);
  let offset = midnight.getTime() - before * 1000 - Real.now();
  window.__advance = (ms) => { offset += ms; };
  window.__localDate = () => {
    const d = new Real(Real.now() + offset);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  function Faked(...args) {
    return args.length === 0 ? new Real(Real.now() + offset) : new Real(...args);
  }
  Faked.prototype = Real.prototype;
  Faked.now = () => Real.now() + offset;
  Faked.parse = Real.parse;
  Faked.UTC = Real.UTC;
  window.Date = Faked;
};

async function open(seedAccount, secondsBeforeMidnight, pausedMinutesAgo = null) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));
  await page.addInitScript(fakeClock(secondsBeforeMidnight), secondsBeforeMidnight);
  // Seeded after the clock script, so a paused session can be dated from the
  // page's own clock rather than the test runner's real one.
  await page.addInitScript((args) => {
    const account = args.account;
    if (args.pausedMinutesAgo !== null) {
      const started = Date.now() - args.pausedMinutesAgo * 60 * 1000;
      const d = new Date(started);
      const pad = (n) => String(n).padStart(2, '0');
      account.coachProgress = {
        routineId: 'r1',
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        startedAt: started,
        index: 1,
        results: [{ title: 'Spider walk', value: 15, unit: 's', done: true }],
      };
    }
    localStorage.setItem(args.key, JSON.stringify({
      state: { currentAccountId: 'anonymous', accounts: { anonymous: account } },
      version: 0,
    }));
  }, { key: KEY, account: seedAccount, pausedMinutesAgo });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.task-container', { timeout: 30000 });
  await page.waitForTimeout(500);
  return { browser, page, errors };
}

const logs = (page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)).state.accounts.anonymous.dailyLogs, KEY);

// --- a timed run that starts on one day and ends on the next ---------------
{
  console.log('\na run that crosses midnight is filed under the day it started\n');
  const { browser, page, errors } = await open(accountWith({}), 25);

  const startedOn = await page.evaluate(() => window.__localDate());

  await page.locator('.task-row', { hasText: 'Spider walk' }).click();
  await page.waitForSelector('.practice-overlay', { timeout: 15000 });
  await page.waitForTimeout(600);

  // The first block runs out before midnight and the surface advances to the
  // second, re-rendering on the way.
  await page.evaluate(() => window.__advance(16_000));
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__advance(6_000));
  await page.waitForTimeout(2000);

  // Now midnight arrives, part-way through the second block.
  await page.evaluate(() => window.__advance(10_000));
  await page.waitForTimeout(1200);
  const endedOn = await page.evaluate(() => window.__localDate());
  check('the clock genuinely crossed midnight during the run', startedOn !== endedOn, `${startedOn} -> ${endedOn}`);

  // Let the second block run out and settle the task.
  await page.evaluate(() => window.__advance(20_000));
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__advance(10_000));
  await page.waitForTimeout(2000);

  const days = await logs(page);
  check('no error escaped the run', errors.length === 0, errors.join(' | '));
  check(
    'the practice is recorded on the evening it was played',
    !!days[startedOn] && days[startedOn].completedTaskIds.includes('t1'),
    `days recorded: ${JSON.stringify(Object.keys(days))}`,
  );
  check(
    'and the next morning is left alone, holding nothing that was not played on it',
    !days[endedOn],
    days[endedOn] ? JSON.stringify(days[endedOn]) : '',
  );

  await browser.close();
}

// --- a coached session paused before midnight, reopened after --------------
{
  console.log('\na session paused before midnight is still there after it\n');

  // Paused ten minutes before midnight, one segment in. The page opens twenty
  // seconds *after* midnight, so the saved progress carries yesterday's date.
  const { browser, page, errors } = await open(accountWith({}), -20, 10);

  const savedDate = await page.evaluate((key) =>
    JSON.parse(localStorage.getItem(key)).state.accounts.anonymous.coachProgress.date, KEY);
  const nowDate = await page.evaluate(() => window.__localDate());
  check('the saved session is from the day before', savedDate !== nowDate, `${savedDate} vs ${nowDate}`);

  await page.locator('button', { hasText: 'Coached' }).first().click();
  await page.waitForSelector('.practice-overlay', { timeout: 20000 });
  await page.waitForTimeout(800);

  check(
    'reopening offers to resume it rather than starting over',
    (await page.getByText('Resume session').count()) > 0,
    await page.locator('.practice-overlay').innerText().catch(() => ''),
  );
  check('nothing threw on the way', errors.length === 0, errors.join(' | '));

  await browser.close();
}

console.log(failures ? `\n${failures} failed\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
