// Capture every lesson page, in the browser you are already using.
//
// Paste this into the DevTools console on any justinguitar.com page.
//
// WHY AN IFRAME AND NOT fetch()
//
// The lesson pages are client-rendered. Fetching one returns 35KB of shell with
// no <h1> and no .lesson element — the content is built by the page's own
// JavaScript afterwards. So the page has to actually run, not merely be
// downloaded. A same-origin iframe runs it exactly as clicking the lesson does,
// and because it is same-origin we can read the DOM once it has settled.
//
// This is not a workaround for a block. Nothing here is spoofed, patched or
// bypassed: it is your browser loading pages it loads anyway, one at a time,
// with a pause between them, and this only reads what rendered.
//
// WHY THIS VERSION EXISTS
//
// v2 ran out of memory around lesson 200 and would have hit the localStorage
// quota around lesson 1000. Three things were wrong, all fixed here:
//
//   1. Each lesson page booted its YouTube and SoundCloud players inside the
//      frame. We read text and never look at a player, so they are stripped as
//      the page renders and never get to initialise.
//   2. One iframe was reused for every lesson, so detached documents and their
//      timers accumulated. Each lesson now gets its own frame, blanked and
//      removed afterwards.
//   3. Every lesson was held in one growing localStorage string, re-serialised
//      on every checkpoint. Bodies now go to IndexedDB one at a time, so heap
//      and write cost stay flat and the 5MB localStorage quota is irrelevant.
//
// Progress survives a closed tab: paste it again and it carries on, and it
// imports anything a v2 run already captured. It downloads lessons.json at the
// end — put that in curriculum/ and run scripts/build-curriculum.mjs.
//
// Type jgDump() at any time to download what has been captured so far.
// Type jgStop() to stop cleanly after the current lesson.
// Type jgSkipped() for the full URLs of everything it could not read, so you
// can open them yourself and check whether there was really nothing to take.

