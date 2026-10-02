// Quick paths, driven in a real browser on a phone.
//
// What has to hold, end to end:
//   - a routine saved with combined tasks comes back split, and a day that
//     completed the combined task still shows every part done;
//   - the Quick entry sits beside Coached and opens a sheet of the routine's
//     own tasks, one exercise per row, grouped by the exercise they came from;
//   - starting runs the real coached session over only the chosen tasks, and
//     the day's record, XP and streak hear it the same way;
//   - the choice is remembered, and a paused Quick path resumes as itself and
//     never as the whole routine;
//   - nothing scrolls sideways at 360 wide and the console stays clean.
//
//   npm run build && npx vite preview --port 4173
//   node tests/browser/quickPaths.mjs [outputDir]
//   BROWSER=webkit node tests/browser/quickPaths.mjs [outputDir]   (the Safari check)

import { launch, contextOptions, ENGINE } from './engine.mjs';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? 'tests/browser/.shots';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.PREVIEW_URL ?? 'http://localhost:4173/';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const TODAY = daysAgo(0);

// The owner's routine as it was saved, bundled tasks and all. The two short
// blocks are what the session actually runs here: four seconds each, so a run
// completes inside the test rather than after a minute of strumming.
const routine = {
  id: 'r1',
  name: '20-Min Muscle Memory',
  description: '',
  chords: ['A', 'D', 'E', 'Am', 'Em'],
  tasks: [
    { id: 't1', title: 'Spider Exercises', duration: '5 mins', description: '1st fret start. Low E to high E.' },
    { id: 't3', title: 'Chord Speed Training', duration: '3', description: 'A, D, E transitions.', drill: { kind: 'one-minute-changes', durationSec: 60, chords: ['A', 'D', 'E'] } },
    {
      id: 'strum', title: 'Strumming Practice', description: 'Current patterns.',
      blocks: [
        { id: 'b1', label: 'Strumming Pattern 1', durationSec: 4, pattern: 'D-DUD-' },
        { id: 'b2', label: 'Strumming Pattern 2', durationSec: 4, pattern: 'D-DUDUD-' },
      ],
    },
    { id: 'song', title: 'Song Practice', duration: '5', drill: { kind: 'song', songId: 'wild-thing' } },
  ],
};

const account = (extra = {}) => ({
  activeRoutineId: 'r1',
  routines: [routine],
  dailyLogs: {
    // Measured history, so the whole-routine Coached button is offered too.
    [daysAgo(2)]: { date: daysAgo(2), routineId: 'r1', completedTaskIds: ['t3'], drillResults: { 'pair:A|D': 50 } },
    // Earlier today, before the split: the combined changes task was done.
    [TODAY]: {
      date: TODAY, routineId: 'r1', completedTaskIds: ['t3'],
      drillResults: { 'pair:A|D': 55, 'pair:A|E': 48, 'pair:D|E': 60 },
      taskRecords: { t3: { evidence: 'measured', at: 1 } },
    },
  },
  strumPatterns: [], songLinks: {}, updatedAt: 1,
  ...extra,
});

const browser = await launch({ media: true });
console.log(`engine: ${ENGINE}`);

async function open(acc, viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext(contextOptions(viewport, { microphone: true }));
  const page = await ctx.newPage();
  const errors = [];
  // Firebase refuses a preview build's placeholder key; that is the environment,
  // not the app.
  page.on('console', (m) => m.type() === 'error' && !/auth\/invalid-api-key|Cloud sync unavailable/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('daily-fret-storage', JSON.stringify({ state: { currentAccountId: 'anonymous', accounts: { anonymous: s } }, version: 0 }));
      sessionStorage.setItem('seeded', '1');
    }
    localStorage.setItem('daily-fret-coach-voice', '0');
  }, acc);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.task-container');
  return { ctx, page, errors };
}

