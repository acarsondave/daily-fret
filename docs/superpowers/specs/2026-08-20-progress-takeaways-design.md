# Progress, rebuilt on takeaways

Design, 2026-08-20. Not implemented. Hand this to an implementing agent.

Companion to `docs/superpowers/specs/2026-08-20-recall-subsystem-design.md` (commit
`7b4cdaf`). That document owns the model and the drills. This one owns the
surface. Section 12 states what this surface needs from that model so the two can
be reconciled rather than guessed at.

## 1. The complaint, and what it turned out to be

The owner, verbatim:

> on our progress/progression, instead of showing videos and etc of what or how
> we progressed in each lesson, we can do it progression based on required
> takeaways from the modules, meaning that each takeaway would have been
> practiced by us as a routine, and we would have learnt it, and then it would
> support auto ticking itself and progressing with us etc. But this is an idea to
> brainstorm about, my point is that the progress section feels too texty and
> bogus and not fully representing as it should.

"Too texty" and "bogus" are two symptoms of one defect, and the defect is
measurable. Everything in section 2 was measured against the running build, not
inferred from reading the source.

## 2. The diagnosis, measured

### 2.1 The surface is mostly not about the person reading it

A production build was served and driven with Playwright. Two accounts, identical
in every respect except practice history: one with forty days of logs across four
chord pairs and a Chord Perfect pool, one with none. Both standing on
`b1-504`, Module 5. Visible text nodes counted, excluding anything
`display:none`, `visibility:hidden`, or inside `[aria-hidden="true"]`.

```
Journey tab, practised account      389 words
Journey tab, day-one account        349 words
Words that differ between them      112
```

**Two hundred and seventy-seven of 389 visible words, seventy-one per cent, are
byte-identical whether you have practised for forty days or opened the app this
morning.** That is the whole of "bogus", stated as a number. The dominant content
of a progress surface is a course catalogue, and a course catalogue says the same
thing to everybody.

Of the 112 words that do move, about thirty are the playable-songs list, which is
the best thing on the panel and is discussed in section 10.

The Numbers tab measures 106 words and is not the problem. Almost all of its text
is data: pair names, values, dates, units. It is discussed in section 10 too.

### 2.2 The mapping is many-to-many, so a module row cannot answer its own question

The coordinator's hypothesis was that textiness is caused by an approximate
mapping between the product's invented skill taxonomy and the course's lessons,
and that explanation is what you write when a relationship is approximate.

That is correct, and it is stronger than a hypothesis. Parsing
`src/data/skills.ts` against the module membership in
`curriculum/justinguitar.db.json`:

```
Skills carrying lesson codes                30
Skills whose lessons span more than one module   9   (30 per cent)
```

| Skill | Lessons | Modules |
|---|---|---|
| `setup.holding` | b1-102 b1-304 | BG00 BG03 |
| `technique.finger-placement` | b1-103 b1-113 | BG00 BG01 |
| `technique.anchor-fingers` | b1-109 b1-202 | BG01 BG02 |
| `changes.one-minute` | b1-110 b1-206 b1-702 | BG01 BG02 BG07 |
| `rhythm.on-the-beat` | b1-111 b1-204 b1-205 | BG01 BG02 |
| `rhythm.patterns` | b1-307 b1-404 b1-502 b1-503 | BG03 BG04 BG05 |
| `riffs.single-note` | b1-207 b1-309 b1-406 b1-506 | BG02 BG03 BG04 BG05 |
| `songs.play-along` | b1-114 b1-208 b1-310 b1-407 b1-507 b1-607 | BG01 to BG06 |
| `theory.note-names` | b1-504 b1-605 | BG05 BG06 |

`songs.play-along` is rendered as a row inside six different modules, carrying the
same standing in all six. There is no answer to "did I meet Module 3's song
requirement" because the unit being drawn cannot hold that question. The panel
then writes sentences to cover the gap, which is why `journeyCopy.ts` exists and
why it is 142 lines of sentence generators for a panel with no paragraphs in it.

So the causal chain is: many-to-many mapping, therefore no module-level answer,
therefore prose that explains the mapping instead of reporting a result. About a
hundred of the 389 words are that prose: `shapeOf` (17), `kindNote` (23),
`countLine`'s "nothing here the app can score yet", `outsideNote` (up to 24), "Not
measured yet", "Taught here, not drilled", "No change drill has used E yet."

### 2.3 The third defect, and it is the one the owner is most afraid of

Verified in `src/lib/progression.ts` at line 578:

```js
      // Only a skill the app can put a number on is allowed to hold another one
      // back. Anything else is a recommendation, and the taxonomy says so.
      .filter((s) => s.measure.kind === 'measured');
```

`rhythm.patterns` requires `rhythm.up-strums` requires `rhythm.on-the-beat`.
`rhythm.up-strums` is `measure.kind: 'measurable'` with no drill behind it, so it
is filtered out of `blockedBy` entirely. An undrilled prerequisite is not merely
unpractised: it is invisible to the progression graph and structurally cannot hold
anything back. The owner has been drilled hard on THE pattern (b1-404, Module 4)
while the counting-ands lesson it rests on (b1-305, Module 3) could never gate it
and has never once been asked about.

The recall subsystem's audit, reproduced independently, puts a size on this:

```
Grade 1 lessons taught (modules 0 to 7)      75
Mapped to a skill with a drill behind it     26
Mapped to a skill the app has never asked    35
Mapped to no skill at all                    15
```

His own words: "it's self taught, so I must not miss anything, or find myself
later on saying ah, I should've done this earlier, when it was things I was indeed
taught but neglected." Thirty-five lessons of that, today, invisible on the
surface whose job is to show it.

### 2.4 Verdict

