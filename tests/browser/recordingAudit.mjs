// The claims this feature makes, driven rather than read.
//
// tests/browser/recording.mjs proves the happy path and tests/browser/footage.mjs
// proves a clip plays back. This file exists to attack the parts that were only
// ever reasoned about: the microphone the recorder borrows from a running drill,
// the race between a surface unmounting and a file being written, and the nine
// documented ways recording is supposed to fail without taking the practice down
// with it.
//
// The governing claim under test is the one the whole design rests on: the
// session is the product and the recording is a passenger. A passenger that can
// throw into a drill, silence a microphone, or delete footage it just wrote is
// not a passenger.
//
//   node tests/browser/recordingAudit.mjs
//
// Set PREVIEW_URL to point at a build.

import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changesTake, write } from './tone.mjs';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5199/';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const DIR = mkdtempSync(join(tmpdir(), 'daily-fret-audit-'));
write(`${DIR}/changes.wav`, [changesTake(['Am', 'Em'], 60, { repSec: 1.0, ringSec: 0.85 })]);

const TIMED_TASK = {
  id: 't1', title: 'Spider walk', duration: '1 mins',
  blocks: [{ id: 'b1', label: 'Spider walk', durationSec: 120 }],
};
const CHANGES_TASK = {
  id: 't2', title: 'Am to Em', duration: '1 min',
  drill: { kind: 'one-minute-changes', durationSec: 20, chordFrom: 'Am', chordTo: 'Em' },
};
const CHANGES_TASK_2 = {
  id: 't3', title: 'Em to Am', duration: '1 min',
  drill: { kind: 'one-minute-changes', durationSec: 20, chordFrom: 'Em', chordTo: 'Am' },
};

const account = (tasks) => ({
  activeRoutineId: 'r1',
  routines: [{ id: 'r1', name: 'Audit', description: '', isDefault: true, tasks }],
  dailyLogs: {}, strumPatterns: [], songLinks: [], userSongs: [], updatedAt: 1, capoFret: 0,
});

/**
 * A page with the app loaded, recording on, and every getUserMedia stream kept.
 *
 * `stub` runs before any app code and is where a failure is injected. Holding on
 * to the streams is what lets a test pull a camera out from under a running
 * recording, which is the only honest way to check what happens when one goes.
 */
async function open({
  tasks = [TIMED_TASK],
  quality = 'standard',
  enabled = true,
  audioFile = null,
  stub = null,
  recordings = [],
} = {}) {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required'];
  if (audioFile) args.push(`--use-file-for-fake-audio-capture=${audioFile}`);
  const browser = await chromium.launch({ args });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    permissions: ['microphone', 'camera'],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 180)));
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 180)));

  await page.addInitScript(() => {
    window.__gum = [];
    window.__streams = [];
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      // The drill's own capture asks for a single channel; the recorder's
      // fallback microphone does not. That one field is what tells a borrowed
      // microphone from a second session opened against the same input, which
      // is the distinction this whole file cares most about.
      const audio = constraints?.audio;
      window.__gum.push({
        audio: !!audio,
        video: !!constraints?.video,
        ownedByDrill: !!audio && typeof audio === 'object' && 'channelCount' in audio,
      });
      const stream = await real(constraints);
      window.__streams.push(stream);
      return stream;
    };
  });
  if (stub) await page.addInitScript(stub);
  await page.addInitScript(
    (s) => localStorage.setItem('daily-fret-storage', JSON.stringify({
      state: { currentAccountId: 'anonymous', accounts: { anonymous: s } }, version: 0,
    })),
    account(tasks),
  );
  await page.addInitScript(
    (s) => localStorage.setItem('daily-fret-recordings', JSON.stringify({ state: s, version: 0 })),
    {
      settings: { enabled, quality, keepSessions: 8, cameraId: null },
      recordings, lastPrune: null,
    },
  );

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForSelector('.task-container', { timeout: 25000 });
  return { browser, page, errors };
}

const library = (page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('daily-fret-recordings');
    return raw ? JSON.parse(raw).state : null;
  });

const filesOnDisk = (page) =>
  page.evaluate(async () => {
    if (!navigator.storage?.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    let dir;
    try {
      dir = await root.getDirectoryHandle('daily-fret-recordings');
    } catch {
      return [];
    }
    const out = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file') continue;
      const file = await handle.getFile();
      out.push({ name, size: file.size });
    }
    return out;
  });

const startTask = async (page, title) => {
  await page.locator('.task-row', { hasText: title }).locator('.task-go').click();
  await page.waitForSelector('.practice-overlay', { timeout: 20000 });
};

// ============================================================================
// Item 3: the audio clone path
// ============================================================================
console.log('\nthe microphone the recorder borrows\n');

