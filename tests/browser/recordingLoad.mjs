// What filming a session costs the thing that was already running.
//
// The chord detector is the product. It runs on the main thread: the audio
// worklet hands frames over by postMessage and every chromagram, template match
// and vote happens in ordinary JavaScript beside React. Encoding 720p video on
// the same machine is not free, and until this file existed nobody had measured
// whether it was free enough.
//
// The measurement is deliberately end-to-end rather than a profile. Chromium
// takes a WAV file as its microphone, so the same thirty-four strums of Am and
// Em go into every run; the only thing that changes between runs is whether a
// camera is rolling and at what quality. What comes out is the number the player
// would see (changes counted), the main thread's own duty cycle, and the gaps
// between detector frames, which is where main-thread starvation shows up first.
//
// Why frame gaps are the sensitive metric: diagnostics timestamps every frame
// with `performance.now()` at the moment the detector processes it, so a frame
// that arrives late because the main thread was busy encoding is visible as a
// gap wider than the nominal 1024-sample hop. Detection can survive a few of
// those. A run of them is a drill that quietly stops counting.
//
//   node tests/browser/recordingLoad.mjs
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

const DIR = mkdtempSync(join(tmpdir(), 'daily-fret-load-'));

/** Seconds the drill runs, and therefore the window every number is measured over. */
const DRILL_SEC = 30;
/** Changes played into it. More than the drill can read, so the clock is the limit. */
const CHANGES = 36;

write(`${DIR}/changes.wav`, [changesTake(['Am', 'Em'], CHANGES, { repSec: 1.0, ringSec: 0.85 })]);

const account = {
  activeRoutineId: 'r1',
  routines: [{
    id: 'r1', name: 'Load', description: '', isDefault: true,
    tasks: [{
      id: 't1', title: 'Changes', duration: '1 min',
      drill: { kind: 'one-minute-changes', durationSec: DRILL_SEC, chordFrom: 'Am', chordTo: 'Em' },
    }],
  }],
  dailyLogs: {}, strumPatterns: [], songLinks: [], userSongs: [], updatedAt: 1, capoFret: 0,
};

/**
 * One run of the drill under one recording condition.
 *
 * `quality` of null is the control: recording switched off entirely, which is
 * what every one of these numbers has to be read against.
 */
