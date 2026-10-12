// Module 6, in a real browser: the routine update, alternate picking and 6/8
// strumming, each driven from the Home screen the way the owner will meet them.
//
//   node tests/browser/module6.mjs [shotsDir]      (PREVIEW_URL to point elsewhere)
//
// Decoded PCM feeds the real capture worklet on its own audio clock. Set
// M6_AUDIO_SOURCE=native to diagnose the OS fake microphone separately; busy
// Linux hosts can drop its chunks. Scores are never mocked or relaxed.
// Phone width throughout, with the browser's light preference (the app has
// one established dark palette, not a separate light theme).

import { chromium, webkit } from 'playwright';
import { isWebKit as IS_WEBKIT, contextOptions } from './engine.mjs';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register } from 'node:module';
import { renderStrum, addRoom, write, SAMPLE_RATE } from './tone.mjs';

register(new URL('../_resolve.mjs', import.meta.url).href);
const { renderClick, VOICES, accentFor } = await import('../../src/audio/metronome.ts');

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

const DIR = mkdtempSync(join(tmpdir(), 'daily-fret-m6-'));
const BPM = 90;
const PERIOD = 60 / BPM;
const SECONDS = 40;
const WOBBLE = [-14, 9, -4, 17, -11, 5, 13, -8];
{
  const lead = 1.2;
  const total = Math.ceil(SECONDS * SAMPLE_RATE);
  const audio = new Float32Array(total);
  let seed = 4242;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const beats = Math.floor((SECONDS - 2) / PERIOD);
  for (let k = 0; k < beats; k += 1) {
    const at = lead + k * PERIOD;
    const click = renderClick(VOICES[accentFor(k, 4)], SAMPLE_RATE, random);
    const st = Math.round(at * SAMPLE_RATE);
    for (let i = 0; i < click.length && st + i < total; i += 1) audio[st + i] += click[i];
    renderStrum(audio, Math.round((at + WOBBLE[k % 8] / 1000) * SAMPLE_RATE), [-1, -1, -1, 0, -1, -1], {
      amp: 0.3, spreadMs: 0, seed: 9 + k, dampAt: PERIOD, dampMs: 25,
    });
  }
  addRoom(audio, 0.0015, 11);
  write(`${DIR}/picks.wav`, [audio]);
}

const t = (id, title, extra = {}) => ({ id, title, duration: '2 mins', ...extra });
// The owner's routine, in shape: the update has to read it right to be any use.
const module5 = {
  activeRoutineId: 'r_10min',
  currentLesson: 'b1-504',
  routines: [{
    id: 'r_10min', name: 'Module 5 Daily', description: '', isDefault: true,
    chords: ['A', 'D', 'E', 'Am', 'Dm', 'Em', 'C'],
    tasks: [
      t('spider', 'Spider'),
      t('cp', 'Chord Perfect', { drill: { kind: 'chord-trainer', chords: ['Dm', 'C'], durationSec: 150 } }),
      t('sweep', 'Chord Sweep', { drill: { kind: 'chord-rotation', chords: ['C', 'Am', 'Dm'], durationSec: 60 } }),
      t('m5', 'Module 5 Changes', { drill: { kind: 'one-minute-changes', pairs: [{ from: 'Am', to: 'C' }, { from: 'C', to: 'Em' }, { from: 'Dm', to: 'Em' }] } }),
      t('strum', 'Strumming Patterns', { drill: { kind: 'strum-pattern', durationSec: 180, bpm: 85 } }),
      t('caya', 'Come As You Are Riff'),
      t('sun', 'Sunshine Of Your Love'),
      t('sna', 'Seven Nation Army Riff'),
      t('505', 'Song 505', { drill: { kind: 'song', songId: '505-arctic-monkeys' } }),
    ],
  }],
  dailyLogs: {
    '2026-10-04': { date: '2026-10-04', routineId: 'r_10min', completedTaskIds: [], drillResults: { 'pair:A|D': 24, 'pair:D|E': 50 } },
  },
  strumPatterns: [], songLinks: {}, updatedAt: 1,
};

