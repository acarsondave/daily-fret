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
// WHAT EARLIER VERSIONS GOT WRONG
//
//   1. They captured the wrong text. Taking a container's whole textContent
//      returned the module's chapter list, the site menus and the shop blurb,
//      with the lesson itself buried inside. Prose is now collected block by
//      block and anything that is mostly link text is dropped, which is what
//      separates the lesson from the furniture around it.
//   2. Every lesson page booted its YouTube and SoundCloud players inside the
//      frame. We read text and never look at a player, so the players are
//      removed as the page builds them and never get to initialise.
//   3. Memory. One frame is reused for the whole run and parked on about:blank
//      between lessons, waited on, so each document is torn down before the
//      next loads. Setting src and removing the element on the same tick leaks
//      about 25MB a lesson, which is what pushed the heap past 3GB.
//   4. Storage. Everything lived in one growing localStorage string and would
//      have hit the 5MB quota near the end. Records go to IndexedDB one at a
//      time now, so heap and write cost stay flat.
//   5. Paid lessons stopped the run. A redirect to /store or /signup is a
//      settled answer, recorded once and never retried, and it no longer counts
//      towards the consecutive-failure stop.
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

  // IndexedDB is on disk and survives a reboot or a flat battery, but by
  // default the browser may evict it under storage pressure. Asking makes it
  // durable. Chrome usually grants this silently for a site you visit often.
  if (navigator.storage?.persist) {
    const durable = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    console.log(durable
      ? 'Storage is persistent: captures survive a reboot and will not be evicted.'
      : 'Storage is best-effort: captures survive a reboot, but run jgDump() now and then to keep a file on disk.');
  }

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

  // Records carry the extractor that produced them. Anything older holds the
  // chapter list and site menus rather than the lesson, so it is re-captured
  // rather than trusted. Without this the fix would only reach lessons nobody
  // had visited yet, and the ones already taken would stay wrong for good.
  const EXTRACTOR = 3;
  const have = new Set();
  for (const key of await allKeys()) {
    const rec = await idb(tx('readonly').get(key));
    if (rec?.paywalled || rec?.v === EXTRACTOR) have.add(key);
  }
  const todo = slugs.filter((s) => !have.has(s));
  const stale = (await allKeys()).length - have.size;
  if (stale > 0) console.log(`${stale} lessons were captured by an older extractor and will be taken again.`);
  console.log(`${slugs.length} lessons, ${have.size} captured, ${todo.length} to go.`);
  console.log(`Roughly ${Math.round((todo.length * (GAP_MS + SETTLE_MS + 1400)) / 60000)} minutes. Leave the tab open.`);

  // --- rendering one lesson ------------------------------------------------
  // Only the media players. They are the entire memory problem and none of them
  // are read, so they go as fast as the page inserts them. Removing *every*
  // iframe also killed the page's chat widget mid-boot, which then threw from
  // its own onLoad handler and filled the console with unrelated failures.
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

  /**
   * The lesson's own writing, and nothing else.
   *
   * Taking a container's whole textContent was wrong: what came back was the
   * module's chapter list, the site menus and the shop blurb, with the actual
   * lesson buried in it. The prose is not identifiable by its container, but it
   * is identifiable by its shape. It lives in paragraphs and headings; the
   * chapter list, the nav and the footer are almost entirely link text.
   *
   * So this collects block elements and drops any block that is mostly a link.
   * Headings are kept as their own lines, which preserves the section structure
   * ("How to Use a Guitar Tuner", "The Best Tuner for Beginners") instead of
   * flattening the lesson into one paragraph.
   */
  const PROSE = 'p, h2, h3, h4, h5, blockquote, li, figcaption';
  const CHROME = 'nav, header, footer, aside, form, .lesson__steps, .lesson-list, .lesson-complete-and-info';
  const TRAILING_MENU = /^(courses|songs|tools|explore|store|join|log ?in|playground|more|view all|lessons & songs app|music theory app|faq|contact|about justin|privacy policy|community|clubs|©)/i;

  const proseFrom = (doc) => {
    const blocks = [];
    for (const el of doc.querySelectorAll(PROSE)) {
      if (el.closest(CHROME)) continue;
      // A block already covered by an outer block would be counted twice.
      if (el.parentElement?.closest(PROSE)) continue;
      const text = clean(el.textContent);
      if (text.length < 2) continue;
      const linkText = clean([...el.querySelectorAll('a')].map((a) => a.textContent).join(' '));
      if (linkText.length > text.length * 0.6) continue;
      blocks.push(text);
    }
    // The shop blurb and the site menus sit after the lesson and survive the
    // link test because they are plain text. They are always last, so trim from
    // the end rather than trying to recognise them in place.
    while (blocks.length && TRAILING_MENU.test(blocks[blocks.length - 1])) blocks.pop();
    return blocks.join('\n\n');
  };

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
    if (!at.endsWith(slug)) {
      // A redirect to the shop or a signup is a paid lesson. That is a settled
      // answer, not a failure to retry: it is recorded so re-runs skip it
      // immediately, and it does not count towards the consecutive-failure
      // stop. Twenty paid lessons happening to sit next to each other in the
      // queue used to halt the whole run.
      const err = new Error(`paywalled, sold at ${at}`);
      err.paywalled = true;
      throw err;
    }
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

    // The module's chapter list: every lesson in this module, in taught order,
    // with its runtime. This is the module membership the sitemaps never state,
    // and it is worth keeping in its own right rather than mixed into the prose.
    const chapters = [...doc.querySelectorAll('a[href*="/guitar-lessons/"]')]
      .map((a) => {
        const t = clean(a.textContent);
        const time = t.match(/(\d{1,2}:\d{2})\s*$/);
        return {
          slug: a.getAttribute('href').split('/guitar-lessons/')[1]?.replace(/\/$/, '') || null,
          title: clean(t.replace(/\d{1,2}:\d{2}\s*$/, '')),
          duration: time ? time[1] : null,
        };
      })
      .filter((c) => c.slug && c.title);

    return {
      v: EXTRACTOR,
      title,
      titleFrom,
      crumb,
      chapters: chapters.filter((c, i) => chapters.findIndex((o) => o.slug === c.slug) === i),
      siblings,
      via: root.dataset?.jgVia ?? 'density',
      text: proseFrom(doc),
    };
  };

  // --- the run -------------------------------------------------------------
  let stopping = false;
  window.jgStop = () => { stopping = true; console.log('Stopping after this lesson.'); };

  const dump = async () => {
    const keys = await allKeys();
    const lessons = {};
    const paywalled = {};
    for (const k of keys) {
      const rec = await idb(tx('readonly').get(k));
      if (rec?.paywalled) paywalled[k] = rec.soldAt;
      else lessons[k] = rec;
    }
    const out = {
      capturedAt: new Date().toISOString().slice(0, 10),
      count: Object.keys(lessons).length,
      // Listed, not silently dropped: these are Justin's paid courses, and the
      // build needs to know they are deliberately absent rather than missed.
      paywalled,
      lessons,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'lessons.json' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    console.log(`Saved lessons.json with ${out.count} lessons (${Object.keys(paywalled).length} paid lessons noted and skipped).`);
    return out.count;
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
      failed += 1;
      failures.push({ slug, reason: e.message });
      if (e.paywalled) {
        // Remembered, so the next run does not spend twenty seconds
        // rediscovering that this lesson is for sale.
        await put(slug, { paywalled: true, soldAt: e.message.replace(/^paywalled, sold at /, '') });
        streak = 0;
      } else {
        streak += 1;
      }
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
