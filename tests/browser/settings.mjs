// Recalibrating from settings, driven in a real browser.
//
// This suite exists because of one bug report, which was three symptoms of one
// cause: "it opens the stuff in the background but the settings modal doesn't
// close. And when I X it, it just closes the recalibration mode too. Can't even
// tap out. When I switch settings tabs it closes the recalibration as well."
//
//   1. The calibration surface set its layer by overriding `.practice-overlay`
//      from a second stylesheet at equal specificity. The tuner's built chunk
//      ships its own copy of that shell rule, so whichever chunk the browser
//      loaded last won: use the tuner, then recalibrate, and calibration painted
//      *behind* the settings dialog, leaving only the settings X reachable.
//      Only the built CSS could show that, never the source.
//   2. The flow was rendered by the settings close button's own dialog, so that
//      button tore both down at once.
//   3. And by the setup tab pane, so changing group unmounted a calibration
//      mid-capture, with the microphone still open.
//
// Calibration is a full-attention task: the microphone is live and the player is
// being asked to hold eight chords with both hands on the guitar. Every check
// below is one of those symptoms, or one of the promises the fix rests on.
//
//   node tests/browser/settings.mjs [outputDir]
//
// Against the shared dev server by default; set PREVIEW_URL for a build.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? 'tests/browser/.shots';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5199/';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};

const account = {
  activeRoutineId: 'r1',
  currentLesson: 'b1-403',
  routines: [{
    id: 'r1', name: 'Module 4 Daily', description: '', isDefault: true,
    tasks: [
      { id: 't1', title: 'Chord Perfect', duration: '10 mins', drill: { kind: 'chord-trainer', durationSec: 90, chords: ['Am', 'Em'] } },
      { id: 't2', title: 'Spider walk', duration: '5 mins' },
    ],
  }],
  dailyLogs: {}, strumPatterns: [], songLinks: [], updatedAt: 1,
  // One guitar, named, with nothing learned yet: the button then reads
  // "Calibrate Steel" and the store has an empty `chords` to watch.
  chordProfiles: [{ id: 'guitar-1', label: 'Steel', version: 1, createdAt: 1, updatedAt: 1, chords: {} }],
  activeProfileId: 'guitar-1',
  capoFret: 0,
};
const seed = { currentAccountId: 'anonymous', accounts: { anonymous: account } };

async function open(viewport = { width: 1366, height: 680 }) {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const ctx = await browser.newContext({ viewport, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));
  await page.addInitScript(
    (s) => localStorage.setItem('daily-fret-storage', JSON.stringify({ state: s, version: 0 })),
    seed,
  );
  // Every track the page is ever handed, so "the microphone was given back" can
  // be asserted rather than assumed.
  await page.addInitScript(() => {
    window.__micTracks = [];
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) return;
    const original = media.getUserMedia.bind(media);
    media.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      window.__micTracks.push(...stream.getTracks());
      return stream;
    };
  });

  // The dev server is shared and can be mid-restart; one retry rather than a
  // flaky suite.
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
  } catch {
    await page.waitForTimeout(2500);
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
  }
  await page.waitForSelector('.task-container', { timeout: 25000 });
  await page.waitForTimeout(700);
  return { browser, page, errors };
}

const openSettings = async (page) => {
  await page.click('.account-btn');
  await page.waitForSelector('.settings-surface', { timeout: 15000 });
  await page.waitForTimeout(500);
};

const startCalibration = async (page) => {
  await page.getByRole('button', { name: /Calibrate Steel/ }).click();
  await page.waitForSelector('.calibration-overlay', { timeout: 15000 });
  await page.waitForTimeout(500);
};

const liveTracks = (page) =>
  page.evaluate(() => window.__micTracks.filter((t) => t.readyState !== 'ended').length);

const railGroup = (page) => page.locator('.settings-rail-btn.is-on').innerText();