const stored = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('daily-fret-storage')).state.accounts.anonymous);
const sideways = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// --- the split, as the day's list shows it ---------------------------------
console.log('\nA routine saved with combined tasks\n');
{
  const { ctx, page, errors } = await open(account());
  const rows = await page.locator('.task-row').count();
  check('comes back split, one exercise per row', rows === 7, `${rows} rows`);
  const titles = await page.locator('.task-title').allTextContents();
  check('the pairs are named', titles.includes('Chord Speed Training · A ↔ E'), titles.join(' | '));
  check('each block is its own task', titles.includes('Strumming Pattern 2'));
  const done = await page.locator('.task-row.is-done').count();
  check('this morning\'s completion of the combined task shows on every part', done === 3, `${done} done`);
  const acc = await stored(page);
  check('the split reached the disk', acc.routines[0].tasks.length === 7 && acc.taskSplits?.t3?.length === 3);
  check('the day itself was not rewritten', JSON.stringify(acc.dailyLogs[TODAY].completedTaskIds) === '["t3"]');
  await page.screenshot({ path: `${OUT}/quick-home.png` });
  check('no console errors', errors.length === 0, errors.join(' / '));
  await ctx.close();
}

// --- the sheet ---------------------------------------------------------------
console.log('\nThe Quick path sheet\n');
{
  const { ctx, page, errors } = await open(account());
  const coached = page.getByRole('button', { name: /^coached$/i });
  const quick = page.getByRole('button', { name: /^quick$/i });
  check('Quick sits beside Coached', (await coached.count()) === 1 && (await quick.count()) === 1);
  const [cb, qb] = [await coached.boundingBox(), await quick.boundingBox()];
  check('on the same line, joined', Math.abs(cb.y - qb.y) < 2 && Math.abs(cb.x + cb.width - qb.x) < 3,
    `${Math.round(cb.x + cb.width)} vs ${Math.round(qb.x)}`);
  check('and is a real target', qb.height >= 36, `${qb.height}px`);

  await quick.click();
  await page.waitForSelector('.quick-sheet');
  const boxes = page.getByRole('checkbox');
  check('every task is a choice', (await boxes.count()) === 7, `${await boxes.count()}`);
  check('grouped under the exercise they came from',
    (await page.locator('.quick-section-title').allTextContents()).join('|') === 'Chord Speed Training|Strumming Practice');
  check('nothing is chosen the first time', (await page.locator('.quick-row.is-on').count()) === 0);
  check('so Start cannot run an empty session', await page.getByRole('button', { name: /^start$/i }).isDisabled());
  check('a part done today says so', (await page.locator('.quick-row.is-done').count()) === 3);

  await page.getByRole('button', { name: /choose all of strumming practice/i }).click();
  check('All picks the whole exercise', (await page.locator('.quick-row.is-on').count()) === 2);
  // Whole minutes per task, as every task row prints them: two short blocks
  // are a minute each on the list, so they are two here.
  check('and the total follows', (await page.locator('.quick-summary').textContent()) === '2 tasks · 2 min',
    await page.locator('.quick-summary').textContent());
  await page.getByRole('checkbox', { name: /A ↔ E/ }).click();
  check('one pair can be chosen on its own', (await page.locator('.quick-row.is-on').count()) === 3);
  check('the sheet fits the phone', (await sideways(page)) <= 0);
  const sheet = await page.locator('.modal-content').boundingBox();
  check('and the Start button is on screen', sheet.y + sheet.height <= 844);
  await page.screenshot({ path: `${OUT}/quick-sheet.png` });

  await page.getByRole('checkbox', { name: /A ↔ E/ }).click();
  await page.getByRole('button', { name: /^start$/i }).click();
  await page.waitForSelector('.practice-overlay');
  const rail = await page.locator('.practice-topbar .segment-rail').getAttribute('aria-label');
  check('the coached session runs only the chosen tasks', /of 2\b/.test(rail ?? ''), rail);
  check('it opens on the first chosen one', (await page.locator('.coach-intro-title').first().textContent()) === 'Strumming Pattern 1');

  // Four-second blocks, no rest between two parts of one exercise.
  await page.waitForSelector('.coach-summary', { timeout: 40000 });
  check('and finishes on the summary', true);
  check('which says it was a Quick path', (await page.locator('.coach-summary .coach-quick-tag').count()) === 1);
  const summaryRows = await page.locator('.coach-summary-row').count();
  check('with one row per chosen task', summaryRows === 2, `${summaryRows}`);
  await page.screenshot({ path: `${OUT}/quick-summary.png` });

  const acc = await stored(page);
  const log = acc.dailyLogs[TODAY];
  check('the day records both parts as done',
    log.completedTaskIds.includes('strum:b1') && log.completedTaskIds.includes('strum:b2'), log.completedTaskIds.join(','));
  check('with the timer as evidence', log.taskRecords['strum:b1']?.evidence === 'timed');
  check('and nothing it did not run', !log.completedTaskIds.includes('t1') && !log.completedTaskIds.includes('song'));
  check('the choice is remembered', JSON.stringify(acc.quickPaths?.r1) === '["strum:b1","strum:b2"]');
  check('no saved place is left behind', !acc.coachProgress);

  await page.getByRole('button', { name: /^done$/i }).click();
  await page.waitForSelector('.practice-overlay', { state: 'detached' });
  const dismiss = page.getByRole('button', { name: /^done$/i });
  if (await dismiss.count()) await dismiss.first().click().catch(() => {});
  check('the day\'s list shows them done', (await page.locator('.task-row.is-done').count()) === 5);

  await page.getByRole('button', { name: /^quick$/i }).click();
  await page.waitForSelector('.quick-sheet');
  check('reopening offers the same choice again', (await page.locator('.quick-row.is-on').count()) === 2);
  check('no console errors', errors.length === 0, errors.join(' / '));
  await ctx.close();
}

