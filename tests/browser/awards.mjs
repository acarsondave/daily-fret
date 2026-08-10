// The Awards panel, driven in a real browser against real-sized histories.
//
// The unit suite proves the economy adds up. This proves the panel says so: the
// breakdown on screen has to equal the total on screen, at five years of daily
// practice as well as at one month, or the learner is reading four numbers that
// nearly reconcile and the honesty of the whole surface is gone.
//
//   npm run build && npx vite preview --port 4173
//   node tests/browser/awards.mjs [outputDir]

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? 'tests/browser/.shots';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.PREVIEW_URL ?? 'http://localhost:4173/';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const pair = (a, b) => `pair:${[a, b].sort().join('|')}`;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

const CHORDS = ['A', 'D', 'E', 'Em', 'Am', 'G', 'C', 'Dm', 'F'];
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const rate = (i, off) =>
  Math.max(4, Math.round(58 * (1 - Math.exp(-(i + 20) / 260)) * (0.9 + rnd() * 0.16) - off));

// The same practitioner the unit benchmark uses: a routine-builder session six
// days a week, results that climb and then plateau, tasks the app cannot hear.
function history(total) {
  seed = 12345;
  const logs = {};
  for (let i = 0; i < total; i += 1) {
    const date = daysAgo(total - 1 - i);
    if (i % 7 === 6 && i !== total - 1) {
      logs[date] = { date, routineId: 'r1', completedTaskIds: [] };
      continue;
    }
    const vocab = Math.min(CHORDS.length, 3 + Math.floor(i / 21));
    const drillResults = {};
    for (let p = 0; p < 3; p += 1) {
      drillResults[pair(CHORDS[(i + p) % vocab], CHORDS[(i + p + 1) % vocab])] = rate(i, p * 3);
    }
    drillResults.t1 = Math.max(3, Math.round(rate(i, 0) * 0.5));
    drillResults.t2 = Math.max(3, Math.round(rate(i, 0) * 0.7));
    const drillRuns = Object.fromEntries(
      Object.entries(drillResults).map(([k, v]) => [k, [{ value: v, at: 1 }]]),
    );
    // Today leaves one task open: a routine with everything settled auto-opens
    // the reflection jotter over the whole screen and nothing else is reachable.
    const taskRecords = {
      t1: { evidence: 'measured', at: 1 },
      t2: { evidence: 'measured', at: 1 },
      t4: { evidence: 'timed', seconds: 180, ranToEnd: true, at: 1 },
      t5: { evidence: 'timed', seconds: 240, ranToEnd: true, at: 1 },
      t6: { stated: true, at: 1 },
    };
    if (i !== total - 1) taskRecords.t3 = { evidence: 'timed', seconds: 300, ranToEnd: true, at: 1 };
    logs[date] = {
      date, routineId: 'r1', completedTaskIds: Object.keys(taskRecords),
      drillResults, drillRuns, taskRecords,
    };
  }
  return logs;
}

const account = (dailyLogs) => ({
  activeRoutineId: 'r1',
  currentLesson: 'b1-403',
  routines: [{
    id: 'r1', name: 'Module 4 Daily', description: '', isDefault: true,
    tasks: [
      { id: 't1', title: 'Chord Perfect', duration: '10 mins', drill: { kind: 'chord-trainer', durationSec: 90, chords: ['Am', 'Em'] } },
      { id: 't3', title: 'Spider walk', duration: '5 mins' },
    ],
  }],
  dailyLogs,
  strumPatterns: [], songLinks: [], updatedAt: 1,
});

const browser = await chromium.launch();

async function openAwards(dailyLogs, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(
    (s) => localStorage.setItem('daily-fret-storage', JSON.stringify({ state: s, version: 0 })),
    { currentAccountId: 'anonymous', accounts: { anonymous: account(dailyLogs) } },
  );
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.task-container');
  await page.getByRole('button', { name: 'Progress' }).click();
  await page.waitForSelector('.progress-tabs');
  await page.locator('.progress-tab', { hasText: /^Awards$/ }).click();
  await page.waitForSelector('.ach');
  await page.waitForTimeout(700);
  return { ctx, page, errors };
}

// The first number in a string. The standing sentence carries two (the total and
// the distance to the next rung) and only the first is the total.
const firstNumber = (text) => Number((text.match(/[\d,]+/)?.[0] ?? '').replace(/,/g, ''));
const sideways = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// --- a brand new account ---------------------------------------------------
{
  console.log('\nA panel with nothing in it yet\n');
  const { ctx, page, errors } = await openAwards({}, { width: 390, height: 844 });
  check('the standing is level one',
    /^level\s*1$/i.test((await page.locator('.ach-standing-rank').innerText()).trim()),
    await page.locator('.ach-standing-rank').innerText());
  check('no ledger of zeros', (await page.locator('.ach-ledger').count()) === 0);
  check('no figures of zeros', (await page.locator('.ach-figures').count()) === 0);
  check('and one award is put within reach', (await page.locator('.ach-nearest').count()) === 1);
  check('no sideways scroll', (await sideways(page)) <= 0);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${OUT}/awards-new-390.png`, fullPage: true });
  await ctx.close();
}

// --- the breakdown has to reconcile ----------------------------------------
for (const [label, days, viewport] of [
  ['a month in', 30, { width: 390, height: 844 }],
  ['five years in, on a phone', 1825, { width: 390, height: 844 }],
  ['five years in', 1825, { width: 1280, height: 1000 }],
]) {
  console.log(`\n${label}\n`);
  const { ctx, page, errors } = await openAwards(history(days), viewport);
  const total = firstNumber(await page.locator('.ach-standing-next').innerText());
  const rows = await page.locator('.ach-ledger-row dd').allInnerTexts();
  const summed = rows.map(firstNumber).reduce((a, b) => a + b, 0);
  check('the breakdown is shown', rows.length >= 5, `${rows.length} lines`);
  check('and adds up to the total on screen', summed === total, `${summed} vs ${total}`);
  check('work the app could not hear is named as such',
    /cannot hear/.test(await page.locator('.ach-standing-note').innerText()));
  check('and no line of the breakdown reads as a deduction',
    rows.every((r) => !r.includes('-')), rows.join(' | '));
  check('some awards are earned', (await page.locator('.ach-tile.is-earned').count()) > 0);
  check('no sideways scroll', (await sideways(page)) <= 0);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${OUT}/awards-${days}d-${viewport.width}.png`, fullPage: true });
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
