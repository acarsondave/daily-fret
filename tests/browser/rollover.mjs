// The day's list across midnight, with the app left open.
//
// A phone keeps the PWA alive in the background. Put it down at 23:50 with the
// routine done, pick it up at 07:00, and the list is the list it was: every
// task still ticked, the streak and the week strip one day behind, because
// the date is read on render and nothing renders the home screen when the day
// turns. The next practice then looks already done.
//
//   PREVIEW_URL=http://localhost:4173/ node tests/browser/rollover.mjs

import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:4173/';
let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const EVE = '2026-08-17';
const routine = {
  id: 'r1', name: 'Evening', description: '',
  tasks: [
    { id: 't1', title: 'Spider walk', duration: '5' },
    { id: 't2', title: 'Pushups', duration: '2' },
  ],
};
const account = {
  activeRoutineId: 'r1',
  routines: [routine],
  dailyLogs: {
    // Done, but only one of two: an all-done day opens the reflection jotter.
    [EVE]: { date: EVE, routineId: 'r1', completedTaskIds: ['t1'], taskRecords: { t1: { evidence: 'stated', stated: true, at: 1 } } },
  },
  strumPatterns: [], songLinks: {}, updatedAt: 1,
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.clock.install({ time: new Date('2026-08-17T23:50:00') });
await page.addInitScript((s) => {
  if (!localStorage.getItem('daily-fret-storage'))
    localStorage.setItem('daily-fret-storage', JSON.stringify({ state: { currentAccountId: 'anonymous', accounts: { anonymous: s } }, version: 0 }));
}, account);
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.task-container');

console.log('\nThe evening\n');
check('the evening\'s task is done', (await page.locator('.task-row.is-done').count()) === 1);
const eveDate = await page.locator('.header-date-short').textContent();

console.log('\nThe next morning, app left open\n');
// The phone was put down: hidden, then shown again seven hours later.
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.clock.fastForward('07:10:00');
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(300);
check('nothing is ticked on the new day', (await page.locator('.task-row.is-done').count()) === 0,
  `${await page.locator('.task-row.is-done').count()} still ticked`);
const todayCell = await page.locator('.streak-day-col.is-today').count();
const lastLabel = await page.locator('.streak-day-col').last().locator('.streak-day-label').textContent();
check('the week strip ends on today', todayCell === 1 && lastLabel === 'T', `today cells ${todayCell}, last ${lastLabel}`);
const morningDate = await page.locator('.header-date-short').textContent();
check('the header date moved', eveDate === 'Mon, Aug 17' && morningDate === 'Tue, Aug 18', `${eveDate} -> ${morningDate}`);

console.log('\nOr left on screen through midnight\n');
await page.clock.fastForward('24:00:00');
await page.waitForTimeout(300);
const strip = await page.locator('.streak-day-col.is-today').count();
check('the strip follows without a touch', strip === 1);

check('no page errors', errors.length === 0, errors.join(' / '));
await browser.close();
console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
