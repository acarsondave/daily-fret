// The chord chart that scrolls with the recording, driven in a real browser.
//
// A real YouTube embed cannot be relied on here: it needs the network, it shows
// ads, and nothing in it is deterministic. It does not have to be. The app talks
// to the recording through exactly one object, the IFrame API's player, and
// `loadYouTubeApi()` hands back whatever `window.YT` already is. So this test
// installs its own `window.YT` before the app boots and drives the chart from a
// clock it controls, through the same code path the real player uses. No
// test-only branch exists in the app for this.
//
//   npm run build && npx vite preview --port 4173
//   node tests/browser/songChart.mjs [outputDir]

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? 'tests/browser/.shots';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.PREVIEW_URL ?? 'http://localhost:4173/';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

// A fixture chart, not a real song: chords and bar lines only, so the test owns
// every number in it. Verse runs at one second a beat, chorus at three quarters
// of one, which is the case a single song-wide tempo would get wrong.
const timedSong = {
  id: 'u_timed',
  title: 'Timing Fixture',
  artist: 'Fixture',
  strum: 'DD',
  chords: ['A', 'D', 'E'],
  youtubeId: 'fixture0001',
  sections: [
    { label: 'Verse', atSeconds: 10, steps: [{ chord: 'A' }, { chord: 'D' }] },
    { label: 'Chorus', atSeconds: 18, steps: [{ chord: 'E' }, { chord: 'A' }, { chord: 'D' }] },
  ],
  endSeconds: 27,
};

const untimedSong = {
  id: 'u_untimed',
  title: 'Untimed Fixture',
  artist: 'Fixture',
  strum: 'DD',
  chords: ['A', 'D'],
  youtubeId: 'fixture0002',
  sections: [{ label: 'Verse', steps: [{ chord: 'A' }, { chord: 'D' }] }],
};

const account = () => ({
  activeRoutineId: 'r1',
  routines: [{
    id: 'r1', name: 'Songs', description: '', isDefault: true,
    tasks: [
      { id: 't1', title: 'Play along', drill: { kind: 'song', songId: 'u_timed', durationSec: 240 } },
      { id: 't2', title: 'Untimed song', drill: { kind: 'song', songId: 'u_untimed', durationSec: 240 } },
      // A built-in charted against a capo, for the key check at the foot of this file.
      { id: 't3', title: 'Song: Get Lucky', drill: { kind: 'song', songId: 'get-lucky', playOnly: true } },
    ],
  }],
  dailyLogs: {},
  userSongs: [timedSong, untimedSong],
  strumPatterns: [],
  songLinks: {},
  updatedAt: 1,
});

const seed = { currentAccountId: 'anonymous', accounts: { anonymous: account() } };

// The player, as the app is entitled to assume it behaves. Every method here is
// one the published IFrame API declares, with the documented return type.
const fakePlayer = () => {
  // The clock runs, the way a real one does. A player frozen at one number
  // would let a chart that never moved pass every assertion below.
  const control = {
    base: 0,
    baseWall: performance.now(),
    rate: 1,
    state: 1,
    seeks: [],
    rates: [],
    listeners: null,
    now() {
      if (this.state !== 1) return this.base;
      return this.base + ((performance.now() - this.baseWall) / 1000) * this.rate;
    },
    set(seconds) {
      this.base = seconds;
      this.baseWall = performance.now();
    },
  };
  window.__player = control;

  window.YT = {
    PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
    Player: class {
      constructor(el, opts) {
        control.listeners = opts.events ?? {};
        const frame = document.createElement('div');
        frame.setAttribute('data-fake-player', opts.videoId);
        frame.style.cssText = 'position:absolute;inset:0;background:#06141d';
        el.replaceWith(frame);
        setTimeout(() => {
          control.listeners.onReady?.({ target: this });
          control.listeners.onStateChange?.({ data: 1, target: this });
        }, 0);
      }
      playVideo() { control.set(control.now()); control.state = 1; }
      pauseVideo() { control.set(control.now()); control.state = 2; }
      getCurrentTime() { return control.now(); }
      getDuration() { return 300; }
      getPlayerState() { return control.state; }
      getPlaybackRate() { return control.rate; }
      getAvailablePlaybackRates() { return [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]; }
      setPlaybackRate(rate) {
        control.set(control.now());
        control.rate = rate;
        control.rates.push(rate);
        control.listeners.onPlaybackRateChange?.({ data: rate, target: this });
      }
      // A real player moves when it is told to seek, and so does this one: the
      // section loop is only proved by the chart coming back round afterwards.
      seekTo(seconds) {
        control.seeks.push(seconds);
        control.set(seconds);
      }
      destroy() {}
    },
  };
};

