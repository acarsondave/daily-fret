// First run, walked end to end in a real browser at three widths.
//
// Onboarding only appears when there is no routine, so this drives a clean
// context rather than the seeded one every other browser suite uses. The two
// laptop-shaped defects this catches are the ones a tall window hides: a panel
// centred by `align-items` clips its own heading out of reach when the content
// is taller than the viewport, and the chord grid is the tallest step there is.
//
//   node tests/browser/onboarding.mjs [outputDir]
//
// Against the dev server by default; set PREVIEW_URL for a built preview.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? 'tests/browser/.shots/onboarding';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5199/';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const VIEWPORTS = [
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'phone-430', width: 430, height: 932 },
  { name: 'laptop-1366', width: 1366, height: 680 },
];

// A fake capture device, so the microphone step reaches its live state instead
// of its blocked one. It plays a tone rather than a guitar, so this proves the
// permission and the meter, never the chord match.
const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

const sideways = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const vp of VIEWPORTS) {
  console.log(`\n${vp.name}\n`);
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    permissions: ['microphone'],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.onboarding-panel', { timeout: 15000 });

  const shot = async (name) => {
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${OUT}/${vp.name}-${name}.png` });
    check(`${name}: no sideways scroll`, (await sideways(page)) <= 0, `${await sideways(page)}px`);
  };

  // --- intro ---------------------------------------------------------------
  await shot('1-intro');
  check(
    'the first screen says what the app is before naming anyone else’s course',
    (await page.locator('.onboarding-title').innerText()).toLowerCase().includes('listens'),
    await page.locator('.onboarding-title').innerText(),
  );
  check(
    'no course content on the first screen',
    !(await page.locator('.onboarding-body').innerText()).toLowerCase().includes('justinguitar'),
  );
  check('there is a way out', (await page.locator('.onboarding-skip').count()) === 1);

  await page.getByRole('button', { name: /set up my practice/i }).click();

  // --- course --------------------------------------------------------------
  await shot('2-course');
  const courseText = await page.locator('.onboarding-body').innerText();
  check('the source is named', courseText.includes('justinguitar.com'));
  check('and the relationship is stated', /not affiliated/i.test(courseText));
  check('there are three grades plus a way out', (await page.locator('.onboarding-choice').count()) === 4);
  check(
    'each grade states its module range',
    (await page.locator('.onboarding-choice-note').first().innerText()).match(/\d+ modules, \d+ to \d+/) !== null,
    await page.locator('.onboarding-choice-note').first().innerText(),
  );

  // Grade 2, so the module-numbering explanation is on screen.
  await page.locator('.onboarding-choice').nth(1).click();

  // --- module --------------------------------------------------------------
  await shot('3-module');
  const moduleText = await page.locator('.onboarding-body').innerText();
  check('it explains why Grade 2 does not start at 1', /straight through/i.test(moduleText));
  const numbers = await page.locator('.onboarding-module-number').allInnerTexts();
  check('and offers exactly the modules it counted', numbers.join(',') === '8,9,10,11,12,13,14', numbers.join(','));

  await page.locator('.onboarding-module').nth(1).click();

  // --- chords --------------------------------------------------------------
  await shot('4-chords');
  check('all nine hearable shapes are offered', (await page.locator('.onboarding-chord').count()) === 9);
  const ticked = await page.locator('.onboarding-chord.is-on').count();
  check('and the course’s own prior teaching is ticked for them', ticked === 8, `${ticked} ticked`);
  check(
    'the panel heading is reachable, not clipped above the scroll',
    await page.evaluate(() => {
      const h = document.querySelector('.onboarding-title');
      const box = h.getBoundingClientRect();
      return box.top >= -1;
    }),
  );

  await page.getByRole('button', { name: /^next/i }).click();

  // --- microphone ----------------------------------------------------------
  await shot('5-mic-ask');
  check('the ask states the cost of declining', /timer/i.test(await page.locator('.onboarding-body').innerText()));
  await page.getByRole('button', { name: /turn on the microphone/i }).click();
  await page.waitForSelector('.onboarding-mic.is-live', { timeout: 15000 });
  await shot('6-mic-live');
  check('a real signal meter appears', (await page.locator('.signal-meter').count()) === 1);

  await page.getByRole('button', { name: /build my routine/i }).click();

  // --- ready ---------------------------------------------------------------
  await shot('7-ready');
  const readyText = await page.locator('.onboarding-body').innerText();
  check(
    'it says the app has no drills mapped to this module rather than claiming it',
    /no drills mapped/i.test(readyText),
    readyText.split('\n').find((l) => /built|mapped/i.test(l)),
  );
  check('and never prints an internal track code', !/BG2|bg2/.test(readyText));
  const rows = await page.locator('.onboarding-preview-item').count();
  check('the session is listed', rows >= 3, `${rows} tasks`);
  check('and each row says whether it is counted or timed',
    (await page.locator('.onboarding-preview-kind').count()) === rows);

  await page.getByRole('button', { name: /start practising/i }).click();

  // --- the app itself ------------------------------------------------------
  await page.waitForSelector('.task-container', { timeout: 15000 });
  await shot('8-first-day');
  const taskRows = await page.locator('.task-row').count();
  check('the routine landed in the day', taskRows === rows, `${taskRows} rows against ${rows} promised`);
  check('every one of them is startable', (await page.locator('.task-go').count()) === taskRows);

  // --- resume after an interruption ---------------------------------------
  check('no console errors through the whole flow', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// A separate context: onboarding abandoned half way, then reloaded.
{
  console.log('\ninterrupted and resumed\n');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.onboarding-panel');
  await page.getByRole('button', { name: /set up my practice/i }).click();
  await page.locator('.onboarding-choice').first().click();
  await page.locator('.onboarding-module').nth(4).click();
  await page.waitForSelector('.onboarding-chord');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.onboarding-panel');
  check(
    'a reload comes back to the question it was on',
    (await page.locator('.onboarding-chord').count()) === 9,
    await page.locator('.onboarding-title').innerText(),
  );
  await page.screenshot({ path: `${OUT}/resumed.png` });
  await ctx.close();
}

// Someone who follows no course at all.
{
  console.log('\nno course\n');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.onboarding-panel');
  await page.getByRole('button', { name: /set up my practice/i }).click();
  await page.locator('.onboarding-choice.is-other').click();
  await page.waitForSelector('.onboarding-chord');
  check('nothing is ticked for them', (await page.locator('.onboarding-chord.is-on').count()) === 0);
  check(
    'and the app refuses to build a routine out of nothing',
    await page.getByRole('button', { name: /^next/i }).isDisabled(),
  );
  await page.screenshot({ path: `${OUT}/no-course-empty.png` });
  await page.locator('.onboarding-chord').nth(0).click();
  await page.locator('.onboarding-chord').nth(1).click();
  check('two shapes is enough', !(await page.getByRole('button', { name: /^next/i }).isDisabled()));
  await page.screenshot({ path: `${OUT}/no-course-ticked.png` });
  await ctx.close();
}

// The microphone refused. A separate browser, because the fake-device flags
// above make Chromium accept every capture request, and the point of this case
// is the one where it does not.
{
  console.log('\nmicrophone declined\n');
  const strict = await chromium.launch();
  const ctx = await strict.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.onboarding-panel');
  await page.getByRole('button', { name: /set up my practice/i }).click();
  await page.locator('.onboarding-choice').first().click();
  await page.locator('.onboarding-module').nth(5).click();
  await page.getByRole('button', { name: /^next/i }).click();
  await page.getByRole('button', { name: /turn on the microphone/i }).click();
  await page.waitForSelector('.onboarding-mic.is-blocked', { timeout: 15000 });
  await page.screenshot({ path: `${OUT}/mic-blocked.png` });
  const text = await page.locator('.onboarding-mic').innerText();
  check('it names the problem in plain words', text.length > 20, text.split('\n')[0]);
  check('and offers a way on regardless',
    await page.getByRole('button', { name: /skip for now/i }).isVisible());
  await page.getByRole('button', { name: /skip for now/i }).click();
  await page.waitForSelector('.onboarding-preview-item');
  const ready = await page.locator('.onboarding-body').innerText();
  check('and the routine says the counting is waiting on the microphone',
    /once the microphone is on/i.test(ready), ready.split('\n')[1]);
  await page.screenshot({ path: `${OUT}/mic-blocked-ready.png` });
  await ctx.close();
  await strict.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
