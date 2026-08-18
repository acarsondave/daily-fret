// The disk fills mid-session, in a real browser, against a real origin cap.
//
// The reported defect, reproduced exactly: a result is recorded, localStorage
// refuses the write, the exception leaves the click handler where no error
// boundary can see it, no crash screen appears, the row still marks itself
// done, and the header still says the practice is saved on this device. It is
// not. It is gone on reload.
//
// Nothing here stubs a throw. The padding below fills the origin until Chrome's
// own quota refuses a write, so the app meets the same DOMException a phone
// would give it at 2am.
//
//   PREVIEW_URL=http://localhost:5401/ node tests/browser/storageFull.mjs

import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5199/';
const KEY = 'daily-fret-storage';
const PAD = 'df-quota-padding-';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};

const account = {
  activeRoutineId: 'r1',
  routines: [{
    id: 'r1', name: 'Module 4 Daily', description: '', isDefault: true,
    tasks: [
      { id: 't1', title: 'Spider walk', duration: '5 mins' },
      { id: 't2', title: 'One minute changes', duration: '5 mins' },
    ],
  }],
  dailyLogs: {}, strumPatterns: [], songLinks: [], userSongs: [], updatedAt: 1,
};
const seed = { currentAccountId: 'anonymous', accounts: { anonymous: account } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 700 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));

await page.addInitScript(
  (args) => localStorage.setItem(args.key, JSON.stringify({ state: args.seed, version: 0 })),
  { key: KEY, seed },
);
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('.task-container', { timeout: 30000 });
await page.waitForTimeout(600);

const pill = page.locator('.account-btn');
const stored = () => page.evaluate((key) => localStorage.getItem(key), KEY);
const doneIds = async () => {
  const raw = await stored();
  const logs = JSON.parse(raw).state.accounts.anonymous.dailyLogs;
  return Object.values(logs).flatMap((log) => log.completedTaskIds);
};

console.log('\na full disk, and what the header says about it\n');

check('before the disk fills, the header claims this device', (await pill.innerText()) === 'This device');

// Fill the origin the way it actually fills: with real bytes, until Chrome's
// own quota says no. Coarse chunks first, then fine ones, so the app is left
// with genuinely nowhere to write rather than a stubbed refusal.
// Chrome charges a rewrite only the difference between the old value and the
// new one, so leaving even half a kilobyte spare would let the app's next write
// through and prove nothing. The tail loop grows one key a character at a time
// until that too is refused, which leaves the origin with under a character of
// slack: less than a completion costs.
const padded = await page.evaluate((prefix) => {
  let written = 0;
  for (const size of [256 * 1024, 8 * 1024, 512]) {
    const block = 'x'.repeat(size);
    for (;;) {
      try {
        localStorage.setItem(prefix + written, block);
        written += 1;
      } catch {
        break;
      }
    }
  }
  let tail = '';
  for (;;) {
    try {
      localStorage.setItem(prefix + 'tail', tail + 'x');
      tail += 'x';
    } catch {
      break;
    }
  }
  return written;
}, PAD);

check('the origin is genuinely out of room', padded > 0, `${padded} padding blocks written`);

// A real correction, made the way the user makes it: right-click the row and
// say it was practised.
await page.locator('.task-row', { hasText: 'Spider walk' }).click({ button: 'right' });
await page.waitForSelector('.context-menu-content', { timeout: 10000 });
await page.getByText('I did this').click();
await page.waitForTimeout(700);

check('recording into a full disk does not throw out of the handler', errors.length === 0, errors.join(' | '));

check(
  'the row marks itself done, so the session keeps working',
  (await page.locator('.task-row.is-done', { hasText: 'Spider walk' }).count()) === 1,
);

check(
  'the header stops claiming the practice is saved',
  (await pill.innerText()) === 'Not saved',
  `reads "${await pill.innerText()}"`,
);

check(
  'and says why, with the way out',
  /out of storage/.test(await pill.getAttribute('aria-label')) &&
    /Sign in/.test(await pill.getAttribute('aria-label')),
  await pill.getAttribute('aria-label'),
);

check(
  'the header is telling the truth: the disk has no record of it',
  !(await doneIds()).includes('t1'),
);

check(
  'and the practice that was already on disk is untouched',
  JSON.parse(await stored()).state.accounts.anonymous.routines.length === 1,
);

// The label is the one thing a glyph cannot stand in for, so it has to survive
// the width where every other label on this row is dropped.
await page.setViewportSize({ width: 390, height: 760 });
await page.waitForTimeout(400);
check(
  'on a phone the words stay, where a glyph alone would say nothing',
  (await pill.innerText()) === 'Not saved',
  `reads "${await pill.innerText()}"`,
);
check(
  'and the header still fits',
  (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0,
);
await page.setViewportSize({ width: 1366, height: 700 });

// Room frees up. The claim has to come back, and the result has to land.
await page.evaluate((prefix) => {
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) localStorage.removeItem(key);
  }
}, PAD);

await page.locator('.task-row', { hasText: 'One minute changes' }).click({ button: 'right' });
await page.waitForSelector('.context-menu-content', { timeout: 10000 });
await page.getByText('I did this').click();
await page.waitForTimeout(700);

check('with room again the header says this device', (await pill.innerText()) === 'This device');

check(
  'and everything held in memory reaches the disk',
  (await doneIds()).includes('t1') && (await doneIds()).includes('t2'),
);

await browser.close();
console.log(failures ? `\n${failures} failed\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