// Firebase is not configured in a preview build, and says so once on boot. It
// is the environment talking, not this screen, and the app is designed to carry
// on locally without it.
const ours = (message) => !/Firebase|Cloud sync unavailable/i.test(message);

const browser = await chromium.launch();

async function open(viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && ours(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => ours(String(e)) && errors.push(String(e)));
  await page.addInitScript(fakePlayer);
  await page.addInitScript(
    (s) => localStorage.setItem('daily-fret-storage', JSON.stringify({ state: s, version: 0 })),
    seed,
  );
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.task-container');
  return { ctx, page, errors };
}

const startSong = async (page, title) => {
  await page.locator('.task-row', { hasText: title }).click();
  await page.waitForSelector('.practice-overlay');
  await page.getByRole('button', { name: 'Start play-along' }).click();
};

// Put the recording at a given second and let the clock poll, project and paint.
// It keeps running from there, so assertions sit comfortably inside a bar.
const seekTo = async (page, seconds) => {
  await page.evaluate((t) => window.__player.set(t), seconds);
  await page.waitForTimeout(420);
};

// Text as the stylesheet renders it is not text as the component wrote it: the
// section chip is uppercased in CSS, and innerText would report the transform.
const words = (page, selector) => page.locator(selector).evaluate((el) => el.textContent.trim());

