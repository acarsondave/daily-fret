# Captured course structure

Drop `<track>.json` files here, produced by `scripts/capture-course.js`.

They exist for one reason: the class and module pages return 403 to automated
clients, and this project does not go around that. Everything else in the
dataset comes from the two sitemaps the site publishes for crawlers. What those
sitemaps genuinely cannot answer is which lessons belong to which module of a
grade whose slugs carry no lesson code — Grade 3 has no `b3` codes at all, and
Grade 2 is coded only for modules 8 and 9.

A person reading the course in their own browser is not an automated client, and
that structure is on the page in front of them. `scripts/capture-course.js` is a
console snippet that reads the DOM already loaded, groups the lesson links under
their headings, and copies JSON here. No network requests, no credentials, no
automation of anything the reader is not already doing by hand.

## The rule the build enforces

**The sitemap is authoritative wherever it speaks. A capture may only fill
silence.** A capture that disagrees with an existing lesson code fails the
build rather than quietly overwriting it: a hand capture is the less trustworthy
of the two and must never win. Slugs the sitemap has never heard of are named in
the build output rather than dropped.

## Shape

```json
{
  "track": "b3",
  "title": "Beginner Grade 3",
  "stage": "beginner",
  "order": 3,
  "source": "https://www.justinguitar.com/classes/beginner-guitar-course-grade-three",
  "capturedAt": "2026-08-09",
  "modules": [
    { "number": 10, "title": "Module name", "lessons": ["a-lesson-slug", "another"] }
  ]
}
```

Lesson order within a module is the array order, which is the order the course
teaches them in. Module numbers run continuously across the beginner grades:
Grade 1 is 1-7, Grade 2 is 8-9, so Grade 3 starts at 10.
