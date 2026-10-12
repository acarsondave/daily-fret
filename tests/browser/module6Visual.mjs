// Module 6 layout sweep, independent of scored audio: three widths, both OS
// colour preferences. The product deliberately retains its one dark palette.
// PREVIEW_URL may point to the live build; seeds exist only in scratch browsers.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, contextOptions, ENGINE } from './engine.mjs';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:4173/';
const OUT = process.argv[2] ?? 'tests/browser/.shots/module6-visual';
mkdirSync(OUT, { recursive: true });
const seed = {
  currentLesson: 'b1-608', activeRoutineId: 'm5', updatedAt: 1,
  routines: [{ id: 'm5', name: 'Module 5 Daily', isDefault: true,
    chords: ['C', 'D', 'Dm'], tasks: [
      { id: 'spider', title: 'Spider', duration: '2 mins' },
      { id: 'c', title: 'C Chord Perfect', drill: { kind: 'chord-trainer', chords: ['C'], durationSec: 60 } },
      { id: 'dm', title: 'Dm Chord Perfect', drill: { kind: 'chord-trainer', chords: ['Dm'], durationSec: 60 } },
      { id: 'caya', title: 'Come As You Are Riff', duration: '2 mins' },
      { id: 'sun', title: 'Sunshine Of Your Love', duration: '2 mins' },
      { id: 'old-song', title: 'Song 505', drill: { kind: 'song', songId: '505-arctic-monkeys' } },
    ] }],
  dailyLogs: {}, strumPatterns: [], songLinks: {}, metronomeMeter: '3/4', metronomeAuto: false,
};
const results = [];
const browser = await launch();
try {
  for (const width of [390, 820, 1440]) for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({
      ...contextOptions({ width, height: width === 390 ? 844 : 1000 }),
      colorScheme, reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript((account) => {
      localStorage.setItem('daily-fret-coach-voice', '0');
      localStorage.setItem('daily-fret-storage', JSON.stringify({
        state: { currentAccountId: 'anonymous', accounts: { anonymous: account } }, version: 0,
      }));
    }, seed);
    const shot = async (name) => {
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const file = `${ENGINE}-${width}-${colorScheme}-${name}.png`;
      await page.screenshot({ path: join(OUT, file) });
      results.push({ file, overflow, errors: [...errors] });
      if (overflow > 1 || errors.length) throw new Error(`${file}: overflow=${overflow}; ${errors.join('; ')}`);
    };
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.locator('.mu').waitFor();
    await page.waitForTimeout(500);
    await shot('offer');
    await page.locator('.mu-toggle').click();
    await page.waitForTimeout(400);
    await shot('preview');
    await page.locator('.mu').getByRole('button', { name: 'Update', exact: true }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll('.task-title')].some((el) => el.textContent === 'Song 505'));
    await shot('routine');
    await page.locator('.task-row', { hasText: 'G Chord Perfect' }).click();
    await page.locator('.ct-chip-grid').waitFor();
    const startChord = page.locator('.practice-overlay').getByRole('button', { name: /^Start/ });
    if (!await startChord.isEnabled()) throw new Error('A single G Chord Perfect must be startable');
    await shot('g-grip');
    await page.keyboard.press('Escape');
    await page.locator('.practice-overlay').waitFor({ state: 'detached' });
    await page.locator('.task-row', { hasText: 'Alternate Picking' }).click();
    await page.locator('.pk-figure').waitFor();
    await shot('picking');
    await page.keyboard.press('Escape');
    await page.locator('.practice-overlay').waitFor({ state: 'detached' });
    await page.locator('.task-row', { hasText: '6/8 Strumming' }).click();
    await page.locator('.pattern-bar').first().waitFor();
    await shot('six-eight');
    await page.locator('.metro-trigger').click();
    await page.locator('.metro-panel').waitFor();
    const count = await page.locator('.metro-cell').count();
    const selected = await page.getByRole('radio', { name: '6/8', exact: true }).getAttribute('aria-checked');
    const preference = await page.evaluate(() => JSON.parse(localStorage.getItem('daily-fret-storage')).state.accounts.anonymous.metronomeMeter);
    if (count !== 6 || selected !== 'true' || preference !== '3/4') throw new Error(`meter/pref: ${count}/${selected}/${preference}`);
    await shot('metronome');
    await context.close();
  }
} finally {
  await browser.close();
  writeFileSync(join(OUT, 'findings.json'), JSON.stringify(results, null, 2));
}
console.log(`PASS: ${results.length} screenshots; no horizontal overflow or page errors.`);
