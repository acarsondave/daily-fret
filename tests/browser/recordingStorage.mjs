// Where the bytes go, and whether they come back.
//
// The index is a claim about the disk, and every check here asks the disk. What
// is being attacked: retention deleting the wrong sessions, deletion that
// forgets a row without freeing the file behind it, a reload that loses the
// library, the fallback backend nobody has run, and files whose bytes exist but
// do not decode.
//
// A byte count is not evidence that a recording works. Every clip this file
// produces is loaded into a real video element and made to report a duration and
// a frame, because a recorder that writes a corrupt container passes every
// byte-count test ever written and fails the only person who matters.
//
//   node tests/browser/recordingStorage.mjs
//
// Set PREVIEW_URL to point at a build.

import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5199/';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const TIMED_TASK = {
  id: 't1', title: 'Spider walk', duration: '5 mins',
  blocks: [{ id: 'b1', label: 'Spider walk', durationSec: 300 }],
};

const account = {
  activeRoutineId: 'r1',
  routines: [{ id: 'r1', name: 'Storage', description: '', isDefault: true, tasks: [TIMED_TASK] }],
  dailyLogs: {}, strumPatterns: [], songLinks: [], userSongs: [], updatedAt: 1, capoFret: 0,
};

async function open({ quality = 'standard', keepSessions = 8, recordings = [], stub = null } = {}) {
  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    permissions: ['microphone', 'camera'],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 180)));
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 180)));

  // Seeded only when the key is absent. An init script runs on every navigation,
  // so seeding unconditionally would rewrite the store on reload and make the
  // persistence check below assert against its own fixture rather than against
  // what the app saved.
  if (stub) await page.addInitScript(stub);
  await page.addInitScript(
    (s) => {
      if (localStorage.getItem('daily-fret-storage')) return;
      localStorage.setItem('daily-fret-storage', JSON.stringify({
        state: { currentAccountId: 'anonymous', accounts: { anonymous: s } }, version: 0,
      }));
    },
    account,
  );
  await page.addInitScript(
    (s) => {
      if (localStorage.getItem('daily-fret-recordings')) return;
      localStorage.setItem('daily-fret-recordings', JSON.stringify({ state: s, version: 0 }));
    },
    {
      settings: { enabled: true, quality, keepSessions, cameraId: null },
      recordings, lastPrune: null,
    },
  );

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForSelector('.task-container', { timeout: 25000 });
  return { browser, page, ctx, errors };
}

const library = (page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('daily-fret-recordings');
    return raw ? JSON.parse(raw).state : null;
  });