const sideways = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// --- it opens in front, not behind ----------------------------------------
{
  console.log('\ncalibration opens as its own layer\n');
  const { browser, page, errors } = await open();

  // The exact path that used to break it: the tuner's stylesheet arrives first
  // and re-declares the overlay shell, so a layer decided in CSS lost to it.
  await page.locator('.progress-launch', { hasText: /^Tune$/ }).click({ force: true });
  await page.waitForSelector('.tuner-overlay, .tuner-blocked', { timeout: 20000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  await openSettings(page);
  await startCalibration(page);

  // Not `isVisible()`: an overlay painted underneath another is visible in every
  // sense except the one that matters. Ask what is actually in front.
  const layering = await page.evaluate(() => {
    const cal = document.querySelector('.calibration-overlay');
    const wrapper = document.querySelector('.modal-wrapper');
    if (!cal || !wrapper) return null;
    const box = cal.getBoundingClientRect();
    const front = document.elementFromPoint(
      Math.round(innerWidth / 2),
      Math.round(innerHeight / 2),
    );
    return {
      position: getComputedStyle(cal).position,
      calLayer: Number(getComputedStyle(cal).zIndex),
      settingsLayer: Number(getComputedStyle(wrapper).zIndex),
      covers: box.top === 0 && box.left === 0 && box.width >= innerWidth && box.height >= innerHeight,
      frontIsCalibration: cal.contains(front),
    };
  });
  check('it covers the viewport', layering?.position === 'fixed' && layering.covers === true,
    JSON.stringify(layering));
  check('it paints above the settings dialog', (layering?.calLayer ?? 0) > (layering?.settingsLayer ?? 0),
    `${layering?.calLayer} vs ${layering?.settingsLayer}`);
  check('and it is what the tap actually lands on', layering?.frontIsCalibration === true);

  // Settings has stepped aside rather than stacked underneath: one surface, one
  // close button. The report was two, a few pixels apart, and the wrong one on
  // top.
  check('settings has stepped aside', (await page.locator('.modal-wrapper.is-suspended').count()) === 1);
  check('so there is only one way out on screen',
    (await page.locator('.modal-close').isVisible()) === false
    && (await page.locator('.practice-close').isVisible()) === true);

  check('no sideways scroll', (await sideways(page)) <= 0);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// --- one Escape, one layer -------------------------------------------------
{
  console.log('\nEscape closes exactly the calibration\n');
  const { browser, page, errors } = await open();
  await openSettings(page);
  await startCalibration(page);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check('the calibration closes', (await page.locator('.calibration-overlay').count()) === 0);
  check('and settings is still open', (await page.locator('.settings-surface').count()) === 1);
  check('and back in charge of itself',
    (await page.locator('.modal-wrapper.is-suspended').count()) === 0);
  check('on the group it was left on', (await railGroup(page)).includes('Your setup'));
  check('with the keyboard back on the button that opened it',
    /Calibrate Steel/.test(await page.evaluate(() => document.activeElement?.textContent ?? '')),
    await page.evaluate(() => document.activeElement?.textContent ?? ''));

  // The second Escape is the one that should reach settings, and only now.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check('a second Escape then closes settings', (await page.locator('.settings-surface').count()) === 0);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// --- the taps that used to destroy it --------------------------------------
{
  console.log('\nnothing behind it can tear it down\n');
  const { browser, page, errors } = await open();
  await openSettings(page);
  await startCalibration(page);

  // "When I switch settings tabs it closes the recalibration as well." The tab
  // is behind a full-screen surface now, and the flow is no longer owned by the
  // pane it used to live in, so neither the tap nor a tab change can reach it.
  await page.locator('.settings-rail-label', { hasText: /^Practice$/ }).click({ force: true });
  await page.waitForTimeout(400);
  check('a tap at the settings tabs leaves it standing',
    (await page.locator('.calibration-overlay').count()) === 1);

  // "When I X it, it just closes the recalibration mode too."
  await page.locator('.modal-close').click({ force: true });
  await page.waitForTimeout(400);
  check('so does a tap at the settings close button',
    (await page.locator('.calibration-overlay').count()) === 1);
  check('and settings did not close underneath it',
    (await page.locator('.settings-surface').count()) === 1);

  await page.locator('.practice-close').click();
  await page.waitForTimeout(500);
  check('the calibration close button is the one that works',
    (await page.locator('.calibration-overlay').count()) === 0
    && (await page.locator('.settings-surface').count()) === 1);
  check('and the group survived the round trip', (await railGroup(page)).includes('Your setup'));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// --- walking out half-way --------------------------------------------------
{
  console.log('\nabandoning it half-way\n');
  const { browser, page, errors } = await open();
  await openSettings(page);
  await startCalibration(page);

  await page.getByRole('button', { name: /Start calibration/ }).click();
  await page.waitForSelector('.om-ring', { timeout: 20000 });
  await page.waitForTimeout(1200);
  check('the microphone is open', (await liveTracks(page)) >= 1);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  check('leaving closes it', (await page.locator('.calibration-overlay').count()) === 0);
  check('and gives the microphone back', (await liveTracks(page)) === 0);
  check('nothing half-fitted was written', await page.evaluate(() => {
    const acc = JSON.parse(localStorage.getItem('daily-fret-storage')).state.accounts.anonymous;
    return Object.keys(acc.chordProfiles?.[0]?.chords ?? {}).length === 0;
  }));
  check('the page behind can scroll again once settings closes', await page.evaluate(async () => {
    document.querySelector('.modal-close').click();
    await new Promise((r) => setTimeout(r, 600));
    return document.body.style.overflow !== 'hidden';
  }));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// --- the shape of it, on both screens the owner practises on ---------------
for (const [label, viewport] of [
  ['390x844', { width: 390, height: 844 }],
  ['1366x680', { width: 1366, height: 680 }],
]) {
  console.log(`\ncalibration at ${label}\n`);
  const { browser, page, errors } = await open(viewport);
  await openSettings(page);
  await page.screenshot({ path: `${OUT}/settings-${label}.png` });
  await startCalibration(page);
  check('it fits the screen', (await sideways(page)) <= 0);
  await page.screenshot({ path: `${OUT}/calibration-${label}.png` });
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
