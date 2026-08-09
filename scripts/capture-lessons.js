// Capture every lesson, in the browser you are already using.
//
// Paste this into the DevTools console on any justinguitar.com page.
//
// WHAT THIS READS
//
// Every lesson page ships its own content as JSON, in
//
//   <script type="application/json" data-js-react-store="lessonStore">
//
// which the page's React app then renders. That block holds the lesson body,
// its reference code (B1-101), its video id and duration, whether it is paid,
// and lessonsWithinModule: the whole module in taught order. So there is
// nothing to scrape. Fetch the page, read the JSON, done.
//
// Earlier versions loaded each lesson in a hidden iframe and read the rendered
// DOM. That was wrong in every way that mattered: it ran the page's YouTube and
// SoundCloud players, leaked about 25MB a lesson, took a second each, and what
// it came back with was the module's chapter list and the site menus rather
// than the lesson. The JSON was in the same 35KB response the whole time. I was
// looking for a CSS class in it instead of reading it.
//
// This is not a workaround for a block. It is a same-origin fetch of pages your
// browser fetches anyway, one at a time, with a pause between them.
//
// Roughly ten minutes for all 1843, against about an hour before.
//
//   jgDump()     download what has been captured so far
//   jgStop()     stop cleanly after the current lesson
//   jgSkipped()  full URLs of anything it could not read, to check by hand