The coordinator's diagnosis is right about the cause of textiness and incomplete
about the cause of bogusness. Both come from one root: **the app has no unit that
is simultaneously the course's own and something the app can hold a result
against.** So it draws two units side by side, the course's (210 lesson rows it
can say nothing about) and its own (30 skill rows that do not line up with
lessons), and spends prose on the seam.

The owner's proposal supplies the missing unit. Everything below builds on it.

## 3. What a takeaway is

**A takeaway is one claim the learner should be able to make at the end of a
module, bound to exactly one thing the app knows how to look for.**

Three decisions inside that sentence, each argued.

### 3.1 Granularity: a set per module, not one per lesson

One per lesson would be 210 rows for the beginner course and would force a
takeaway out of "Songs For Module 5", "Module 5 Practice", and "Grade 1 Feedback
Please!", which teach nothing. Fifteen of Grade 1's 75 lessons are course admin of
exactly this kind.

A set per module is three to five rows, about 36 for Grade 1 and about 100 for the
whole beginner course. That is a surface you can see at once instead of a
catalogue you scroll.

It is also the owner's own phrasing ("required takeaways from the modules") and it
is the granularity the course itself uses. Which brings the next decision.

### 3.2 Authorship: the course states them, and we transcribe rather than invent

This is the finding that decides the whole design. **Every beginner module from 3
onward ends with a lesson containing a section headed "YOU'LL BE READY TO MOVE ON
WHEN...", followed by four or five bullet items.**

Module 5 (`b1-508`), verbatim from `curriculum/justinguitar.db.json`:

```
YOU'LL BE READY TO MOVE ON WHEN...
You can get around 30 chord changes in one minute
You've memorized all of the chords you've learned so far - A, D, E, Am, Dm, Em, and C
You're feeling more confident with rhythm and are fairly consistent with keeping
  the hand moving, preferably with a metronome
You can get through the Come As You Are Riff. Not perfect, but have some fun with it!
You're able to play at least one song that uses the C Chord most of the way through.
```

The codebase already reads this section. `readiness.ts` says so:

> Justin's own gate, stated in the practice routine lesson of every beginner
> module: "you can get around 30 chord changes in one minute". The app did not
> invent this one and should not present it as its own.

`CHANGES_BAR = 30` is one takeaway, already harvested. The design is to harvest
the rest.

Coverage, scanned across all 23 numbered beginner modules:

```
Modules with an explicit exit-criteria section    3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 22
Grade-level criteria instead                      7  (b1-710, "How to PASS Grade 1", five numbered items)
No stated criteria                                0, 1, 2, 15 to 21
```

So the course states them for most of the path and not all of it. That is a fact
about the source and the design must not paper over it, which is what `statedIn`
in section 4 is for.

**Who authors a takeaway for a second learner's course.** Nobody, until they
supply one. Takeaway data is per track, and `takeawaysFor(track)` returns an empty
array for a course nothing has been authored against. The surface degrades to what
it can honestly draw (section 10.4). The JustinGuitar table is one authored data
set, not a privileged one, and the build script that produces it is an importer.

**What ships.** Not Justin's wording. `curriculum/README.md` is explicit that
lesson bodies "are here as a development reference" and "do not ship in the app",
and the takeaway table honours that: what ships is our own four-to-eight-word noun
phrase plus the lesson code it was read from. A test asserts the citation still
resolves and that the cited lesson still contains an exit-criteria section, run
against the development database, which is exactly what that database is for.

### 3.3 Relation to `skills.ts`: it sits above, and neither replaces nor derives

**It cannot derive from `skills.ts`.** Deriving a module's takeaways from the
skills touching that module's lessons reproduces the many-to-many mapping in
section 2.2 exactly: `songs.play-along` would appear as a derived takeaway in six
modules and `theory.note-names` in two. Derivation is the defect.

**It must not replace `skills.ts`.** The taxonomy holds two things a takeaway
cannot: prerequisite structure (`requires`) and measurement capability
(`measure`). Both are product knowledge, not course knowledge. Folding them into
curriculum data would mean a second learner's imported course had to declare what
Daily Fret's microphone can hear, which inverts the platform commitment that the
curriculum is data and the drills are the product's.

**So it sits above.** A takeaway names exactly one skill (or one derived set of
them) as its proof, and the arrow points one way, from course to product. The
mapping stops being approximate because it is authored singular and required,
which is the same move the recall subsystem makes with `taughtBy`:

> Singular and required. Not "lessons that touch it": the only question this
> answers is whether the course has said the thing yet, and a list cannot answer
> it.

A takeaway is to a module what a recall item is to a lesson. Both are single
arrows into the product's taxonomy, and both exist because a bag of references
cannot answer a question about one thing.

## 4. The data

New file, `src/data/takeaways.ts`.

```ts
export type TakeawayProof =
  /** One skill, judged by its own standing. */
  | { of: 'skill'; skill: string }
  /** Every chord skill the course has taught at or before this module. */
  | { of: 'chords'; through: string }
  /** Every pair among those chords. */
  | { of: 'pairs'; through: string };

export interface Takeaway {
  /**
   * Stable, and deliberately not stored anywhere. Nothing about a takeaway is
   * persisted (section 5.4), so this is a React key and a test handle and
   * nothing else. Renaming one cannot corrupt a record, because there is no
   * record.
   */
  id: string;
  /** The module that requires it, as the course's own reference: 'BG05'. */
  module: string;
  /**
   * The lesson where the course states this requirement, or null where the
   * course states none and this is Daily Fret's reading of what the module
   * taught. Modules 0, 1, 2 and 15 to 21 carry null. A test asserts every
   * non-null value resolves through getLessonByCode AND that the cited lesson
   * body still holds an exit-criteria section, so a curriculum rebuild that
   * moved the text fails loudly instead of leaving a stale citation.
   */
  statedIn: string | null;
  /** The lesson that teaches the thing. The row's title links here. */
  taughtIn: string;
  /**
   * Four to eight words. Ours, never the course's prose.
   *
   * A noun phrase, never a sentence, never second person. "30 changes a minute",
   * not "You can get around 30 chord changes in one minute". Two words per row
   * saved across a hundred rows, and it drops the congratulatory register the
   * product forbids. It also must not enumerate what a mark already draws: the
   * chords claim reads "Every chord so far, from memory" and the grid says which
   * chords, because a label that repeats its own figure is the figure failing.
   */
  claim: string;
  proof: TakeawayProof;
}
```

