# The curriculum database

The complete JustinGuitar course structure and lesson text, captured from the
site and reshaped into something we can reason from grade by grade.

Nothing in this directory is imported by the app. It lives outside `src/` so
the bundler physically cannot pull four megabytes of lesson prose into a
browser. `src/data/curriculum.ts` carries the structure the app ships with; this
is the source that structure is checked against and built from.

## The files

| File | What it is |
|---|---|
| `lessons/lessons.json` | The raw capture, one record per lesson, exactly as read |
| `justinguitar.db.json` | The database: grade to course to module to lessons, with every word |
| `justinguitar.index.json` | The same tree with the bodies removed, for reading and diffing |
| `justinguitar.reference.json` | Older sitemap-derived reference, kept until the build moves across |

## Rebuilding

```sh
node scripts/build-lesson-db.mjs
```

Recapturing needs a browser, because the lesson pages return 403 to anything
else. Paste `scripts/capture-lessons.js` into DevTools on any justinguitar.com
page. It checks one known lesson first and refuses to start if any field the
curriculum needs is absent, so a bad run costs two seconds rather than a
quarter of an hour. About ten minutes for all 1843.

## What the shape says

`grade` belongs to the **lesson**, and a module inherits it. It is not a
property of a course: the classic beginner course carries lessons at grades 1,
2 and 3 at once, and 140 of 142 modules hold exactly one grade while two
genuinely span three. `gradesPresent` records that rather than picking one.

`lessonCount` is the module's true size. `listed` is how many the site names.
The difference is `paidNotListed`, and it is always stated: the site's chapter
roll silently omits paid lessons, so 126 lessons exist that we know the count
of but not the names. A gap that is stated is data; a gap quietly closed up is
a lie about the course.

Lesson order comes from the site's own roll, never from sorting our own keys,
so taught order survives and an absent lesson keeps its position.

## What is here

1276 readable lessons across 142 modules, plus 126 paid lessons the site does
not list. The beginner spine is complete: **modules 0 to 22**, 204 of 210
lessons readable, the six absent ones being Justin's paid material.

| Grade | Belt | Modules | Lessons |
|---|---|---|---|
| 0 | Spectrum | 56 | 478 |
| 1 | White | 18 | 213 |
| 2 | Yellow | 11 | 101 |
| 3 | Orange | 15 | 121 |
| 4 | Green | 10 | 132 |
| 5 | Blue | 9 | 66 |
| 6 | Purple | 13 | 106 |
| 7 | Red | 7 | 32 |
| 8 | Brown | 1 | 7 |

Grade 0 is not a grade in the course sense. It is everything outside the graded
path: the Playground, the Knowledge Base, Production, Ukulele, and so on.

Grade 3 was thought to be missing for a long time. It was not: those lessons
use `BG-15xx` to `BG-22xx` reference codes rather than `B3-xxx`, so every search
for `b3-` came back empty. `course.reference` and `grade.position` are the
reliable keys, not the shape of a slug.

## Scope

Lesson bodies are Justin's writing. They are here as a development reference so
that a drill built for a lesson matches what that lesson actually teaches. They
are not redistributed and they do not ship in the app.
