// The app opening with no connection at all.
//
// This is the one claim about offline that cannot be reasoned about. Everything
// the routine depends on already survived a disconnection (Zustand persists to
// localStorage, diagnostics to IndexedDB, Firebase Auth to its own store) while
// the page hosting all of it was still fetched from the network on every cold
// load. A tab already open kept working; a cold start with no signal did not.
//
// So this suite serves the real build, loads it once, then takes the network
// away for real: the browser context goes offline AND the HTTP server is shut
// down, so nothing can be quietly served from a socket that is still listening.
// A second tab is then opened cold and has to reach the routine.
//
// The last case is the control. The same cold load in a context that never
// installed the worker must fail, or this suite would pass with no service
// worker at all and prove nothing.
//
//   npm run build && node tests/browser/offline.mjs

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

if (!existsSync(join(DIST, 'sw.js'))) {
  console.error('no dist/sw.js — run `npm run build` first');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json',
};

// Served the way Cloudflare Pages serves it: the shell revalidates, the hashed
// assets do not. A browser HTTP cache that happened to hold index.html would
// make this suite pass for the wrong reason.
let served = 0;
const server = createServer((req, res) => {
  served += 1;
  const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, path === '/' ? 'index.html' : path);
  if (!existsSync(file) || !statSync(file).isFile()) file = join(DIST, 'index.html');
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000',
  });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const account = {
  activeRoutineId: 'r1',
  currentLesson: 'b1-403',
  routines: [{
    id: 'r1', name: 'Module 4 Daily', description: '', isDefault: true,
    tasks: [
      { id: 't1', title: 'Spider walk', duration: '5 mins' },
      { id: 't2', title: 'One minute changes', duration: '5 mins' },
    ],
  }],
  dailyLogs: {}, strumPatterns: [], songLinks: [], updatedAt: 1,
};
const seed = { currentAccountId: 'anonymous', accounts: { anonymous: account } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
await ctx.addInitScript(
  (s) => localStorage.setItem('daily-fret-storage', JSON.stringify({ state: s, version: 0 })),
  seed,
);

console.log('\nThe first load, with the network up\n');
{
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.task-container');
  check('the routine paints online', await page.locator('.task-container').isVisible());
  // `ready` resolves once a registration has an active worker, which is after
  // install finished, which is after the precache was written.
  const state = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const worker = reg.active;
    if (!worker) return 'none';
    if (worker.state === 'activated') return worker.state;
    await new Promise((resolve) => {
      worker.addEventListener('statechange', () => worker.state === 'activated' && resolve());
      setTimeout(resolve, 5000);
    });
    return worker.state;
  });
  check('a service worker is active', state === 'activated', state);
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    let total = 0;
    for (const name of names) total += (await (await caches.open(name)).keys()).length;
    return { names, total };
  });
  check('the shell is in the cache', cached.total > 20, `${cached.total} entries in ${cached.names.join(', ')}`);

  // Installing to a home screen is a gesture no driver can make, so what is
  // checked here is the part that decides whether the browser will offer it at
  // all: the manifest the browser actually parsed, and its own list of reasons
  // it would refuse.
  const cdp = await ctx.newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest');
  const parsed = JSON.parse(manifest.data ?? '{}');
  check('the browser parsed a manifest', !!manifest.url, manifest.url);
  check('it names the app', parsed.name === 'Daily Fret', parsed.name);
  check('it opens standalone', parsed.display === 'standalone', parsed.display);
  check('it carries an icon at both sizes',
    ['192x192', '512x512'].every((s) => (parsed.icons ?? []).some((i) => i.sizes === s)),
    (parsed.icons ?? []).map((i) => i.sizes).join(' '));
  const blockers = (manifest.errors ?? []).filter((e) => e.critical);
  check('nothing in it blocks an install', blockers.length === 0,
    blockers.map((e) => e.message).join('; '));
  await page.close();
}

console.log('\nThe cold load, with the network gone\n');
{
  await ctx.setOffline(true);
  await new Promise((r) => server.close(r));
  const before = served;
  const page = await ctx.newPage();
  const failed = [];
  page.on('requestfailed', (r) => failed.push(r.url()));
  let opened = true;
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch (e) {
    opened = false;
    check('the page loaded at all', false, String(e).split('\n')[0]);
  }
  if (opened) {
    let reached = true;
    try {
      await page.waitForSelector('.task-container', { timeout: 15000 });
    } catch {
      reached = false;
    }
    check('a cold tab reaches the routine with no network', reached);
    check('the routine it painted is the real one',
      (await page.locator('.task-row').count()) === 2,
      `${await page.locator('.task-row').count()} rows`);
    check('and today is still today',
      (await page.locator('.header-date').innerText()).length > 0);
    check('nothing was served by the server, because there is no server', served === before,
      `${served - before} requests answered`);
    check('no request failed on the way there', failed.length === 0, failed.slice(0, 3).join(' '));
  }
  await page.close();
}

console.log('\nThe control: the same load without the worker\n');
{
  // A context that never installed the worker has the same localStorage seed and
  // the same offline network. If this one also reached the routine, the case
  // above would be measuring nothing.
  const bare = await browser.newContext({ viewport: { width: 900, height: 900 }, offline: true });
  await bare.addInitScript(
    (s) => localStorage.setItem('daily-fret-storage', JSON.stringify({ state: s, version: 0 })),
    seed,
  );
  const page = await bare.newPage();
  let reached = false;
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 8000 });
    await page.waitForSelector('.task-container', { timeout: 4000 });
    reached = true;
  } catch {
    reached = false;
  }
  check('an uncached browser cannot open the app offline', reached === false);
  await bare.close();
}

await ctx.close();
await browser.close();
console.log(failures ? `\n${failures} failed\n` : '\nall good\n');
process.exit(failures ? 1 : 0);