### 4.1 Grade 1, authored

Thirty-six takeaways. Modules 3 to 6 are the course's own list; module 7 is
`b1-710`'s five numbered criteria; modules 0, 1 and 2 are ours, and say so through
`statedIn: null`.

| Module | Claim | Proof | Stated in |
|---|---|---|---|
| 0 | Guitar in tune before playing | `setup.tuning` | (ours) |
| 0 | Read a chord box | `theory.chord-boxes` | (ours) |
| 0 | Fingertips, behind the fret | `technique.finger-placement` | (ours) |
| 0 | Hold the pick | `setup.pick` | (ours) |
| 1 | A and D under the hand | chords through BG01 | (ours) |
| 1 | 30 changes a minute | pairs through BG01 | (ours) |
| 1 | Strum only the strings the chord uses | `technique.string-accuracy` | (ours) |
| 1 | A song with A and D | `songs.play-along` | (ours) |
| 2 | E under the hand | chords through BG02 | (ours) |
| 2 | Strum on the beat | `rhythm.on-the-beat` | (ours) |
| 2 | Foot on the beat | `rhythm.foot` | (ours) |
| 2 | Peter Gunn riff | `riffs.single-note` | (ours) |
| 3 | Every chord so far, from memory | chords through BG03 | b1-311 |
| 3 | 30 changes a minute | pairs through BG03 | b1-311 |
| 3 | Seven Nation Army riff | `riffs.single-note` | b1-311 |
| 3 | A song using Am or Em | `songs.play-along` | b1-311 |
| 4 | 30 changes a minute | pairs through BG04 | b1-408 |
| 4 | Every chord so far, from memory | chords through BG04 | b1-408 |
| 4 | Old Faithful, with a metronome | `rhythm.patterns` | b1-408 |
| 4 | Sunshine Of Your Love riff | `riffs.single-note` | b1-408 |
| 4 | One song, most of the way through | `songs.play-along` | b1-408 |
| 5 | 30 changes a minute | pairs through BG05 | b1-508 |
| 5 | Every chord so far, from memory | chords through BG05 | b1-508 |
| 5 | Hand keeps moving to a click | `rhythm.metronome` | b1-508 |
| 5 | Come As You Are riff | `riffs.single-note` | b1-508 |
| 5 | One song using C | `songs.play-along` | b1-508 |
| 6 | 30 changes a minute | pairs through BG06 | b1-608 |
| 6 | Every chord so far, from memory | chords through BG06 | b1-608 |
| 6 | Alternate picking on one string | `technique.alternate-picking` | b1-608 |
| 6 | Strumming in 6:8 | `rhythm.six-eight` | b1-608 |
| 6 | One song using G | `songs.play-along` | b1-608 |
| 7 | Tune it with a tuner | `setup.tuning` | b1-710 |
| 7 | Eight chords, right sound over half the time | chords through BG07 | b1-710 |
| 7 | 30 changes a minute | pairs through BG07 | b1-710 |
| 7 | Old Faithful at 80 bpm | `rhythm.patterns` | b1-710 |
| 7 | Five songs from memory | `songs.memorise` | b1-710 |

A hazard worth naming once: b1-710's fourth criterion is 80 beats per minute and
`RHYTHM_BAR` is 80 per cent. Two different eighties about the same drill. The
`rhythm.patterns` proof must read both, the score against `RHYTHM_BAR` and the
tempo the run was played at, and the mark must not print an unqualified 80.

### 4.2 The evidence the app can actually bring, today

Each of the 36 resolved through `skills.ts`'s `measure.kind`:

```
Heard      (a drill exists and produces a number)     17
Timed      (minutes are the measure, no bar exists)    6
Said       (a claim, and only ever a claim)            1
Not askable(the app has nothing it could ask)         12
```

**A third of Grade 1's required takeaways are things the app currently cannot ask
about at all.** If the surface drew 36 identical checkmarks, twelve would be lies
and six would be attendance. That is not a hypothetical risk of the tick-based
design; it is its arithmetic. Section 6 is the response.

After the recall subsystem lands, chord boxes, foot tapping, tab reading and capo
arithmetic become askable and the not-askable column falls to roughly eight:
tuning, finger placement, string accuracy, alternate picking, 6:8, dynamics, air
changes, and single-note riffs pending a component.

## 5. What proves a takeaway

### 5.1 One rule, and it already exists

The three-run rule in `src/lib/readiness.ts`: cleared its bar on the last
`HELD_RUNS` runs, and still fresh within `STALE_DAYS`. Auto-ticking is that rule
and nothing else.

`journeyCopy.ts`'s header records what happens when this is violated:

> The app had two vocabularies for "good enough": lib/readiness.ts owned Held,
> three runs running at the bar and still fresh, while lib/progression.ts called
> a skill solid on one best-ever result. Printing "Solid" here while Numbers
> printed "1 of 3" for the same pair was the app disagreeing with itself.

There is not going to be a third. A takeaway's standing is a **projection of the
`SkillStanding` its proof names**, computed by `allStandings()`, which already
runs `readiness()`. This design adds no bar, no threshold, and no word for good
enough.