const sideways = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// --- the chart follows the record -----------------------------------------
{
  console.log('\nThe chart follows the record\n');
  const { ctx, page, errors } = await open();
  await startSong(page, 'Play along');

  check('the recording is on screen, at a real size', await page.locator('[data-fake-player]').isVisible());
  await page.waitForSelector('.chart-ribbon');
  check('the chart is there too', await page.locator('.chart').isVisible());

  const chord = () => words(page, '.chart-now-chord');
  const next = () => words(page, '.chart-next-chord');

  await seekTo(page, 8);
  check('before the first bar the player is counted in',
    await page.locator('.chart-countin-number').isVisible());
  check('and told what it opens on', (await next()) === 'A');

  await seekTo(page, 11);
  check('the first bar is the first chord', (await chord()) === 'A');
  // The decision the whole layout exists for: the chord after this one is named
  // while there is still a bar in which to move a hand to it.
  check('the next chord is announced a bar early', (await next()) === 'D');
  // Landing mid-bar after a seek is counted in too, then the count clears
  // itself on the downbeat rather than sitting over the chart.
  check('a seek is counted back in', await page.locator('.chart-countin-number').isVisible());
  const cleared = await page.locator('.chart-countin-number')
    .waitFor({ state: 'detached', timeout: 8000 }).then(() => true, () => false);
  check('and the count clears at the downbeat', cleared);

  await seekTo(page, 15);
  check('the chart moves on with the record', (await chord()) === 'D');
  check('and keeps announcing ahead', (await next()) === 'E');

  // The chorus runs at a different tempo from the verse. A chart extrapolated
  // from one tempo would be a bar out by here; anchored per section it is not.
  await seekTo(page, 19);
  check('a section with its own tempo still lands right', (await chord()) === 'E');
  check('the section label follows the playhead', (await words(page, '.song-pass')) === 'Chorus');

  await seekTo(page, 25);
  check('the last bar is the last chord', (await chord()) === 'D');
  check('and nothing is announced after it', (await page.locator('.chart-next').count()) === 0);

  await seekTo(page, 40);
  check('past the end the chart says so', (await chord()) === 'End');

  check('nothing is ever scored', (await page.locator('text=Not graded, just play').count()) > 0);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${OUT}/song-chart.png` });
  await ctx.close();
}

// --- the ribbon actually moves --------------------------------------------
{
  console.log('\nThe ribbon moves between polls, not in steps\n');
  const { ctx, page, errors } = await open();
  await startSong(page, 'Play along');
  // Attached, not visible: the track is a zero-width origin whose bars are all
  // positioned off it, which is what lets one transform move the whole chart.
  await page.waitForSelector('.chart-track', { state: 'attached' });
  await seekTo(page, 12);

  const offset = () => page.evaluate(() => {
    const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.chart-track')).transform);
    return m.m41;
  });

  const a = await offset();
  await page.waitForTimeout(120);
  const b = await offset();
  await page.waitForTimeout(120);
  const c = await offset();
  // The player is only asked the time four times a second. If the chart moved
  // only when it was told, these would come back equal and the ribbon would
  // visibly stutter beside a video that does not.
  check('the ribbon is moving', b < a && c < b, `${a.toFixed(1)} ${b.toFixed(1)} ${c.toFixed(1)}`);
  check('and moving leftwards, at about the right pace',
    Math.abs((a - c) / 0.24) > 8 && Math.abs((a - c) / 0.24) < 120,
    `${((a - c) / 0.24).toFixed(1)} px/s`);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- speed and loop --------------------------------------------------------
{
  console.log('\nSlowing it down and looping a section\n');
  const { ctx, page, errors } = await open();
  await startSong(page, 'Play along');
  await page.waitForSelector('.pbc');
  await seekTo(page, 19);

  check('speed reads full speed to start', (await words(page, '.pbc-rate-value')) === '1x');
  await page.getByRole('button', { name: 'Slower' }).click();
  await page.waitForTimeout(360);
  check('one step down is three quarter speed', (await words(page, '.pbc-rate-value')) === '0.75x');
  check('and the player was actually told',
    (await page.evaluate(() => window.__player.rate)) === 0.75);
  check('the control says the pitch survives',
    (await words(page, '.pbc-rate-label')).includes('in key'));
  await page.getByRole('button', { name: 'Back to full speed' }).click();
  await page.waitForTimeout(360);
  check('and it comes straight back', (await page.evaluate(() => window.__player.rate)) === 1);

  const loop = page.locator('.pbc-loop');
  check('the loop names the section you are in', (await words(page, '.pbc-loop')).includes('Chorus'));
  await loop.click();
  check('arming it says so', (await words(page, '.pbc-loop')).includes('Looping'));

  await seekTo(page, 26.9);
  await page.waitForTimeout(500);
  const seeks = await page.evaluate(() => window.__player.seeks);
  check('running past the section sends it round again', seeks.length > 0, `${seeks.length} seeks`);
  check('landing a hair before the downbeat, not after it',
    seeks[0] > 17.5 && seeks[0] < 18, `${seeks[0]}`);
  await page.waitForTimeout(400);
  check('and the chart is back in the chorus', (await words(page, '.chart-now-chord')) === 'E');
  check('one seek per lap, not one per frame', (await page.evaluate(() => window.__player.seeks.length)) < 4);

  await loop.click();
  check('turning it off releases the song', (await words(page, '.pbc-loop')).includes('Loop Chorus'));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- a chart with no timing ------------------------------------------------
{
  console.log('\nA chart nobody has timed\n');
  const { ctx, page, errors } = await open();
  await startSong(page, 'Untimed song');
  await page.waitForSelector('[data-fake-player]');
  await page.waitForTimeout(400);
  check('there is no chart', (await page.locator('.chart-ribbon').count()) === 0);
  // Explicit and visible. The alternative is a chart scrolling to approximately
  // the right place, which is trusted and then blamed on the player's hands.
  check('and the screen says why', await page.locator('.song-untimed').isVisible());
  check('the play-along still works as it always did',
    await page.locator('[data-fake-player]').isVisible());
  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- what the day records about a play-along -------------------------------
//
// The play-along has no clock and no microphone, so the only fact the app owns
// is how it ended. It used to file both endings identically, with reachedEnd
// true: tapping Done ten seconds in put "the clock ran out" on the day, which
// the task row then reads as a completed timed block and the points model reads
// as time witnessed rather than the player's word.
const readRecord = (page, taskId) =>
  page.evaluate((id) => {
    const raw = localStorage.getItem('daily-fret-storage');
    if (!raw) return null;
    const acc = JSON.parse(raw).state.accounts.anonymous;
    const day = Object.values(acc.dailyLogs ?? {})[0];
    return day?.taskRecords?.[id] ?? null;
  }, taskId);

{
  console.log('\nEnding the record, and ending it early\n');
  {
    const { ctx, page } = await open({ width: 1280, height: 900 });
    await startSong(page, 'Play along');
    await page.waitForSelector('[data-fake-player]');
    // The recording runs out on its own.
    await page.evaluate(() => window.__player.listeners.onStateChange({ data: 0, target: null }));
    await page.waitForSelector('.coach-intro-title, .om-results', { timeout: 10000 });
    await page.locator('.practice-close').last().click();
    await page.waitForTimeout(400);
    const record = await readRecord(page, 't1');
    check('a record that ran out is filed as a clock that reached its end',
      record?.ranToEnd === true, JSON.stringify(record));
    await ctx.close();
  }
  {
    const { ctx, page } = await open({ width: 1280, height: 900 });
    await startSong(page, 'Play along');
    await page.waitForSelector('[data-fake-player]');
    await page.waitForTimeout(600);
    // The player decides they are finished instead.
    await page.locator('.song-real-foot .practice-btn.primary').click();
    await page.waitForTimeout(400);
    await page.locator('.practice-close').last().click();
    await page.waitForTimeout(400);
    const record = await readRecord(page, 't1');
    check('tapping Done is the player\'s word, not a clock that ran out',
      record?.ranToEnd !== true, JSON.stringify(record));
    check('and it still counts the play-along as done',
      record?.stated === true, JSON.stringify(record));
    await ctx.close();
  }
}

// --- phones ----------------------------------------------------------------
{
  console.log('\nOn the phone it is actually used on\n');
  for (const width of [360, 390, 430]) {
    const { ctx, page, errors } = await open({ width, height: width === 360 ? 640 : 844 });
    await startSong(page, 'Play along');
    await page.waitForSelector('.chart-ribbon');
    await seekTo(page, 15);

    check(`${width}: no sideways scroll`, (await sideways(page)) <= 0);
    const box = await page.locator('.chart-ribbon').boundingBox();
    check(`${width}: the ribbon fits the screen`, box.x >= 0 && box.x + box.width <= width + 1,
      `${box.x.toFixed(0)}..${(box.x + box.width).toFixed(0)}`);
    const controls = await page.locator('.pbc').boundingBox();
    check(`${width}: the controls fit too`,
      controls.x >= 0 && controls.x + controls.width <= width + 1);
    const foot = await page.locator('.song-real-foot').boundingBox();
    const view = page.viewportSize();
    check(`${width}: nothing is pushed off the bottom`, foot.y + foot.height <= view.height + 1,
      `${(foot.y + foot.height).toFixed(0)} of ${view.height}`);
    const video = await page.locator('.song-real-video').boundingBox();
    check(`${width}: the recording is still a real size`, video.height >= 150,
      `${video.height.toFixed(0)}px tall`);
    check(`${width}: no console errors`, errors.length === 0, errors.join(' | '));
    await page.screenshot({ path: `${OUT}/song-chart-${width}.png` });
    await ctx.close();
  }
}

// --- the key a chart is written in -----------------------------------------
//
// Get Lucky is charted in A minor against a record in B minor. Without a capo on
// the second fret the shapes are a whole tone under the recording and clash on
// every chord, and for a while nothing on the screen said so: the Song type
// carried a `capo` and no surface read it. The capo is drawn on each shape now,
// because it is a fact about how that shape is fretted, and the one thing a
// picture cannot carry, that the clamp on the actual neck is somewhere else, is
// a line that only appears when the two disagree.
{
  console.log('\nThe key a chart is written in\n');
  for (const [fret, expectNote] of [[0, true], [2, false]]) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 572 } });
    const page = await ctx.newPage();
    await page.addInitScript(fakePlayer);
    await page.addInitScript(
      (s) => localStorage.setItem('daily-fret-storage', JSON.stringify({ state: s, version: 0 })),
      { ...seed, accounts: Object.fromEntries(Object.entries(seed.accounts).map(
        ([id, a]) => [id, { ...a, capoFret: fret }])) },
    );
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.task-container');
    const go = page.getByRole('button', { name: /Start .*Get Lucky/i }).first();
    if (!(await go.count())) {
      check('Get Lucky is in the routine under test', false, 'no task found');
      await ctx.close();
      continue;
    }
    await go.click();
    await page.waitForSelector('.practice-overlay', { timeout: 20000 });
    await page.waitForTimeout(1200);
    check(`capo ${fret}: the capo is drawn on every shape`,
      (await page.locator('.practice-overlay .cd-capo').count()) === 4,
      `${await page.locator('.practice-overlay .cd-capo').count()} drawn`);
    check(`capo ${fret}: the line appears only when the clamp disagrees`,
      (await page.locator('.song-capo-note').count() > 0) === expectNote);
    await ctx.close();
  }
}

await browser.close();
console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
