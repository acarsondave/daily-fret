// Screenshots of the live coached drills, at both viewports, first-run and
// with-a-best. Usage: node .scratch/shots.mjs <outdir>
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chordPerfectTake, changesTake, write } from '../tests/browser/tone.mjs';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5415/';
const DIR = mkdtempSync(join(tmpdir(), 'df-shots-'));
write(`${DIR}/am.wav`, [chordPerfectTake('Am', 24, { repSec: 1.4, ringSec: 1.0, liftRing: true, leadSec: 0.5, tailSec: 2 })]);
write(`${DIR}/changes.wav`, [changesTake(['Am', 'Em'], 30, { repSec: 1.0, ringSec: 0.85 })]);

const state = (drill, results) => ({
  activeRoutineId: 'r1', currentLesson: 'b1-403',
  routines: [{ id: 'r1', name: 'Module 4 Daily', description: '', isDefault: true,
    tasks: [{ id: 't1', title: 'The drill', duration: '1 min', drill }] }],
  dailyLogs: results ? { '2026-08-19': { date: '2026-08-19', completedTaskIds: [], drillResults: results } } : {},
  strumPatterns: [], songLinks: [], updatedAt: 1,
});

async function shot(name, wav, drill, results, width, waitMs) {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
    `--use-file-for-fake-audio-capture=${DIR}/${wav}`] });
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 780 : 900 },
    permissions: ['microphone'], deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript((s) => localStorage.setItem('daily-fret-storage',
    JSON.stringify({ state: { currentAccountId: 'anonymous', accounts: { anonymous: s } }, version: 0 })), state(drill, results));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForSelector('.task-container', { timeout: 25000 });
  await page.locator('.task-row', { hasText: 'The drill' }).click();
  await page.waitForSelector('.practice-overlay', { timeout: 15000 });
  const start = page.locator('.practice-overlay').getByRole('button', { name: /^Start/ });
  if (await start.count()) await start.first().click();
  await page.waitForTimeout(waitMs);
  await page.screenshot({ path: `${OUT}/${name}-${width}.png` });
  if (errs.length) console.log(`  ${name}-${width} PAGE ERRORS:`, errs.join(' | '));
  await browser.close();
}

const CP = { kind: 'chord-trainer', durationSec: 60, chords: ['Am', 'Em'] };
const OM = { kind: 'one-minute-changes', chordFrom: 'Am', chordTo: 'Em', durationSec: 60 };
for (const w of [390, 1366]) {
  await shot('cp-first', 'am.wav', CP, null, w, 16000);
  await shot('cp-best', 'am.wav', CP, { 'pool:Am|Em': 26 }, w, 16000);
  await shot('om-first', 'changes.wav', OM, null, w, 16000);
  await shot('om-best', 'changes.wav', OM, { 'pair:Am|Em': 30 }, w, 16000);
}
console.log('done ->', OUT);