Section 6 goes further: the rule stops being a vocabulary at all and becomes a
shape. There is exactly one meaning of good enough and it is now drawn as well as
named, so the two cannot drift.

### 5.2 The standing

New file, `src/lib/takeawayStanding.ts`.

```ts
export type TakeawayStanding =
  /** Cleared the bar on the last three runs, still fresh. */
  | { kind: 'held';     runs: DrillRun[]; bar: number; everHeld: boolean }
  /** Was held; nothing heard since it went cold. */
  | { kind: 'lapsed';   runs: DrillRun[]; bar: number; daysCold: number; everHeld: true }
  /** Heard, not there yet. runs may be empty: never asked is not a failure. */
  | { kind: 'working';  runs: DrillRun[]; bar: number; banked: number; everHeld: boolean }
  /** Minutes are the measure. No bar exists, so nothing can clear. */
  | { kind: 'logged';   sessions: string[] }
  /** The learner said so, on a date. */
  | { kind: 'said';     at: string }
  /** The app has nothing it could ask. The product's gap, not the learner's. */
  | { kind: 'unaskable'; why: string }
  /** A set proof: every member, each with its own standing. */
  | { kind: 'set';      members: { label: string; standing: TakeawayStanding }[] };

export function takeawayStanding(
  t: Takeaway,
  standings: readonly SkillStanding[],
  evidence: Evidence,
  today: string,
): TakeawayStanding;
```

`unaskable.why` comes straight from `skill.measure.needs`, which the taxonomy
already states in the product's own terms.

### 5.3 Two things `progression.ts` must expose

Both additive, and the visual design in section 6 does not work without the first.

**a. `SkillStanding.recent: DrillRun[]`.** The last `HELD_RUNS` runs the standing
was judged on, chronological. `measure()` already computes these to call
`readiness()`; `Measurement` keeps only `runs: number`, the count. The count is
enough for a sentence and not enough for a picture, which is precisely the
substitution this design is making.

**b. `Evidence.sessions: Map<string, string[]>`.** Skill id to the dates on which
a task backed by it ran to its end. Needed for the timed mark, which has no bar
and therefore no series. Read `TaskRecord.ranToEnd`, never elapsed seconds,
because `src/types/index.ts` already settled that question: "A timer for this task
reached zero at least once. This, not elapsed time, is what earns a timed task its
completion: skipping is not doing." The task-to-skill mapping does not exist today
and is the one genuinely new piece of plumbing here.

### 5.4 Nothing about a takeaway is persisted

Derived on every read from `dailyLogs` plus `claimedSkills`. Storing a ticked
takeaway would create a second source of truth for good enough, which is the
failure `journeyCopy.ts`'s header exists to remember. It also means the whole
surface has no sync surface, no merge rule, and no migration: two devices
practising offline cannot disagree about a takeaway, because neither of them holds
one.

## 6. The marks

This is where the current surface fails hardest, and the standard is set inside
this codebase rather than imported. `NoteCircle.tsx`:

> a relationship written in a sentence has to be believed, while a relationship
> drawn as two figures that move together is just watched. So there is no
> explanatory copy on this surface at all.

`craft-floor.md` names the trap on the other side: "Sparklines, progress rings,
and soft-shadowed rounded rectangles standing in for content." So the answer is
neither prose nor a ring.

### 6.1 The governing idea: one object at four zooms

Everything drawn on this surface is the three-run rule at some scale. Not a
metaphor for it, and not a summary of it: the rule's own three positions, drawn.

```
  full series  ->  three runs  ->  one grid cell  ->  one wall cell
  (a chart)        (the mark)      (a set member)     (a takeaway)
```

Zooming out never changes the object, only how much of it fits. That is what stops
a second vocabulary appearing at any level.

### 6.2 The runs mark

For `held`, `lapsed` and `working`, which are one shape at three readings.

A horizontal **bar line** at the bar's value, and up to three **vertical strokes**
standing at the true heights of the last three runs. Nothing else. Three
positions, because the rule has exactly three, and each stroke is one run rather
than a share of a total.

- Three strokes over the line: held. This is the tick, and it ticked itself.
- Two over and one under: two banked. The reader can see which run broke it and
  when, which "2 of 3" cannot say.
- No strokes at all: never asked. The line is drawn on its own, so the row states
  what it would take without scoring practice that never happened. This preserves
  the rule `Figure` already follows in `JourneyPanel.tsx`: "Nothing measured is
  not a score of nothing."
- Lapsed: the strokes are drawn hollow. The evidence has not been withdrawn, it
  has stopped being current, which is exactly what hollow says. Same instinct as
  the existing hollow tick.
- `everHeld`: a hairline notch in the baseline that never disappears. This is the
  sticky `proven` flag, which nothing renders today.

The notch needs its constraint stated, because `readiness.ts` is explicit that
`everHeld` "asks whether the player has ever shown they can do it reliably" and
that "nothing that reports competence should read it: that has to be current". The
notch is not competence. The strokes say what is true now; the notch says this was
once true. Two facts, two marks, neither wearing the other's clothes.

**Geometry cannot round.** `readiness.ts` carries a whole function, `figure()`, to
stop a run of 29.6 printing as 30 against a bar of 30. A stroke drawn at its true
height sits below the line and no rule is needed. This is a case where drawing is
strictly more honest than printing, and it is worth saying out loud because it is
the shape of the argument for the whole section.

### 6.3 The other three marks, and why they cannot be confused

The brief's absolute constraint is that a ticked takeaway carries which kind of
evidence ticked it, and that a row of identical ticks where some are measured and
some are self-reported is worse than the problem it solves.

The response is not four badges on one shape. It is four different **quantities
and shapes of evidence, drawn at their true size**, so the kind is not annotated,
it is structural.

