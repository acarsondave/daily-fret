// What a coached session is allowed to say it heard, and what tempo it asks for.
//
// Two defects, both in the same file, both of the same kind: a number reported
// confidently about something other than what its label claims.
//
//   1. The summary carried the previous drill's figure into a drill that
//      produced nothing. `lastValueRef` held the last measured value for the
//      whole session, and every measured segment reads it to build its own
//      summary row. A segment that never calls onResult still advances, which
//      is exactly what happens when the microphone goes away mid-session and
//      the player takes the drill's own offer to run it on a timer. The row
//      then showed a pair the app had not heard a note of, with a real number
//      beside it and a tick.
//
//   2. Chord Perfect's prescribed click was read against the length the task
//      asked for rather than the length the block runs. Every shape gets a
//      twenty-second floor, so a ninety-second task over five shapes runs a
//      hundred seconds; dividing the score by ninety made the player look
//      eleven per cent faster than they were and the click asked for a pace
//      they had never reached.
//
// Both are asserted through the running app, because both live in the wiring
// rather than in a pure function: the unit suites can only hold the helpers.
//
//   PREVIEW_URL=http://localhost:4181/ node tests/browser/coached.mjs

import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changesTake, silence, write } from './tone.mjs';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5199/';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const DIR = mkdtempSync(join(tmpdir(), 'daily-fret-coached-'));
// Am and Em in turn, the take tests/browser/chordPerfect.mjs already establishes
// this detector counts reliably. It only has to produce a number at all here.
write(`${DIR}/changes.wav`, [changesTake(['Am', 'Em'], 17, { repSec: 1.0, ringSec: 0.85 })]);

// Four real changes, then twenty seconds of D. Restricted to Am and Em the
// detector shares no pitch class worth matching with it, so the level stays
// strong and nothing is recognised, which is exactly the reading `unreadable`
// exists to name: plenty of clean signal arriving, none of it matching. It
// stands in for the microphone the owner's July runs were taken through, and it
// is the take that has to NOT reach the day's record.
write(`${DIR}/unreadable.wav`, [
  changesTake(['Am', 'Em'], 4, { repSec: 1.0, ringSec: 0.85, tailSec: 0.2 }),
  changesTake(['D'], 20, { repSec: 1.0, ringSec: 0.85, leadSec: 0, tailSec: 0.5 }),
]);

// The same four changes and then nothing at all. A player who stopped is silent,
// not unheard, so this run is just as bad and must still count. It is the half
// of the fix that matters most: the product rests on not flattering the player.
write(`${DIR}/quiet.wav`, [
  changesTake(['Am', 'Em'], 4, { repSec: 1.0, ringSec: 0.85, tailSec: 0.2 }),
  silence(22),
]);

/** Seed the account, silence the coach so the count-in is a fixed three seconds. */
async function launch(account, { audio = null } = {}) {
  const args = [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ];
  if (audio) args.push(`--use-file-for-fake-audio-capture=${DIR}/${audio}`);
  const browser = await chromium.launch({ args });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    permissions: ['microphone'],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

  // A switch the test can throw mid-session, the way a revoked permission or an
  // input claimed by another app refuses the next open.
  await page.addInitScript(() => {
    window.__denyMic = false;
    const media = navigator.mediaDevices;
    const original = media.getUserMedia.bind(media);
    media.getUserMedia = async (constraints) => {
      if (window.__denyMic) throw new DOMException('Permission denied', 'NotAllowedError');
      return original(constraints);
    };
  });
  await page.addInitScript((s) => {
    localStorage.setItem('daily-fret-storage', JSON.stringify({
      state: { currentAccountId: 'anonymous', accounts: { anonymous: s } }, version: 0,
    }));
    localStorage.setItem('daily-fret-coach-voice', '0');
  }, account);

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.task-container', { timeout: 30000 });
  return { browser, page, errors };
}

const openCoached = async (page) => {
  await page.getByRole('button', { name: /coached/i }).first().click();
  await page.waitForSelector('.practice-overlay', { timeout: 20000 });
};

/** Move past the rest between segments rather than waiting out its thirty seconds. */
async function skipRest(page) {
  const skip = page.locator('.coach-skip-rest');
  await skip.waitFor({ state: 'visible', timeout: 40000 });
  await skip.click();
}

// --- 1. the summary never reports a number it did not measure ---------------

