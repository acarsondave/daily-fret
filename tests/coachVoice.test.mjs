// The coach's spoken drill names, as shipped.
//
// The player announces a drill by name only when its slug is in
// public/coach/manifest.json, and otherwise says a generic "Up next". The
// manifest is regenerated from scripts/drill-names.json, which is refetched
// from the account, so a drill that is not in the routine on the day of a
// refetch drops out of the manifest while its clip stays on disk. That is how
// "Strumming Pattern 1" and "2" went unnamed: both clips shipped, neither was
// listed. With every strumming block now its own task, those two are read out
// on every session.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from '../scripts/slugify.mjs';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${d ? ' — ' + d : ''}`); };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'public/coach/manifest.json'), 'utf8'));
const names = JSON.parse(readFileSync(join(ROOT, 'scripts/drill-names.json'), 'utf8'));
const clips = readdirSync(join(ROOT, 'public/coach'))
  .filter((f) => /^name-.+\.mp3$/.test(f) && !/^name-lead-\d+\.mp3$/.test(f))
  .map((f) => f.slice('name-'.length, -'.mp3'.length));

console.log('\nEvery name clip that ships can be spoken\n');
{
  const unlisted = clips.filter((s) => !manifest.names.includes(s));
  check('every name clip is in the manifest', unlisted.length === 0, unlisted.join(', '));
  const missing = manifest.names.filter((s) => !clips.includes(s));
  check('and every listed name has a clip', missing.length === 0, missing.join(', '));
  const unnamed = manifest.names.filter((s) => !names.some((n) => n.slug === s));
  check('the name list agrees, so a regeneration keeps them', unnamed.length === 0, unnamed.join(', '));
  check('each name list entry slugs to its own slug', names.every((n) => slugify(n.title) === n.slug));
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