| Kind | Mark | Why it cannot be mistaken for another |
|---|---|---|
| Heard | bar line plus up to three strokes | The only mark with a line and strokes together |
| Timed | no line at all, one short tick per completed session along a baseline | There is no bar to clear, so there is no line to be above, so it can never read as held |
| Said | one hollow lozenge at one date | A claim is a single event, not a series. One mark, never three |
| Not askable | the bar line drawn dashed, and nothing on it | The app draws the evidence it would need and admits it has none |

**No checkmark appears anywhere on this surface.** The mark that says done is the
third stroke landing above the line, which is the same mark that shows how it got
there.

The timed row is the important one to get right. `songs.play-along` and
`songs.memorise` are `timed`, and the product's rule is that it "does not
congratulate the user for showing up". A timed mark accumulates ticks and never
completes, because minutes on the instrument are a real thing to record and are
not a verdict. Six of Grade 1's 36 takeaways are timed, and none of them will ever
look finished. That is correct and it should not be softened.

### 6.4 How they still read as one picture

Because uniformity lives in the frame and difference lives in what fills it. Every
mark shares one baseline, one cell width, one left origin, one ink. The reader
scans a column of identically framed cells whose contents differ, which is how a
table of numbers reads as one object while every number differs. Four decorated
variants of one shape would read as noise; four different amounts of evidence in
one frame reads as a record.

### 6.5 Set proofs, and the best drawing on the surface

`{ of: 'pairs', through: 'BG05' }` is every pair among the chords taught through
Module 5. Seven chords, twenty-one pairs. Drawn as the **lower triangle of a
seven by seven chord matrix**, one cell per pair, each cell filled by that pair's
own banked runs out of three. `{ of: 'chords' }` is the same logic in one row.

A grid cell is the runs mark at its smallest, so this is not a fifth mark, it is
zoom three of the same object.

Two things fall out of this for free, and they are the two hardest requirements in
the brief.

**It shows avoidance.** A pair never drilled is an empty cell inside a filled
triangle. Nothing on the surface today can show that the learner has been quietly
skipping A to Dm for two months.

**It is the long look back, drawn.** "30 changes a minute" is not one takeaway
repeated five times across Modules 3 to 7. The claim is constant and the job
widens: a ten-cell triangle at Module 3, a twenty-eight-cell triangle at Module 7.
Put the Module 3 triangle next to the Module 7 triangle and that is a year of work
in one picture, with no sentence and no number. This is the single most valuable
artefact this design produces and it costs nothing extra, because the data is
`pairStats` and `readiness()` as they already stand.

### 6.6 Where the words go instead

Every fact the marks carry must reach a screen reader, and the accessibility tree
is where those words legitimately live. Each cell carries an accessible name
holding the claim, the kind of evidence, the standing, and the numbers, generated
from the same standing the mark is drawn from so the two cannot disagree.

This is the clean resolution of show-do-not-tell against assistive technology: the
screen carries no sentence, the tree carries all of them, and neither is a
degraded copy of the other. The wall is a grid, so it takes roving tabindex and
arrow keys, following the pattern the existing tablist in `DailyPath.tsx` already
uses. PRODUCT.md lists "task rows not keyboard operable" and "no visible focus
states" as known gaps that the stranger's-first-session commitment makes material;
this surface does not get to add to that list.

The only motion is a stroke arriving when a run lands, and it respects
`prefers-reduced-motion` the way `NoteCircle.tsx` already does.

## 7. The surface

**Where it lives, and where it does not.** This stays exactly where it is: a panel
inside the Progress modal, opened deliberately between sessions. Nothing here
moves into coached mode and nothing here is a drill. A reference surface is
allowed to be a reference surface, and a record of the whole course is the
clearest case of one: it is read when the guitar is down, not while both hands are
on it. The rail is the right home for it.

The distinction that matters is drills, not panels. A drill that only exists as a
rail panel is a drill nobody runs, which is part of why the note finder failed in
live use. A record that only exists as a rail panel is a record in the right
place. This design moves no drill onto the rail and no panel off it.

The one action the surface offers (section 7.4) hands off to the existing practice
path rather than running anything itself.

One panel, three zooms, no navigation. PRODUCT.md forbids page navigation, so all
three are the same panel resolving further.

### 7.1 Zoom one: the course wall

New component, `CourseWall.tsx`. Replaces `Spine`.

Horizontal axis is taught order, left to right. Each module is a block; each
takeaway in it is one cell. A cell's fill is its banked runs out of three, drawn as
three slices, so a wall cell is a runs mark rotated and shrunk. Said cells are
outlined. Timed cells are hatched. Not-askable cells are hairline-dashed and are
grouped at the foot of their module's block, so "the app has nothing to ask here"
reads as a band of the app's own missing work rather than as the learner's
failure. The grouping is the signal and it costs no words.

A **position line** stands at the current module. Everything to its left is taught
and therefore owed.

Paid lessons the course counts but refuses to name are drawn as hairline cells in
the block. `paidGap()` spends 24 words saying this today. A gap that is stated is
data, and a hairline is a statement.

Scale: Grade 1 is 36 cells. The whole beginner course is about 100. Grade 8 is a
few hundred, still one screen. The wall never resets and never removes anything.

### 7.2 Zoom two: the module band

The takeaway rows for one band of the wall, each a claim plus its mark. The row's
title links to `taughtIn`, which is the whole of what survives from today's lesson
lists: not a catalogue, but one link per row, on a row that already had to exist.

That link closes the backfill loop in one gesture. See an empty mark in Module 3,
tap the claim, arrive at the lesson that taught it. Today that journey does not
exist.

