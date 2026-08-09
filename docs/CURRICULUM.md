# Curriculum data

Where the course structure comes from, what we do and do not take, and why.

## Source

Two files, both published by justinguitar.com for crawlers and both served at
200 to anyone who asks:

- `/sitemap.xml` — every URL on the site. 1843 lessons, 189 modules, 29 classes,
  794 songs.
- `/video-sitemap.xml` — per-lesson `<video:title>` and `<video:description>`.
  1557 of the 1843 lessons have one.

`scripts/build-curriculum.mjs` reads those two files and nothing else.

## What we deliberately do not do

The lesson pages themselves sit behind a Cloudflare challenge. Every request for
one returns **403** with an interstitial, whether it comes from `curl`, from a
headless browser, or from a headless browser wearing a normal desktop user
agent. `robots.txt` says `Allow: /`, but the operative signal is the 403: the
site has deployed a control that says "not automated clients".

We do not work around it. No fingerprint spoofing, no challenge solving, no
proxies. That would be evading an access control, and the goal here does not
need it.

The cost of that decision: the prose on a lesson page below the video is not
available. The video description is usually a good summary of the same lesson,
so the loss is smaller than it sounds, but it is a real gap and it should be
stated rather than papered over.

## What the codes mean

Every course lesson's slug ends in a code: two characters for the track, then a
digit for the module, then two for the lesson within it.

    the-d-minor-chord-b1-402
                      ^^ ^ ^^
                      |  | └── second lesson of the module
                      |  └──── module 4
                      └─────── track b1, Beginner Grade 1

**The code is authoritative for ordering, and the course page is not.** A
module's position in the visual outline does not match its internal number,
because "Before You Begin" sits at the front of the list without being module 1.
`/modules/capo-minor-chords-up-strums` renders fourth and is module **3**.

Module numbers also run continuously across the beginner grades: Grade 1 is
modules 1 to 7, and Grade 2 picks up at 8. Nothing in the build assumes a course
starts at module 1.

The mapping from a track code to a human name is not in any published file, so
`TRACKS` in the build script states it. Codes not listed there still appear in
the output with a `null` title rather than being dropped or guessed at.

## Two outputs

**`curriculum/justinguitar.reference.json`** — everything, including the lesson
descriptions. Development material. It lives outside `src/` so the app
physically cannot import it: no amount of later carelessness can put someone
else's prose into a shipped bundle. It exists so that a lesson plan can be built
by someone who knows what the lesson actually covers.

**`src/data/curriculum.ts`** — generated typed source. Structure only: titles,
codes, module numbers, ordering. Filtered to the tracks that are actually
courses a learner walks; blog posts and knowledge-base entries stay in the
reference file. About 650 lessons across 15 named tracks.

## Rebuilding

    node scripts/build-curriculum.mjs

Or against files already on disk, which is what tests use:

    node scripts/build-curriculum.mjs --offline <dir-with-both-sitemaps>

Both outputs are regenerated. `src/data/curriculum.ts` is generated: do not edit
it by hand.

## Known gaps

- Grade 2 has only modules 8 and 9 coded `b2` in the sitemap. Its later modules
  are either coded differently or absent. Grade 3 has no `b3` codes at all.
- Class pages exist in the sitemap but never say which lessons belong to them,
  so course membership comes from the lesson code alone.
- 573 lessons have no course code. They are real lessons, they are in the
  reference file, and they are not part of any progression.
