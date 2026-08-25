// Chart mode, reached the way the owner actually reaches a song.
//
// The defect this suite exists for is not a broken function. It is that the
// feature was invisible: the synced chart shipped, every song returned
// no-anchors so it never once ran, a coached session went straight to the video,
// and the owner concluded after a fortnight that the song work had never been
// built. So the assertions here are about a person finding it and it working,
// from inside a coached session, which is the only surface he uses.
//
// It serves the real build rather than a dev server, because the offline state
// it checks is a property of the shipped bundle.
//
//   npm run build && node tests/browser/songChartMode.mjs

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const DIST = 'dist';
let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('no dist — run `npm run build` first');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json',
};
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, path === '/' ? 'index.html' : path);
  if (!existsSync(file) || !statSync(file).isFile()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// Three Little Birds: 74 bpm, six arrows to a bar, no video of its own. Its
// strum is arrow art rather than a slot grid, so no strum segment is inserted
// ahead of it and the song is the first thing a coached session opens.
const SONG = 'three-little-birds';
const account = {
  activeRoutineId: 'r1',
  currentLesson: 'b1-403',
  routines: [{
    id: 'r1', name: 'Session', description: '', isDefault: true,
    tasks: [{ id: 't1', title: 'Three Little Birds', duration: '5 mins', drill: { kind: 'song', songId: SONG } }],
  }],
  // The header's Coached control only appears once something has ever been
  // measured, so the session has a way in.
  dailyLogs: {
    '2026-08-01': {
      date: '2026-08-01', routineId: 'r1', completedTaskIds: [],
      drillResults: { 'pair:Am|Em': 24 },
    },
  },
  strumPatterns: [], songLinks: {}, userSongs: [], updatedAt: 1, capoFret: 0,
};

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 220)));
// Every buffer the app actually hands the audio thread, with the moment it was
// scheduled for. This is how the sound is observed rather than assumed: the
// chord voice's buffer length is set by how many strings the shape sounds, and
// A, D and E sound five, four and six, so the length names the chord.
await page.addInitScript(() => {
  window.__scheduled = [];
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, ...rest) {
    if (this.buffer) {
      window.__scheduled.push({
        when,
        length: this.buffer.length,
        rate: this.context.sampleRate,
      });
    }
    return start.call(this, when, ...rest);
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

/** Every word of interface copy on the mode choice, miniature content aside. */
const copyWords = async () => {
  const labels = await page.locator('.song-mode-name').allInnerTexts();
  return labels.join(' ').trim().split(/\s+/).filter(Boolean).length;
};

const transform = (selector) => page.evaluate(
  (sel) => document.querySelector(sel)?.style.transform ?? null, selector,
);

console.log('\nA coached session offers both ways to play, without being asked\n');
{
  await page.getByRole('button', { name: /coached/i }).first().click();
  await page.waitForSelector('.practice-overlay', { timeout: 20000 });
  await page.waitForSelector('.song-modes', { timeout: 30000 });

  const cards = page.locator('.song-mode');
  check('the song segment opens on the choice, not on a video',
    (await cards.count()) === 2, `${await cards.count()} cards`);
  check('and no video is on screen yet', (await page.locator('.song-real-video').count()) === 0);
  check('one of them is the chart', await page.locator('.song-mode.is-chart').isVisible());
  check('and it says what it gives you',
    (await page.locator('.song-mode.is-chart .song-mode-name').innerText()).trim() === 'Play the song');
  check('the other is the record',
    (await page.locator('.song-mode.is-record .song-mode-name').innerText()).trim() === 'Play with the band');

  // Show, not tell: the card is the chart at a quarter scale, already running.
  check('the chart card carries a miniature of the chart itself',
    await page.locator('.chart-mini').isVisible());
  const first = await transform('.chart-mini-track');
  await page.waitForTimeout(450);
  const second = await transform('.chart-mini-track');
  check('and the miniature is moving', first !== null && second !== null && first !== second,
    `${first} then ${second}`);
  check('it draws this song, not a stand-in',
    (await page.locator('.chart-mini-chord').first().innerText()).trim() === 'A');

  // The whole choice is two labels and nothing else: no paragraph explaining a
  // mode, no sentence about what is or is not available. The chord letters
  // inside the miniature are the chart's own content and not interface copy.
  check('the whole choice is seven words', (await copyWords()) === 7, `${await copyWords()} words`);
  check('and nothing on it is a sentence',
    (await page.locator('.song-modes p').count()) === 0);
}

console.log('\nWith no connection the record is struck out, and nothing is explained\n');
{
  await ctx.setOffline(true);
  await page.waitForTimeout(300);
  check('the record card cannot be picked',
    await page.locator('.song-mode.is-record').isDisabled());
  check('and it is struck through', await page.locator('.song-mode-strike').isVisible());
  check('the strike is drawn at the icon set\'s own pen',
    (await page.locator('.song-mode-strike line').getAttribute('stroke-width')) === '1.75');
  check('and going offline added no words at all', (await copyWords()) === 7, `${await copyWords()} words`);
  check('and no sentence appeared either', (await page.locator('.song-modes p').count()) === 0);
  // Never dim text to say a thing is unavailable.
  const opacity = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.song-mode.is-record .song-mode-name')).opacity);
  check('nor dimmed the label to say so', opacity === '1', opacity);
  check('the chart is still there to pick', await page.locator('.song-mode.is-chart').isEnabled());
  await ctx.setOffline(false);
  await page.waitForTimeout(300);
  check('and the record comes back when the connection does',
    await page.locator('.song-mode.is-record').isEnabled());
}

console.log('\nPicking the chart plays the song\n');
{
  await page.locator('.song-mode.is-chart').click();
  await page.waitForSelector('.song-real.is-chartmode .chart', { timeout: 20000 });
  check('the chart is on screen', await page.locator('.chart').isVisible());

  // The count-in is the clock starting a bar early, so the chart's own count-in
  // draws itself with nothing added to the timeline and no new UI.
  let countedIn = true;
  try {
    await page.locator('.chart-countin-number').waitFor({ state: 'visible', timeout: 3000 });
  } catch {
    countedIn = false;
  }
  check('and it counts you in before the first bar', countedIn);

  const before = await transform('.chart-track');
  await page.waitForTimeout(700);
  const after = await transform('.chart-track');
  check('the chart advances on the app\'s own clock', before !== after, `${before} then ${after}`);

  // The tempo, drawn as a fraction of this song's own pace.
  check('the pace is the song\'s own written tempo',
    (await page.locator('.song-pace-value').innerText()).trim() === '74',
    await page.locator('.song-pace-value').innerText());
  const fill = await page.evaluate(() => document.querySelector('.song-pace-fill').style.transform);
  check('and the bar is full at full pace', fill === 'scaleX(1)', fill);

  // Slow it down: the fraction has to move with it.
  await page.locator('.pbc-step').first().click();
  await page.waitForTimeout(250);
  const slowed = (await page.locator('.song-pace-value').innerText()).trim();
  const slowedFill = await page.evaluate(() => document.querySelector('.song-pace-fill').style.transform);
  check('slowing down draws a smaller fraction of the same song',
    Number(slowed) < 74 && Number(slowed) > 40, slowed);
  check('and the fill follows it', slowedFill !== 'scaleX(1)' && slowedFill.startsWith('scaleX(0.9'), slowedFill);

  // The chart kept its place through the pace change rather than restarting.
  const moved = await transform('.chart-track');
  await page.waitForTimeout(600);
  check('and the chart keeps running at the new pace', (await transform('.chart-track')) !== moved);

  const click = page.locator('.song-click');
  check('the click is off under the backing', (await click.getAttribute('aria-pressed')) === 'false');
  await click.click();
  check('and it can be turned on', (await click.getAttribute('aria-pressed')) === 'true');

  check('nothing about the song is scored',
    (await page.locator('.song-real.is-chartmode').innerText()).includes('Not graded'));
}

console.log('\nThe chord that reaches the speaker is the chord on the chart\n');
{
  // Back to full pace and let it play, so the comparison is against the song's
  // own tempo rather than against a fraction of it.
  await page.locator('.pbc-rate').click();
  await page.evaluate(() => { window.__scheduled = []; });
  await page.waitForTimeout(14_000);

  const scheduled = await page.evaluate(() => window.__scheduled);
  const rate = scheduled.length ? scheduled[0].rate : 48000;
  // A down stroke's buffer is the ring plus one string gap for each string after
  // the first, so its length says how many strings the shape sounds. A sounds
  // five, D four and E six, which is the whole of this song.
  const lengthFor = (strings) => Math.ceil(1.5 * rate) + Math.round((strings - 1) * 0.004 * rate);
  const NAMES = new Map([[lengthFor(4), 'D'], [lengthFor(5), 'A'], [lengthFor(6), 'E']]);
  const chords = scheduled
    .filter((s) => NAMES.has(s.length))
    .map((s) => ({ when: s.when, chord: NAMES.get(s.length) }));

  check('the app actually put chords on the audio thread', chords.length >= 3,
    `${chords.length} of ${scheduled.length} sources`);

  if (chords.length >= 3) {
    // Three Little Birds is A A D A E A, one chord to a bar, so the strokes have
    // to arrive in that order and a bar apart at 74 beats to the minute.
    const heard = chords.map((c) => c.chord).join('');
    const written = 'AADAEAAADAEAAADAEA';
    check('and they are this song\'s chords, in this song\'s order',
      written.includes(heard) || heard.length === 0, `heard ${heard}`);

    const bar = (60 / 74) * 4;
    const gaps = chords.slice(1).map((c, i) => c.when - chords[i].when);
    const off = gaps.filter((g) => Math.abs(g - bar) > 0.02);
    check('a bar apart, at the song\'s own tempo', off.length === 0,
      `${gaps.map((g) => g.toFixed(3)).join(', ')} against ${bar.toFixed(3)}`);

    // And the chart agrees with what was just played.
    const onScreen = (await page.locator('.chart-now-chord').innerText()).trim();
    check('and the chart is drawing one of them', ['A', 'D', 'E'].includes(onScreen), onScreen);
  }
}

console.log('\nThe other mode is one tap away, drawn and not written\n');
{
  const swap = page.locator('.song-mode-swap');
  check('the record is reachable from inside the chart', await swap.isVisible());
  check('and the control is a mark, not a word',
    (await swap.innerText()).trim() === '', await swap.innerText());
  await swap.click();
  await page.waitForSelector('.song-real:not(.is-chartmode)', { timeout: 20000 });
  check('tapping it goes to the record stage',
    (await page.locator('.song-real-link, .song-real-video').count()) > 0);
  check('and the chart is reachable back from there',
    await page.locator('.song-mode-swap').isVisible());
}

check('the app logged no errors on the way through', errors.length === 0, errors.slice(0, 2).join(' | '));

await ctx.close();
await browser.close();
await new Promise((r) => server.close(r));
console.log(failures ? `\n${failures} failed\n` : '\nall good\n');
process.exit(failures ? 1 : 0);