Where `statedIn` is non-null, the band header carries the cited lesson as a link,
labelled with the lesson's own title. Where it is null, the header carries the
module title alone. A citation is present or it is not, exactly like a footnote,
and no sentence explains the difference.

### 7.3 Zoom three: the takeaway detail

One takeaway's full evidence. This is today's `progress-focus` section, kept
almost whole: `ProgressChart` on the full series, the trend reading, the readiness
line, the personal best, and for a set proof the per-member rows that are today's
`StatRow` list. Plus one action, which starts the drill that would move it.

`ProgressChart.tsx` is good work and changes nothing.

### 7.4 One recommender, where there are currently two

`JourneyPanel` runs `nextUp()` and renders "Closest to done"; `ProgressPanel` runs
`recommendNext()` and renders "Practice next". Two algorithms, two vocabularies,
two answers, one tab apart. That is the same class of defect as the Held/Solid
split, caught before it was named.

One survives: **the takeaway with the fewest runs left to bank, among takeaways
left of the position line.** Backfill-first by construction, because the pool is
everything taught rather than everything current. It defers to the recall
subsystem's prerequisite rule (its section 6.3): where two candidates are both
open and one's skill is a transitive prerequisite of the other's, the prerequisite
surfaces and the dependent waits.

This is also the surface's answer to section 2.3. The graph cannot express the
counting-ands gate today, and this recommender does not wait for it to: it reads
`prerequisitesOf` directly rather than `blockedBy`, so a `measurable` prerequisite
is visible here even while `progression.ts` correctly refuses to let it lock
anything.

### 7.5 The empty state

No `currentLesson`: the wall draws the whole course dimmed, with no position line,
and the only interaction is to place the line. Placing it fills the wall behind it
with what is now owed.

That is rule 90 applied literally: the empty state is a picture of the filled
state, and the onboarding gesture is the user doing the smallest real version of
the thing and watching it work. It replaces all three branches of `outsideNote()`,
which spend up to 24 words apiece explaining why nothing is marked as behind you.
A lesson outside the taught path gets no line, and the absence is the statement.

## 8. Backfill

The requirement is that a gap in Module 3 is as visible at Module 5 as anything
current. Three mechanisms, none of which can be turned off:

1. **The wall does not collapse.** Everything taught is drawn at all times, at one
   size. There is no expander to leave shut. A hole in Module 3 sits left of the
   position line at the same prominence as Module 5's, permanently.
2. **The recommender's pool is everything taught**, ordered by closest to done and
   not by recency, so the oldest gap competes on equal terms with today's work.
3. **Not-askable is drawn, not omitted.** Twelve of Grade 1's 36 takeaways are the
   app's own missing work today. Omitting them would let the wall look complete
   while thirty-five taught lessons had never been asked about.

## 9. The long look back

### 9.1 What is worth keeping for years

- Every run of every drill, with its date. Kept, in
  `dailyLogs[date].drillRuns`. This is the spine of everything above.
- Which chords and pairs were under the hand when. Derivable from the above.
- When the learner moved through the course. **Not kept.** See 9.2.
- What was claimed rather than measured, and when. **Partly kept.** See 9.3.

### 9.2 The gap: there is no record of moving through the course

`currentLesson` is a single string in `UserData`. Setting it overwrites it. The app
has never recorded that the owner was on Module 3 in June, so "how far have I
come" can only ever be answered as a snapshot, never as a path.

Add an append-only journal:

```ts
/**
 * Where the learner said they were, and when they said it. Append-only.
 *
 * currentLesson answers "where am I" and overwrites itself, so the app has no
 * record of the course being walked. One entry per position change, which in
 * practice is one per module. It is never rewritten: moving the marker
 * backwards appends, so a correction is visible as a correction.
 */
lessonJournal?: { code: string; at: number }[];
```

Written in `setCurrentLesson`. It is tiny, it is the horizontal axis the wall's
history needs, and every year it is not added is a year of the journey that cannot
be recovered. That argues for adding it first, ahead of the surface it serves.

### 9.3 The second gap: claims carry no date

`claimedSkills?: string[]` is a bare array. A claim with no date can never be
re-examined, and the `said` mark in section 6.3 is drawn at a date. It becomes
`Record<string, { at: number }>`, or defers to `recallClaims` if the recall
subsystem's field lands first. Either way a claim carries when it was made.

### 9.4 What the record looks like in Grade 8

The same wall, longer. Nothing is deleted, nothing is summarised, and the sticky
`everHeld` notch means a cell that has gone quiet still shows it was once held.
The pair triangle at Module 22 against the pair triangle at Module 1 is the whole
journey in two shapes.

## 10. Progress, Numbers, and the chart

### 10.1 Merged, and the modal loses a tab

To be unambiguous about what is being merged: two tabs of one modal become one tab
of the same modal. The modal does not move, does not close, and does not lose a
job. Nothing migrates into a session.

The owner refers to Progress and Journey as one thing. They already are one modal
with four tabs, and section 7 shows they are one object at three zooms, because a
takeaway's runs mark is a miniature of the Numbers chart. Four tabs become three:
**Journey, Awards, History.** Memory records an earlier defect of a whole Progress
tab sitting off-screen on a phone; one fewer tab is a small dividend.

### 10.2 What happens to each part