(async () => {
  const GAP_MS = 200;
  const DB = 'jg-capture';
  const STORE = 'lessons';
  const EXTRACTOR = 5;
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // --- storage -------------------------------------------------------------
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

  // IndexedDB is on disk and survives a reboot or a flat battery, but the
  // browser may evict it under storage pressure unless asked not to.
  if (navigator.storage?.persist) {
    const durable = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    console.log(durable
      ? 'Storage is persistent: captures survive a reboot and will not be evicted.'
      : 'Storage is best-effort: run jgDump() now and then to keep a file on disk.');
  }

  // --- what to capture -----------------------------------------------------
  console.log('Reading the sitemap...');
  const xml = await (await fetch('/sitemap.xml')).text();
  let slugs = [...xml.matchAll(/<loc>([^<]*\/guitar-lessons\/[^<]+)<\/loc>/g)]
    .map((m) => m[1].split('/guitar-lessons/')[1].replace(/\/$/, ''));
  const graded = (s) => /-(b[0-3]|im)-\d{3}$/.test(s);
  slugs = [...slugs.filter(graded), ...slugs.filter((s) => !graded(s))];

  // Records carry the extractor that produced them. Everything taken before
  // this one holds the wrong text, so it is captured again rather than trusted.
  const keys = await allKeys();
  const have = new Set();
  for (const key of keys) {
    const rec = await idb(tx('readonly').get(key));
    if (rec?.v === EXTRACTOR) have.add(key);
  }
  const todo = slugs.filter((s) => !have.has(s));
  const stale = keys.length - have.size;
  if (stale > 0) console.log(`${stale} earlier captures are being taken again: they were read from the rendered page, not from the lesson data.`);
  console.log(`${slugs.length} lessons, ${have.size} captured, ${todo.length} to go.`);
  console.log(`Roughly ${Math.max(1, Math.round((todo.length * (GAP_MS + 260)) / 60000))} minutes.`);

  // --- reading one lesson --------------------------------------------------
  const STORE_RE = /<script[^>]+data-js-react-store="lessonStore"[^>]*>([\s\S]*?)<\/script>/;

  // The body is authored HTML. Block by block keeps the headings on their own
  // lines, so the lesson's sections survive instead of collapsing into one
  // paragraph. There is no nav or footer in here to filter out.
  const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, pre';
  const bodyText = (html) => {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    const out = [];
    for (const el of doc.body.querySelectorAll(BLOCKS)) {
      if (el.parentElement?.closest(BLOCKS)) continue;   // already covered by an outer block
      const text = clean(el.textContent);
      if (text) out.push(text);
    }
    return out.join('\n\n');
  };

  const read = async (slug) => {
    const res = await fetch(`/guitar-lessons/${slug}`, {
      headers: { Accept: 'text/html,application/xhtml+xml' },
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // A redirect to the shop or a signup means the lesson is sold, not missing.
    if (res.redirected && !res.url.includes(`/guitar-lessons/${slug}`)) {
      const err = new Error(`paywalled, sold at ${new URL(res.url).pathname}`);
      err.paywalled = true;
      throw err;
    }

    const html = await res.text();
    const match = html.match(STORE_RE);
    if (!match) throw new Error(`no lessonStore in ${html.length} bytes`);

    const store = JSON.parse(match[1]);
    const lesson = store?.entity?.lesson?.data?.attributes;
    if (!lesson) throw new Error('lessonStore held no lesson');
    if (lesson.paidContent) {
      const err = new Error('paywalled, paidContent');
      err.paywalled = true;
      throw err;
    }

    // Find the sideloaded records by walking for them rather than by path.
    // They live at entity.lesson.included, and reading entity.included instead
    // silently dropped the module and the grade from all 1276 lessons: every
    // field still populated, so nothing looked wrong until the totals were
    // counted. Searching by type cannot be wrong about where they sit.
    const typed = (type) => {
      const seen = [];
      const walk = (node, depth) => {
        if (!node || typeof node !== 'object' || depth > 6) return;
        if (Array.isArray(node)) { node.forEach((n) => walk(n, depth + 1)); return; }
        if (node.type === type && node.attributes) { seen.push(node.attributes); return; }
        Object.values(node).forEach((v) => walk(v, depth + 1));
      };
      walk(store.entity, 0);
      return seen[0];
    };
    const group = typed('group');
    const grade = typed('grade');

    return {
      v: EXTRACTOR,
      slug: lesson.slug,
      // The authoritative lesson code (B1-101). The sitemap only ever gave this
      // buried in a slug, and it is what the curriculum orders by.
      reference: lesson.reference,
      title: lesson.title,
      text: bodyText(lesson.body),
      summary: lesson.metaDesc || null,
      video: lesson.video || null,
      duration: lesson.youtubeDuration || null,
      videoChapters: bodyText(lesson.youtubeChapters),
      releasedAt: lesson.pageReleaseDate || null,
      signedInOnly: !!lesson.signedInOnly,
      // The module, in taught order, with each lesson's runtime. This is the
      // membership the sitemaps never stated and the reason Grade 3 was blank.
      module: group ? {
        title: group.title,
        slug: group.slug,
        reference: group.reference,
        label: group.tabHeaderForClassPage || null,
        lessonOrder: group.lessonOrder ?? null,
        intro: bodyText(group.introductionText),
      } : null,
      moduleLessons: (lesson.lessonsWithinModule ?? []).map((l) => ({
        slug: l.slug, title: l.title, duration: l.youtubeDuration || null,
      })),
      course: lesson.parentGroupBreadcrumb ?? null,
      grade: grade ? { position: grade.position, belt: grade.belt } : null,
    };
  };

  // --- the run -------------------------------------------------------------
  let stopping = false;
  window.jgStop = () => { stopping = true; console.log('Stopping after this lesson.'); };

  const dump = async () => {
    const all = await allKeys();
    const lessons = {};
    const paywalled = {};
    for (const k of all) {
      const rec = await idb(tx('readonly').get(k));
      if (rec?.paywalled) paywalled[k] = rec.soldAt;
      else if (rec) lessons[k] = rec;
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
    console.log(`Saved lessons.json: ${out.count} lessons, ${Object.keys(paywalled).length} paid and skipped.`);
    return out.count;
  };
  window.jgDump = dump;

  const heap = () => (performance.memory
    ? ` · heap ${Math.round(performance.memory.usedJSHeapSize / 1048576)}MB`
    : '');

  let done = 0, failed = 0, paid = 0, streak = 0;
  const failures = [];
  const link = (slug) => `${location.origin}/guitar-lessons/${slug}`;

  // Check any skipped page by hand. The script's verdict is not evidence on its
  // own, and a page it could not read may still have something a person sees.
  window.jgSkipped = () => {
    if (!failures.length) return console.log('Nothing skipped.');
    const list = failures.map((f) => link(f.slug)).join('\n');
    console.log(list);
    navigator.clipboard?.writeText(list).then(() => console.log(`${failures.length} links copied.`), () => {});
    console.table(failures.map((f) => ({ reason: f.reason, url: link(f.slug) })));
    return failures.length;
  };

  for (const slug of todo) {
    if (stopping) break;
    try {
      await put(slug, await read(slug));
      done += 1; streak = 0;
    } catch (e) {
      if (e.paywalled) {
        // A settled answer, not a failure to retry. Recorded so later runs skip
        // it instantly, and it does not count towards the stop rule: twenty paid
        // lessons sitting together in the queue used to halt the whole run.
        await put(slug, { paywalled: true, soldAt: e.message.replace(/^paywalled, /, '') });
        paid += 1; streak = 0;
      } else {
        failed += 1; streak += 1;
        failures.push({ slug, reason: e.message });
        console.log(`  skipped ${e.message}: ${link(slug)}`);
        if (streak >= 20) { console.error('Twenty in a row failed. Stopping rather than pushing.'); break; }
      }
    }
    if ((done + failed + paid) % 25 === 0) {
      console.log(`  ${done + failed + paid}/${todo.length} · ${done} captured, ${paid} paid, ${failed} skipped${heap()}`);
    }
    await sleep(GAP_MS);
  }

  const total = await dump();
  if (failures.length) console.log(`${failures.length} skipped. Run jgSkipped() for the links.`);
  console.log(`Captured ${total}. Put lessons.json in curriculum/ and run the build.`);
})();
