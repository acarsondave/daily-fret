// Read a course page's structure out of a browser that is already looking at it.
//
// Why this exists: the lesson, module and class pages return 403 to automated
// clients, and this project does not go around that. But a person reading the
// course in their own browser is not an automated client, and the structure we
// are missing — which lessons belong to which module of Grade 2 and Grade 3 —
// is on the page in front of them.
//
// So: open the class page, paste this into the DevTools console, and it copies
// a JSON block to the clipboard. Save that as
// curriculum/captured/<track>.json and re-run scripts/build-curriculum.mjs.
// One minute, once per grade, and the dataset stops guessing.
//
// HOW TO USE
//   1. Open e.g. https://www.justinguitar.com/classes/beginner-guitar-course-grade-three
//   2. Expand every module on the page so the lesson lists are in the DOM.
//   3. DevTools > Console > paste this whole file > Enter.
//   4. Check the table it prints. If the grouping looks wrong, say so — the
//      selectors below are a best guess at a page this script cannot see.
//   5. It copies JSON to the clipboard. Save it, then run the build.
//
// It reads the DOM and nothing else: no network requests, no credentials, no
// automation of anything the reader is not already doing by hand.

(() => {
  const TRACK = prompt('Track code for this page (e.g. b3 for Beginner Grade 3):', 'b3');
  if (!TRACK) return;
  const TITLE = prompt('Course title:', document.title.split('|')[0].trim());

  const HEADING = 'h1, h2, h3, h4';
  const LESSON_HREF = '/guitar-lessons/';

  /** Nearest heading above a node, in document order. */
  const headingFor = (node) => {
    const all = [...document.querySelectorAll(`${HEADING}, a[href*="${LESSON_HREF}"]`)];
    const at = all.indexOf(node);
    for (let i = at - 1; i >= 0; i--) {
      if (all[i].matches(HEADING)) return all[i].textContent.trim().replace(/\s+/g, ' ');
    }
    return null;
  };

  const links = [...document.querySelectorAll(`a[href*="${LESSON_HREF}"]`)];
  if (!links.length) {
    console.error('No lesson links found. Is this a course/class page, and are the modules expanded?');
    return;
  }

  // Group in document order, which is the order the course is taught in.
  const groups = [];
  const seen = new Set();
  for (const a of links) {
    const slug = new URL(a.href, location.origin).pathname.split(LESSON_HREF)[1]?.replace(/\/$/, '');
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const heading = headingFor(a) ?? 'Module';
    let group = groups.find((g) => g.title === heading);
    if (!group) {
      group = { title: heading, lessons: [] };
      groups.push(group);
    }
    group.lessons.push(slug);
  }

  // Module numbers run continuously across the beginner grades (Grade 1 is 1-7,
  // Grade 2 picks up at 8), so the first number is asked for rather than assumed.
  const first = Number(prompt(`First module number on this page (Grade 1 is 1-7, Grade 2 is 8-9):`, '10'));
  const modules = groups.map((g, i) => ({
    number: Number.isFinite(first) ? first + i : i + 1,
    title: g.title,
    lessons: g.lessons,
  }));

  const out = {
    track: TRACK.trim().toLowerCase(),
    title: TITLE?.trim() || null,
    source: location.href,
    capturedAt: new Date().toISOString().slice(0, 10),
    modules,
  };

  console.table(modules.map((m) => ({ number: m.number, title: m.title, lessons: m.lessons.length })));
  console.log(`${modules.reduce((n, m) => n + m.lessons.length, 0)} lessons across ${modules.length} modules.`);

  const json = JSON.stringify(out, null, 2);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(json).then(
      () => console.log('Copied. Save as curriculum/captured/' + out.track + '.json'),
      () => console.log(json),
    );
  } else {
    console.log(json);
  }
  return out;
})();
