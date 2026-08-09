// The paths a person actually walks, driven in a real browser.
//
// This lives in the repo rather than in a scratch directory. The browser suites
// used to sit in a temp folder, which meant they evaporated between sessions and
// the visual gate had to be rebuilt from memory each time — and the visual gate
// is the one that has caught most of the real defects here (a whole Progress tab
// off-screen on a phone, a primary button rendering as bare text, a half-written
// song discarded on Escape). A check that does not survive is not a check.
//
//   npm run build && npx vite preview --port 4173
//   node tests/browser/smoke.mjs [outputDir]

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

// Two tasks, one done: a routine where everything is complete auto-opens the
// reflection jotter over the whole screen, which is app behaviour rather than a
// bug but makes every other assertion unreachable.
const account = (extra = {}) => ({
  activeRoutineId: 'r1',
  currentLesson: 'b1-403',
  routines: [{
    id: 'r1', name: 'Module 4 Daily', description: '', isDefault: true,
    tasks: [
      { id: 't1', title: 'Chord Perfect', duration: '10 mins', drill: { kind: 'chord-trainer', durationSec: 90, chords: ['Am', 'Em'] } },
      { id: 't2', title: 'Spider walk', duration: '5 mins' },
    ],
  }],
  dailyLogs: Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => {
      const date = daysAgo(i + 1);
      return [date, { date, routineId: 'r1', completedTaskIds: ['t1'], drillResults: { [pair('A', 'D')]: 40 + i, t1: 15 } }];
    }),
  ),
  strumPatterns: [], songLinks: [], updatedAt: 1,
  ...extra,
});

const seed = (extra) => ({ currentAccountId: 'anonymous', accounts: { anonymous: account(extra) } });

const browser = await chromium.launch();

