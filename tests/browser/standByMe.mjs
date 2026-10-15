// Stand By Me in place of This Year's Love, and Fade Into You on his own sheet,
// in a real browser at phone width, the way the owner meets them from Home.
//
//   node tests/browser/standByMe.mjs [shotsDir]   (PREVIEW_URL, BROWSER=webkit)
//
// Light and dark are the browser's colour preference (the app has one
// established palette); both are captured for the new chart.

import { isWebKit as IS_WEBKIT, contextOptions, launch } from './engine.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:4173/';
const OUT = process.argv[2] ?? 'tests/browser/.shots';
mkdirSync(OUT, { recursive: true });
const PHONE = { width: 390, height: 844 };

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
};
const handled = (text) => /Cloud sync unavailable/.test(text);

const song = (id, title, songId) => ({ id, title, source: 'module', drill: { kind: 'song', songId } });
// A routine as the first Module 6 update left it, This Year's Love closing.
const shipped = {
  activeRoutineId: 'r_10min',
  currentLesson: 'b1-608',
  routines: [{
    id: 'r_10min', name: 'Module 6 \u00b7 G, 6/8 & picking', description: '', isDefault: true, module: 'bg1-m6',
    chords: ['A', 'C', 'D', 'E', 'G', 'Am', 'Em'],
    tasks: [
      { id: 'spider', title: 'Spider', duration: '2 mins' },
      { id: 'm6-six-eight', title: '6/8 Strumming', source: 'module', drill: { kind: 'strum-pattern', durationSec: 120, bpm: 110, patterns: ['68.D-D-D-D-D-D-', '68.D--UD-D--UD-', '68.D--UD-D--UDU'] } },
      song('m6-fade-into-you', 'Song: Fade Into You', 'fade-into-you'),
      song('m6-this-years-love', "Song: This Year's Love", 'this-years-love'),
    ],
  }],
  moduleUpdates: { 'bg1-m6': { outcome: 'accepted', at: 1 } },
  dailyLogs: {
    '2026-10-12': { date: '2026-10-12', routineId: 'r_10min', completedTaskIds: ['m6-this-years-love'], drillResults: { 'pair:C|G': 30 } },
  },
  strumPatterns: [], songLinks: {}, updatedAt: 1, capoFret: 2,
};

async function open(account, scheme = 'light') {
  const browser = await launch({ media: true });
  const ctx = await browser.newContext({ ...contextOptions(PHONE), colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => { if (!handled(e.message)) errors.push(e.message); });
  await page.addInitScript((s) => {
    localStorage.setItem('daily-fret-coach-voice', '0');
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('daily-fret-storage', JSON.stringify({
      state: { currentAccountId: 'anonymous', accounts: { anonymous: s } }, version: 0,
    }));
  }, account);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForSelector('.task-container', { timeout: 25000 });
  return { browser, page, errors };
}
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('daily-fret-storage')).state.accounts.anonymous);
const titles = (page) => page.locator('.task-row .task-title').allTextContents();
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