async function open(account, wav) {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
  if (wav) args.push(`--use-file-for-fake-audio-capture=${DIR}/${wav}`);
  const browser = IS_WEBKIT ? await webkit.launch() : await chromium.launch({ args });
  const ctx = await browser.newContext({
    ...contextOptions(PHONE, { microphone: true }),
    deviceScaleFactor: IS_WEBKIT ? 3 : 2, colorScheme: 'light',
  });
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
  await page.route('**/__test-picks.wav', (route) => route.fulfill({ path: `${DIR}/picks.wav`, contentType: 'audio/wav' }));
  if (wav && process.env.M6_AUDIO_SOURCE !== 'native') {
    // Replace only the source node with decoded PCM on the capture context's
    // clock. Native fake-device delivery on a loaded Linux host drops 10ms
    // chunks (confirmed with an isolated capture), corrupting a known take.
    // Worklet, analyser, beat fitting and scoring remain real; permissions
    // and OS routing are deliberately outside this deterministic fixture.
    // M6_AUDIO_SOURCE=native retains the OS fake-microphone diagnostic path.
    await page.addInitScript(() => {
      const native = AudioContext.prototype.createMediaStreamSource;
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => {
            const bytes = await fetch('/__test-picks.wav').then((r) => r.arrayBuffer());
            window.__fixtureBytes = bytes;
            // Retain context AND destination: WebKit otherwise collects the
            // stand-in and ends its track. No permission behavior is simulated.
            window.__fixtureContext = new AudioContext();
            window.__fixtureDestination = window.__fixtureContext.createMediaStreamDestination();
            return window.__fixtureDestination.stream;
          },
        },
      });
      AudioContext.prototype.createMediaStreamSource = function (stream) {
        if (!window.__fixtureBytes) return native.call(this, stream);
        const source = this.createBufferSource();
        this.decodeAudioData(window.__fixtureBytes.slice(0)).then((buffer) => {
          source.buffer = buffer;
          source.loop = true;
          source.start(this.currentTime + 0.2);
        });
        return source;
      };
    });
  }
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForSelector('.task-container', { timeout: 25000 });
  return { browser, page, errors };
}
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('daily-fret-storage')).state.accounts.anonymous);
const titles = (page) => page.locator('.task-row .task-title').allTextContents();

