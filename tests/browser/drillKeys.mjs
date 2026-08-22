// Drill results, keyed by what was played, driven in a real browser.
//
// Three things this has to see with its own eyes, because none of them can be
// proven by a pure function:
//
//   1. months of numbers written under a task id still read after the change,
//      through the store, the panels and the tempo prescription;
//   2. they survive the routine being regenerated underneath them, which is the
//      case the alias map exists for and the one that needs localStorage to be
//      real;
//   3. a drill run for real writes under the new keys, with a microphone.
//
// Chromium takes a file as its microphone, so the whole capture path runs: the
// worklet, the chromagram, the onset gate, the salience and margin gates. Only
// the physical microphone is faked. The file is generated here rather than
// committed, the same way tests/browser/tone.mjs does it for the tuner.
//
//   PREVIEW_URL=http://localhost:5199/ node tests/browser/drillKeys.mjs [outDir]

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'tests/browser/.shots';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.PREVIEW_URL ?? 'http://localhost:4173/';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `: ${detail}` : ''}`);
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

const POOL = ['A', 'D'];
const RING = ['D', 'A', 'E'];
const poolKey = (chords) => `pool:${[...new Set(chords)].sort().join('|')}`;
const ringKey = (chords) => {
  let best = chords.join('>');
  for (let i = 1; i < chords.length; i += 1) {
    const rotated = [...chords.slice(i), ...chords.slice(0, i)].join('>');
    if (rotated < best) best = rotated;
  }
  return `ring:${best}`;
};

// --- a microphone, as a file ------------------------------------------------

const RATE = 44100;

// The notes in each open shape, as the strings actually sound them.
const VOICING = {
  A: [110.0, 164.81, 220.0, 277.18, 329.63],
  D: [146.83, 220.0, 293.66, 369.99],
  E: [82.41, 123.47, 164.81, 207.65, 246.94, 329.63],
};

// One strum: every string plucked a few milliseconds apart, decaying. A pure
// sustained sine would flatter the detector; this is closer to what a strummed
// open chord presents to the chromagram.
function strum(notes, seconds, amp = 0.5) {
  const n = Math.floor(RATE * seconds);
  const out = new Float32Array(n);
  const partials = [1, 0.6, 0.35, 0.22, 0.13, 0.08];
  notes.forEach((hz, s) => {
    const start = Math.floor(RATE * 0.012 * s);
    for (let i = start; i < n; i += 1) {
      const t = (i - start) / RATE;
      const env = Math.exp(-t * 1.6) * (t < 0.004 ? t / 0.004 : 1);
      let v = 0;
      for (let k = 0; k < partials.length; k += 1) {
        v += partials[k] * Math.sin(2 * Math.PI * hz * (k + 1) * t);
      }
      out[i] += (v / 2.4) * env;
    }
  });
  const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  for (let i = 0; i < n; i += 1) out[i] = (out[i] / peak) * amp;
  return out;
}

const silence = (seconds) => new Float32Array(Math.floor(RATE * seconds));

function wav(parts) {
  const total = parts.reduce((n, a) => n + a.length, 0);
  const buf = Buffer.alloc(44 + total * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + total * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(total * 2, 40);
  let at = 44;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) {
      const v = Math.max(-1, Math.min(1, part[i]));
      buf.writeInt16LE(Math.round(v * 32767), at);
      at += 2;
    }
  }
  return buf;
}

// A, D and E strummed round and round with a gap between each. Chromium loops
// the file, so every block of every drill hears all three shapes: Chord Perfect
// counts the one it is asking for, and the rotation counts each landing of the
// chord it is cueing.
const AUDIO = join(OUT, 'chords.wav');
writeFileSync(
  AUDIO,
  wav(['A', 'D', 'E'].flatMap((c) => [strum(VOICING[c], 0.85), silence(0.35)])),
);

// --- the account ------------------------------------------------------------

const routine = (tasks) => ({
  id: 'r1', name: 'Module 4 Daily', description: '', isDefault: true, tasks,
});

const OLD_TASKS = [
  { id: 't1', title: 'Chord Perfect', duration: '2', drill: { kind: 'chord-trainer', durationSec: 40, chords: POOL } },
  { id: 't2', title: 'Anchor changes', duration: '1', drill: { kind: 'chord-rotation', durationSec: 25, chords: RING } },
];

// Six days of the shape the owner's history is actually in: both drills filed
// under the id of the task they were launched from.
const legacyLogs = () => Object.fromEntries(
  Array.from({ length: 6 }, (_, i) => {
    const date = daysAgo(6 - i);
    return [date, {
      date, routineId: 'r1', completedTaskIds: ['t1', 't2'],
      drillResults: { t1: 30 + i, t2: 18 + i, 'a-task-long-since-deleted': 7 },
    }];
  }),
);

const account = (extra = {}) => ({
  activeRoutineId: 'r1',
  currentLesson: 'b1-403',
  routines: [routine(OLD_TASKS)],
  dailyLogs: legacyLogs(),
  strumPatterns: [], songLinks: [], updatedAt: 1,
  ...extra,
});

const seed = (extra) => ({ currentAccountId: 'anonymous', accounts: { anonymous: account(extra) } });

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${AUDIO}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});

async function open(state, viewport = { width: 1280, height: 1000 }) {
  const ctx = await browser.newContext({ viewport, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => {
    localStorage.setItem('daily-fret-storage', JSON.stringify({ state: s, version: 0 }));
  }, state);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.task-container');
  await page.waitForTimeout(500);
  return { ctx, page, errors };
}

// Progress lives behind its own tab, and the numbers behind a tab inside that.
async function numbers(page) {
  await page.getByRole('button', { name: 'Progress' }).click();
  await page.waitForSelector('.progress-tabs');
  await page.locator('.progress-tab', { hasText: /^Numbers$/ }).click();
  await page.waitForSelector('.progress-root');
  await page.waitForTimeout(400);
  return page.locator('.progress-root').innerText();
}

const stored = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('daily-fret-storage')).state.accounts.anonymous);

// --- 1. the old numbers, read back ------------------------------------------
{
  console.log('\nMonths of task-keyed numbers, on the real screens\n');
  const { ctx, page, errors } = await open(seed());

  const acc = await stored(page);
  check('the task ids were mapped while the tasks were still here',
    acc.drillKeyAliases?.t1 === poolKey(POOL) && acc.drillKeyAliases?.t2 === ringKey(RING),
    JSON.stringify(acc.drillKeyAliases));
  check('and not one stored day was rewritten',
    acc.dailyLogs[daysAgo(1)].drillResults.t1 === 35,
    JSON.stringify(acc.dailyLogs[daysAgo(1)].drillResults));

  const perfectRow = page.locator('.task-row', { hasText: 'Chord Perfect' });
  const anchorRow = page.locator('.task-row', { hasText: 'Anchor changes' });
  check('Chord Perfect still shows its personal best',
    (await perfectRow.innerText()).includes('35'), (await perfectRow.innerText()).replace(/\n/g, ' | '));
  check('and the anchor rotation shows its own',
    (await anchorRow.innerText()).includes('23'), (await anchorRow.innerText()).replace(/\n/g, ' | '));

  const progress = await numbers(page);
  check('Progress finds Chord Perfect under the shapes it drilled',
    progress.includes('A D'), progress.split('\n').join(' | '));
  check('and the rotation under the ring it turned',
    progress.includes('A → E → D'));
  check('a task deleted before any of this shipped keeps its number',
    progress.includes('A drill since removed'));
  await page.screenshot({ path: join(OUT, 'drillkeys-progress.png'), fullPage: true });

  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- 2. the routine regenerated underneath them -----------------------------
{
  console.log('\nThe routine regenerated out from under six days of practice\n');
  const { ctx, page, errors } = await open(seed());

  // Exactly what the routine builder does: same practice, brand new task ids,
  // nothing left pointing back at the old ones.
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('daily-fret-storage'));
    const acc = raw.state.accounts.anonymous;
    acc.routines[0].tasks = acc.routines[0].tasks.map((t, i) => ({ ...t, id: `gen-${i}` }));
    acc.updatedAt = Date.now();
    localStorage.setItem('daily-fret-storage', JSON.stringify(raw));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  const perfectRow = page.locator('.task-row', { hasText: 'Chord Perfect' });
  check('the best badge survives new task ids',
    (await perfectRow.innerText()).includes('35'), (await perfectRow.innerText()).replace(/\n/g, ' | '));

  const progress = await numbers(page);
  check('and so does the whole series on Progress', progress.includes('A D'),
    progress.split('\n').join(' | '));
  check('with the rotation intact too', progress.includes('A → E → D'));

  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- 3. a run, for real, into a microphone ----------------------------------
{
  console.log('\nRunning both drills with a microphone\n');
  const { ctx, page, errors } = await open(seed());
  const today = iso(new Date());

  const run = async (title, seconds) => {
    await page.locator('.task-row', { hasText: title }).first().click();
    await page.waitForSelector('.practice-overlay');
    const start = page.locator('.practice-overlay .practice-btn.primary');
    if (await start.count()) await start.first().click();
    await page.waitForSelector('.practice-overlay .om-timer, .practice-overlay .ct-stats', { timeout: 15000 });
    await page.waitForTimeout(seconds * 1000 + 3000);
    await page.screenshot({ path: join(OUT, `drillkeys-${title.replace(/\W+/g, '-').toLowerCase()}.png`) });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  };

  await run('Chord Perfect', 42);
  await run('Anchor changes', 27);

  const acc = await stored(page);
  const results = acc.dailyLogs[today]?.drillResults ?? {};
  console.log('    today:', JSON.stringify(results));

  check('Chord Perfect filed its block score under the pool it drilled',
    typeof results[poolKey(POOL)] === 'number' && results[poolKey(POOL)] > 0,
    JSON.stringify(results));
  check('and said which shape earned what',
    POOL.some((c) => typeof results[`chord:${c}`] === 'number' && results[`chord:${c}`] > 0));
  check('the rotation filed its count under the ring it turned',
    typeof results[ringKey(RING)] === 'number' && results[ringKey(RING)] > 0);
  check('nothing was written under a task id',
    !('t1' in results) && !('t2' in results), Object.keys(results).join(' '));
  check('every run is on the record beside the day\'s best',
    (acc.dailyLogs[today]?.drillRuns?.[poolKey(POOL)] ?? []).length > 0);

  // The keys the run just wrote are the keys the panels read.
  const progress = await numbers(page);
  check('Progress puts today\'s run on the same series as the old ones',
    progress.includes('A D'));
  check('and now names the shape behind the score',
    POOL.some((c) => progress.includes(`${c} shape`)), progress.split('\n').join(' | '));
  await page.screenshot({ path: join(OUT, 'drillkeys-after-run.png'), fullPage: true });

  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- 4. a count filed with the window it was counted over --------------------
{
  console.log('\nA drill whose key states the window it was measured over\n');
  // The note finder is the one drill that reports how long its block ran, so
  // every one of its results is filed under `find:<rung>@60` rather than under
  // the bare rung. Every reader in the app folds that window back onto the rung
  // before looking anything up; the row looked the bare key up directly, found
  // nothing, and so the drill that fills in the neck was the one drill whose row
  // could never say what it had heard.
  const FINDER = { id: 't3', title: 'Note finder', drill: { kind: 'note-finder', durationSec: 60 } };
  // Days only, with no per-run detail, which is what a day recorded before the
  // drill kept find times looks like. It also keeps the ladder on its bottom
  // rung, so the rung the row asks about is the rung these runs are filed under.
  const finderLogs = Object.fromEntries(
    [11, 12, 13, 9].map((finds, i) => {
      const date = daysAgo(3 - i);
      return [date, {
        date, routineId: 'r1', completedTaskIds: ['t3'],
        drillResults: { 'find:open-strings@60': finds },
        taskRecords: { t3: { evidence: 'measured', at: 1 } },
        // Answered, so the note sheet the finished day opens is not sitting over
        // the screen this section is reading.
        feedback: 'Getting quicker on the D string.',
      }];
    }),
  );
  const { ctx, page, errors } = await open(
    seed({ routines: [routine([FINDER])], dailyLogs: finderLogs }),
  );

  const row = page.locator('.task-row', { hasText: 'Note finder' });
  const text = (await row.innerText()).replace(/\n/g, ' | ');
  check('the row reports what today\'s run counted', text.includes('9 finds today'), text);
  check('and carries the best behind it', text.includes('13 finds'), text);

  // The same numbers through a reader that already folded the window back on,
  // so a failure above is the row rather than the history.
  const progress = await numbers(page);
  check('Progress has the same runs under the rung they were run at',
    progress.includes('The six open strings'), progress.split('\n').join(' | '));

  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
