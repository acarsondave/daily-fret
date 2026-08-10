// Chord Perfect in the real app, with a real number of strums going into it.
//
// The unit suite (tests/placements.test.mjs) drives the detector directly. This
// one runs the drill: React, the audio worklet, the shared microphone, the
// clock, the counter on screen. Chromium will accept a file as its microphone
// (--use-file-for-fake-audio-capture), so the only thing faked is the physical
// mic — everything the player would hit is exercised.
//
// The bug this covers came back as "when I lift off and place to strum again, it
// either doesn't work or it just counts weirdly". Before the fix this take of
// twelve strums put 1 on the screen.
//
//   node tests/browser/chordPerfect.mjs
//
// Against the shared dev server by default; set PREVIEW_URL for a build.

import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chordPerfectTake, changesTake, write, silence, addRoom } from './tone.mjs';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5199/';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const DIR = mkdtempSync(join(tmpdir(), 'daily-fret-chords-'));

// Twelve strums of Am at a normal drill pace: each chord rings for a full second
// and the lift then leaves the strings sounding open, so the guitar is never
// actually quiet between one placement and the next. That is the motion in the
// report, and it is what the drill used to score 1 out of 12 on. Sized to fit
// inside one 20-second block with room to read the counter before Chromium loops
// the file back to the start.
const REPS = 12;
write(`${DIR}/am-12.wav`, [chordPerfectTake('Am', REPS, { repSec: 1.4, ringSec: 1.0, liftRing: true, leadSec: 0.5, tailSec: 2.5 })]);
// The same length of nothing, for the count that must not move.
write(`${DIR}/room.wav`, [addRoom(silence(20), 0.0015)]);
// Somebody drilling the wrong shape: twelve strums of Dm while Am is on screen.
write(`${DIR}/dm-12.wav`, [chordPerfectTake('Dm', REPS, { repSec: 1.4, ringSec: 0.85, leadSec: 0.5, tailSec: 2.5, liftRing: true })]);
// Am and Em in turn, for the drill that shares this detector.
write(`${DIR}/changes.wav`, [changesTake(['Am', 'Em'], 17, { repSec: 1.0, ringSec: 0.85 })]);

const routine = (drill) => ({
  activeRoutineId: 'r1',
  currentLesson: 'b1-403',
  routines: [{
    id: 'r1', name: 'Module 4 Daily', description: '', isDefault: true,
    tasks: [{ id: 't1', title: 'The drill', duration: '1 min', drill }],
  }],
  dailyLogs: {}, strumPatterns: [], songLinks: [], updatedAt: 1,
});

async function openWithAudio(wav, drill) {
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      `--use-file-for-fake-audio-capture=${DIR}/${wav}`,
    ],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    permissions: ['microphone'],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    (s) => localStorage.setItem('daily-fret-storage', JSON.stringify({
      state: { currentAccountId: 'anonymous', accounts: { anonymous: s } }, version: 0,
    })),
    routine(drill),
  );
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForSelector('.task-container', { timeout: 25000 });
  await page.locator('.task-row', { hasText: 'The drill' }).click();
  await page.waitForSelector('.practice-overlay', { timeout: 15000 });
  return { browser, page, errors };
}

/** Start the block if the drill opened on its chord picker, and wait for audio. */
async function begin(page, playingSelector) {
  // Scoped to the overlay: the task row underneath it is also called "Start".
  const start = page.locator('.practice-overlay').getByRole('button', { name: /^Start/ });
  if (await start.count()) await start.first().click();
  await page.waitForSelector(playingSelector, { timeout: 20000 });
}

const CHORD_PERFECT = { kind: 'chord-trainer', durationSec: 40, chords: ['Am', 'Em'] };
const placed = (page) =>
  page.locator('.ct-score').innerText().then((t) => Number(/(\d+)/.exec(t)?.[1] ?? -1));

console.log('\nChord Perfect, on twelve real strums\n');
{
  const { browser, page, errors } = await openWithAudio('am-12.wav', CHORD_PERFECT);
  await begin(page, '.ct-stage');
  check('the shape being drilled is the first of the pool',
    (await page.locator('.ct-target').innerText()).trim() === 'Am');

  // The take runs 19s and the block runs 20s, so this reads the finished block.
  await page.waitForTimeout(19_500);
  const count = await placed(page);
  check(`twelve strums are counted as twelve placements`, count === REPS, `screen says ${count}`);
  check('the diagram lit for the shape while it was held',
    (await page.locator('.ct-shape').count()) === 1);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log('\nand counts nothing that was not played\n');
{
  const { browser, page, errors } = await openWithAudio('room.wav', CHORD_PERFECT);
  await begin(page, '.ct-stage');
  await page.waitForTimeout(19_500);
  const count = await placed(page);
  check('twenty seconds of an empty room counts nothing', count === 0, `screen says ${count}`);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  const { browser, page, errors } = await openWithAudio('dm-12.wav', CHORD_PERFECT);
  await begin(page, '.ct-stage');
  await page.waitForTimeout(19_500);
  const count = await placed(page);
  // The lifts in this take ring open, and open strings read as Em. Em is the
  // next shape in the pool, so this is also the check that a phantom chord
  // cannot bank placements against a block that has not started.
  check('twelve strums of the wrong shape count nothing', count === 0, `screen says ${count}`);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log('\nthe drills that share the detector\n');
{
  const { browser, page, errors } = await openWithAudio('changes.wav', {
    kind: 'one-minute-changes', durationSec: 20, chordFrom: 'Am', chordTo: 'Em',
  });
  await begin(page, '.om-count');
  await page.waitForTimeout(19_500);
  const changes = Number(/(\d+)/.exec(await page.locator('.om-count, .om-ring-value').first().innerText())?.[1] ?? -1);
  // Seventeen changes go in over 18 seconds. The drill reads whatever part of
  // them fits in its own 20-second clock, so this asserts the band a healthy
  // count sits in rather than a single number: the failure being guarded
  // against is a collapse to near zero or a runaway.
  check(`Am to Em counts in the right band (${changes} for 17 played)`,
    changes >= 14 && changes <= 18, `counted ${changes}`);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  const { browser, page, errors } = await openWithAudio('room.wav', {
    kind: 'chord-rotation', durationSec: 20, chords: ['D', 'A', 'E'],
  });
  await begin(page, '.om-count');
  await page.waitForTimeout(19_500);
  const changes = Number(/(\d+)/.exec(await page.locator('.om-count, .om-ring-value').first().innerText())?.[1] ?? -1);
  check('a rotation in an empty room counts nothing', changes === 0, `counted ${changes}`);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures ? 1 : 0);