{
  // First, the platform fact everything else rests on, asked of the browser
  // directly: stopping a cloned track must not stop the track it came from. If
  // this is false the whole design is unsound, and it would show up as a drill
  // going deaf the moment a recording ended.
  const { browser, page, errors } = await open();
  const clone = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const original = stream.getAudioTracks()[0];
    const copy = original.clone();

    const ctxA = new AudioContext();
    const analyser = ctxA.createAnalyser();
    ctxA.createMediaStreamSource(new MediaStream([original])).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const rms = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      return Math.sqrt(sum / buf.length);
    };

    await new Promise((r) => setTimeout(r, 700));
    const before = rms();
    copy.stop();
    await new Promise((r) => setTimeout(r, 700));
    const after = rms();

    const out = {
      cloneState: copy.readyState,
      originalState: original.readyState,
      before, after,
    };
    original.stop();
    await ctxA.close();
    return out;
  });

  check('a cloned audio track stops on its own', clone.cloneState === 'ended');
  check('and the track it was cloned from stays live',
    clone.originalState === 'live', clone.originalState);
  check('and still carries signal after the clone is stopped',
    clone.after > 0, `rms ${clone.before.toFixed(5)} before, ${clone.after.toFixed(5)} after`);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

{
  // Then the same question through the app: a coached run of two listening
  // drills. The clip key changes at the segment boundary, so the first recording
  // is stopped and a second started while the drill's microphone stays open. If
  // stopping a recording took the microphone with it, the second drill counts
  // nothing.
  const { browser, page, errors } = await open({
    tasks: [CHANGES_TASK, CHANGES_TASK_2],
    audioFile: `${DIR}/changes.wav`,
  });

  await page.locator('.progress-launch', { hasText: /Coached/ }).click();
  await page.waitForSelector('.practice-overlay', { timeout: 20000 });

  // Through the announcement and count-in of the first segment.
  await page.waitForSelector('.om-count', { timeout: 40000 });
  await page.waitForSelector('.capture-pill', { timeout: 25000 });
  await page.waitForTimeout(18_000);
  const firstCount = Number(
    /(\d+)/.exec(await page.locator('.om-count, .om-ring-value').first().innerText())?.[1] ?? -1,
  );

  // The rest between segments is long and its length is not this file's
  // business, so the second segment is waited for rather than slept past: the
  // counter leaves the DOM during the rest and comes back with the next drill.
  await page.waitForSelector('.om-count', { state: 'detached', timeout: 40_000 });
  await page.waitForSelector('.om-count', { timeout: 60_000 });
  await page.waitForTimeout(16_000);
  const secondCount = Number(
    /(\d+)/.exec(await page.locator('.om-count, .om-ring-value').first().innerText())?.[1] ?? -1,
  );

  check('the first drill counted changes while a camera rolled',
    firstCount >= 10, `counted ${firstCount}`);
  check('the second drill still counts after the first recording was filed',
    secondCount >= 10, `counted ${secondCount}`);

  const gum = await page.evaluate(() => window.__gum);
  // The real invariant. The app opens one microphone at a time and a coached run
  // of two listening drills legitimately opens one per segment; what must never
  // happen is the recorder opening one of its own alongside a drill that already
  // has the microphone, which is a second live session against the same input.
  const recorderOwnAudio = gum.filter((c) => c.audio && !c.ownedByDrill).length;
  check('the recorder never opened an audio session of its own',
    recorderOwnAudio === 0, `${recorderOwnAudio} of ${JSON.stringify(gum)}`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(2500);
  const lib = await library(page);
  check('both segments were filmed', (lib?.recordings?.length ?? 0) >= 2,
    `${lib?.recordings?.length} clips`);
  check('and both carry sound', (lib?.recordings ?? []).every((r) => r.hasAudio === true),
    JSON.stringify((lib?.recordings ?? []).map((r) => r.hasAudio)));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ============================================================================
// Item 8: the unmount race
// ============================================================================
console.log('\nleaving a drill with Escape, repeatedly\n');
//
// The defect this guards: the cleanup that gives the camera back used to call
// abort() straight away, which deleted the file stop() was still writing, so
// every recording made by leaving a drill with Escape vanished. It is a race, so
// once is not evidence. This runs it five times in a row.
{
  let survived = 0;
  const sizes = [];
  for (let run = 0; run < 5; run++) {
    const { browser, page } = await open();
    await startTask(page, 'Spider walk');
    await page.waitForSelector('.capture-pill', { timeout: 20000 });
    // Long enough for several chunks to have been written, which is the window
    // the race lived in.
    await page.waitForTimeout(5000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(3000);

    const lib = await library(page);
    const files = await filesOnDisk(page);
    const clip = lib?.recordings?.[0];
    if (clip && clip.bytes > 10_000 && files?.length === 1 && files[0].size === clip.bytes) {
      survived += 1;
      sizes.push(clip.bytes);
    } else {
      sizes.push(`run ${run}: clip ${clip?.bytes ?? 'none'}, disk ${JSON.stringify(files)}`);
    }
    await browser.close();
  }
  check('every Escape exit kept its footage, five times out of five',
    survived === 5, `${survived}/5 — ${JSON.stringify(sizes)}`);
}

{
  // The other end of the same race. Leaving while the camera is still opening
  // means the cleanup queues a stop against a start that has not returned, and
  // the recorder has to end up idle with nothing half-written behind it. The
  // wrong outcome here is not a lost clip but a camera left on.
  let clean = 0;
  const notes = [];
  for (let run = 0; run < 4; run++) {
    const { browser, page, errors } = await open();
    await startTask(page, 'Spider walk');
    // Deliberately inside the window where the camera is opening: no wait for
    // the pill, which is what appears once it is already rolling.
    await page.waitForTimeout(120 + run * 220);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(3500);

    const lib = await library(page);
    const files = await filesOnDisk(page);
    const cameraLeftOn = await page.evaluate(() => !!document.querySelector('video'));
    const rows = lib?.recordings?.length ?? 0;
    // Either a real clip or nothing at all. What must never survive is an index
    // row with no bytes, or bytes with no row.
    const consistent = rows === files.length
      && (lib?.recordings ?? []).every((r) => files.some((f) => f.name === r.location.key && f.size === r.bytes));

    if (consistent && !cameraLeftOn && errors.filter((e) => e.startsWith('PAGEERROR')).length === 0) {
      clean += 1;
    }
    notes.push(`${rows} rows / ${files.length} files${cameraLeftOn ? ' CAMERA ON' : ''}`);
    await browser.close();
  }
  check('leaving while the camera is still opening leaves nothing behind',
    clean === 4, `${clean}/4 — ${JSON.stringify(notes)}`);
}

// ============================================================================
// Item 7: the documented failure modes
// ============================================================================
console.log('\nthe nine ways it is allowed to fail\n');

/** Every failure mode ends the same way: a notice, and a drill still running. */
async function expectSurvivesFailure(label, options, expectations = {}) {
  const { browser, page, errors } = await open(options);
  await startTask(page, 'Spider walk');

  const notice = await page
    .waitForSelector('.capture-notice', { timeout: 20000 })
    .then(() => page.locator('.capture-notice').innerText())
    .catch(() => null);

  const stillRunning = (await page.locator('.practice-overlay').count()) === 1;
  const claimsToRecord = (await page.locator('.capture-pill').count()) > 0;

  check(`${label}: the drill is still running`, stillRunning);
  check(`${label}: nothing claims to be recording`, !claimsToRecord);
  if (expectations.notice !== false) {
    // Both halves, read separately. The recovery line is rendered from
    // `recoveryFor(error.kind)`, so its presence is what proves a structured
    // RecordingError with a kind the app recognises arrived here, rather than
    // some other throwable whose message happened to reach the screen.
    const head = await page.locator('.capture-notice-head').innerText().catch(() => '');
    const help = await page.locator('.capture-notice-help').innerText().catch(() => '');
    check(`${label}: it names the problem`, head.length > 12, head);
    check(`${label}: and carries the recovery for its kind`,
      help.length > 12 && help !== head, help);
  }

  // The practice itself must be logged regardless, which is the actual promise.
  await page.waitForTimeout(6500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  const logged = await page.evaluate(() => {
    const acc = JSON.parse(localStorage.getItem('daily-fret-storage')).state.accounts.anonymous;
    const day = Object.values(acc.dailyLogs)[0];
    return !!day?.taskRecords?.t1;
  });
  check(`${label}: the practice was still recorded in the log`, logged);
  check(`${label}: no uncaught page errors`,
    errors.filter((e) => e.startsWith('PAGEERROR')).length === 0,
    errors.join(' | '));

  const lib = await library(page);
  await browser.close();
  return { notice, lib };
}

await expectSurvivesFailure('permission denied', {
  stub: () => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Denied', 'NotAllowedError'));
  },
});

await expectSurvivesFailure('no camera', {
  stub: () => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('None', 'NotFoundError'));
  },
});

await expectSurvivesFailure('camera busy', {
  stub: () => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Busy', 'NotReadableError'));
  },
});

