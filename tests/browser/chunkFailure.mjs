// A screen that will not download must not take the app with it.
//
// Every lazy surface sat behind a bare Suspense, which catches a pending import
// and nothing else. A rejected one threw past it into the app-level
// ErrorBoundary and replaced the entire screen with "Something broke" because a
// panel did not arrive.
//
// This is not a rare failure. Cloudflare Pages gives every build new hashed
// asset filenames, so the moment a deploy lands, every already-open tab is one
// tap away from it. The owner practises with the app open while I deploy.
//
// What is asserted is what he would see: the practice list still on screen, the
// failure contained to the panel that failed, and a way forward. The negative
// assertion matters as much as the positive one, so the app-level crash screen
// is checked for by name every time.
//
//   node tests/browser/chunkFailure.mjs
//
// Set PREVIEW_URL to point at a build.

import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5199/';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const TASK = {
  id: 't1', title: 'Spider walk', duration: '5 mins',
  blocks: [{ id: 'b1', label: 'Spider walk', durationSec: 300 }],
};

const account = {
  activeRoutineId: 'r1',
  routines: [{ id: 'r1', name: 'Chunks', description: '', isDefault: true, tasks: [TASK] }],
  dailyLogs: {}, strumPatterns: [], songLinks: [], userSongs: [], updatedAt: 1, capoFret: 0,
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();

await page.addInitScript((s) => {
  localStorage.setItem('daily-fret-storage', JSON.stringify({
    state: { currentAccountId: 'anonymous', accounts: { anonymous: s } }, version: 0,
  }));
}, account);

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 25000 });
await page.waitForSelector('.task-container', { timeout: 25000 });

// Everything already needed to paint the day has loaded. From here, every
// further chunk request fails, which is exactly the state of a tab that was open
// when a new build replaced this one.
await page.route('**/assets/*.js', (route) => route.abort('failed'));

const crashed = () => page.locator('.error-fallback').count();
const alive = () => page.locator('.task-container').count();
const missing = () => page.locator('.surface-missing').count();

console.log('\nOpening Progress after a redeploy\n');
{
  await page.getByRole('button', { name: /progress/i }).first().click().catch(() => {});
  await page.waitForTimeout(2500);
  check('the app is not replaced by a crash screen', (await crashed()) === 0);
  check('the practice list is still there', (await alive()) > 0);
  check('and the panel that failed says so', (await missing()) === 1, `${await missing()} panels`);

  const text = await page.locator('.surface-missing-title').first().textContent().catch(() => '');
  check('naming the screen the user asked for, not the component',
    /journey/i.test(text ?? ''), text ?? '(none)');
  check('with a way forward',
    (await page.getByRole('button', { name: /^reload$/i }).count()) > 0);
}

console.log('\nAnd again on the coached session\n');
{
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const coached = page.getByRole('button', { name: /coach/i }).first();
  if (await coached.count()) {
    await coached.click().catch(() => {});
    await page.waitForTimeout(2500);
    check('still no crash screen', (await crashed()) === 0);
    check('the practice list survived that too', (await alive()) > 0);
    check('and the failure is drawn where the session would have opened',
      (await page.locator('.surface-missing-scrim').count()) === 1);

    // The point of "Go back": a failure must never be a dead end.
    const back = page.getByRole('button', { name: /go back/i }).first();
    check('there is a way out that is not a reload', (await back.count()) > 0);
    if (await back.count()) {
      await back.click();
      await page.waitForTimeout(400);
      check('and taking it returns to the practice list',
        (await missing()) === 0 && (await alive()) > 0,
        `${await missing()} panels, ${await alive()} lists`);
    }
  } else {
    check('a coached session control was found', false, 'no button matched /coach/i');
  }
}

console.log('\nReload is the only recovery, and it has to actually work\n');
{
  // Not a retry, and the panel deliberately does not offer one. React caches a
  // lazy import's rejection and re-throws it forever, and the usual cause is a
  // build whose files no longer exist on the server, so nothing short of a fresh
  // page can fetch that screen. The first version of this test asserted the
  // surface would come back on its own; it cannot, and a button promising it
  // would be exactly the confident lie this product refuses everywhere else.
  await page.unroute('**/assets/*.js');

  await page.getByRole('button', { name: /progress/i }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  check('the panel is honest that this page cannot fetch it', (await missing()) === 1,
    `${await missing()} panels`);

  await page.reload({ waitUntil: 'networkidle', timeout: 25000 });
  await page.waitForSelector('.task-container', { timeout: 25000 });
  await page.getByRole('button', { name: /progress/i }).first().click().catch(() => {});
  await page.waitForTimeout(2500);

  check('and after a reload the screen opens', (await missing()) === 0,
    `${await missing()} panels still showing`);
  check('with the real thing behind it',
    (await page.locator('.journey').count()) > 0);
  check('and no crash screen anywhere in the run', (await crashed()) === 0);
}

await ctx.close();
await browser.close();

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