async function open(state, viewport = { width: 1280, height: 1000 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(
    (s) => localStorage.setItem('daily-fret-storage', JSON.stringify({ state: s, version: 0 })),
    state,
  );
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.task-container');
  return { ctx, page, errors };
}

const sideways = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// --- the day's list --------------------------------------------------------
{
  console.log('\nThe day\'s practice\n');
  const { ctx, page, errors } = await open(seed());
  check('the routine renders', (await page.locator('.task-row').count()) === 2);
  check('a drill is launchable', (await page.locator('.task-drill-btn').count()) >= 1);
  check('no sideways scroll', (await sideways(page)) <= 0);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- Progress, on the smallest phone --------------------------------------
{
  console.log('\nProgress on a 320px phone\n');
  const { ctx, page, errors } = await open(seed(), { width: 320, height: 780 });
  await page.getByRole('button', { name: 'Progress' }).click();
  await page.waitForSelector('.progress-tabs');
  await page.waitForTimeout(700);

  const offscreen = await page.evaluate((vw) =>
    [...document.querySelectorAll('.progress-tab')]
      .filter((t) => { const r = t.getBoundingClientRect(); return r.left < 0 || r.right > vw; })
      .map((t) => t.textContent.trim()), 320);
  check('every tab is on screen', offscreen.length === 0, offscreen.join(' '));

  for (const name of ['Numbers', 'Awards', 'History', 'Journey']) {
    await page.locator('.progress-tab', { hasText: new RegExp(`^${name}$`) }).click();
    await page.waitForTimeout(350);
    check(`${name} opens`, (await page.locator('.progress-tab.is-on').innerText()).trim() === name);
  }
  await page.screenshot({ path: `${OUT}/progress-320.png`, fullPage: true });
  check('no sideways scroll', (await sideways(page)) <= 0);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- the lesson link -------------------------------------------------------
{
  console.log('\nThe lesson you say you are on\n');
  const { ctx, page, errors } = await open(seed(), { width: 390, height: 850 });
  await page.getByRole('button', { name: 'Progress' }).click();
  await page.waitForSelector('.journey');
  await page.waitForTimeout(500);
  const link = page.locator('.journey-lesson-link');
  check('it links to the lesson', (await link.count()) === 1);
  const href = await link.getAttribute('href');
  check('at the course, not YouTube', href?.startsWith('https://www.justinguitar.com/guitar-lessons/'), href);
  check('naming the right lesson', href?.includes('b1-403'), href);
  check('opening safely', (await link.getAttribute('target')) === '_blank'
    && /noopener/.test(await link.getAttribute('rel')));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- writing a song --------------------------------------------------------
{
  console.log('\nWriting a chart\n');
  const { ctx, page, errors } = await open(seed());
  await page.click('.add-task-btn');
  await page.getByRole('button', { name: 'Song', exact: true }).click();
  await page.getByRole('button', { name: /Write a chart/ }).click();
  await page.waitForSelector('.song-editor');

  await page.getByRole('button', { name: 'Add to my songs' }).click();
  check('an empty draft is refused with reasons', (await page.locator('.se-problems li').count()) === 2);

  await page.getByLabel('Song title').fill('Smoke Test');
  const line = page.getByLabel('Add chords to Verse');
  await line.fill('A D | E D');
  await line.press('Enter');
  check('a pasted line becomes bars', (await page.locator('.se-bar').count()) === 4);

  // The loss that mattered most: a typed chart discarded by a stray Escape.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  check('Escape asks before discarding', (await page.locator('.se-confirm').count()) === 1);
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await page.waitForTimeout(200);

  await page.getByRole('button', { name: 'Add to my songs' }).click();
  await page.waitForSelector('.song-editor', { state: 'detached' });
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('daily-fret-storage')).state.accounts.anonymous.userSongs);
  check('the chart persisted', stored?.length === 1);
  check('with chords derived from the bars', stored?.[0].chords.join(' ') === 'A D E', stored?.[0].chords.join(' '));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- guitars and reminders in settings -------------------------------------
{
  console.log('\nSettings: guitars and the reminder\n');
  const { ctx, page, errors } = await open(seed({
    chordProfiles: [
      { id: 'guitar-1', label: 'Steel', version: 1, createdAt: 1, updatedAt: 1,
        chords: Object.fromEntries(['A', 'D'].map((c, i) => [c, { mean: Array.from({ length: 12 }, (_, k) => (k === i ? 1 : 0.1)), samples: 60 }])) },
      { id: 'guitar-2', label: 'Nylon', version: 1, createdAt: 1, updatedAt: 1, chords: {} },
    ],
    activeProfileId: 'guitar-1',
    reminder: { time: '18:30', days: [0, 1, 2, 3, 4, 5, 6], notify: false },
  }), { width: 375, height: 812 });

  await page.click('.account-btn');
  await page.waitForSelector('.guitar-list');
  await page.waitForTimeout(700);
  check('both guitars are listed', (await page.locator('.guitar-row').count()) === 2);
  check('one is in use', (await page.locator('.guitar-row.is-active').count()) === 1);
  check('an uncalibrated one says so',
    (await page.locator('.guitar-meta').nth(1).innerText()) === 'Not calibrated yet');

  await page.locator('.guitar-pick', { hasText: 'Nylon' }).click();
  await page.waitForTimeout(250);
  check('switching guitars works',
    (await page.locator('.guitar-row.is-active .guitar-name').innerText()) === 'Nylon');

  const panel = await page.locator('.mic-setting', { hasText: 'Practice reminder' }).innerText();
  check('the calendar route is named the reliable one', /This is the reliable one/.test(panel));
  check('the notification route states its limit', /cannot wake a sleeping phone/.test(panel));
  check('seven day toggles on one row', await page.evaluate(() => {
    const tops = [...document.querySelectorAll('.reminder-day')].map((b) => Math.round(b.getBoundingClientRect().top));
    return tops.length === 7 && new Set(tops).size === 1;
  }));

  await page.screenshot({ path: `${OUT}/settings-375.png`, fullPage: true });
  check('no sideways scroll', (await sideways(page)) <= 0);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- the nudge -------------------------------------------------------------
{
  console.log('\nThe nudge on a missed day\n');
  const logs = {};
  for (let i = 2; i <= 6; i += 1) {
    const date = daysAgo(i);
    logs[date] = { date, routineId: 'r1', completedTaskIds: [] };
  }
  logs[daysAgo(7)] = { date: daysAgo(7), routineId: 'r1', completedTaskIds: ['t1'] };
  const { ctx, page, errors } = await open(
    seed({ reminder: { time: '00:01', days: [0, 1, 2, 3, 4, 5, 6], notify: false }, dailyLogs: logs }),
    { width: 390, height: 850 },
  );
  await page.waitForSelector('.nudge');
  const text = await page.locator('.nudge-text').innerText();
  check('it appears', true);
  check('and never scolds', !/should|failed|lost|broke|streak/i.test(text), text);
  await page.getByRole('button', { name: 'Not today' }).click();
  await page.waitForTimeout(300);
  check('dismissing works', (await page.locator('.nudge').count()) === 0);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