await expectSurvivesFailure('MediaRecorder unsupported', {
  stub: () => {
    delete window.MediaRecorder;
  },
});

await expectSurvivesFailure('no codec this browser will write', {
  stub: () => {
    window.MediaRecorder.isTypeSupported = () => false;
  },
});

await expectSurvivesFailure('an insecure context', {
  stub: () => {
    Object.defineProperty(window, 'isSecureContext', { get: () => false });
    Object.defineProperty(navigator, 'mediaDevices', { get: () => undefined });
  },
});

await expectSurvivesFailure('storage that is already full', {
  stub: () => {
    // The file is opened before the recorder starts, so a disk with no room is
    // reported before any footage exists to lose.
    FileSystemFileHandle.prototype.createWritable = () =>
      Promise.reject(new DOMException('No room', 'QuotaExceededError'));
    const idb = indexedDB.open;
    indexedDB.open = function (...a) {
      const req = idb.apply(this, a);
      if (a[0] === 'daily-fret-recordings') {
        setTimeout(() => req.onerror?.({ target: req }), 0);
      }
      return req;
    };
  },
});

// ============================================================================
// Item 7, second half: failures that arrive part-way through a recording
// ============================================================================
console.log('\nwhen it breaks with footage already on the disk\n');
//
// The claim being checked is the specific one the model makes: footage cut short
// is kept and says how it ended, rather than being discarded or offered as a
// complete take. Three ways that happens, and each has to produce both halves.

