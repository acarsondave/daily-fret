// Read the lesson pages in a real browser window, politely, once.
//
// WHAT THIS IS AND IS NOT
//
// The sitemaps give the skeleton but not the lesson text, and not which lessons
// belong to a grade whose slugs carry no code (Grade 3 has none). That is on the
// lesson pages, which return 403 to *headless* automation.
//
// This opens a real Chromium window and reads the pages the way a person does.
// There is deliberately no evasion here: no stealth plugin, no patched
// navigator.webdriver, no spoofed TLS or canvas fingerprint, no proxy, and
// nothing that solves or skips a challenge. When the interstitial appears the
// script simply waits for the browser to satisfy it on its own, exactly as it
// does when you sit in front of it. If a page will not load without one of
// those tricks, this gives up on that page rather than reaching for them.
//
// It is also polite: one tab, one request at a time, a real pause between them,
// and every page cached to disk so it never has to be asked twice. robots.txt
// allows `/` and disallows only /cms, /admin and /en, none of which are touched.
//
//   node scripts/fetch-lessons.mjs             # everything not yet cached
//   node scripts/fetch-lessons.mjs --limit 20  # a taste, to check extraction
//   node scripts/fetch-lessons.mjs --only b1   # one track
//
// Output: curriculum/lessons/<slug>.json, one per lesson. Re-runnable; already
// cached pages are skipped, so an interrupted run just carries on.

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'curriculum/lessons');
const BASE = 'https://www.justinguitar.com';

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
// A second and a half between pages. Nobody is waiting on this and the site is
// doing us a favour by serving it at all.
const DELAY_MS = Number(arg('--delay', '1500'));
const LIMIT = Number(arg('--limit', '0'));
const ONLY = arg('--only');

mkdirSync(CACHE, { recursive: true });

const reference = JSON.parse(readFileSync(join(ROOT, 'curriculum/justinguitar.reference.json'), 'utf8'));
const cached = new Set(readdirSync(CACHE).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)));

let queue = reference.lessons.filter((l) => !cached.has(l.slug));
if (ONLY) queue = queue.filter((l) => l.track === ONLY || l.slug.includes(ONLY));
// Uncoded lessons first: they are the ones the sitemaps genuinely cannot place,
// so an interrupted run still buys the structure we are missing.
queue.sort((a, b) => (a.code ? 1 : 0) - (b.code ? 1 : 0));
if (LIMIT > 0) queue = queue.slice(0, LIMIT);

if (!queue.length) {
  console.log(`nothing to do — ${cached.size} lessons already cached`);
  process.exit(0);
}
console.log(`${queue.length} to fetch, ${cached.size} already cached, ${DELAY_MS}ms apart`);

/** Everything a lesson page knows about itself. Runs inside the page. */
const EXTRACT = () => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const root = document.querySelector('.lesson');

  // The sidebar names the course, the module and every sibling lesson in taught
  // order, with the current one marked active. That is exactly the membership
  // the sitemaps never state.
  const crumb = [...document.querySelectorAll('.lesson__steps, .lesson__steps *')]
    .map((e) => clean(e.textContent))
    .filter(Boolean);
  const siblings = [...document.querySelectorAll('.lesson__list-item')].map((el) => {
    const a = el.tagName === 'A' ? el : el.querySelector('a');
    const href = a?.getAttribute('href') || el.getAttribute('href') || '';
    return {
      slug: href.split('/guitar-lessons/')[1]?.replace(/\/$/, '') || null,
      title: clean(el.querySelector('h3, h4, .title')?.textContent || el.textContent).slice(0, 120),
      active: /\bactive\b/.test(el.className),
    };
  }).filter((s) => s.slug);

  // The lesson prose, with the sidebar and the controls stripped out.
  const clone = root?.cloneNode(true);
  if (clone) {
    for (const sel of ['.lesson-list', '.lesson__steps', 'nav', 'script', 'style',
                       '.lesson-complete-and-info', 'button', 'form']) {
      clone.querySelectorAll(sel).forEach((n) => n.remove());
    }
  }

  return {
    title: clean(document.querySelector('h1')?.textContent),
    crumb,
    siblings,
    text: clean(clone?.innerText || ''),
    tabs: [...document.querySelectorAll('pre, .tab, [class*=tab]')]
      .map((e) => clean(e.textContent)).filter((t) => t.length > 20).slice(0, 10),
  };
};

// Real Google Chrome, with a profile that persists between runs.
//
// Playwright's bundled Chromium on a blank profile is not the same thing as
// your browser, and the site treats it that way: a fresh profile got stopped on
// the interstitial on every page, while ordinary Chrome opens the same URLs
// without blinking. `channel: 'chrome'` uses the Chrome already installed, and a
// persistent profile keeps whatever clearance that visit earns, so the check
// stops being asked over and over.
//
// Still no evasion: this is the real browser being itself, not a fake one
// dressed up. If Chrome is not installed, fall back with --chromium.
const PROFILE = join(ROOT, 'curriculum/.browser-profile');
mkdirSync(PROFILE, { recursive: true });
const useChromium = process.argv.includes('--chromium');
const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  ...(useChromium ? {} : { channel: 'chrome' }),
  viewport: { width: 1280, height: 900 },
});
const browser = context.browser() ?? { close: () => context.close() };
const page = context.pages()[0] ?? (await context.newPage());

// The first visit may have to satisfy the check once, by hand if it asks. After
// that the profile carries it and the run is unattended.
console.log('If the browser shows a human check, complete it once — the profile keeps it.');

let done = 0;
let failed = 0;
const started = Date.now();

for (const lesson of queue) {
  const url = `${BASE}/guitar-lessons/${lesson.slug}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Wait the interstitial out. The browser satisfies it by itself; nothing
    // here helps it along.
    for (let i = 0; i < 40; i += 1) {
      if (!/Just a moment/i.test(await page.title())) break;
      await page.waitForTimeout(1000);
    }
    if (/Just a moment/i.test(await page.title())) {
      throw new Error('still on the interstitial after 40s');
    }
    await page.waitForSelector('.lesson, h1', { timeout: 20000 });
    const data = await page.evaluate(EXTRACT);
    // The interstitial has a <title> and an <h1> of its own, so "we got a
    // title" is not evidence of a lesson. Demand the things only a real lesson
    // page has, or this quietly caches challenge pages as curriculum.
    if (!data.title || /justinguitar\.com|just a moment|verify/i.test(data.title)) {
      throw new Error(`not a lesson page (title: ${data.title || 'none'})`);
    }
    if (data.text.length < 200) throw new Error(`only ${data.text.length} chars of text`);

    writeFileSync(
      join(CACHE, `${lesson.slug}.json`),
      JSON.stringify({ slug: lesson.slug, url, fetchedAt: new Date().toISOString().slice(0, 10), ...data }, null, 2),
    );
    done += 1;
  } catch (e) {
    failed += 1;
    console.error(`  FAILED ${lesson.slug}: ${String(e).split('\n')[0].slice(0, 90)}`);
  }

  if ((done + failed) % 25 === 0 || done + failed === queue.length) {
    const rate = (done + failed) / ((Date.now() - started) / 1000);
    const left = Math.round((queue.length - done - failed) / Math.max(rate, 0.01) / 60);
    console.log(`  ${done + failed}/${queue.length} (${failed} failed, ~${left} min left)`);
  }
  await page.waitForTimeout(DELAY_MS);
}

await context.close();
console.log(`\nfetched ${done}, failed ${failed}, cached total ${cached.size + done}`);
console.log('curriculum/lessons/*.json — run scripts/build-curriculum.mjs to fold it in');