console.log('\nThe update, offered on Home\n');
let updated;
{
  const { browser, page, errors } = await open(module5);
  const card = page.locator('.mu');
  await card.waitFor({ timeout: 10000 });
  const before = await stored(page);
  await page.waitForTimeout(450);
  const cardBox = await card.boundingBox();
  const buttonBox = await card.getByRole('button', { name: 'Update' }).boundingBox();
  check('the update button is not clipped by flex shrink', cardBox.height >= 60 && buttonBox.height >= 44 && buttonBox.y + buttonBox.height <= cardBox.y + cardBox.height);
  check('a Module 5 player is offered the Module 6 routine', await card.isVisible());
  await page.screenshot({ path: `${OUT}/m6-update-closed.png` });
  await card.locator('.mu-toggle').click();
  await page.waitForTimeout(400);
  const groups = await card.locator('.mu-label').allTextContents();
  check('the preview groups changes by where they came from',
    ['MODULE 6', 'FROM YOUR NUMBERS', 'KEPT', 'OUT'].every((g) => groups.map((x) => x.toUpperCase()).includes(g)), groups.join(' | '));
  const preview = await card.textContent();
  check('the weak D change from his own numbers is in it', /D Chord Perfect/.test(preview));
  await card.screenshot({ path: `${OUT}/m6-update-open.png` });
  await page.screenshot({ path: `${OUT}/m6-update-open-page.png`, fullPage: true });

  await card.getByRole('button', { name: 'Update' }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('.task-row .task-title')].some((e) => e.textContent === 'Song 505'));
  const list = await titles(page);
  check('one tap rewrites the list', list.includes('Alternate Picking') && list.includes('6/8 Strumming') && !list.includes('Song 505'), list.join(' | '));
  check('kept tasks are still there', list.includes('Spider') && list.includes('Come As You Are Riff'));
  const acc = await stored(page);
  check('the old routine is archived on the account', acc.moduleUpdates?.['bg1-m6']?.previous?.name === 'Module 5 Daily');
  check('the lesson moves on to the end of Module 6', acc.currentLesson === 'b1-608', acc.currentLesson);
  check('an undo is offered', await page.locator('.mu-done').getByRole('button', { name: 'Undo' }).isVisible());
  updated = acc;
  await page.screenshot({ path: `${OUT}/m6-new-routine.png` });

  await page.locator('.mu-done').getByRole('button', { name: 'Undo' }).click();
  // Rows leave on an exit animation; read the list once it has settled.
  await page.waitForFunction(
    () => ![...document.querySelectorAll('.task-row .task-title')].some((e) => e.textContent === 'Alternate Picking'),
    null, { timeout: 5000 },
  );
  const restored = await stored(page);
  check('Undo restores exactly the persisted pre-update routine', JSON.stringify(restored.routines) === JSON.stringify(before.routines));
  check('Undo preserves every historical result', JSON.stringify(restored.dailyLogs) === JSON.stringify(before.dailyLogs));
  const back = await titles(page);
  check('undo puts the Module 5 routine back exactly', back.includes('Song 505') && !back.includes('Alternate Picking'), back.join(' | '));
  check('and offers the update again', await page.locator('.mu').isVisible());

  await page.locator('.mu').getByRole('button', { name: 'Later' }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.task-container');
  check('Later hides it across a reload', (await page.locator('.mu').count()) === 0);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log('\nAlternate picking, heard\n');
{
  const account = { ...updated, moduleUpdates: { 'bg1-m6': { outcome: 'accepted', at: 1 } } };
  account.routines = account.routines.map((r) => ({
    ...r,
    tasks: r.tasks.map((task) => (task.id === 'm6-alternate-picking' ? { ...task, drill: { ...task.drill, durationSec: 32, bpm: BPM } } : task)),
  }));
  const { browser, page, errors } = await open(account, 'picks.wav');
  check('the update is not offered once accepted', (await page.locator('.mu').count()) === 0);
  await page.locator('.task-row', { hasText: 'Alternate Picking' }).click();
  await page.waitForSelector('.practice-overlay', { timeout: 15000 });
  await page.waitForSelector('.pk-figure', { timeout: 10000 });
  await page.screenshot({ path: `${OUT}/m6-picking-setup.png` });
  await page.locator('.practice-overlay').getByRole('button', { name: /^Start/ }).first().click();
  try {
    await page.waitForFunction(() => document.querySelectorAll('.pk-ring.is-in').length >= 3, null, { timeout: 25000 });
  } catch (error) {
    await page.screenshot({ path: `${OUT}/m6-picking-failure.png` });
    console.dir(await page.evaluate(() => ({ audio: window.dailyFretAudio?.(), text: document.body.textContent, fixture: window.__fixtureContext?.state, tracks: window.__fixtureDestination?.stream.getTracks().map((t) => t.readyState) })), { depth: null });
    console.log(errors);
    await browser.close();
    throw error;
  }
  check('picks on the click draw as in-time rings', true);
  if (process.env.M6_CAPTURE_DURING_AUDIO === '1') await page.screenshot({ path: `${OUT}/m6-picking-flat.png` });
  await page.waitForSelector('.pk-figure.is-angled', { timeout: 20000 });
  check('the second half turns the pick to the angle', true);
  await page.waitForTimeout(1500);
  if (process.env.M6_CAPTURE_DURING_AUDIO === '1') await page.screenshot({ path: `${OUT}/m6-picking-angled.png` });
  await page.waitForSelector('.pk-results', { timeout: 30000 });
  const values = await page.locator('.pk-compare-value').allInnerTexts();
  const score = await page.locator('.om-ring-value').innerText();
  if (Number(score) < 85 || values.some((v) => !/^\d+%$/.test(v))) {
    await page.waitForTimeout(2200); // diagnostic persistence yields to idle after the result
    console.dir(await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('daily-fret-diag');
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
      return new Promise((resolve) => {
        const r = db.transaction('sessions').objectStore('sessions').getAll();
        r.onsuccess = () => { resolve(r.result.map(({ sampleRate, timings, marks }) => ({ sampleRate, timings, marks }))); db.close(); };
      });
    }), { depth: null });
  }
  check('a steady take scores high', Number(score) >= 85, score);
  check('both halves are measured', values.length === 2 && values.every((v) => /^\d+%$/.test(v)), values.join(' / '));
  await page.screenshot({ path: `${OUT}/m6-picking-results.png` });
  const acc = await stored(page);
  const keys = Object.values(acc.dailyLogs).flatMap((l) => Object.keys(l.drillResults ?? {}));
  check('the result is filed under its own picking key', keys.some((k) => k.startsWith('pick:90')), keys.join(','));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log('\n6/8 strumming, in six\n');
{
  const account = { ...updated, moduleUpdates: { 'bg1-m6': { outcome: 'accepted', at: 1 } } };
  const { browser, page, errors } = await open(account);
  await page.locator('.task-row', { hasText: '6/8 Strumming' }).click();
  await page.waitForSelector('.practice-overlay', { timeout: 15000 });
  await page.waitForSelector('.pb-bar, .pattern-bar', { timeout: 10000 });
  await page.locator('.metro-trigger').click();
  await page.waitForSelector('.metro-panel');
  const cells = await page.locator('.metro-cell').count();
  check('the click is counted in six', cells === 6, String(cells));
  check('the prescribed meter is 6/8', await page.getByRole('radio', { name: '6/8', exact: true }).getAttribute('aria-checked') === 'true');
  check('beats 1 and 4 carry distinct accents', await page.locator('.metro-cell').nth(0).evaluate((e) => e.classList.contains('is-downbeat')) && await page.locator('.metro-cell').nth(3).evaluate((e) => e.classList.contains('is-midbar')));
  await page.screenshot({ path: `${OUT}/m6-metronome.png` });
  await page.locator('.metro-trigger').click();
  check('the bar draws beat 4 as the second pulse', (await page.locator('.pb-stem.is-four').count()) >= 1);
  await page.screenshot({ path: `${OUT}/m6-six-eight.png` });
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log('\nPicking in the actual coached container\n');
{
  const account = structuredClone(updated);
  account.routines[0].tasks = [
    { id: 'coached-pick', title: 'Alternate Picking', drill: { kind: 'alternate-picking', durationSec: 32, bpm: BPM } },
    { id: 'coached-six', title: '6/8 Strumming', drill: { kind: 'strum-pattern', durationSec: 16, bpm: 110, patterns: ['68.D-D-D-D-D-D-'] } },
  ];
  const { browser, page, errors } = await open(account, 'picks.wav');
  await page.getByRole('button', { name: /coached/i }).first().click();
  await page.waitForSelector('.pk-stage', { timeout: 25000 });
  check('coached starts the picking mic without a second Start tap', true);
  await page.waitForSelector('.pk-results', { timeout: 40000 });
  check('coached picking produces a measured result', Number(await page.locator('.om-ring-value').innerText()) >= 85);
  await page.waitForSelector('.coach-skip-rest', { timeout: 15000 });
  await page.locator('.coach-skip-rest').click();
  await page.waitForSelector('.sp-stage', { timeout: 30000 });
  await page.locator('.metro-trigger').click();
  await page.waitForFunction(() => document.querySelectorAll('.metro-cell').length === 6);
  check('the next coached drill switches from four to six', true);
  await page.screenshot({ path: `${OUT}/m6-coached-six-metronome.png` });
  await page.locator('.metro-trigger').click();
  await page.screenshot({ path: `${OUT}/m6-six-eight-playing.png` });
  await page.keyboard.press('Escape');
  const acc = await stored(page);
  check('coached commits picking under its own key', Object.values(acc.dailyLogs).some((l) => Object.keys(l.drillResults ?? {}).some((k) => k.startsWith('pick:90'))));
  check('no coached page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
