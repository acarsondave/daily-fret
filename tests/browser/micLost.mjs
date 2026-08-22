// A microphone that dies part-way through a drill.
//
// The reported defect: only the tuner ever passed `onRouteChange`, so a chord
// drill was blind to its own input going away, and `watchRoute` listened for
// mute and unmute but never `ended` — which is the event a revoked permission
// or an unplugged interface actually fires. The frames stop, no error is
// raised, the context happily reports itself as running, and the screen goes on
// saying it is listening over a drill that scores zero.
//
// The kill below is the real thing rather than a stub: the track is stopped, so
// its readyState really is 'ended', and then the event a browser fires on that
// track is fired on it. Anything less would pass against the broken code, which
// was perfectly happy as long as nobody told it.
//
// Also here: a stored microphone that is busy. It used to hard-fail the drill,
// because NotReadableError was missing from the branch that falls back to the
// system default.
//
//   PREVIEW_URL=http://localhost:5401/ node tests/browser/micLost.mjs

import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5199/';
const KEY = 'daily-fret-storage';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};

const account = {
  activeRoutineId: 'r1',
  routines: [{
    id: 'r1', name: 'Module 4 Daily', description: '', isDefault: true,
    tasks: [
      { id: 't1', title: 'Chord Perfect', duration: '2 mins', drill: { kind: 'chord-trainer', durationSec: 60, chords: ['Am', 'Em'] } },
      { id: 't2', title: 'Strum timing', duration: '1 min', drill: { kind: 'strum-timing', durationSec: 120, bpm: 80 } },
      { id: 't3', title: 'Note finder', duration: '1 min', drill: { kind: 'note-finder', durationSec: 120 } },
    ],
  }],
  dailyLogs: {}, strumPatterns: [], songLinks: [], userSongs: [], updatedAt: 1,
  chordProfiles: [{ id: 'guitar-1', label: 'Steel', version: 1, createdAt: 1, updatedAt: 1, chords: {} }],
  activeProfileId: 'guitar-1',
  capoFret: 0,
};

async function open({ busyDeviceId = null } = {}) {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const ctx = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));

  // Hold on to every track handed out, so the test can kill the one the drill
  // is actually listening to. Optionally refuse an exact-device request the way
  // an input held by another app refuses one.
  await page.addInitScript((busy) => {
    window.__micTracks = [];
    window.__exactRequests = 0;
    const media = navigator.mediaDevices;
    const original = media.getUserMedia.bind(media);
    media.getUserMedia = async (constraints) => {
      const exact = constraints?.audio?.deviceId?.exact;
      if (exact) {
        window.__exactRequests += 1;
        if (busy && exact === busy) {
          throw new DOMException('Could not start audio source', 'NotReadableError');
        }
      }
      const stream = await original(constraints);
      window.__micTracks.push(...stream.getAudioTracks());
      return stream;
    };
    // What a revoked permission or an unplugged interface leaves behind: a
    // track whose readyState is 'ended', announced by an 'ended' event.
    window.__killMic = () => {
      const track = window.__micTracks[window.__micTracks.length - 1];
      if (!track) return false;
      track.stop();
      track.dispatchEvent(new Event('ended'));
      return true;
    };
  }, busyDeviceId);

  await page.addInitScript((args) => {
    localStorage.setItem(args.key, JSON.stringify({
      state: { currentAccountId: 'anonymous', accounts: { anonymous: args.account } },
      version: 0,
    }));
    if (args.preferred) localStorage.setItem('daily-fret-mic-device', args.preferred);
  }, { key: KEY, account, preferred: busyDeviceId });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.task-container', { timeout: 30000 });
  await page.waitForTimeout(600);
  return { browser, page, errors };
}

// Returns whether the drill reached the point of listening. A drill that never
// gets there is a failure to report, not an exception to die on: hard-failing
// instead of falling back is one of the defects under test.
const startDrill = async (page, title = 'Chord Perfect') => {
  await page.locator('.task-row', { hasText: title }).click();
  await page.waitForSelector('.practice-overlay', { timeout: 20000 });
  await page.locator('.practice-btn.primary').first().click();
  try {
    await page.waitForSelector('.signal-meter', { timeout: 20000 });
  } catch {
    return false;
  }
  await page.waitForTimeout(1200);
  return true;
};

const meterText = (page) => page.locator('.signal-meter .signal-label').first().innerText();

// --- the microphone dies mid-drill -----------------------------------------
{
  console.log('\na drill notices its microphone going away\n');
  const { browser, page, errors } = await open();
  const listening = await startDrill(page);

  check('the drill opened its microphone', listening === true);
  check(
    'the drill is listening to begin with',
    (await page.locator('.signal-meter.is-lost').count()) === 0,
    await meterText(page),
  );

  const killed = await page.evaluate(() => window.__killMic());
  check('the drill had a live track to lose', killed === true);
  await page.waitForTimeout(2200);

  // This used to assert the meter had turned red and said "microphone stopped",
  // and that was right until the drill stopped standing there saying it. A
  // chord drill can fall back to a clock, so a lost microphone now ends the run
  // where it stands and files the seconds as time played with no number, exactly
  // as a refused microphone does. The meter is gone because the run is.
  const body = (await page.locator('.practice-overlay').innerText()).toLowerCase();
  check(
    'the run ends rather than counting down over a dead microphone',
    (await page.locator('.mic-gate').count()) === 1,
    body.replace(/\n+/g, ' / ').slice(0, 110),
  );
  check('and it is filed as time played with no number', /time played|nothing counted/.test(body), body.slice(0, 90));
  // The claim underneath both versions of this test, and the one that must never
  // come back: a dead microphone must not be reported as bad playing.
  check(
    'nothing blames the playing for a microphone that is gone',
    !/too quiet|strum louder|move closer/.test(body),
    body.slice(0, 110),
  );
  check('nothing threw on the way', errors.length === 0, errors.join(' | '));

  await browser.close();
}

