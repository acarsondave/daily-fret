// Capture every lesson page, using the browser you are already signed into.
//
// Paste this into the DevTools console on any justinguitar.com page.
//
// Why this and not a crawler: the pages 403 to automated clients, and this
// project does not defeat that. It does not need to. Your browser is not an
// automated client — it loads these pages normally — and JavaScript running in
// your tab inherits that same session. So the browser does the fetching, exactly
// as it does when you click through the course, and this only reads and parses
// what comes back. Nothing is spoofed, patched or bypassed.
//
// It is polite: one page at a time, a pause between each, and it stops on
// repeated failures rather than hammering. Roughly 30 minutes for the lot;
// leave the tab open. It downloads lessons.json when finished — save it to
// curriculum/lessons.json and run scripts/build-curriculum.mjs.
//
// Resume: it keeps progress in localStorage, so if the tab closes, paste it
// again and it carries on from where it stopped.

(async () => {
  const DELAY = 900;              // ms between pages
  const KEY = 'jg-capture-v1';
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  const store = JSON.parse(localStorage.getItem(KEY) || '{"lessons":{}}');
  const save = () => localStorage.setItem(KEY, JSON.stringify(store));

  // The slug list comes from the sitemap, same as the offline build.
  console.log('Reading the sitemap...');
  const xml = await (await fetch('/sitemap.xml')).text();
  const slugs = [...xml.matchAll(/<loc>([^<]*\/guitar-lessons\/[^<]+)<\/loc>/g)]
    .map((m) => m[1].split('/guitar-lessons/')[1].replace(/\/$/, ''));
  const todo = slugs.filter((s) => !store.lessons[s]);
  console.log(`${slugs.length} lessons, ${slugs.length - todo.length} already captured, ${todo.length} to go.`);
  console.log(`About ${Math.round((todo.length * DELAY) / 60000)} minutes. Leave this tab open.`);

  const parse = (html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const root = doc.querySelector('.lesson');
    if (!root) return null;
    // The sidebar names the grade, the module and the sibling lessons in taught
    // order — the membership the sitemaps never state.
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
    return {
      title: clean(doc.querySelector('h1')?.textContent),
      crumb,
      siblings,
      text: clean(body.innerText || body.textContent),
    };
  };

  let done = 0, failed = 0, streak = 0;
  for (const slug of todo) {
    try {
      const res = await fetch(`/guitar-lessons/${slug}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = parse(await res.text());
      if (!data?.title || data.text.length < 100) throw new Error('not a lesson page');
      store.lessons[slug] = data;
      done += 1; streak = 0;
    } catch (e) {
      failed += 1; streak += 1;
      console.warn(`  ${slug}: ${e.message}`);
      // Something changed, or we are being asked to slow down. Either way,
      // stop rather than keep pushing.
      if (streak >= 8) { console.error('Eight failures in a row — stopping.'); break; }
    }
    if ((done + failed) % 25 === 0) { save(); console.log(`  ${done + failed}/${todo.length} (${failed} failed)`); }
    await new Promise((r) => setTimeout(r, DELAY));
  }
  save();

  const out = { capturedAt: new Date().toISOString().slice(0, 10), count: Object.keys(store.lessons).length, lessons: store.lessons };
  const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: 'lessons.json' }).click();
  console.log(`Captured ${out.count} lessons. Saved lessons.json — put it in curriculum/ and run the build.`);
})();