async function measure(quality, throttle = 1) {
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      `--use-file-for-fake-audio-capture=${DIR}/changes.wav`,
    ],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    permissions: ['microphone', 'camera'],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

  // Every getUserMedia this page makes, recorded before any app code runs. This
  // is how "exactly one audio session" stops being a claim about the source.
  await page.addInitScript(() => {
    const calls = [];
    window.__gum = calls;
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => {
      calls.push({ audio: !!constraints?.audio, video: !!constraints?.video, at: Date.now() });
      return real(constraints);
    };
  });
  await page.addInitScript(
    (s) => localStorage.setItem('daily-fret-storage', JSON.stringify({
      state: { currentAccountId: 'anonymous', accounts: { anonymous: s } }, version: 0,
    })),
    account,
  );
  await page.addInitScript(
    (q) => localStorage.setItem('daily-fret-recordings', JSON.stringify({
      state: {
        settings: { enabled: q !== null, quality: q ?? 'standard', keepSessions: 8, cameraId: null },
        recordings: [], lastPrune: null,
      },
      version: 0,
    })),
    quality,
  );

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  // A laptop that is not this one. The fake camera hands the encoder a synthetic
  // pattern that costs almost nothing to compress, so an unthrottled run flatters
  // the feature: it proves the wiring is not pathological, not that the budget is
  // safe. Slowing the whole renderer is the closest this harness gets to a real
  // camera on a mid-range machine, and it is where a detector that is only just
  // keeping up starts dropping frames.
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const readMetrics = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
  };

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForSelector('.task-container', { timeout: 25000 });
  await page.locator('.task-row', { hasText: 'Changes' }).locator('.task-go').click();
  await page.waitForSelector('.practice-overlay', { timeout: 20000 });

  const start = page.locator('.practice-overlay').getByRole('button', { name: /^Start/ });
  if (await start.count()) await start.first().click();
  await page.waitForSelector('.om-count', { timeout: 20000 });

  // Only from here is the camera up and the detector fed, so the window starts
  // after both rather than including the camera opening.
  if (quality !== null) {
    await page.waitForSelector('.capture-pill', { timeout: 20000 }).catch(() => {});
  }
  await page.waitForTimeout(600);

  const before = await readMetrics();
  const wallStart = Date.now();
  await page.waitForTimeout(DRILL_SEC * 1000);
  const wallMs = Date.now() - wallStart;
  const after = await readMetrics();

  const counted = Number(
    /(\d+)/.exec(await page.locator('.om-count, .om-ring-value').first().innerText())?.[1] ?? -1,
  );
  const gum = await page.evaluate(() => window.__gum);

  // Ends the capture, which flushes the diagnostic session to IndexedDB.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(3000);

  const diag = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('daily-fret-diag', 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onupgradeneeded = () => r.transaction.abort();
    }).catch(() => null);
    if (!db) return null;
    const sessions = await new Promise((res) => {
      const tx = db.transaction('sessions', 'readonly');
      const rq = tx.objectStore('sessions').getAll();
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res([]);
    });
    if (!sessions.length) return null;
    const s = sessions.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
    return {
      sampleRate: s.sampleRate,
      frames: s.frames.map((f) => f[0]),
      silences: s.silences,
      emits: s.emits.length,
      truncated: s.truncated,
    };
  });

  const clip = await page.evaluate(() => {
    const raw = localStorage.getItem('daily-fret-recordings');
    return raw ? JSON.parse(raw).state.recordings[0] ?? null : null;
  });

  await browser.close();

  // --- frame timing ---------------------------------------------------------
  // Silent stretches are aggregated away into `silences` rather than kept as
  // frames, so a gap that sits inside one is the recorder economising and not
  // the main thread stalling. Those are excluded rather than counted as stalls.
  let late = 0;
  let worstGap = 0;
  let gapSum = 0;
  let nominal = 0;
  if (diag && diag.frames.length > 2) {
    nominal = (1024 / diag.sampleRate) * 1000;
    const silent = diag.silences.map(([at, len]) => [at, at + len]);
    const inSilence = (a, b) => silent.some(([s, e]) => b > s - nominal && a < e + nominal);
    for (let i = 1; i < diag.frames.length; i++) {
      const a = diag.frames[i - 1];
      const b = diag.frames[i];
      const gap = b - a;
      if (inSilence(a, b)) continue;
      gapSum += gap;
      if (gap > nominal * 1.5) late += 1;
      if (gap > worstGap) worstGap = gap;
    }
  }

  const taskMs = ((after.TaskDuration ?? 0) - (before.TaskDuration ?? 0)) * 1000;
  const scriptMs = ((after.ScriptDuration ?? 0) - (before.ScriptDuration ?? 0)) * 1000;

  return {
    quality: quality ?? 'off',
    throttle,
    counted,
    errors,
    gum,
    clip,
    frames: diag?.frames.length ?? 0,
    emits: diag?.emits ?? 0,
    truncated: diag?.truncated ?? false,
    nominal,
    late,
    worstGap,
    meanGap: diag && diag.frames.length > 2 ? gapSum / (diag.frames.length - 1) : 0,
    dutyPct: (taskMs / wallMs) * 100,
    scriptPct: (scriptMs / wallMs) * 100,
    wallMs,
  };
}

console.log('\nwhat recording costs the detector\n');
console.log(`  ${CHANGES} changes of Am/Em played into a ${DRILL_SEC}s drill, same audio every run.\n`);

