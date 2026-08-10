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
  check('every task is startable', (await page.locator('.task-go').count()) === 2);
  check('nothing asks to be ticked', (await page.locator('[aria-pressed]').count()) === 0);
  check('no sideways scroll', (await sideways(page)) <= 0);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- the day's record ------------------------------------------------------
// The list used to ask the player to tick off what the app had just listened to.
// It records instead. These drive the paths that produce each state, and then
// the one path that lets the player disagree with it.
{
  console.log('\nThe day records itself\n');

  const routine = {
    id: 'r1', name: 'Recording', description: '', isDefault: true,
    tasks: [
      { id: 'q1', title: 'Quick block', blocks: [{ id: 'b1', label: 'Quick block', durationSec: 3 }] },
      { id: 'q2', title: 'Long block', blocks: [{ id: 'b2', label: 'Long block', durationSec: 600 }] },
      { id: 'q3', title: 'Never started', duration: '5' },
    ],
  };
  const { ctx, page, errors } = await open(
    seed({ routines: [routine], dailyLogs: {} }),
    { width: 1280, height: 1000 },
  );

  const row = (title) => page.locator('.task-row', { hasText: title });
  const stored = () => page.evaluate(() => {
    const acc = JSON.parse(localStorage.getItem('daily-fret-storage')).state.accounts.anonymous;
    const key = Object.keys(acc.dailyLogs).sort().pop();
    return acc.dailyLogs[key] ?? null;
  });

  // A task run to the end completes itself, with no tick anywhere in the path.
  await row('Quick block').click();
  await page.waitForSelector('.practice-overlay');
  await page.waitForSelector('.practice-overlay', { state: 'detached', timeout: 20000 });
  const afterRun = await stored();
  check('running a task to the end completes it', afterRun?.completedTaskIds.includes('q1'));
  check('recorded as time, not as a tick', afterRun?.taskRecords?.q1?.evidence === 'timed');
  check('and the clock is on the record', afterRun?.taskRecords?.q1?.ranToEnd === true);
  check('the row states what happened',
    /practised/.test(await row('Quick block').innerText()), await row('Quick block').innerText());

  // Walking out half-way is honest about itself: the time it ran, and no claim.
  await row('Long block').click();
  await page.waitForSelector('.practice-overlay');
  await page.waitForTimeout(6500);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.practice-overlay', { state: 'detached' });
  const afterLeaving = await stored();
  check('abandoning a task does not complete it', !afterLeaving?.completedTaskIds.includes('q2'));
  check('but the time it really ran is kept', (afterLeaving?.taskRecords?.q2?.seconds ?? 0) >= 5);
  check('and the day knows the clock never ran out',
    afterLeaving?.taskRecords?.q2?.ranToEnd === false);
  check('the row says so rather than nothing',
    /so far/.test(await row('Long block').innerText()), await row('Long block').innerText());

  // The player disagreeing with the record, and it sticking.
  await row('Never started').click({ button: 'right' });
  await page.waitForSelector('.context-menu-content');
  await page.getByRole('menuitem', { name: 'I did this' }).click();
  await page.waitForTimeout(300);
  const afterSaying = await stored();
  check('saying so completes the task', afterSaying?.completedTaskIds.includes('q3'));
  check('kept as the player\'s word, not as evidence',
    afterSaying?.taskRecords?.q3?.stated === true && afterSaying?.taskRecords?.q3?.evidence === undefined);
  check('and the row attributes it to them',
    /Marked done by you/.test(await row('Never started').innerText()));

  // And taking it back.
  await row('Never started').click({ button: 'right' });
  await page.waitForSelector('.context-menu-content');
  await page.getByRole('menuitem', { name: "Clear today's record" }).click();
  await page.waitForTimeout(300);
  const afterClearing = await stored();
  check('clearing it sticks too', !afterClearing?.completedTaskIds.includes('q3'));
  check('and forgets how it came about', afterClearing?.taskRecords?.q3 === undefined);
  check('while never touching what was measured',
    JSON.stringify(afterClearing?.drillResults ?? {}) === JSON.stringify(afterRun?.drillResults ?? {}));

  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- the day's list, in every state it can be in ---------------------------
{
  console.log('\nEvery state a row can be in\n');
  const today = iso(new Date());
  const routine = {
    id: 'r1', name: 'Module 4 Daily', description: '', isDefault: true,
    tasks: [
      { id: 't1', title: 'Chord Perfect', duration: '10', drill: { kind: 'chord-trainer', durationSec: 90, chords: ['Am', 'Em'] } },
      { id: 't2', title: 'Spider walk', duration: '5', description: 'Start at the 1st fret, alternate picking.' },
      { id: 't3', title: 'Strumming', duration: '5' },
      { id: 't4', title: 'One-minute changes', duration: '5', drill: { kind: 'one-minute-changes', durationSec: 60, chords: ['A', 'D'] } },
    ],
  };
  const states = {
    nothing: {},
    partway: {
      [today]: {
        date: today, routineId: 'r1', completedTaskIds: ['t1'],
        drillResults: { t1: 19 },
        drillRuns: { t1: [{ value: 17, at: 1 }, { value: 19, at: 2 }] },
        taskRecords: {
          t1: { evidence: 'measured', at: 1 },
          t2: { evidence: 'timed', seconds: 128, ranToEnd: false, at: 1 },
          t4: { evidence: 'silent', at: 1 },
        },
      },
    },
    everything: {
      [today]: {
        date: today, routineId: 'r1', completedTaskIds: ['t1', 't2', 't3', 't4'],
        drillResults: { t1: 17, [pair('A', 'D')]: 46 },
        taskRecords: {
          t1: { evidence: 'measured', at: 1 },
          t2: { evidence: 'timed', seconds: 300, ranToEnd: true, at: 1 },
          t3: { stated: true, at: 1 },
          t4: { evidence: 'measured', at: 1 },
        },
      },
    },
  };

  for (const [name, dailyLogs] of Object.entries(states)) {
    for (const [tag, viewport] of [['390', { width: 390, height: 844 }], ['1280', { width: 1280, height: 1000 }]]) {
      const { ctx, page, errors } = await open(seed({ routines: [routine], dailyLogs }), viewport);
      await page.waitForTimeout(600);
      if (name === 'partway' && tag === '1280') {
        check('a drill run twice says so',
          /2 runs/.test(await page.locator('.task-row', { hasText: 'Chord Perfect' }).innerText()));
      }
      if (name === 'everything' && tag === '1280') {
        // The one distinction the whole thing rests on: what the app saw, and
        // what it was told, must never look the same.
        check('a completion resting on the player\'s word is marked apart',
          (await page.locator('.task-row.is-stated').count()) === 1);
        check('and the measured ones are not', (await page.locator('.task-row.is-done').count()) === 4);
      }
      // Everything done pops the reflection note over the list; dismiss it so the
      // shot is of the list rather than of the sheet on top of it.
      const jotter = page.locator('.jotter-done-btn');
      if (await jotter.count()) {
        await jotter.click();
        await page.waitForTimeout(400);
      }
      await page.screenshot({ path: `${OUT}/day-${name}-${tag}.png` });
      check(`${name} at ${tag}: no sideways scroll`, (await sideways(page)) <= 0);
      check(`${name} at ${tag}: no console errors`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  }
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
  check('settings open on the setup group',
    (await page.locator('.settings-rail-btn.is-on').innerText()).includes('Your setup'));
  check('both guitars are listed', (await page.locator('.guitar-row').count()) === 2);
  check('one is in use', (await page.locator('.guitar-row.is-active').count()) === 1);
  check('an uncalibrated one says so',
    (await page.locator('.guitar-meta').nth(1).innerText()) === 'Not calibrated yet');

  await page.locator('.guitar-pick', { hasText: 'Nylon' }).click();
  await page.waitForTimeout(250);
  check('switching guitars works',
    (await page.locator('.guitar-row.is-active .guitar-name').innerText()) === 'Nylon');

  await page.locator('.settings-rail-label', { hasText: /^Practice$/ }).click();
  await page.waitForSelector('.reminder-days');
  const panel = await page.locator('.setting-block', { hasText: 'Practice reminder' }).innerText();
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

// --- the capo, without opening settings ------------------------------------
// A capo transposes everything the detector hears, so a wrong one silently stops
// every drill counting. It has to be reachable and readable from the practice
// screen, not three taps down.
{
  console.log('\nQuick setup in the header\n');
  const { ctx, page, errors } = await open(seed(), { width: 390, height: 850 });

  await page.click('.quick-setup-btn');
  await page.waitForSelector('.quick-setup-panel');
  check('the capo is one tap from practice', (await page.locator('.capo-fret').count()) === 8);
  check('the microphone came with it', (await page.locator('.mic-setting-select').count()) === 1);

  await page.getByRole('radio', { name: 'Capo on fret 2' }).click();
  await page.waitForTimeout(200);
  check('the header states the capo it assumes',
    (await page.locator('.quick-setup-btn').innerText()).trim() === 'Capo 2');
  check('and the store agrees', await page.evaluate(() =>
    JSON.parse(localStorage.getItem('daily-fret-storage')).state.accounts.anonymous.capoFret === 2));

  // One Escape, one layer: the popover closes and nothing underneath does.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  check('Escape closes exactly the popover', (await page.locator('.quick-setup-panel').count()) === 0
    && (await page.locator('.task-container').count()) === 1);

  await page.click('.quick-setup-btn');
  await page.waitForSelector('.quick-setup-panel');
  await page.getByRole('button', { name: 'All settings' }).click();
  await page.waitForSelector('.settings-surface');
  check('and it hands over to the full surface',
    (await page.locator('.quick-setup-panel').count()) === 0);

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