| Today | Becomes |
|---|---|
| `ProgressChart.tsx` | Unchanged. Zoom three. |
| `progress-focus` (chart, trend, readiness line, best) | `TakeawayDetail.tsx`, near-verbatim |
| `StatRow` list | The set-proof member rows inside a detail |
| `progress-reco` "Practice next" | Merged into the one recommender (7.4) |
| `progress-meta` (days, results, streak) | Moves to History, where days and streaks belong |
| `JourneyPanel.tsx` | Replaced by `CourseWall` plus `ModuleBand` |
| `Spine` | Becomes `CourseWall` |
| `journeyCopy.ts` | Deleted. Its entire job was explaining an approximate mapping |
| `journeyCourse.ts` | Kept and narrowed: `BEGINNER_PATH`, `moduleOfLesson`, `positionOf` stay; `moduleContent` and `isPractice` go, because a module's content is now its takeaways rather than a skill-family filter |
| Playable-songs list | Kept, as its own band at the foot of the wall. It is earned, entirely learner-specific, and it is the payoff |
| Lesson-title link lists | Removed. This is the "showing videos and etc" the owner named. One link survives per takeaway row |

### 10.3 The coached session's own summary may read the same model

Coached mode already ends with a summary. `takeawayStanding.ts` is a pure function
over the standings and the evidence, so that summary can read it without this
panel being involved at all: the honest end-of-session line is "this run put a
third stroke on Old Faithful", drawn as that stroke arriving, using the same
`ProofMark` component.

Sharing a model is free and keeps the two surfaces from developing separate
opinions about what today's run meant. Sharing a model is not the same as moving
the panel, and nothing above proposes the second. The summary shows what changed
today; the panel shows everything, which is a different question asked at a
different moment.

### 10.4 What a course with no takeaways gets

`takeawaysFor(track)` returns empty. The wall draws module outlines with no cells,
and the measured band, which is today's Numbers content, carries the panel. The
surface degrades to exactly what it can honestly draw, which is the same instinct
as the recall gate returning nothing when it does not know where the learner is.

## 11. Word budget

Measured, not estimated. Method in section 2.1, reproducible.

```
Today, Journey tab, current module open        389 words
  of which invariant to the learner            277  (71 per cent)
  of which explain the app's own limits        ~100 (26 per cent)
Today, Numbers tab                             106 words
```

Target for the merged surface at its default state:

```
Under 120 visible words
  of which explain a mapping, a chip, a state
  or a limitation                                0
```

Every remaining word is a proper noun (module title, lesson title, chord name,
song title) or a takeaway claim, which is the label of the thing being tracked
rather than a description of it.

The budget, itemised for Module 5:

```
Grade names on the wall edge                      6
Module 5's five claims                           32
Modules 4 and 6 partly in view                  ~25
The songs band                                  ~30
The recommender's action label                    2
Module numbers on the wall                    digits
                                             ------
                                              ~95 to 120
```

What is deleted to get there: `shapeOf` (17), `kindNote` (23), `outsideNote` (up
to 24), `paidGap` (24), the spine caption (15), the whole-course totals line (7),
`countLine` across 23 modules (about 138), the per-module lesson lists (about 35
each), and every evidence sentence of the form "No change drill has used E yet."

**The second metric matters more than the first and should be tracked with it:**
share of visible words that are invariant to the learner. Today 71 per cent.
Target is that every mark is derived from the learner's own evidence and every
word is a name, so the invariant share is exactly the course's proper nouns and
nothing else.

## 12. What this surface needs from the recall subsystem

Stated here so the two designs can be reconciled rather than each assuming.

1. **One owner for "is this proven".** The recall design specifies
   `src/lib/coverage.ts` returning a per-lesson `LessonCoverage`. This design
   specifies `src/lib/takeawayStanding.ts` returning a per-takeaway standing.
   Both would otherwise derive proof from `SkillStanding`, which is two
   derivations of one fact and the beginning of the same drift
   `journeyCopy.ts` warns about. **Proposal: `takeawayStanding.ts` is the only
   module that reads standings into a verdict, and `coverage.ts` becomes a
   lesson-level projection of it rather than a parallel computation.** If the
   recall implementation lands first, this surface consumes `coverage.ts` and
   does not compute its own.
2. **`SkillStanding.recent: DrillRun[]`** (section 5.3a). Without it the runs mark
   cannot be drawn and the design falls back to printing "2 of 3", which is the
   thing being replaced.
3. **`Evidence.sessions`** (section 5.3b), for the timed mark.
4. **Recall runs must flow through `allStandings()`** so a takeaway proved by
   recall gets the same runs mark as one proved by a chord drill. The recall
   design already does this via `RECALL_BAR` and a `drillResults` prefix, so this
   is a confirmation rather than a request.
5. **Stated recall must stay out of `drillResults`**, and its claims must carry a
   date. The recall design already requires the first; this surface requires the
   second, because the `said` mark is drawn at a date. A claim that reached
   `drillResults` would be drawn as strokes over a line, which is exactly the
   fabrication both designs exist to prevent.
6. **`setCurrentLesson` appends to `lessonJournal`** (section 9.2) and never
   rewrites it. The recall gate makes `currentLesson` load-bearing; this surface
   makes it editable. Both are safe only if the record of it is append-only.

## 13. Files touched

New:

```
src/data/takeaways.ts                          the authored table
src/lib/takeawayStanding.ts                    the projection; no new rule
src/components/practice/CourseWall.tsx         zoom one
src/components/practice/ModuleBand.tsx         zoom two
src/components/practice/TakeawayDetail.tsx     zoom three (from progress-focus)
src/components/practice/ProofMark.tsx          the four marks
src/components/practice/courseWall.css
tests/takeaways.test.mjs                       citations, arrows, coverage
```

Changed:

```
src/lib/progression.ts        SkillStanding.recent; Evidence.sessions
src/store/index.ts            lessonJournal; claims carry a date
src/types/index.ts            the journal entry type
src/components/DailyPath.tsx  four tabs to three; one recommender
src/components/practice/journeyCourse.ts   narrowed
scripts/build-takeaways.mjs   importer, reads the dev database, writes the table
```

Deleted:

```
src/components/practice/journeyCopy.ts
src/components/practice/JourneyPanel.tsx
src/components/practice/ProgressPanel.tsx
src/components/practice/journey.css
src/components/practice/progress.css
```