// --- pausing -----------------------------------------------------------------
console.log('\nA paused Quick path\n');
{
  const { ctx, page, errors } = await open(account({
    quickPaths: { r1: ['t1', 'strum:b1', 'strum:b2'] },
    routines: [{ ...routine, tasks: routine.tasks.map((t) => (t.id === 't1' ? { ...t, duration: undefined, blocks: [{ id: 'w', label: 'Warm-up', durationSec: 4 }] } : t)) }],
  }));
  await page.getByRole('button', { name: /^quick$/i }).click();
  await page.waitForSelector('.quick-sheet');
  check('the remembered choice is seeded', (await page.locator('.quick-row.is-on').count()) === 3);
  await page.getByRole('button', { name: /^start$/i }).click();
  await page.waitForSelector('.practice-overlay');
  // Through the first block and into the rest before the next exercise.
  await page.locator('.coach-skip-rest').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByRole('button', { name: /exit the session/i }).click();
  await page.waitForSelector('.practice-overlay', { state: 'detached' });
  const acc = await stored(page);
  check('its place is saved with what it was running',
    JSON.stringify(acc.coachProgress?.taskIds) === '["t1","strum:b1","strum:b2"]', JSON.stringify(acc.coachProgress));

  await page.getByRole('button', { name: /^coached$/i }).click();
  await page.waitForSelector('.practice-overlay');
  check('the whole routine does not resume it', (await page.getByRole('button', { name: /^resume$/i }).count()) === 0);
  await page.getByRole('button', { name: /exit the session/i }).click();
  await page.waitForSelector('.practice-overlay', { state: 'detached' });

  await page.getByRole('button', { name: /^quick$/i }).click();
  await page.waitForSelector('.quick-sheet');
  await page.getByRole('button', { name: /^start$/i }).click();
  await page.waitForSelector('.practice-overlay');
  check('the same Quick path does', (await page.getByRole('button', { name: /^resume$/i }).count()) === 1);
  check('and says it is one', (await page.locator('.coach-intro .coach-quick-tag').count()) === 1);
  check('no console errors', errors.length === 0, errors.join(' / '));
  await ctx.close();
}

// --- small and large screens -------------------------------------------------
console.log('\nOther screens\n');
for (const viewport of [{ width: 360, height: 740 }, { width: 1280, height: 900 }]) {
  const { ctx, page, errors } = await open(account(), viewport);
  check(`${viewport.width}: nothing scrolls sideways`, (await sideways(page)) <= 0);
  const quick = page.getByRole('button', { name: /^quick$/i });
  check(`${viewport.width}: Quick is visible`, await quick.isVisible());
  await quick.click();
  await page.waitForSelector('.quick-sheet');
  await page.screenshot({ path: `${OUT}/quick-sheet-${viewport.width}.png` });
  check(`${viewport.width}: the sheet fits`, (await sideways(page)) <= 0);
  check(`${viewport.width}: no console errors`, errors.length === 0, errors.join(' / '));
  await ctx.close();
}

// A one-task routine has nothing to choose between.
{
  const { ctx, page } = await open(account({ routines: [{ ...routine, tasks: [routine.tasks[0]] }] }));
  check('a routine of one task offers no Quick path', (await page.getByRole('button', { name: /^quick$/i }).count()) === 0);
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
