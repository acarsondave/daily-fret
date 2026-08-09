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

The lesson pages sit behind a Cloudflare bot rule. Every request for one returns
**403**, whether it comes from `curl`, from a headless browser, or from a
headless browser wearing a normal desktop user agent. `robots.txt` says
`Allow: /` and disallows only `/cms`, `/admin` and `/en`, but the operative
signal is the 403: the site has deployed a control that says "not automated
clients".

We do not work around it. No fingerprint spoofing, no challenge solving, no
proxies, no third-party mirrors of the blocked pages. That is the line, and it
does not move.

**What that line does not cover, and what a first pass wrongly treated as
closed.** "We are blocked" is not the same as "there is nothing else", and
stating the 403 is not the same as looking. Re-probed 2026-08-09:

- `/sitemap.xml`, `/video-sitemap.xml`, `/robots.txt` — **200**, as before.
- `/guitar-lessons/...`, `/modules/...`, `/classes/...`, `.json` variants,
  `/feed`, `/rss` — **403**.
- `/api/v1/...` — **404 rendered by Rails** (`x-request-id`, `x-runtime`
  present), so that namespace is not covered by the bot rule. No route exists
  there; guessing further would be scanning someone's server, so it stopped.
- The main sitemap lists module URLs once per lesson, but shuffled, so adjacency
  encodes no membership. That lead is dead.

**What looking actually recovered.** The video sitemap has always carried the
YouTube id of the video that teaches each lesson, inside the thumbnail URL:
`i.ytimg.com/vi/<id>/hqdefault.jpg`. The first build of this dataset parsed the
title and description out of those blocks and threw the id away. It is kept now:
**1048 of 1843 lessons overall, and 73/74 of Beginner Grade 1 and 21/21 of
Grade 2** — the courses this app is built around.

The user agent no longer claims to be Chrome either. The sitemaps serve a plain
client at 200, so the spoof bought nothing, and a script that declines to work
around an access control should not be dressing up as a browser three lines
later.

The cost that remains, stated plainly: the prose on a lesson page below the
video is not available, and the video description is truncated at about 2048
characters. The description is usually a fair summary of the same lesson, so the
loss is smaller than it sounds, but it is real.

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


## What is still missing, and the only honest ways to get it

**Grade 3 has no lesson codes at all.** There is a class page
`/classes/beginner-guitar-course-grade-three`, but no lesson slug carries a `b3`
code, and nothing in either sitemap says which lessons belong to it. `bc-1xx` is
the *legacy* Beginner Course, not Grade 3. Grade 2 is coded only for modules 8
and 9. Class-to-lesson membership is likewise only on the blocked HTML.

Two routes exist that do not cross the line, and both need a decision that is
not the build script's to make:

1. **A YouTube Data API key.** Justin publishes every lesson on his own channel,
   organised into playlists by grade. We now hold a lesson-to-video mapping, so
   video-to-playlist would give grade and ordering from the author's own
   published structure, through an official API. Needs a free Google API key.
2. **Ask.** The course structure is a small amount of information, and Justin's
   team can simply say what it is or point at a feed.

Until one of those happens the dataset states what it knows and leaves Grade 3
out rather than guessing at it.
