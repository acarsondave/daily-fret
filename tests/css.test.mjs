// What the built CSS actually says, as opposed to what the source says.
//
// This exists because of one defect that nothing else here could have caught.
// Every glass surface declared the pair
//
//   backdrop-filter: blur(20px);
//   -webkit-backdrop-filter: blur(20px);
//
// and the CSS minifier read the two as duplicates and kept only the second.
// Chromium and Firefox do not support the prefixed form at all, so seven
// surfaces shipped with no blur on every browser except Safari. The worst of
// them was .practice-overlay: the full-screen drill and coached-session
// surface, sitting over the task list at 86% opacity with nothing softening
// what was behind it. The owner practises on a Mac, so it looked correct.
//
// Source review could not see it (the source was right). Unit tests could not
// see it (there is no DOM). Only the built file knows. So this reads the built
// file.
//
//   npm run build && node tests/css.test.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist/assets';
let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  // Detail explains a failure. Printing it on a pass reads as a complaint.
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail ? `: ${detail}` : ''}`);
};

let files;
try {
  files = readdirSync(DIST).filter((f) => f.endsWith('.css'));
} catch {
  console.error(`No ${DIST}. Run \`npm run build\` first.`);
  process.exit(1);
}
if (!files.length) {
  console.error(`No CSS in ${DIST}. Run \`npm run build\` first.`);
  process.exit(1);
}

console.log('\nBuilt CSS\n');

const all = files.map((f) => readFileSync(join(DIST, f), 'utf8')).join('\n');

// The real requirement, stated once: for every selector that blurs at all, the
// unprefixed property must survive somewhere. A selector left holding only the
// -webkit- form blurs in Safari and nowhere else, which is the bug above.
const blurred = new Map(); // selector -> { std, prefixed }
for (const [, sel, body] of all.matchAll(/([^{}@]+)\{([^{}]*backdrop-filter[^{}]*)\}/g)) {
  const key = sel.trim().replace(/\s+/g, ' ');
  const seen = blurred.get(key) ?? { std: false, prefixed: false };
  if (/(^|[;\s])backdrop-filter:/.test(body)) seen.std = true;
  if (/-webkit-backdrop-filter:/.test(body)) seen.prefixed = true;
  blurred.set(key, seen);
}

const orphans = [...blurred].filter(([, v]) => v.prefixed && !v.std).map(([k]) => k);
check('every blurred selector keeps the unprefixed property', orphans.length === 0, orphans.join(' | '));
check('the stylesheet blurs something at all', blurred.size > 0, `${blurred.size} selectors`);

// The surfaces whose whole legibility depends on it.
for (const sel of ['.practice-overlay', '.glass-panel', '.modal-backdrop', '.routine-dropdown',
                   '.context-menu-content', '.mic-hint', '.app-loader.is-overlay']) {
  const hit = [...blurred].find(([k]) => k.split(',').some((s) => s.trim() === sel));
  check(`${sel} blurs outside Safari`, !!hit?.[1].std, hit ? 'prefixed only' : 'no blur rule found');
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
