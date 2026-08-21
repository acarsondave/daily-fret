// Reproduction: does the live progress ring move during Chord Perfect?
// Samples the arc's stroke-dashoffset alongside the on-screen count.
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chordPerfectTake, write } from '/Users/acarson/Documents/guitar-journey/daily-fret/.claude/worktrees/agent-ab68edbc0afad5fc5/tests/browser/tone.mjs';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5415/';
const DIR = mkdtempSync(join(tmpdir(), 'df-ring-'));
write(`${DIR}/am.wav`, [chordPerfectTake('Am', 14, { repSec: 1.4, ringSec: 1.0, liftRing: true, leadSec: 0.5, tailSec: 2 })]);

const PRIOR = process.argv[2] === 'with-best';

const state = {
  activeRoutineId: 'r1',
  currentLesson: 'b1-403',
  routines: [{
    id: 'r1', name: 'Module 4 Daily', description: '', isDefault: true,
    tasks: [{ id: 't1', title: 'The drill', duration: '1 min', drill: { kind: 'chord-trainer', durationSec: 40, chords: ['Am', 'Em'] } }],
  }],
  dailyLogs: PRIOR ? { '2026-08-01': [{ id: 'x', taskId: 't1', title: 'The drill', drillKey: 'chord-trainer:Am+Em', value: 30, unit: 'placements', at: 1 }] } : {},
  strumPatterns: [], songLinks: [], updatedAt: 1,
};

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required', `--use-file-for-fake-audio-capture=${DIR}/am.wav`],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, permissions: ['microphone'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.addInitScript((s) => localStorage.setItem('daily-fret-storage',
  JSON.stringify({ state: { currentAccountId: 'anonymous', accounts: { anonymous: s } }, version: 0 })), state);
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
await page.waitForSelector('.task-container', { timeout: 25000 });
await page.locator('.task-row', { hasText: 'The drill' }).click();
await page.waitForSelector('.practice-overlay', { timeout: 15000 });
const start = page.locator('.practice-overlay').getByRole('button', { name: /^Start/ });
if (await start.count()) await start.first().click();
await page.waitForSelector('.ct-stage', { timeout: 20000 });

console.log(`prior best: ${PRIOR ? 'yes (30)' : 'none'}`);
console.log('t(ms)  count  dashoffset  circumference  arcFraction  markDeg');
for (let i = 0; i < 22; i++) {
  await page.waitForTimeout(900);
  const s = await page.evaluate(() => {
    const ring = document.querySelector('.ct-ring-live');
    if (!ring) return null;
    const arc = ring.querySelector('svg circle[stroke="currentColor"]');
    const mark = ring.querySelector('.ring-mark');
    const cs = arc ? getComputedStyle(arc) : null;
    return {
      count: document.querySelector('.ct-score')?.textContent ?? '?',
      chord: document.querySelector('.ct-target')?.textContent?.trim() ?? '?',
      dash: cs?.strokeDasharray ?? '',
      off: cs?.strokeDashoffset ?? '',
      markT: mark ? getComputedStyle(mark.parentElement).transform : 'none',
    };
  });
  if (!s) { console.log('ring gone'); continue; }
  const circ = parseFloat(s.dash);
  const off = parseFloat(s.off);
  const frac = circ ? 1 - off / circ : NaN;
  console.log(`${String((i + 1) * 900).padStart(5)}  ${String(s.count).padStart(5)}  ${off.toFixed(2).padStart(8)}  ${circ.toFixed(2).padStart(10)}  ${frac.toFixed(4).padStart(8)}  ${s.chord}  mark=${s.markT}`);
}
await browser.close();
