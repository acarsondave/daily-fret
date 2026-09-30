// The coach's list of spoken names has to reach a phone that already has one.
//
// The voice clips are cached CacheFirst, which is right: a clip at a given name
// never changes. The manifest that lists them sat under the same rule and was
// fetched with `cache: 'force-cache'` besides, so the first copy a device ever
// saw was the copy it kept. A drill added to the pack stayed unannounced on
// every installed app forever.
//
// Asserted against a real service worker: install the app, replace the cached
// manifest with an old one, reload, and ask whether the coach still believes
// the old list.
//
//   npm run build && npx vite preview --port 4173
//   PREVIEW_URL=http://localhost:4173/ node tests/browser/coachManifest.mjs

import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:4173/';
let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
// The worker registers from the app; wait until it controls the page.
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 30000 }).catch(() => {});
if (!(await page.evaluate(() => !!navigator.serviceWorker?.controller))) {
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 30000 });
}

console.log('\nAn installed app with an old list of names\n');
const live = await page.evaluate(async () => (await (await fetch('/coach/manifest.json')).json()).names);
check('the pack lists the strumming patterns', live.includes('strumming-pattern-1'));

// What a phone that installed before the fix holds: the same file, minus them.
await page.evaluate(async () => {
  const res = await fetch('/coach/manifest.json');
  const body = await res.json();
  body.names = body.names.filter((n) => !n.startsWith('strumming-pattern'));
  const stale = new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      if (new URL(req.url).pathname === '/coach/manifest.json') await cache.put(req, stale.clone());
    }
  }
  const voice = await caches.open('coach-voice');
  await voice.put('/coach/manifest.json', stale.clone());
});

// Online again, as the app would be on its next open. Asked the way the coach
// asks for it (src/audio/coachVoice.ts).
await page.reload({ waitUntil: 'domcontentloaded' });
const seen = await page.evaluate(async () => {
  const res = await fetch('/coach/manifest.json', { cache: 'no-cache' });
  return (await res.json()).names;
});
check('the next open gets the new list', seen.includes('strumming-pattern-1'), `saw ${seen.length} names`);

console.log('\nOffline\n');
await ctx.setOffline(true);
const offline = await page.evaluate(async () => {
  try { return (await (await fetch('/coach/manifest.json')).json()).names.length; } catch { return -1; }
});
check('the list is still there with no connection', offline > 0, `${offline}`);
await ctx.setOffline(false);

await browser.close();
console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
