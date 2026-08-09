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
// Progress is kept in localStorage, so if the tab closes, paste it again and it
// carries on. It downloads lessons.json at the end — put that in curriculum/
// and run scripts/build-curriculum.mjs.
//
//   Graded courses first (~655 lessons, ~30 min), then everything else.

(async () => {
  const SETTLE_MS = 400;      // after the frame reports load
  const GAP_MS = 500;         // between lessons
  const TIMEOUT_MS = 15000;
  const KEY = 'jg-capture-v2';
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  const store = JSON.parse(localStorage.getItem(KEY) || '{"lessons":{}}');
  const save = () => localStorage.setItem(KEY, JSON.stringify(store));

  console.log('Reading the sitemap...');
  const xml = await (await fetch('/sitemap.xml')).text();
  let slugs = [...xml.matchAll(/<loc>([^<]*\/guitar-lessons\/[^<]+)<\/loc>/g)]
    .map((m) => m[1].split('/guitar-lessons/')[1].replace(/\/$/, ''));
  // Graded courses first, so an interrupted run still buys the part that
  // matters most. b0-b3 are the beginner grades, im the intermediate one.
  const graded = (s) => /-(b[0-3]|im)-\d{3}$/.test(s);
  slugs = [...slugs.filter(graded), ...slugs.filter((s) => !graded(s))];
  const todo = slugs.filter((s) => !store.lessons[s]);
  console.log(`${slugs.length} lessons, ${slugs.length - todo.length} captured, ${todo.length} to go.`);
  console.log(`Roughly ${Math.round((todo.length * (GAP_MS + SETTLE_MS + 900)) / 60000)} minutes. Leave the tab open.`);

  const frame = document.createElement('iframe');
  Object.assign(frame.style, { position: 'fixed', left: '-9999px', top: '0', width: '1200px', height: '900px' });
  document.body.appendChild(frame);

  const render = (slug) => new Promise((resolve, reject) => {
    const done = (fn) => { clearTimeout(timer); frame.onload = null; fn(); };
    const timer = setTimeout(() => done(() => reject(new Error('timed out'))), TIMEOUT_MS);
    frame.onload = async () => {
      const doc = frame.contentDocument;
      // The frame fires load before the app has painted the lesson, so wait for
      // the element itself rather than a fixed guess.
      for (let i = 0; i < 30; i += 1) {
        if (doc?.querySelector('.lesson')) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      done(() => resolve(frame.contentDocument));
    };
    frame.src = `/guitar-lessons/${slug}`;
  });

  const extract = (doc) => {
    const root = doc.querySelector('.lesson');
    if (!root) return null;
    // The sidebar names the grade, the module and the sibling lessons in taught
    // order — the membership the sitemaps never state.
    const crumb = clean(doc.querySelector('.lesson__steps')?.textContent);
    const siblings = [...doc.querySelectorAll('.lesson__list-item')].map((el) => {
      const href = (el.tagName === 'A' ? el : el.querySelector('a'))?.getAttribute('href') || '';
      return { slug: href.split('/guitar-lessons/')[1]?.replace(/\/$/, '') || null,
               active: /\bactive\b/.test(el.className) };
    }).filter((s) => s.slug);
    const body = root.cloneNode(true);
    for (const sel of ['.lesson-list', '.lesson__steps', 'nav', 'script', 'style',
                       '.lesson-complete-and-info', 'button', 'form']) {
      body.querySelectorAll(sel).forEach((n) => n.remove());
    }
    return { title: clean(doc.querySelector('h1')?.textContent), crumb, siblings,
             text: clean(body.innerText || body.textContent) };
  };

  let done = 0, failed = 0, streak = 0;
  for (const slug of todo) {
    try {
      const data = extract(await render(slug));
      if (!data) throw new Error('no .lesson after render');
      if (!data.title) throw new Error('no h1');
      if (data.text.length < 100) throw new Error(`only ${data.text.length} chars`);
      store.lessons[slug] = data;
      done += 1; streak = 0;
    } catch (e) {
      failed += 1; streak += 1;
      console.warn(`  ${slug}: ${e.message}`);
      if (streak >= 8) { console.error('Eight in a row failed — stopping rather than pushing.'); break; }
    }
    if ((done + failed) % 25 === 0) { save(); console.log(`  ${done + failed}/${todo.length} (${failed} failed)`); }
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  save();
  frame.remove();

  const out = { capturedAt: new Date().toISOString().slice(0, 10),
                count: Object.keys(store.lessons).length, lessons: store.lessons };
  const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: 'lessons.json' }).click();
  console.log(`Captured ${out.count}. Saved lessons.json — put it in curriculum/ and run the build.`);
})();