`tests/journey.test.mjs` imports six functions from `journeyCopy.ts` and eight
bindings from `journeyCourse.ts`. Its curriculum assertions (three grades, module 0 present,
BG-15xx filed under Grade 3) are still worth having and move to
`tests/takeaways.test.mjs`; its copy assertions go with the copy.

New tests worth naming, because two of them are the honesty guarantees:

- Every `proof.skill` resolves through `getSkill`.
- Every non-null `statedIn` resolves through `getLessonByCode` **and** its body in
  the development database still holds an exit-criteria section.
- No takeaway's `claim` exceeds eight words or begins with "You".
- The Grade 1 table's evidence-kind distribution matches section 4.2, so a
  taxonomy change that quietly turns a not-askable takeaway into a heard one has
  to be acknowledged.

## 14. Failure modes

| Failure | Behaviour |
|---|---|
| `currentLesson` absent | No position line. The wall is the course, dimmed, one gesture to place. Never guess forward |
| `currentLesson` in a companion series | Same as absent. No line, no sentence |
| Position moved backwards | The taught set shrinks and cells stop being owed. No evidence is ever deleted, and the journal records the move |
| A `proof.skill` does not resolve | Build-time test failure |
| A `statedIn` citation goes stale after a curriculum rebuild | Build-time test failure against the development database |
| A course with no takeaways authored | Module outlines only; the measured band carries the panel |
| One skill proving takeaways in five modules | Correct and intended. The claim repeats because the course repeats it, and the set widens each time, which is the point |
| A run of 29.6 against a bar of 30 | The stroke is drawn below the line. Geometry cannot round |
| A blocked microphone stores a zero | Already handled: `readiness()` refuses to count a stored zero, so no stroke appears and no streak breaks |
| Two devices practising offline | Nothing to merge. Takeaway state is derived and never stored |
| A timed takeaway | Accumulates ticks and never completes. There is no bar, so nothing can clear, and showing up is not congratulated |

## 15. Decisions, and the questions I would have asked

The human partner was out of the loop. Where the process calls for a question,
both the question and the assumption are recorded.

| # | Question I would have asked | Assumption made |
|---|---|---|
| 1 | Modules 0, 1, 2 have no stated exit criteria. Author ours, or leave them blank? | Author ours, marked `statedIn: null`. Leaving them blank would hide Module 0's tuning, chord boxes and finger placement, and the owner's stated fear is exactly that kind of hole. A blank module is the failure mode he is asking to be protected from |
| 2 | Is a citation link enough to distinguish the course's requirement from ours, or does each row need to say whose it is? | The link alone. A citation is present or absent, like a footnote, and per-row provenance would be a third honesty axis on a row that already carries two. This is the weakest decision in the document and the one most likely to need revisiting after it is seen |
| 3 | Should the merged surface keep four tabs with Journey rebuilt, or fold Numbers into it? | Fold. The runs mark is the chart at small size, so they are one object; keeping both would recreate the two-recommenders defect in a new place |
| 4 | Is deleting the per-module lesson lists too much? He follows JustinGuitar closely | Delete, but keep one link per takeaway row. The lists are the largest invariant block on the surface and are literally what he asked to remove, while per-row links preserve every reachable lesson that matters and cost no additional words |
| 5 | Should the wall show the whole course, or only what has been taught? | The whole course, with everything past the position line drawn empty and unowed. Seeing what is ahead is the "how far have I come" frame, and hiding it would make the wall shrink when the learner moves backwards |
| 6 | Is `lessonJournal` worth adding now given nothing reads it yet? | Yes, and first. It is a few bytes per module and it is unrecoverable retroactively. Every month without it is a month of the journey that can never be drawn |

### Unresolved

- **The `set` standing's recursion.** `TakeawayStanding` includes a `set` variant
  holding member standings, which is one level deep in practice and typed as
  arbitrarily deep. If an implementer finds that awkward, flattening it to
  `{ kind: 'set'; members: { label: string; banked: number; bar: number }[] }` is
  a fair trade, since the grid only draws banked-out-of-three per cell.
- **Whether the timed mark should be capped.** Five hundred sessions of song
  play-along is a lot of ticks. A tick per session is honest and does not scale;
  a tick per week scales and is a summary. Not decided, and it does not block a
  Grade 1 build, where the counts are small.
- **Where `technique.anchor-fingers` lives.** It is measured, it is drilled, and
  no module's exit criteria require it, because the course puts it in the
  practice routine rather than the gate. It falls into the measured-but-not-
  required band at the foot of the wall. That band is correct and it is the one
  place a reader might reasonably ask why something is not a takeaway.

### Things asked for that I think are bad ideas

- **Drawing takeaways as ticks at all.** The owner asked for "auto ticking
  itself", and the arithmetic in section 4.2 says a tick row would be twelve lies
  and six attendances out of thirty-six. The ask underneath it is that the mark
  arrives on its own rather than being set by hand, and the third stroke landing
  above the line satisfies that ask better than a checkmark does, because it shows
  what made it arrive.
- **Inferring takeaways for modules the course leaves unstated, without saying
  so.** Tempting, because it would make the table uniform. It would also mean the
  app quietly presenting its own requirements as the course's, which is a
  different kind of the same dishonesty the evidence marks exist to prevent.
- **Persisting a ticked takeaway.** Not asked for, but it is the natural drift:
  once a takeaway is a row, someone will want to store whether it is done.
  Section 5.4 makes that structurally unnecessary rather than merely discouraged.
- **Building any surface state around pitch-detector octave errors.** They do not
  exist for this detector; `tests/pitch.test.mjs` asserts none across the guitar
  range and passes. Recorded so it is rejected once rather than rediscovered.