console.log('\nA drill the microphone missed reports no number\n');
{
  const account = {
    activeRoutineId: 'r1',
    routines: [{
      id: 'r1', name: 'Session', description: '', isDefault: true,
      tasks: [
        { id: 't1', title: 'Changes', duration: '1 min', drill: { kind: 'one-minute-changes', chordFrom: 'Am', chordTo: 'Em', durationSec: 20 } },
        { id: 't2', title: 'Stretch', duration: '1 min', blocks: [{ id: 'b1', label: 'Stretch', durationSec: 8 }] },
        { id: 't3', title: 'More changes', duration: '1 min', drill: { kind: 'one-minute-changes', chordFrom: 'A', chordTo: 'D', durationSec: 5 } },
      ],
    }],
    // One old measurement, because the header's Coached control only appears
    // once something has ever been measured.
    dailyLogs: {
      '2026-08-01': {
        date: '2026-08-01', routineId: 'r1', completedTaskIds: [],
        drillResults: { 'pair:Am|Em': 24 },
      },
    },
    strumPatterns: [], songLinks: {}, userSongs: [], updatedAt: 1, capoFret: 0,
  };
  const { browser, page, errors } = await launch(account, { audio: 'changes.wav' });
  await openCoached(page);

  // Segment 1: measured, on real audio. Twenty seconds of drill, then the
  // results card and its five-second hand-off.
  await page.waitForSelector('.om-ring-live', { timeout: 30000 });
  await page.waitForTimeout(21_000);
  const heard = Number(/(\d+)/.exec(await page.locator('.om-ring-value').first().innerText())?.[1] ?? -1);
  check('the first drill counted something real', heard > 0, `counted ${heard}`);

  // The microphone goes away while the timed block is on screen, which is when
  // the coached session has already closed the shared capture.
  await skipRest(page);
  await page.waitForSelector('.practice-mode', { timeout: 40000 });
  await page.evaluate(() => { window.__denyMic = true; });
  await skipRest(page);

  // Segment 3 opens on the gate, because opening the microphone now fails.
  const timerBtn = page.locator('.practice-overlay').getByRole('button', { name: /timer/i }).first();
  await timerBtn.waitFor({ state: 'visible', timeout: 40000 });
  check('the last drill says the microphone did not open', true);
  await timerBtn.click();

  // Five-second blind block, then its hand-off, then the summary.
  await page.waitForSelector('.coach-summary-list', { timeout: 40000 });
  const rows = await page.locator('.coach-summary-row').evaluateAll((els) =>
    els.map((el) => ({
      name: el.querySelector('.coach-summary-name')?.textContent?.trim() ?? '',
      value: el.querySelector('.coach-summary-val')?.textContent?.trim() ?? null,
      open: el.classList.contains('is-open'),
    })),
  );
  console.log('    summary:', JSON.stringify(rows));
  const missed = rows.find((r) => r.name.includes('A') && r.name.includes('D'));
  check('the drill run blind has a row at all', !!missed, JSON.stringify(rows));
  if (missed) {
    check('and it carries no number, because none was taken', missed.value === null, String(missed.value));
    check('and it is not ticked off as done', missed.open === true);
  }
  const measuredRow = rows.find((r) => r.name.includes('Am') && r.name.includes('Em'));
  check('while the drill that was heard keeps its own number',
    !!measuredRow && measuredRow.value !== null, JSON.stringify(measuredRow));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// --- 2. Chord Perfect's click is read against the block it runs -------------

console.log('\nChord Perfect asks for a pace the player has actually reached\n');
{
  // Three sessions of Chord Perfect over five shapes, at 70, 72 and 74
  // placements. The block runs 100 seconds (five shapes, twenty each), so 74 is
  // 44.4 a minute, and the climbing branch asks for 46. Read against the
  // configured 90 it reads 49.3 a minute and asks for 51, which is above
  // anything the player has done.
  const dailyLogs = {};
  const days = ['2026-08-14', '2026-08-15', '2026-08-16'];
  [70, 72, 74].forEach((value, i) => {
    dailyLogs[days[i]] = {
      date: days[i], routineId: 'r1', completedTaskIds: [],
      drillResults: { 'pool:A|C|D|E|G': value },
    };
  });
  const account = {
    activeRoutineId: 'r1',
    routines: [{
      id: 'r1', name: 'Session', description: '', isDefault: true,
      tasks: [{
        id: 't1', title: 'Chord Perfect', duration: '2 mins',
        drill: { kind: 'chord-trainer', durationSec: 90, chords: ['A', 'C', 'D', 'E', 'G'] },
      }],
    }],
    dailyLogs, strumPatterns: [], songLinks: {}, userSongs: [], updatedAt: 1, capoFret: 0,
  };
  const { browser, page, errors } = await launch(account);
  await openCoached(page);
  await page.waitForSelector('.ct-stage', { timeout: 40000 });

  // The panel, not the trigger: the trigger reads "muted" when the browser is
  // holding audio, and what is under test is the prescription rather than
  // whether this headless Chromium let it sound.
  await page.locator('.metro-trigger').click();
  await page.waitForSelector('.metro-panel', { timeout: 10000 });
  const bpm = Number((await page.locator('.metro-bpm').innerText()).trim());
  const note = (await page.locator('.metro-note').innerText()).trim();
  console.log('    click:', bpm, 'BPM,', note);
  check('the click runs at the pace the hundred-second block justifies', bpm === 92,
    `${bpm} BPM (the configured-length reading is 102)`);
  check('and the reason names the same pace', /\b46\/min\b/.test(note), note);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// --- 3. a run the microphone could not hear never reaches the record --------
//
// The meter classifies the input as weak or unreadable all the way through every
// drill, and the classification was thrown away when the run ended. So a run of
// eleven changes through a failing microphone was written to the history exactly
// like a run of eleven played badly, and it then reset the readiness streak and
// pulled the next tempo prescription down. Three such runs are in the owner's
// July history.
//
// Asserted here rather than only in tests/unheardRun.test.mjs because the unit
// suite can only hold the judgement. What it cannot say is whether the app
// actually withholds the write, and the write is the whole defect: a version
// that draws the results screen correctly and files the number anyway would pass
// every unit test in the repository.

/** Today's log, as the app has actually written it. */
const todayLog = (page) =>
  page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('daily-fret-storage'));
    const logs = raw.state.accounts.anonymous.dailyLogs ?? {};
    const today = Object.keys(logs).sort().pop();
    return logs[today] ?? null;
  });