(async () => {
  const SETTLE_MS = 250;      // after .lesson appears, let the rest paint
  const GAP_MS = 350;         // between lessons
  const TIMEOUT_MS = 20000;
  const DB = 'jg-capture';
  const STORE = 'lessons';
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // --- storage -------------------------------------------------------------
  // One record per lesson. Written as it is captured, never re-read in bulk
  // until the download, so memory does not track the number of lessons.
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = (mode) => db.transaction(STORE, mode).objectStore(STORE);
  const idb = (req) => new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  const put = (slug, data) => idb(tx('readwrite').put(data, slug));
  const allKeys = () => idb(tx('readonly').getAllKeys());

  // Anything a v2 run already captured moves across, then its localStorage key
  // is released — that quota is what would have stopped the old run.
  const legacy = localStorage.getItem('jg-capture-v2');
  if (legacy) {
    const lessons = JSON.parse(legacy).lessons || {};
    for (const [slug, data] of Object.entries(lessons)) await put(slug, data);
    localStorage.removeItem('jg-capture-v2');
    console.log(`Imported ${Object.keys(lessons).length} lessons from the previous run.`);
  }

  // --- what to capture -----------------------------------------------------
  console.log('Reading the sitemap...');
  const xml = await (await fetch('/sitemap.xml')).text();
  let slugs = [...xml.matchAll(/<loc>([^<]*\/guitar-lessons\/[^<]+)<\/loc>/g)]
    .map((m) => m[1].split('/guitar-lessons/')[1].replace(/\/$/, ''));
  // Graded courses first, so an interrupted run still buys the part that
  // matters most. b0-b3 are the beginner grades, im the intermediate one.
  const graded = (s) => /-(b[0-3]|im)-\d{3}$/.test(s);
  slugs = [...slugs.filter(graded), ...slugs.filter((s) => !graded(s))];

  const have = new Set(await allKeys());
  const todo = slugs.filter((s) => !have.has(s));
  console.log(`${slugs.length} lessons, ${have.size} captured, ${todo.length} to go.`);
  console.log(`Roughly ${Math.round((todo.length * (GAP_MS + SETTLE_MS + 1400)) / 60000)} minutes. Leave the tab open.`);

  // --- rendering one lesson ------------------------------------------------
  // The player embeds are the entire memory problem and none of them are read,
  // so they are removed as fast as the page inserts them. Stripping while the
  // page is still building means YouTube and SoundCloud never boot at all.
  // Only the media players. Removing *every* iframe also killed the page's chat
  // widget mid-boot, which then threw from its own onLoad handler and filled the
  // console with failures that had nothing to do with the capture.
  const MEDIA_HOST = /youtube|ytimg|soundcloud|vimeo|spotify|bandcamp|dailymotion/i;
  const strip = (doc) => {
    try {
      doc?.querySelectorAll('video, audio, object, embed').forEach((n) => n.remove());
      doc?.querySelectorAll('iframe').forEach((n) => {
        if (MEDIA_HOST.test(n.src || n.dataset.src || '')) n.remove();
      });
    } catch { /* mid-navigation */ }
  };

  // Some pages are built on a different template. Named containers first,
  // because they are the ones whose shape we understand.
  const CONTAINERS = ['.lesson', '.lesson__content', '[class*="lesson"]', 'article', 'main', '#content'];
  const containerIn = (doc) => {
    if (!doc?.body) return null;
    for (const sel of CONTAINERS) {
      try {
        const el = doc.querySelector(sel);
        if (el && clean(el.textContent).length > 200) { el.dataset.jgVia = sel; return el; }
      } catch { /* bad selector on an odd document */ }
    }
    // Last resort: the deepest element still holding most of the page's text.
    // A template we have never seen is not a reason to lose the lesson, and
    // this finds the body copy without needing to know what it is called.
    const total = clean(doc.body.textContent).length;
    if (total < 400) return null;
    let best = doc.body;
    for (;;) {
      const child = [...best.children].find(
        (c) => !/^(SCRIPT|STYLE|NAV|HEADER|FOOTER)$/.test(c.tagName)
          && clean(c.textContent).length > total * 0.6,
      );
      if (!child) return best;
      best = child;
    }
  };

  // ONE frame for the whole run, navigated to about:blank between lessons and
  // waited on. A frame per lesson leaked about 25MB each: setting src and
  // removing the element on the same tick means the navigation never completes,
  // so the old document is never torn down and the heap climbed past 3GB by
  // lesson 200. Letting a real about:blank load finish is what frees it.
  const frame = document.createElement('iframe');
  Object.assign(frame.style, {
    position: 'fixed', left: '-9999px', top: '0', width: '1200px', height: '900px',
    border: '0', visibility: 'hidden',
  });
  document.body.appendChild(frame);
  const janitor = setInterval(() => strip(frame.contentDocument), 100);

  const navigate = (url) => new Promise((resolve) => {
    // The fallback timer covers a load event that fires before the listener
    // attaches. Clearing it matters: two navigations per lesson across 1600
    // lessons is 3200 timers that would otherwise sit there until the run ends.
    const timer = setTimeout(() => onLoad(), 4000);
    const onLoad = () => {
      clearTimeout(timer);
      frame.removeEventListener('load', onLoad);
      resolve();
    };
    frame.addEventListener('load', onLoad);
    frame.src = url;
  });

  const titleIn = (doc) => clean(doc?.querySelector('h1')?.textContent);

  const render = async (slug) => {
    await navigate(`/guitar-lessons/${slug}`);

    // Wait for the HEADING, not merely for a container. Accepting the first
    // element holding 200 characters latched onto the page's own chrome before
    // the lesson had rendered, which is why so much came back titled nothing.
    const deadline = Date.now() + TIMEOUT_MS;
    let root = null, title = '';
    while (Date.now() < deadline) {
      await sleep(150);
      const doc = frame.contentDocument;
      strip(doc);
      title = titleIn(doc);
      root = containerIn(doc);
      if (title && root) break;
    }

    const doc = frame.contentDocument;
    const at = doc?.location?.pathname ?? '?';
    if (!at.endsWith(slug)) throw new Error(`redirected to ${at}`);
    if (!root) throw new Error(`rendered ${clean(doc?.body?.textContent).length} chars, no container`);

    await sleep(SETTLE_MS);
    strip(doc);
    root = containerIn(doc) || root;

    // Some templates put the lesson name in the tab title and never in an h1.
    // That is a page we can still read, not a page we should throw away.
    let titleFrom = 'h1';
    if (!title) {
      title = clean(doc.title).replace(/\s*[|·]\s*JustinGuitar.*$/i, '');
      titleFrom = 'document.title';
    }

    // The sidebar names the grade, the module and the sibling lessons in
    // taught order, the membership the sitemaps never state.
    const crumb = clean(doc.querySelector('.lesson__steps')?.textContent);
    const siblings = [...doc.querySelectorAll('.lesson__list-item')].map((el) => {
      const href = (el.tagName === 'A' ? el : el.querySelector('a'))?.getAttribute('href') || '';
      return {
        slug: href.split('/guitar-lessons/')[1]?.replace(/\/$/, '') || null,
        active: /\bactive\b/.test(el.className),
      };
    }).filter((s) => s.slug);

    const body = root.cloneNode(true);
    for (const sel of ['.lesson-list', '.lesson__steps', 'nav', 'script', 'style',
                       '.lesson-complete-and-info', 'button', 'form']) {
      body.querySelectorAll(sel).forEach((n) => n.remove());
    }
    // Plain strings only. Holding on to a node would hold the whole document.
    return {
      title,
      titleFrom,
      crumb,
      siblings,
      // Which template this came from. The build trusts a .lesson capture more
      // than a page we found by text density, and needs to know which.
      via: root.dataset?.jgVia ?? 'density',
      text: clean(body.textContent),
    };
  };

  // --- the run -------------------------------------------------------------
  let stopping = false;
  window.jgStop = () => { stopping = true; console.log('Stopping after this lesson.'); };

  const dump = async () => {
    const keys = await allKeys();
    const lessons = {};
    for (const k of keys) lessons[k] = await idb(tx('readonly').get(k));
    const out = { capturedAt: new Date().toISOString().slice(0, 10), count: keys.length, lessons };
    const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'lessons.json' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    console.log(`Saved lessons.json with ${keys.length} lessons.`);
    return keys.length;
  };
  window.jgDump = dump;

  const heap = () => (performance.memory
    ? ` · heap ${Math.round(performance.memory.usedJSHeapSize / 1048576)}MB`
    : '');

  let done = 0, failed = 0, streak = 0;
  const failures = [];
  const link = (slug) => `${location.origin}/guitar-lessons/${slug}`;

  // Check any skipped page by hand. The script's verdict is not evidence on its
  // own, and a page it could not read may still have text a person can see.
  window.jgSkipped = () => {
    if (!failures.length) return console.log('Nothing skipped.');
    const list = failures.map((f) => link(f.slug)).join('\n');
    console.log(list);
    navigator.clipboard?.writeText(list).then(
      () => console.log(`${failures.length} links copied to the clipboard.`),
      () => {},
    );
    console.table(failures.map((f) => ({ reason: f.reason, url: link(f.slug) })));
    return failures.length;
  };

  for (const slug of todo) {
    if (stopping) break;
    try {
      const data = await render(slug);
      if (!data.title) throw new Error('no title anywhere on the page');
      if (data.text.length < 100) throw new Error(`only ${data.text.length} chars`);
      await put(slug, data);
      done += 1; streak = 0;
    } catch (e) {
      failed += 1; streak += 1;
      failures.push({ slug, reason: e.message });
      // log, not warn: warn attaches a stack trace to every line, which made a
      // handful of skipped pages look like the run had collapsed.
      console.log(`  skipped ${e.message}: ${link(slug)}`);
      // A run of failures means something changed at their end, not that these
      // particular lessons are odd. Twenty leaves room for a template we do not
      // read without stopping on a bad patch.
      if (streak >= 20) { console.error('Twenty in a row failed — stopping rather than pushing.'); break; }
    }
    // Every ten, so a quiet stretch still reads as progress rather than as a
    // stall. Failures were the only thing that printed before, which made a
    // working run look like a broken one.
    if ((done + failed) % 10 === 0) {
      console.log(`  ${done + failed}/${todo.length} · ${done} captured, ${failed} skipped${heap()}`);
    }
    // Park the frame on a blank page so the lesson's document is torn down
    // before the next one loads, rather than kept alive behind it.
    await navigate('about:blank');
    await sleep(GAP_MS);
  }

  clearInterval(janitor);
  await navigate('about:blank');
  frame.remove();

  const total = await dump();
  if (failures.length) {
    console.log(`${failures.length} skipped. Run jgSkipped() for the full list of links to check by hand.`);
  }
  console.log(`Captured ${total}. Put lessons.json in curriculum/ and run the build.`);
})();