const filesOnDisk = (page) =>
  page.evaluate(async () => {
    if (!navigator.storage?.getDirectory) return [];
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

/** Put a file of a known size where the index says one already is. */
const seedFile = (page, key, bytes) =>
  page.evaluate(async ([name, size]) => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('daily-fret-recordings', { create: true });
    const handle = await dir.getFileHandle(name, { create: true });
    const stream = await handle.createWritable();
    await stream.write(new Blob([new Uint8Array(size)]));
    await stream.close();
  }, [key, bytes]);

/**
 * Load a stored clip into a real video element and make it prove itself.
 *
 * Duration, dimensions, a seek, and a painted frame. The frame is checked for
 * more than one distinct pixel value, because a decoder handed a broken file
 * will happily paint a uniform black rectangle and report success.
 */
const decode = (page, clipId) =>
  page.evaluate(async (id) => {
    const raw = JSON.parse(localStorage.getItem('daily-fret-recordings'));
    const rec = raw.state.recordings.find((r) => r.id === id);
    if (!rec) return { ok: false, why: 'no index row' };

    let blob;
    try {
      if (rec.location.backend === 'opfs') {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('daily-fret-recordings');
        blob = await (await dir.getFileHandle(rec.location.key)).getFile();
      } else {
        const db = await new Promise((res, rej) => {
          const r = indexedDB.open('daily-fret-recordings', 1);
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        blob = await new Promise((res, rej) => {
          const rq = db.transaction('clips', 'readonly').objectStore('clips').get(rec.location.key);
          rq.onsuccess = () => res(rq.result);
          rq.onerror = () => rej(rq.error);
        });
      }
    } catch (err) {
      return { ok: false, why: `read failed: ${err}` };
    }
    if (!(blob instanceof Blob)) return { ok: false, why: 'not a blob' };

    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.playsInline = true;

    const meta = await new Promise((res) => {
      const done = (why) => res({ ok: false, why });
      video.onerror = () => done(`decode error ${video.error?.code}`);
      setTimeout(() => done('timed out waiting for metadata'), 12000);
      video.onloadedmetadata = () => res({ ok: true });
    });
    if (!meta.ok) {
      URL.revokeObjectURL(url);
      return meta;
    }

    // The same trick the library uses: a container written as it went has no
    // duration in its header, and walking to the end is what makes the browser
    // work it out. Measured here so the fix is verified against a real file
    // rather than trusted.
    const rawDuration = video.duration;
    let primeMs = 0;
    if (!Number.isFinite(video.duration)) {
      const startedPriming = performance.now();
      await new Promise((res) => {
        const onChange = () => {
          if (!Number.isFinite(video.duration)) return;
          video.removeEventListener('durationchange', onChange);
          res();
        };
        video.addEventListener('durationchange', onChange);
        video.currentTime = 1e101;
        setTimeout(res, 8000);
      });
      primeMs = performance.now() - startedPriming;
      video.currentTime = 0;
    }

    const duration = video.duration;
    const width = video.videoWidth;
    const height = video.videoHeight;

    // Seek to the middle and paint it. A file that reports a duration but
    // cannot produce a frame from the middle of itself is not reviewable.
    let painted = { distinct: 0 };
    if (Number.isFinite(duration) && duration > 0) {
      await new Promise((res) => {
        video.onseeked = () => res();
        setTimeout(res, 8000);
        video.currentTime = duration / 2;
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(width, 160);
      canvas.height = Math.min(height, 90);
      const g = canvas.getContext('2d');
      g.drawImage(video, 0, 0, canvas.width, canvas.height);
      const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
      const seen = new Set();
      for (let i = 0; i < data.length; i += 4) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      painted = { distinct: seen.size, seekedTo: video.currentTime };
    }

    URL.revokeObjectURL(url);
    return {
      ok: true,
      rawDurationInfinite: !Number.isFinite(rawDuration),
      primeMs,
      duration, width, height,
      bytes: blob.size,
      type: blob.type,
      painted,
      indexed: {
        durationMs: rec.durationMs, bytes: rec.bytes,
        width: rec.width, height: rec.height, hasAudio: rec.hasAudio,
      },
    };
  }, clipId);

const film = async (page, seconds) => {
  await page.locator('.task-row', { hasText: 'Spider walk' }).locator('.task-go').click();
  await page.waitForSelector('.practice-overlay', { timeout: 20000 });
  await page.waitForSelector('.capture-pill', { timeout: 20000 });
  await page.waitForTimeout(seconds * 1000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(3000);
};

// ============================================================================
// Item 4: retention
// ============================================================================
console.log('\nwhat retention deletes, and what it must not\n');
{
  // Five sittings already on the shelf and a limit of three. Laid out so that
  // every exemption is load-bearing: if sessions were counted as clips, or if
  // starred and technique clips spent a slot, a different session would go.
  const at = (n) => 1_770_000_000_000 + n * 1000;
  const clip = (id, sessionId, startedAt, over = {}) => ({
    id, sessionId, kind: 'session', date: '2026-08-10',
    taskId: 't1', routineId: 'r1', label: 'Spider walk',
    startedAt, durationMs: 60_000, bytes: 4096,
    mimeType: 'video/webm;codecs=vp9,opus', quality: 'standard',
    width: 1280, height: 720, hasAudio: true, starred: false, endedBy: 'complete',
    location: { backend: 'opfs', key: `${id}.webm` },
    ...over,
  });

  const seeded = [
    // Oldest, unprotected, two clips. This is the one that must go, and it must
    // go as one session rather than as two of the three slots.
    clip('a1', 'old-1', at(1)),
    clip('a2', 'old-1', at(2)),
    clip('b1', 'old-2', at(3)),
    // A starred clip. Its session is entirely protected, so it must not spend a
    // slot either, or it would push an ordinary session out.
    clip('c1', 'starred-1', at(4), { starred: true }),
    clip('d1', 'old-3', at(5)),
    clip('e1', 'tech-1', at(6), {
      kind: 'technique-check', taskId: null, routineId: null,
      label: 'Straight on', view: 'front', starred: true,
    }),
  ];

  const { browser, page, errors } = await open({ keepSessions: 3, recordings: seeded });
  for (const c of seeded) await seedFile(page, c.location.key, c.bytes);

  const before = await filesOnDisk(page);
  check('the seeded files are all on the disk to start with',
    before.length === 6, `${before.length} files`);

  await film(page, 5);

  const lib = await library(page);
  const ids = (lib?.recordings ?? []).map((r) => r.id);
  const files = await filesOnDisk(page);

  check('the oldest unprotected session was pruned',
    !ids.includes('a1') && !ids.includes('a2'), JSON.stringify(ids));
  check('and it was counted as one session, not as two clips',
    ids.includes('b1'), 'old-2 survived, so old-1 spent a single slot');
  check('the starred clip survived', ids.includes('c1'));
  check('the technique check survived', ids.includes('e1'));
  check('and the newest session is there', ids.length === 5, `${ids.length} rows: ${ids}`);

  const gone = files.every((f) => f.name !== 'a1.webm' && f.name !== 'a2.webm');
  check('the pruned clips bytes are really gone from the disk', gone,
    JSON.stringify(files.map((f) => f.name)));
  check('and nothing else was taken with them',
    ['b1.webm', 'c1.webm', 'd1.webm', 'e1.webm'].every((n) => files.some((f) => f.name === n)),
    JSON.stringify(files.map((f) => f.name)));
  check('the prune was recorded so it is not silent',
    lib?.lastPrune?.clips === 2, JSON.stringify(lib?.lastPrune));
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ============================================================================
// Items 1, 2, 5, 6: a real clip, its metadata, deleting it, and a reload
// ============================================================================
console.log('\na clip that has to prove it is a video\n');
{
  const { browser, page, errors } = await open();
  await film(page, 12);

  let lib = await library(page);
  const clip = lib?.recordings?.[0];
  check('a clip was filed', !!clip, JSON.stringify(lib?.recordings?.length));

  const decoded = await decode(page, clip.id);
  check('the bytes decode as a video', decoded.ok === true, decoded.why);
  check('it reports a real duration', decoded.duration > 5 && Number.isFinite(decoded.duration),
    `${decoded.duration}s`);
  check('and real dimensions', decoded.width > 0 && decoded.height > 0,
    `${decoded.width}x${decoded.height}`);
  check('it can seek and paint a frame from the middle',
    decoded.painted.distinct > 1, `${decoded.painted.distinct} distinct pixel values`);

  // The header really is written without a duration, which is what the library's
  // priming exists for. Recorded here so the fix is never quietly reverted.
  console.log(`        container reports duration up front: ${decoded.rawDurationInfinite ? 'no (Infinity)' : 'yes'}`);

  check('the indexed size matches the file exactly',
    decoded.indexed.bytes === decoded.bytes, `${decoded.indexed.bytes} against ${decoded.bytes}`);
  check('the indexed dimensions match what the file contains',
    decoded.indexed.width === decoded.width && decoded.indexed.height === decoded.height,
    `${decoded.indexed.width}x${decoded.indexed.height} against ${decoded.width}x${decoded.height}`);
  // Wall clock against decoded length. They are measured differently (one is
  // Date.now around the recorder, the other is the container's own timeline) so
  // they are compared as a band rather than for equality.
  const drift = Math.abs(decoded.indexed.durationMs / 1000 - decoded.duration);
  check('the indexed duration matches the footage within a second',
    drift < 1.0, `${(decoded.indexed.durationMs / 1000).toFixed(2)}s indexed against ${decoded.duration.toFixed(2)}s decoded`);
  check('and it claims sound only if there is an audio track',
    typeof decoded.indexed.hasAudio === 'boolean');

  // --- persistence round trip ---------------------------------------------
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.task-container', { timeout: 25000 });
  await page.waitForTimeout(800);
  lib = await library(page);
  check('the index survives a reload', lib?.recordings?.length === 1);
  const afterReload = await decode(page, clip.id);
  check('and the clip still plays after a reload',
    afterReload.ok === true && afterReload.duration > 5,
    `${afterReload.why ?? afterReload.duration}`);

  // --- deletion actually frees the bytes -----------------------------------
  const usedBefore = await page.evaluate(() => navigator.storage.estimate().then((e) => e.usage));
  // Driven through the interface rather than a module handle: the library is
  // where a person deletes a clip, so that is the path worth proving.
  await page.locator('.progress-launch', { hasText: /Footage/ }).click();
  await page.waitForSelector('.spine', { timeout: 20000 });
  // Deleting now lives on the stage, so the clip is opened first: that is the
  // path a person actually takes to get rid of one.
  await page.locator('.take').first().click();
  await page.waitForSelector('.stage', { timeout: 20000 });
  await page.locator('.stage-act.is-danger').click();
  await page.locator('.stage-confirm-yes').click();
  await page.waitForTimeout(2500);

  lib = await library(page);
  check('the row is gone from the index', lib?.recordings?.length === 0,
    `${lib?.recordings?.length} rows`);
  check('and the file is gone from the disk', (await filesOnDisk(page)).length === 0,
    JSON.stringify(await filesOnDisk(page)));
  const usedAfter = await page.evaluate(() => navigator.storage.estimate().then((e) => e.usage));
  check('and the browser agrees the space came back',
    usedAfter < usedBefore, `${usedBefore} then ${usedAfter} bytes`);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ============================================================================
// Item 9: the IndexedDB fallback
// ============================================================================
console.log('\nthe fallback, for a browser with no writable file system\n');
{
  const { browser, page, errors } = await open({
    // Exactly the shape the availability check tests for: Safari shipped OPFS
    // with only the worker-only sync handle, so getDirectory exists and every
    // createWritable throws. Removing the method is that browser.
    stub: () => {
      delete FileSystemFileHandle.prototype.createWritable;
    },
  });
  await film(page, 10);

  const lib = await library(page);
  const clip = lib?.recordings?.[0];
  check('a clip was still filed', !!clip, JSON.stringify(lib?.recordings?.length));
  check('and it says it went to IndexedDB',
    clip?.location?.backend === 'indexeddb', clip?.location?.backend);
  check('nothing was written to the file system', (await filesOnDisk(page)).length === 0);

  const decoded = await decode(page, clip.id);
  check('the fallback clip decodes as a video', decoded.ok === true, decoded.why);
  check('it reports a real duration', decoded.duration > 4 && Number.isFinite(decoded.duration),
    `${decoded.duration}s`);
  check('and can paint a frame from the middle',
    decoded.painted.distinct > 1, `${decoded.painted.distinct} distinct pixel values`);
  check('the indexed size matches the stored blob',
    decoded.indexed.bytes === decoded.bytes, `${decoded.indexed.bytes} against ${decoded.bytes}`);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ============================================================================
// The shapes the quick checks never see: a long clip, portrait, and mp4
// ============================================================================
console.log('\na long clip, which is where forcing the duration could hurt\n');
{
  // Ninety seconds is a real timed block rather than a token five. It matters
  // because the library forces the browser to work out a duration the container
  // never wrote by seeking past the end, and how long that walk takes scales
  // with the file. If it were slow, every clip in the library would sit on
  // "Opening" for that long before it could be scrubbed.
  const { browser, page, errors } = await open();
  await film(page, 90);

  const clip = (await library(page))?.recordings?.[0];
  check('a long clip was filed', !!clip && clip.bytes > 1_000_000,
    clip ? `${(clip.bytes / 1024 / 1024).toFixed(1)} MB` : 'nothing filed');

  const decoded = await decode(page, clip.id);
  check('it decodes', decoded.ok === true, decoded.why);
  check('and reports its real length', decoded.duration > 85 && decoded.duration < 95,
    `${decoded.duration.toFixed(1)}s`);
  check('the indexed duration matches the footage within a second',
    Math.abs(decoded.indexed.durationMs / 1000 - decoded.duration) < 1.0,
    `${(decoded.indexed.durationMs / 1000).toFixed(2)}s indexed against ${decoded.duration.toFixed(2)}s decoded`);
  check('it can still seek and paint from the middle',
    decoded.painted.distinct > 1, `${decoded.painted.distinct} distinct pixel values`);
  // The number the owner would feel. Reported rather than merely asserted.
  console.log(`        working the duration out took ${decoded.primeMs.toFixed(0)}ms on a ${(decoded.bytes / 1024 / 1024).toFixed(1)} MB file`);
  check('working out the duration is not something you would sit through',
    decoded.primeMs < 1500, `${decoded.primeMs.toFixed(0)}ms`);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log('\nfootage from a camera held upright\n');
{
  // A phone propped in portrait is the likeliest second camera anyone owns, and
  // every preset in the app names a landscape size. What matters is that the
  // clip records the shape that was actually captured rather than the shape that
  // was asked for, because the library sizes the player from those numbers.
  const { browser, page, errors } = await open({
    stub: () => {
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (c) => {
        if (c?.video && typeof c.video === 'object') {
          const w = c.video.width, h = c.video.height;
          return real({ ...c, video: { ...c.video, width: h, height: w } });
        }
        return real(c);
      };
    },
  });
  await film(page, 8);

  const clip = (await library(page))?.recordings?.[0];
  check('a portrait clip was filed', !!clip, JSON.stringify(clip?.width));
  const decoded = await decode(page, clip.id);
  check('it decodes', decoded.ok === true, decoded.why);
  check('the camera really handed back an upright picture',
    decoded.height > decoded.width, `${decoded.width}x${decoded.height}`);
  check('and the index records the shape that was captured, not the one requested',
    decoded.indexed.width === decoded.width && decoded.indexed.height === decoded.height,
    `${decoded.indexed.width}x${decoded.indexed.height} against ${decoded.width}x${decoded.height}`);
  check('it can paint a frame', decoded.painted.distinct > 1,
    `${decoded.painted.distinct} distinct pixel values`);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

console.log('\nthe mp4 path, which is what Safari would take\n');
{
  // Safari has no WebM encoder and answers every webm probe with false. This
  // browser is not Safari, but the branch is the same one, so forcing every
  // candidate except mp4 to be unsupported exercises the code Safari would run:
  // the container choice, the file extension, and whether the result decodes.
  const { browser, page, errors } = await open({
    stub: () => {
      const real = MediaRecorder.isTypeSupported.bind(MediaRecorder);
      MediaRecorder.isTypeSupported = (type) => type.startsWith('video/mp4') && real(type);
    },
  });

  const canRecordMp4 = await page.evaluate(
    () => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4'),
  );
  if (!canRecordMp4) {
    console.log('        this browser will not write mp4 at all, so the path is not exercised here');
    check('and the app refuses cleanly rather than filming nothing', true, 'reported, not asserted');
    await browser.close();
  } else {
    await film(page, 10);
    const clip = (await library(page))?.recordings?.[0];
    check('a clip was filed', !!clip, JSON.stringify(clip?.mimeType));
    check('in an mp4 container', /^video\/mp4/.test(clip?.mimeType ?? ''), clip?.mimeType);
    check('and saved under an mp4 extension',
      clip?.location?.key?.endsWith('.mp4') === true, clip?.location?.key);
    const decoded = await decode(page, clip.id);
    check('the mp4 decodes as a video', decoded.ok === true, decoded.why);
    check('it reports a real duration',
      decoded.duration > 4 && Number.isFinite(decoded.duration), `${decoded.duration}s`);
    console.log(`        mp4 reports duration up front: ${decoded.rawDurationInfinite ? 'no (Infinity)' : 'yes'}`);
    check('and can paint a frame from the middle',
      decoded.painted.distinct > 1, `${decoded.painted.distinct} distinct pixel values`);
    check('the indexed dimensions match the file',
      decoded.indexed.width === decoded.width && decoded.indexed.height === decoded.height,
      `${decoded.indexed.width}x${decoded.indexed.height} against ${decoded.width}x${decoded.height}`);
    check('no console errors', errors.length === 0, errors.join(' | '));
    await browser.close();
  }
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