/** Film for a while, break something, then leave and read back what was filed. */
async function breakMidRecording(label, { stub, breakIt, expect }) {
  const { browser, page, errors } = await open({ stub });
  await startTask(page, 'Spider walk');
  await page.waitForSelector('.capture-pill', { timeout: 20000 });
  // Several chunks in, so there is real footage to either keep or lose.
  await page.waitForTimeout(6000);

  if (breakIt) await breakIt(page);
  await page.waitForTimeout(4000);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(3000);

  const lib = await library(page);
  const files = await filesOnDisk(page);
  const clip = lib?.recordings?.[0];

  check(`${label}: the footage up to that point was kept`,
    !!clip && clip.bytes > 10_000, clip ? `${clip.bytes} bytes` : 'nothing filed');
  check(`${label}: and the clip says how it ended`,
    clip?.endedBy === expect, `endedBy ${clip?.endedBy}, wanted ${expect}`);
  check(`${label}: the bytes are really on the disk`,
    files?.length === 1 && files[0].size === clip?.bytes,
    JSON.stringify(files));
  check(`${label}: no uncaught page errors`,
    errors.filter((e) => e.startsWith('PAGEERROR')).length === 0, errors.join(' | '));

  await browser.close();
}

await breakMidRecording('the camera is unplugged', {
  // Dispatched rather than calling stop(). Per spec `ended` fires when a track
  // stops for a reason outside the page's control, and stop() deliberately does
  // not fire it, which is what lets the recorder's own teardown stop a track
  // without being mistaken for a device going away. Unplugging fires it.
  breakIt: (page) => page.evaluate(() => {
    for (const s of window.__streams) {
      for (const t of s.getVideoTracks()) t.dispatchEvent(new Event('ended'));
    }
  }),
  expect: 'device-lost',
});

await breakMidRecording('the screen goes away', {
  stub: () => {
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
  },
  // A phone locking looks like this from inside: the track stays live and every
  // frame it hands over is black, which MediaRecorder reports as a mute.
  breakIt: (page) => page.evaluate(() => {
    for (const s of window.__streams) {
      for (const t of s.getVideoTracks()) t.dispatchEvent(new Event('mute'));
    }
  }),
  expect: 'hidden',
});

await breakMidRecording('the disk fills up part-way', {
  stub: () => {
    const real = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      const stream = await real.apply(this, args);
      let writes = 0;
      const write = stream.write.bind(stream);
      stream.write = (chunk) => {
        writes += 1;
        if (writes > 2) return Promise.reject(new DOMException('Full', 'QuotaExceededError'));
        return write(chunk);
      };
      return stream;
    };
  },
  // Nothing to break by hand: the write itself fails once enough chunks have
  // gone by, which is how a disk actually fills during a session.
  expect: 'storage-full',
});

// The one failure that must not stop the filming: no microphone to be had.
{
  const { browser, page, errors } = await open({
    stub: () => {
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (c) =>
        c?.video ? real(c) : Promise.reject(new DOMException('No mic', 'NotAllowedError'));
    },
  });
  await startTask(page, 'Spider walk');
  await page.waitForSelector('.capture-pill', { timeout: 20000 });
  await page.waitForTimeout(5000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(3000);

  const clip = (await library(page))?.recordings?.[0];
  check('a refused microphone still gets the session filmed',
    !!clip && clip.bytes > 10_000, clip ? `${clip.bytes} bytes` : 'nothing filed');
  check('and the clip says it has no sound on it',
    clip?.hasAudio === false, `hasAudio ${clip?.hasAudio}`);
  check('and it is not reported as a broken take',
    clip?.endedBy === 'complete', clip?.endedBy);
  check('no uncaught page errors',
    errors.filter((e) => e.startsWith('PAGEERROR')).length === 0, errors.join(' | '));
  await browser.close();
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