// --- a stored microphone that is busy --------------------------------------
{
  console.log('\na stored microphone held by another app\n');
  const { browser, page, errors } = await open({ busyDeviceId: 'busy-input' });
  const listening = await startDrill(page);

  check(
    'the stored device really was asked for, and refused',
    (await page.evaluate(() => window.__exactRequests)) > 0,
  );
  check(
    'the drill falls back to the default input and listens',
    listening === true &&
      (await page.locator('.signal-meter.is-lost').count()) === 0 &&
      (await page.locator('.mic-gate').count()) === 0,
    listening ? await meterText(page).catch(() => '') : 'the drill was left on the mic gate',
  );
  check('nothing threw on the way', errors.length === 0, errors.join(' | '));

  await browser.close();
}

// --- the same, for the drill with its own capture --------------------------
//
// Strum timing does not share the chord drills' microphone: it needs a band
// split and millisecond attack times, so it opens its own. Its capture never
// passed the route through, so this drill kept the exact defect the chord path
// had fixed. The frames stop, the meter freezes on its last reading, and the one
// drill in the app that grades rhythm goes on drawing a live signal over a
// microphone that has been revoked.
// Strum timing keeps the older shape on purpose, and the difference is not an
// oversight. It grades rhythm against a click and has no clock to fall back to,
// so there is no honest "run it blind" ending for it to take. What it must do is
// stop claiming to hear, which is what this checks. It writes no number either
// way: a run with no grid reports `enough: false` and nothing is stored.
{
  console.log('\nthe strum-timing drill notices it too\n');
  const { browser, page, errors } = await open();
  const listening = await startDrill(page, 'Strum timing');

  check('the drill opened its own microphone', listening === true);
  check(
    'the drill is listening to begin with',
    (await page.locator('.signal-meter.is-lost').count()) === 0,
    await meterText(page).catch(() => 'no meter'),
  );

  const killed = await page.evaluate(() => window.__killMic());
  check('the drill had a live track to lose', killed === true);
  await page.waitForTimeout(1800);

  check(
    'the meter stops saying the drill can hear',
    (await page.locator('.signal-meter.is-lost').count()) === 1,
    await meterText(page).catch(() => 'no meter'),
  );
  check(
    'and names what happened rather than blaming the playing',
    /microphone stopped/i.test(await meterText(page).catch(() => '')),
    await meterText(page).catch(() => 'no meter'),
  );
  check('nothing threw on the way', errors.length === 0, errors.join(' | '));

  await browser.close();
}

// --- the drill whose microphone is a pitch estimator ------------------------
//
// The note finder opens its own MicStream through usePitchDetector, which did
// not carry the route at all: it folded 'closed' into 'idle', and 'idle' is also
// what a detector reads before it has ever been started. So the one status the
// drill could see said "no microphone yet" for a microphone that had just been
// taken away, its own microphone-lost path could not fire, and the worst of the
// three ways to lose an input was the one left unhandled. The screen went back
// to asking for a permission the player had already granted, the clock kept
// running behind it, and at the end the run was filed as a measured one — a
// count of how much the player recalled through a dead microphone.
{
  console.log('\nthe note finder notices it too\n');
  const { browser, page, errors } = await open();
  await page.locator('.task-row', { hasText: 'Note finder' }).click();
  await page.waitForSelector('.practice-overlay', { timeout: 20000 });
  await page.locator('.practice-overlay').getByRole('button', { name: /^Start/ }).first().click();
  await page.waitForSelector('.nf-stage', { timeout: 20000 });
  await page.waitForTimeout(1500);

  const killed = await page.evaluate(() => window.__killMic());
  check('the drill had a live track to lose', killed === true);
  await page.waitForTimeout(2500);

  const body = (await page.locator('.practice-overlay').innerText()).toLowerCase();
  check(
    'the run ends rather than asking again for a permission it already has',
    !/allow microphone access/.test(body),
    body.replace(/\n+/g, ' / ').slice(0, 110),
  );
  check('and it is filed as time played with no number', /time played|nothing counted/.test(body), body.slice(0, 90));
  // The claim that matters, and the one the day carries afterwards. A run whose
  // input died must never leave 'measured' behind it: that word is what the
  // ladder, the readiness streak and the next prescription all read.
  const record = await page.evaluate(() => {
    const raw = localStorage.getItem('daily-fret-storage');
    const acc = raw ? JSON.parse(raw).state.accounts.anonymous : null;
    const key = Object.keys(acc?.dailyLogs ?? {}).sort().pop();
    return acc?.dailyLogs?.[key]?.taskRecords?.t3 ?? null;
  });
  check(
    'and the day records time played, never a measurement',
    record?.evidence === 'timed',
    JSON.stringify(record),
  );
  check('nothing threw on the way', errors.length === 0, errors.join(' | '));

  await browser.close();
}

console.log(failures ? `\n${failures} failed\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
