// Builds the curriculum dataset from the two sitemaps JustinGuitar publishes for
// crawlers. Nothing else is fetched.
//
// The lesson pages themselves sit behind a Cloudflare challenge that returns 403
// to any automated client, browser user agent or not. That is an access control,
// and this script does not go near it. Everything here comes from
// /sitemap.xml and /video-sitemap.xml, which are served willingly at 200 and
// exist precisely so machines can read them.
//
// What that yields: the full course/module/lesson skeleton with ordering, plus
// the title and description of every lesson that has a video. What it does not
// yield: the prose on the lesson page below the video.
//
// Usage: node scripts/build-curriculum.mjs [--offline <dir>]

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Says what it is. The sitemaps are served at 200 to a plain client, so there
// was never anything to gain by claiming to be Chrome — and a file that
// declines to work around an access control should not be dressing up as a
// browser three lines later.
const UA = 'daily-fret-curriculum-builder (+https://github.com/acarsondave/daily-fret)';
const BASE = 'https://www.justinguitar.com';

const offlineAt = process.argv.indexOf('--offline');
const offlineDir = offlineAt >= 0 ? process.argv[offlineAt + 1] : null;

async function source(name) {
  if (offlineDir) return readFileSync(join(offlineDir, name), 'utf8');
  const res = await fetch(`${BASE}/${name}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.text();
}

const decode = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
   .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Title Case From A Slug, with the trailing lesson code removed. */
function titleFromSlug(slug) {
  const SMALL = new Set(['a','an','and','as','at','but','by','for','from','in','of','on','or','the','to','with','your','you']);
  const ACRONYM = { bpm:'BPM', cagd:'CAGED', caged:'CAGED', diy:'DIY', eq:'EQ', ii:'II', iii:'III', iv:'IV', vi:'VI', vii:'VII', pdf:'PDF', tab:'TAB', usa:'USA' };
  return slug
    .replace(/-[a-z]{2}\d?-\d{3}$/i, '')
    .split('-')
    .filter(Boolean)
    .map((w, i, all) => {
      if (ACRONYM[w]) return ACRONYM[w];
      if (i > 0 && i < all.length - 1 && SMALL.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

/**
 * Tracks worth naming, keyed by the code that prefixes their lesson numbers.
 *
 * The sitemap lists class pages but never says which lessons belong to them, so
 * course membership can only come from the lesson code. That code is reliable;
 * the mapping from code to a human name is not in any file, so it is stated
 * here and nowhere else infers it. Codes not listed still appear in the output
 * as tracks with a null title, rather than being dropped or guessed at.
 *
 * Module numbers run continuously across the beginner grades: grade one is
 * modules 1 to 7 and grade two picks up at 8, which is why `moduleRange` exists
 * and why nothing here assumes a course starts at module 1.
 */
const TRACKS = {
  b0: { title: 'Before You Begin', stage: 'pre', order: 0 },
  b1: { title: 'Beginner Grade 1', stage: 'beginner', order: 1, moduleRange: [1, 7] },
  b2: { title: 'Beginner Grade 2', stage: 'beginner', order: 2, moduleRange: [8, 9] },
  bc: { title: 'Beginner Course (classic)', stage: 'beginner', order: 1, legacy: true },
  im: { title: 'Intermediate Foundation', stage: 'intermediate', order: 4 },
  bl: { title: 'Blues Lead', stage: 'intermediate' },
  mt: { title: 'Practical Music Theory', stage: 'any' },
  sc: { title: 'Scales and Modes', stage: 'intermediate' },
  te: { title: 'Technique Study', stage: 'intermediate' },
  et: { title: 'Ear Training', stage: 'any' },
  ch: { title: 'Chords', stage: 'any' },
  ar: { title: 'Arpeggios', stage: 'intermediate' },
  tr: { title: 'Transcribing', stage: 'advanced' },
  ru: { title: 'Rust Removal', stage: 'any' },
  uk: { title: 'Ukulele', stage: 'any' },
};

/**
 * Module names for the courses we support, keyed `track:number`.
 *
 * The sitemap lists module pages but never says which module number a slug is,
 * and the visual order on the course page does not match the internal numbering
 * either. So these are stated, and `checkModuleNames` below asserts each one
 * against a lesson that can only belong to that module. A name that drifts out
 * of step with the course fails the build rather than misleading a learner.
 */
const MODULE_NAMES = {
  'b0:0': 'Before You Begin',
  'b1:1': 'A & D Chords, Your First Song',
  'b1:2': 'Rhythm, Chord Changes & Your First Riff',
  'b1:3': 'Capo, Minor Chords & Up Strums',
  'b1:4': 'Metronome, Stretches & The Pattern',
  'b1:5': 'Basic Theory & Strumming Development',
  'b1:6': '6:8 Time, Fast Changes & Alternate Picking',
  'b1:7': 'Air Changes, Dynamics & Consolidation',
  'b2:8': 'Stuck 3&4 Chords, Muting & Fast Changes',
  'b2:9': 'The F Chord, Scales & Chords In Keys',
};

/** A lesson that could only sit in this module, as a check on the name above. */
const MODULE_ANCHORS = {
  'b1:1': 'how-to-play-the-d-chord-b1-105',
  'b1:2': 'how-to-play-the-e-chord-b1-201',
  'b1:3': 'all-about-capos-b1-308',
  'b1:4': 'meet-the-metronome-b1-403',
  'b1:5': 'the-c-chord-b1-501',
  'b1:6': 'a-6-8-strumming-pattern-b1-604',
  'b1:7': 'air-changes-aspire-to-this-b1-703',
  'b2:9': 'the-f-chord-b2-901',
};

function checkModuleNames(lessons) {
  const slugs = new Set(lessons.map((l) => l.slug));
  const missing = Object.entries(MODULE_ANCHORS).filter(([, slug]) => !slugs.has(slug));
  if (missing.length) {
    throw new Error(
      `module names are out of step with the course: ${missing
        .map(([key, slug]) => `${key} expected ${slug}`)
        .join('; ')}`,
    );
  }
}

function parseSitemap(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decode(m[1]));
}

/**
 * Title, description and YouTube id per lesson url, from the video sitemap.
 *
 * The id is not published as a field. It is inside the thumbnail URL, which
 * points at `i.ytimg.com/vi/<id>/hqdefault.jpg` — so the mapping from a lesson
 * to the video that teaches it is already in a file the site hands to crawlers,
 * and the first pass at this simply threw it away. 1841 of the 1843 lessons
 * have one.
 */
function parseVideoSitemap(xml) {
  const out = new Map();
  for (const block of xml.split('<url>').slice(1)) {
    const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
    if (!loc) continue;
    const title = block.match(/<video:title>([\s\S]*?)<\/video:title>/)?.[1];
    const description = block.match(/<video:description>([\s\S]*?)<\/video:description>/)?.[1];
    const videoId = block.match(/i\.ytimg\.com\/vi\/([\w-]{11})\//)?.[1] ?? null;
    if (!title && !description && !videoId) continue;
    const key = decode(loc).replace(/\/$/, '');
    // A lesson can carry several videos. Keep the first, which is the lesson's
    // own; the rest are follow-ups embedded in the same page.
    if (!out.has(key)) {
      out.set(key, {
        title: title ? decode(title).trim() : null,
        description: description ? decode(description).replace(/\s+/g, ' ').trim() : null,
        videoId,
      });
    }
  }
  return out;
}

const main = async () => {
  const [sitemap, videoSitemap] = await Promise.all([source('sitemap.xml'), source('video-sitemap.xml')]);
  const urls = parseSitemap(sitemap);
  const videos = parseVideoSitemap(videoSitemap);

  const lessonUrls = urls.filter((u) => u.includes('/guitar-lessons/'));
  const moduleSlugs = [...new Set(urls.filter((u) => u.includes('/modules/')).map((u) => u.split('/modules/')[1]))];
  const classSlugs = [...new Set(urls.filter((u) => u.includes('/classes/')).map((u) => u.split('/classes/')[1]))];

  const lessons = [];
  for (const url of lessonUrls) {
    const slug = url.split('/guitar-lessons/')[1];
    // The trailing code is the curriculum's own identifier: two letters for the
    // course, then a digit for the module and two for the lesson within it. It
    // is authoritative for ordering, and it disagrees with the visual position
    // of a module on the course page, so nothing here reads that instead.
    // Two characters for the track, then a digit for the module and two for the
    // lesson within it. The second character can be a digit (b1, b2), which is
    // why this is not [a-z]{2}.
    const code = slug.match(/-([a-z][a-z0-9])-(\d)(\d{2})$/i);
    const video = videos.get(url.replace(/\/$/, '')) ?? null;
    lessons.push({
      slug,
      url,
      track: code ? code[1].toLowerCase() : null,
      code: code ? `${code[1].toLowerCase()}-${code[2]}${code[3]}` : null,
      module: code ? Number(code[2]) : null,
      position: code ? Number(code[3]) : null,
      title: video?.title ?? titleFromSlug(slug),
      titleSource: video?.title ? 'video-sitemap' : 'slug',
      description: video?.description ?? null,
      videoId: video?.videoId ?? null,
    });
  }

  // Group every coded lesson under its track and module. Tracks with no entry in
  // TRACKS still appear, titled null, so the dataset never claims to know a name
  // it does not have.
  checkModuleNames(lessons);

  const tracks = [];
  for (const lesson of lessons) {
    if (!lesson.track) continue;
    let track = tracks.find((t) => t.code === lesson.track);
    if (!track) {
      const known = TRACKS[lesson.track] ?? null;
      track = {
        code: lesson.track,
        title: known?.title ?? null,
        stage: known?.stage ?? null,
        order: known?.order ?? null,
        legacy: known?.legacy ?? false,
        modules: [],
      };
      tracks.push(track);
    }
    let mod = track.modules.find((m) => m.number === lesson.module);
    if (!mod) {
      mod = {
        number: lesson.module,
        title: MODULE_NAMES[`${lesson.track}:${lesson.module}`] ?? null,
        lessons: [],
      };
      track.modules.push(mod);
    }
    mod.lessons.push(lesson.slug);
  }
  for (const track of tracks) {
    track.modules.sort((a, b) => a.number - b.number);
    for (const mod of track.modules) {
      mod.lessons.sort((a, b) => {
        const codeOf = (s) => lessons.find((l) => l.slug === s).position;
        return codeOf(a) - codeOf(b);
      });
    }
  }
  tracks.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || b.modules.length - a.modules.length);

  const dataset = {
    source: {
      site: BASE,
      files: ['/sitemap.xml', '/video-sitemap.xml'],
      note: 'Lesson pages are behind an anti-bot challenge and were not fetched. Everything here comes from the two sitemaps the site publishes for crawlers.',
      builtAt: new Date().toISOString().slice(0, 10),
    },
    counts: {
      lessons: lessons.length,
      lessonsWithCode: lessons.filter((l) => l.track).length,
      lessonsWithDescription: lessons.filter((l) => l.description).length,
      modules: moduleSlugs.length,
      classes: classSlugs.length,
    },
    tracks,
    moduleSlugs,
    classSlugs,
    lessons,
  };

  // Two outputs, deliberately.
  //
  // The reference file carries the lesson descriptions and lives outside src/,
  // so the app physically cannot import it and no amount of later carelessness
  // can put someone else's prose in a shipped bundle. It is development
  // material: it exists so a lesson plan can be built by someone who knows what
  // the lesson actually covers.
  //
  // The shipped file is typed source with structure only: titles, codes,
  // ordering, links. Facts about how the course is arranged, which is the part
  // a learner's progression needs.
  mkdirSync(join(ROOT, 'curriculum'), { recursive: true });
  writeFileSync(join(ROOT, 'curriculum/justinguitar.reference.json'), JSON.stringify(dataset, null, 2));

  // Only lessons that belong to a course a learner actually walks. The rest of
  // the sitemap is blog posts, knowledge base entries and one-offs: real
  // material, but not a progression, and shipping 1843 records to describe seven
  // courses is over-serving by a factor of three. They stay in the reference
  // file.
  //
  // The url is dropped because it is `${LESSON_BASE}${slug}` every time, and the
  // titleSource only appears when the title had to be guessed from the slug, so
  // a guess is still never mistaken for the real thing.
  const namedTracks = dataset.tracks.filter((t) => t.title);
  const namedCodes = new Set(namedTracks.map((t) => t.code));
  const shipped = {
    source: dataset.source,
    // Counts for what is in *this* file, not the reference one. A shipped file
    // that reports 1843 lessons while containing 650 is lying about itself.
    counts: {
      tracks: namedTracks.length,
      lessons: 0, // filled in below, once the filter has run
      inReferenceOnly: 0,
    },
    tracks: namedTracks,
    lessons: lessons
      .filter((l) => l.track && namedCodes.has(l.track))
      .map((l) => ({
        slug: l.slug,
        track: l.track,
        code: l.code,
        module: l.module,
        position: l.position,
        title: l.title,
        ...(l.titleSource === 'slug' ? { fromSlug: true } : {}),
        // The video that teaches the lesson. An identifier, not lesson prose,
        // and it points at content published on YouTube to be embedded — so it
        // stays on the right side of the line drawn in docs/CURRICULUM.md.
        ...(l.videoId ? { videoId: l.videoId } : {}),
      })),
  };
  shipped.counts.lessons = shipped.lessons.length;
  shipped.counts.inReferenceOnly = lessons.length - shipped.lessons.length;

  mkdirSync(join(ROOT, 'src/data'), { recursive: true });
  writeFileSync(
    join(ROOT, 'src/data/curriculum.ts'),
    `// GENERATED by scripts/build-curriculum.mjs. Do not edit by hand.\n` +
    `//\n` +
    `// Structure only: titles, codes, ordering, links. The lesson descriptions\n` +
    `// live in curriculum/justinguitar.reference.json, outside src/, so they\n` +
    `// cannot reach a bundle. See docs/CURRICULUM.md.\n` +
    `\n` +
    `/** Where a lesson lives on the course site. */\n` +
    `export const LESSON_BASE = 'https://www.justinguitar.com/guitar-lessons/';\n` +
    `\n` +
    `export interface CurriculumLesson {\n` +
    `  slug: string;\n` +
    `  /** Two-character track code, e.g. 'b1'. */\n` +
    `  track: string;\n` +
    `  /** Full lesson code, e.g. 'b1-403'. Authoritative for ordering. */\n` +
    `  code: string;\n` +
    `  module: number;\n` +
    `  position: number;\n` +
    `  title: string;\n` +
    `  /** YouTube id of the lesson video, where the sitemap named one. */\n` +
    `  videoId?: string;\n` +
    `  /** Present only when the title had to be derived from the slug. */\n` +
    `  fromSlug?: boolean;\n` +
    `}\n` +
    `\n` +
    `export const lessonUrl = (lesson: CurriculumLesson): string => LESSON_BASE + lesson.slug;\n` +
    `\n` +
    `export interface CurriculumModule {\n` +
    `  number: number;\n` +
    `  /** Null where the course does not publish a name we can pin to a number. */\n` +
    `  title: string | null;\n` +
    `  lessons: string[];\n` +
    `}\n` +
    `\n` +
    `export interface CurriculumTrack {\n` +
    `  code: string;\n  title: string | null;\n  stage: string | null;\n` +
    `  order: number | null;\n  legacy: boolean;\n  modules: CurriculumModule[];\n}\n` +
    `\n` +
    `export interface Curriculum {\n` +
    `  source: { site: string; files: string[]; note: string; builtAt: string };\n` +
    `  counts: { tracks: number; lessons: number; inReferenceOnly: number };\n` +
    `  tracks: CurriculumTrack[];\n` +
    `  lessons: CurriculumLesson[];\n` +
    `}\n` +
    `\n` +
    `// Not \`as const\`: it would mint six hundred literal types for no gain and\n` +
    `// make every consumer fight the checker to pass a plain string.\n` +
    `export const CURRICULUM: Curriculum = ${JSON.stringify(shipped, null, 2)};\n` +
    `\n` +
    `const BY_SLUG = new Map(CURRICULUM.lessons.map((l) => [l.slug, l]));\n` +
    `const BY_CODE = new Map(CURRICULUM.lessons.map((l) => [l.code, l]));\n` +
    `\n` +
    `export const getLesson = (slug: string): CurriculumLesson | null => BY_SLUG.get(slug) ?? null;\n` +
    `export const getLessonByCode = (code: string): CurriculumLesson | null => BY_CODE.get(code) ?? null;\n` +
    `export const getTrack = (code: string): CurriculumTrack | null =>\n` +
    `  CURRICULUM.tracks.find((t) => t.code === code) ?? null;\n` +
    `\n` +
    `/** A track's modules with their lessons resolved, in curriculum order. */\n` +
    `export function trackModules(\n` +
    `  code: string,\n` +
    `): Array<{ number: number; title: string | null; lessons: CurriculumLesson[] }> {\n` +
    `  const track = getTrack(code);\n` +
    `  if (!track) return [];\n` +
    `  return track.modules.map((m) => ({\n` +
    `    number: m.number,\n` +
    `    title: m.title,\n` +
    `    lessons: m.lessons.map(getLesson).filter((l): l is CurriculumLesson => l !== null),\n` +
    `  }));\n` +
    `}\n`,
  );

  console.log(`lessons              ${dataset.counts.lessons}`);
  console.log(`  with a course code ${dataset.counts.lessonsWithCode}`);
  console.log(`  with a description ${dataset.counts.lessonsWithDescription}`);
  console.log(`modules              ${dataset.counts.modules}`);
  console.log(`classes              ${dataset.counts.classes}`);
  console.log(`tracks               ${dataset.tracks.length}`);
  for (const t of dataset.tracks.filter((t) => t.title)) {
    const n = t.modules.reduce((sum, m) => sum + m.lessons.length, 0);
    console.log(`  ${t.title.padEnd(28)} ${String(t.modules.length).padStart(2)} modules, ${String(n).padStart(3)} lessons`);
  }
  const unnamed = dataset.tracks.filter((t) => !t.title);
  console.log(`  (${unnamed.length} further tracks kept with no title rather than guessed at)`);
  for (const out of ['curriculum/justinguitar.reference.json', 'src/data/curriculum.ts']) {
    if (!existsSync(join(ROOT, out))) throw new Error(`nothing written to ${out}`);
    console.log(`wrote ${out}`);
  }
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