const results = [];
for (const quality of [null, 'light', 'standard', 'detail']) {
  const r = await measure(quality);
  results.push(r);
  console.log(
    `  ${String(r.quality).padEnd(9)} counted ${String(r.counted).padStart(2)}  ` +
    `main-thread ${r.dutyPct.toFixed(1).padStart(5)}% (script ${r.scriptPct.toFixed(1)}%)  ` +
    `frames ${String(r.frames).padStart(4)}  late ${String(r.late).padStart(3)}  ` +
    `worst gap ${r.worstGap.toFixed(0).padStart(4)}ms  (nominal ${r.nominal.toFixed(1)}ms)`,
  );
  if (r.clip) {
    console.log(
      `            filmed ${(r.clip.bytes / 1024).toFixed(0)} kB, ${r.clip.width}x${r.clip.height}, ` +
      `audio ${r.clip.hasAudio}, ended ${r.clip.endedBy}`,
    );
  }
  if (r.errors.length) console.log(`            page errors: ${r.errors.join(' | ')}`);
}

const control = results[0];

console.log('\nthe verdict\n');

check('the control run counted a healthy number of changes',
  control.counted >= 24 && control.counted <= CHANGES,
  `${control.counted} with no camera`);

for (const r of results.slice(1)) {
  check(`${r.quality}: a camera actually rolled`, !!r.clip && r.clip.bytes > 10_000,
    r.clip ? `${r.clip.bytes} bytes` : 'no clip filed');

  // The bar the feature has to clear: filming must not cost the player changes
  // the drill would otherwise have counted. Three is the noise floor of the
  // detector against a fixed take across repeated runs.
  check(`${r.quality}: detection holds up against the control`,
    r.counted >= control.counted - 3,
    `${r.counted} against ${control.counted}`);

  check(`${r.quality}: no page errors`, r.errors.length === 0, r.errors.join(' | '));
}

// --- the audio session, which is the highest-risk interaction ----------------
console.log('\nthe microphone, while a camera is rolling\n');

for (const r of results.slice(1)) {
  const audioCalls = r.gum.filter((c) => c.audio);
  check(`${r.quality}: exactly one getUserMedia asked for audio`,
    audioCalls.length === 1,
    `${audioCalls.length} audio calls, ${r.gum.length} total`);
  check(`${r.quality}: the clip carries sound from the drill's own microphone`,
    r.clip?.hasAudio === true,
    `hasAudio ${r.clip?.hasAudio}`);
}

const controlAudio = control.gum.filter((c) => c.audio).length;
check('with recording off the drill still opens exactly one audio session',
  controlAudio === 1, `${controlAudio}`);
check('and no camera was opened at all',
  control.gum.every((c) => !c.video), JSON.stringify(control.gum));

// --- the same question on a slower machine -----------------------------------
//
// The runs above all sat near 8% of one main thread, which is a long way from
// the ceiling, so nothing was ever going to be squeezed out. That is a real
// result and it is also the easy case. These repeat the two extremes with the
// renderer slowed down, which is the condition under which "recording is free"
// would stop being true, and it is the honest test of the claim.
console.log('\nthe same drill on a slower machine\n');

const throttled = [];
for (const rate of [4, 6]) {
  for (const quality of [null, 'detail']) {
    const r = await measure(quality, rate);
    throttled.push(r);
    console.log(
      `  ${rate}x slower, ${String(r.quality).padEnd(8)} counted ${String(r.counted).padStart(2)}  ` +
      `main-thread ${r.dutyPct.toFixed(1).padStart(5)}%  frames ${String(r.frames).padStart(4)}  ` +
      `late ${String(r.late).padStart(3)}  worst gap ${r.worstGap.toFixed(0).padStart(4)}ms`,
    );
    if (r.errors.length) console.log(`            page errors: ${r.errors.join(' | ')}`);
  }
}

for (const rate of [4, 6]) {
  const off = throttled.find((r) => r.throttle === rate && r.quality === 'off');
  const on = throttled.find((r) => r.throttle === rate && r.quality === 'detail');
  check(`at ${rate}x slower, filming at Detail costs no counted changes`,
    on.counted >= off.counted - 3,
    `${on.counted} filming against ${off.counted} not filming`);
  check(`at ${rate}x slower, no page errors while filming`,
    on.errors.length === 0, on.errors.join(' | '));
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