/** Three prior sessions worth 30 a minute, so there is a baseline to fall short of. */
const seededPair = () => {
  const logs = {};
  for (const date of ['2026-08-14', '2026-08-15', '2026-08-16']) {
    logs[date] = { date, routineId: 'r1', completedTaskIds: [], drillResults: { 'pair:Am|Em': 30 } };
  }
  return logs;
};

const unheardAccount = () => ({
  activeRoutineId: 'r1',
  routines: [{
    id: 'r1', name: 'Session', description: '', isDefault: true,
    tasks: [{
      id: 't1', title: 'Chord speed', duration: '1 min',
      drill: { kind: 'one-minute-changes', chordFrom: 'Am', chordTo: 'Em', durationSec: 24 },
    }],
  }],
  dailyLogs: seededPair(),
  strumPatterns: [], songLinks: {}, userSongs: [], updatedAt: 1, capoFret: 0,
});

console.log('\nA run taken through a microphone that could not hear it is not filed\n');
{
  const { browser, page, errors } = await launch(unheardAccount(), { audio: 'unreadable.wav' });
  await openCoached(page);
  await page.waitForSelector('.om-ring-live', { timeout: 30000 });
  await page.waitForSelector('.om-results', { timeout: 60000 });

  const counted = Number(/(\d+)/.exec(await page.locator('.om-ring-value').first().innerText())?.[1] ?? -1);
  const unfiled = await page.locator('.om-ring.is-unfiled').count();
  const caption = (await page.locator('.om-ring .om-caption').first().innerText()).trim();
  console.log('    counted:', counted, '| unfiled ring:', unfiled, '| caption:', JSON.stringify(caption));

  check('the run landed far under what the pair is recently worth', counted >= 0 && counted < 12,
    `counted ${counted} over 24s against a baseline of 30 a minute`);
  check('the ring says the number is not being kept', unfiled === 1);
  check('and says it in the same words the summary uses', /not counted/i.test(caption), caption);
  check('the microphone reading that caused it is on screen',
    (await page.locator('.om-results .signal-meter').count()) === 1);
  check('and Again is offered rather than only a countdown',
    (await page.locator('.coach-handoff button', { hasText: 'Again' }).count()) === 1);

  // The claim that matters. Let the hand-off expire and look at the store.
  await page.waitForSelector('.coach-rest-ring, .coach-summary-list', { timeout: 40000 });
  await page.waitForTimeout(500);
  const log = await todayLog(page);
  console.log('    today:', JSON.stringify(log));
  check('nothing at all was written for the pair',
    !!log && (log.drillResults?.['pair:Am|Em'] === undefined),
    JSON.stringify(log?.drillResults));
  check('and no run was appended to its history either',
    !!log && (log.drillRuns?.['pair:Am|Em'] === undefined),
    JSON.stringify(log?.drillRuns));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log('\nA run that was simply bad still is\n');
{
  // The same four changes, followed by silence instead of an unmatched chord. A
  // player who stopped is silent, not unheard. If this ever stops being written
  // the app has started hiding bad sessions from the person who played them.
  const { browser, page, errors } = await launch(unheardAccount(), { audio: 'quiet.wav' });
  await openCoached(page);
  await page.waitForSelector('.om-ring-live', { timeout: 30000 });
  await page.waitForSelector('.om-results', { timeout: 60000 });

  const counted = Number(/(\d+)/.exec(await page.locator('.om-ring-value').first().innerText())?.[1] ?? -1);
  console.log('    counted:', counted, '| unfiled ring:', await page.locator('.om-ring.is-unfiled').count());
  check('the run is just as far under the baseline', counted >= 0 && counted < 12, `counted ${counted}`);
  check('but the ring keeps it as a result', (await page.locator('.om-ring.is-unfiled').count()) === 0);

  await page.waitForSelector('.coach-rest-ring, .coach-summary-list', { timeout: 40000 });
  await page.waitForTimeout(500);
  const log = await todayLog(page);
  console.log('    today:', JSON.stringify(log?.drillResults));
  check('and the day records it, however bad it was',
    log?.drillResults?.['pair:Am|Em'] === counted,
    JSON.stringify(log?.drillResults));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures ? 1 : 0);