console.log("\nThe swap, offered on Home to a routine already on Module 6\n");
let swapped;
{
  const { browser, page, errors } = await open(shipped);
  const before = await stored(page);
  const card = page.locator('.mu');
  await card.waitFor({ timeout: 10000 });
  check('the swap is offered', await card.isVisible());
  await card.locator('.mu-toggle').click();
  await page.waitForTimeout(400);
  const text = await card.textContent();
  check('it adds Stand By Me', /Song: Stand By Me/.test(text));
  check("and takes out This Year's Love", /Out[\s\S]*Song: This Year's Love/i.test(text), text);
  check('it is one in, one out', /\+1\s*\u22121/.test(await card.locator('.mu-counts').textContent()));
  await card.screenshot({ path: `${OUT}/sbm-swap-preview.png` });
  await card.getByRole('button', { name: 'Update' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.task-row .task-title')].some((e) => e.textContent === 'Song: Stand By Me'));
  await page.waitForTimeout(600);
  const list = await titles(page);
  check('Stand By Me takes the closing place', list.at(-1) === 'Song: Stand By Me' && list.at(-2) === 'Song: Fade Into You', list.join(' | '));
  check("This Year's Love is gone", !list.includes("Song: This Year's Love"));
  const acc = await stored(page);
  check('the routine keeps its name and Module 6 receipt', acc.routines[0].name === before.routines[0].name && acc.routines[0].module === 'bg1-m6');
  check('the routine before the swap is archived', Object.values(acc.moduleRoutineArchive ?? {}).some((e) => JSON.stringify(e.snapshot) === JSON.stringify(before.routines[0])));
  check('no day is rewritten', JSON.stringify(acc.dailyLogs) === JSON.stringify(before.dailyLogs));
  check('the lesson does not move', acc.currentLesson === before.currentLesson);
  await page.screenshot({ path: `${OUT}/sbm-routine-both-songs.png`, fullPage: true });
  swapped = acc;

  await page.locator('.mu-done').getByRole('button', { name: 'Undo' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.task-row .task-title')].some((e) => e.textContent === "Song: This Year's Love"), null, { timeout: 5000 });
  await page.waitForTimeout(600);
  const restored = await stored(page);
  check('Undo puts the routine back exactly', JSON.stringify(restored.routines) === JSON.stringify(before.routines));
  check('and leaves every result', JSON.stringify(restored.dailyLogs) === JSON.stringify(before.dailyLogs));
  check("This Year's Love still plays from a routine that names it", true);
  await page.locator('.task-row', { hasText: "This Year's Love" }).click();
  await page.waitForSelector('.practice-overlay', { timeout: 15000 });
  await page.waitForSelector('.song-intro-title', { timeout: 10000 });
  check('a retired song still resolves', (await page.locator('.song-intro-title').textContent()) === "This Year's Love");
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

for (const scheme of ['light', 'dark']) {
  console.log(`\nStand By Me, its screen and chart (${scheme})\n`);
  const account = { ...swapped, moduleUpdates: { ...swapped.moduleUpdates, 'bg1-m6-songs': { outcome: 'accepted', at: 2 } } };
  const { browser, page, errors } = await open(account, scheme);
  check('nothing is offered once the swap is accepted', (await page.locator('.mu').count()) === 0);
  await page.locator('.task-row', { hasText: 'Stand By Me' }).click();
  await page.waitForSelector('.practice-overlay', { timeout: 15000 });
  await page.waitForSelector('.song-intro-title', { timeout: 10000 });
  check('the song screen names it', (await page.locator('.song-intro-title').textContent()) === 'Stand By Me');
  check('four shapes are drawn: G, Em, C, D',
    (await page.locator('.song-shape-name').allTextContents()).join() === 'G,Em,C,D');
  const arrows = await page.locator('.om-setup > .strum-row .strum-arrow').count();
  check('the strum is one bar of eight', arrows === 8, String(arrows));
  check('with its two muted strokes drawn as crosses', (await page.locator('.om-setup > .strum-row svg path[d="M7 7l10 10M17 7L7 17"]').count()) === 2);
  const link = page.locator('.song-lesson-link');
  check('one Watch lesson link', (await link.count()) === 1 && (await link.textContent()).trim() === 'Watch lesson');
  check('it opens the lesson, not the record, in a new tab',
    /kvAFzZjGlCg/.test(await link.getAttribute('href')) && (await link.getAttribute('target')) === '_blank');
  const box = await link.boundingBox();
  check('the link is a comfortable tap target', box && box.height >= 40, String(box?.height));
  check('no sideways scroll on the song screen', !(await overflow(page)));
  await page.screenshot({ path: `${OUT}/sbm-song-${scheme}.png` });

  await page.locator('.song-mode.is-chart').click();
  await page.waitForSelector('.chart', { timeout: 10000 });
  await page.waitForTimeout(800);
  check('the chart plays', await page.locator('.chart').isVisible());
  check('the chart carries no lyric line', (await page.locator('.chart-lyric').count()) === 0);
  check('no sideways scroll on the chart', !(await overflow(page)));
  await page.screenshot({ path: `${OUT}/sbm-chart-${scheme}.png` });
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log('\nFade Into You, on his sheet\n');
{
  const account = structuredClone(swapped);
  account.moduleUpdates['bg1-m6-songs'] = { outcome: 'accepted', at: 2 };
  account.routines[0].tasks.push({ id: 'fade-strum', title: 'Fade Into You strum', drill: { kind: 'strum-pattern', durationSec: 60, bpm: 157, patterns: ['68.D-DUDU'] } });
  const { browser, page, errors } = await open(account);
  await page.locator('.task-row', { hasText: 'Song: Fade Into You' }).click();
  await page.waitForSelector('.song-intro-title', { timeout: 15000 });
  const arrows = await page.locator('.om-setup > .strum-row .strum-arrow').count();
  check('the strum is six arrows, one per click', arrows === 6, String(arrows));
  check('its lesson is linked', /iDdUpxZQhpc/.test(await page.locator('.song-lesson-link').getAttribute('href')));
  await page.screenshot({ path: `${OUT}/fiy-song.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  if (await page.locator('.practice-overlay').count()) await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.task-container');

  await page.locator('.task-row', { hasText: 'Fade Into You strum' }).click();
  await page.waitForSelector('.practice-overlay', { timeout: 15000 });
  await page.waitForSelector('.pb-slot', { timeout: 10000 });
  check('the drill names the phrase for the song', /Fade Into You/.test(await page.locator('.practice-overlay').textContent()));
  check('the bar is six slots', (await page.locator('.pb-slot').count()) === 6, String(await page.locator('.pb-slot').count()));
  check('beat 4 is drawn as the second pulse', (await page.locator('.pb-stem.is-four').count()) >= 1);
  await page.locator('.metro-trigger').click();
  await page.waitForSelector('.metro-panel');
  check('the click is counted in six', (await page.locator('.metro-cell').count()) === 6);
  await page.locator('.metro-trigger').click();
  check('no sideways scroll', !(await overflow(page)));
  await page.screenshot({ path: `${OUT}/fiy-strum-drill.png` });
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

for (const warm of [undefined, true]) {
  console.log(`\nCoached, a song task with the strum warm-up ${warm ? 'on' : 'off (the default)'}\n`);
  const account = {
    activeRoutineId: 'r1', currentLesson: 'b1-608', songStrumWarmup: warm,
    routines: [{ id: 'r1', name: 'Songs', description: '', isDefault: true, tasks: [song('sbm', 'Song: Stand By Me', 'stand-by-me')] }],
    // The header's Coached control appears once anything has been measured.
    dailyLogs: { '2026-08-01': { date: '2026-08-01', routineId: 'r1', completedTaskIds: [], drillResults: { 'pair:C|G': 24 } } },
    strumPatterns: [], songLinks: {}, updatedAt: 1, capoFret: 2,
  };
  const { browser, page, errors } = await open(account);
  await page.getByRole('button', { name: /coached/i }).first().click();
  await page.waitForSelector('.practice-overlay', { timeout: 20000 });
  await page.waitForSelector('.coach-intro-title', { timeout: 20000 });
  const first = (await page.locator('.coach-intro-title').first().textContent()).trim();
  if (warm) check('it opens with the song\'s strum', first === 'Stand By Me strum', first);
  else check('it goes straight to the song', first === 'Song: Stand By Me', first);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log('\nThe setting, in Settings > Practice\n');
{
  const { browser, page, errors } = await open({ ...swapped, moduleUpdates: { ...swapped.moduleUpdates, 'bg1-m6-songs': { outcome: 'accepted', at: 2 } } });
  await page.click('.account-btn');
  await page.waitForSelector('.settings-surface', { timeout: 15000 });
  await page.locator('.settings-rail-label', { hasText: /^Practice$/ }).click();
  const group = page.getByRole('radiogroup', { name: 'Strum warm-up before songs' });
  await group.waitFor({ timeout: 10000 });
  check('it reads Off', (await group.getByRole('radio', { name: 'Off' }).getAttribute('aria-checked')) === 'true');
  await group.getByRole('radio', { name: 'On' }).click();
  await page.waitForTimeout(400);
  check('turning it on is saved', (await stored(page)).songStrumWarmup === true);
  check('no sideways scroll', !(await overflow(page)));
  await group.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/song-warmup-setting.png` });
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(`\n${IS_WEBKIT ? 'WebKit (iPhone)' : 'Chromium'}`);
console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
