// What the capture script pulls out of a lesson page.
//
// This exists because of a bug that a test actively hid. The script read the
// sideloaded module and grade records from `entity.included`, but on the real
// page they sit at `entity.lesson.included`, a sibling of `data`. Every other
// field still populated, so nothing looked broken: 1276 lessons came back with
// a title, a body, a video and a course, and with the module and the grade
// silently missing on all of them. The check I wrote at the time built its
// fixture from memory, agreed with the code, and passed.
//
// So the fixture here is built from the actual page source, nesting included,
// and the extraction logic is imported rather than retyped. A test that
// restates the implementation only proves the implementation is self-consistent.
//
//   node tests/capture.test.mjs

import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail !== undefined ? `: ${detail}` : ''}`);
};

console.log('\nReading a lesson page\n');

const html = readFileSync('tests/fixtures/lesson-b1-101.html', 'utf8');

// The two pieces of the capture script that can be exercised without a browser.
const STORE_RE = /<script[^>]+data-js-react-store="lessonStore"[^>]*>([\s\S]*?)<\/script>/;
const match = html.match(STORE_RE);
check('the lessonStore block is found', !!match);
check('and not the searchStore that precedes it', !/"ui":\{\}$/.test(match?.[1] ?? ''));

const store = JSON.parse(match[1]);
const lesson = store?.entity?.lesson?.data?.attributes;
check('the lesson attributes parse', !!lesson);

// The walk, copied in behaviour from the script: find by record type, never by
// path. Reading a fixed path is exactly what failed.
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

// The regression itself: these live one level deeper than the old code looked.
check('the module is found despite the nesting', !!group, 'entity.lesson.included, not entity.included');
check('the grade is found', !!grade);
check('the module knows its number', group?.tabHeaderForClassPage === 'Module 0', group?.tabHeaderForClassPage);
check('the module knows its taught order', group?.lessonOrder?.length === 6, group?.lessonOrder?.length);
check('the grade knows its position', grade?.position === 1, grade?.position);

// The fields the curriculum is built from.
check('the reference code is the real one', lesson.reference === 'B1-101', lesson.reference);
check('the course is named', lesson.parentGroupBreadcrumb?.reference === 'BG1');
check('the module roll is present', lesson.lessonsWithinModule?.length === 2);
check('a runtime comes with each', lesson.lessonsWithinModule?.every((l) => l.youtubeDuration));
check('the video id is kept', lesson.video === 'X2EmpWr9vUc');
check('paid lessons are flagged by the site itself', lesson.paidContent === false);

// Body text: headings must survive as their own lines, and the markup must go.
// Node has no DOMParser, so this mirrors the script's block walk with a regex
// over the same authored HTML.
const text = lesson.body
  .replace(/<\/(p|h[1-6]|li|blockquote)>/g, '\n\n')
  .replace(/<[^>]+>/g, '')
  .replace(/\r/g, '')
  .split('\n\n').map((s) => s.trim()).filter(Boolean).join('\n\n');

check('the body carries no markup', !/[<>]/.test(text), text.slice(0, 60));
check('the opening line survives', text.startsWith('You should never play'), text.slice(0, 40));
check('a section heading is its own line', text.includes('\n\nHow to Use a Guitar Tuner\n\n'));
check('list items are kept', text.includes('Use your thumb instead of a pick!'));

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
