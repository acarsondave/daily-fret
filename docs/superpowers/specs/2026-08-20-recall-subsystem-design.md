# The recall subsystem

Design, 2026-08-20. Not implemented. Hand this to an implementing agent.

## 1. What this is for

Daily Fret is the practice layer around a course it does not own. The course
teaches; this app rehearses. Until now it has only rehearsed the things that
make a sound it already knows how to count: chord changes, placements, strum
timing, patterns. Everything else the course taught has been delivered once and
never asked about again.

Two failures forced this, and they are the same failure seen from two ends.

**The forward failure.** A note finder shipped on 2026-08-18 and failed in live
use. It asks the player to find a named note on the neck. Note names are taught
by `open-string-note-names-b1-605`, in Module 6. The player is on
`understanding-music-notes-b1-504`, in Module 5. The drill asked for knowledge
the course had not delivered. Nothing in the codebase prevented that, because
nothing in the codebase knows when a fact becomes askable.

**The backward failure.** The owner, reading his own practice, found holes in
material he was taught months ago:

> across module 0 to module 4 and or 5, I think there are some things I missed
> out on learning, exactly because of this, focusing more on the practical part
> of playing/sound based stuffs, might have made me incapable of some things
> that I see Justin uses, for example the counting beats, the ands

He is right, and the codebase can prove it. Section 2 is the audit.

Both failures are one missing thing: **the app has no model of what it has been
taught and never asked.** This subsystem is that model, plus the two mechanisms
that do the asking, plus one scheduler that decides which of them runs today.

It lives entirely inside coached mode. The owner's constraint, verbatim:

> I don't want anything to be outside of that coached mode, I want the coached
> mode to be possibly carried along on the whole journey, meaning they can just
> run a session (full session), and confidently say they ticked today's box.

There is no rail panel, no side quiz, no separate screen to remember to visit.
A recall item is a coached segment like every other drill.

### The line this must not cross

The product does not teach guitar. A recall item rehearses a fact the lesson
already delivered. No explanations, no "here's why", no lesson content. If an
item cannot be asked without first teaching something, it is not an item yet.

## 2. The audit: taught versus asked

Reproduced from `src/data/curriculum.ts` and `src/data/skills.ts` over the `bg1`
track, mapping every taught lesson through `skillsForLesson` to its
`measure.kind`.

```
Grade 1 lessons (taught modules 0-7):        75
Mapped to a skill with a drill behind it:    26
Mapped to a skill the app has never asked:   35
Mapped to no skill at all:                   15
```

The 35 are the backlog. By module, the ones that matter:

| Lesson | Title | Skill | measure.kind |
|---|---|---|---|
| b1-101 | How To Tune A Guitar | `setup.tuning` | measurable |
| b1-103 | Positive Finger Placement | `technique.finger-placement` | measurable |
| b1-104 | How To Read Guitar Chord Boxes | `theory.chord-boxes` | known |
| b1-112 | How To Strum The Correct Strings | `technique.string-accuracy` | measurable |
| b1-203 | Tapping Your Foot | `rhythm.foot` | known |
| b1-207 | Peter Gunn Theme | `riffs.single-note` | measurable |
| b1-301 | What Are Minor Chords | `theory.minor-chords` | known |
| **b1-305** | **Counting Ands** | **`rhythm.up-strums`** | **measurable** |
| b1-306 | All About Up Strums | `rhythm.up-strums` | measurable |
| b1-308 | All About Capos | `setup.capo` | known |
| b1-309 | Seven Nation Army | `riffs.single-note` | measurable |
| b1-405 | How To Read Guitar TAB | `theory.tab` | known |
| b1-406 | Sunshine Of Your Love | `riffs.single-note` | measurable |
| b1-506 | RIFF Come As You Are | `riffs.single-note` | measurable |
| b1-601 | Beginner Alternate Picking | `technique.alternate-picking` | measurable |
| b1-603 | About Time Signatures | `theory.time-signatures` | known |
| b1-604 | A 6:8 Strumming Pattern | `rhythm.six-eight` | measurable |
| b1-703 | Air Changes | `changes.air` | measurable |
| b1-705 | Feel Good Strumming | `rhythm.dynamics` | measurable |

### The mechanism behind the gap, and why it compounds

`src/lib/routineBuilder.ts` filters what may become a routine task:

```
- measure.kind === 'known' is excluded
- the setup, theory and ear families are excluded
```

That filter is correct for what it was written for: a five-minute timer on "How
To Hold Your Guitar" is absurd. But its effect is that **an entire class of
taught material is structurally unable to enter a routine**, which is exactly
how the owner came to neglect it.

It compounds, because `src/lib/progression.ts` allows only measured skills to
gate anything:

```js
// Only a skill the app can put a number on is allowed to hold another one back.
.filter((s) => s.measure.kind === 'measured')
```

So an un-drillable prerequisite is not merely un-practised, it is **invisible to
the progression graph**. The chain proves it:

```
rhythm.foot        requires []                     known        b1-203
rhythm.on-the-beat requires [chord.A, rhythm.foot] measured     b1-111 b1-204 b1-205
rhythm.up-strums   requires [rhythm.on-the-beat]   measurable   b1-305 b1-306   <-- no drill
rhythm.patterns    requires [rhythm.up-strums]     measured     b1-307 b1-404 b1-502 b1-503
```

The owner is drilled hard on THE pattern (b1-404, Module 4) while the thing it
rests on, where "and" is (b1-305, Module 3), has never been asked, and *cannot*
hold the pattern back because it has no number. That is why THE pattern feels
arbitrary to him. It is arbitrary: he has the last link of a three-link chain.

This is the single most valuable consequence of the subsystem, and it should be
stated in the implementation plan as a goal in its own right: **giving a recall
item to a skill turns that skill into a real gate.** Repairing coverage repairs
the progression graph as a side effect, at no extra cost.

### The rule this implies

> A gap surfaces its earliest un-proven prerequisite, not the skill that exposed
> it.

Drilling THE pattern harder will not fix a missing understanding of where "and"
is. The scheduler implements this in section 6.3.

## 3. Shape of the subsystem

```
                    src/data/recall.ts
                    the item registry (curriculum as data)
                              |
              +---------------+---------------+
              |                               |
     src/lib/recallGate.ts          src/lib/recallSchedule.ts
     what may be asked at all       what is asked today
     (curriculum order)             (spaced repetition)
              |                               |
              +---------------+---------------+
                              |
                     one segment in coached mode
                              |
        +---------------------+---------------------+
        |                     |                     |
   recall-played         rhythm-counting       recall-stated
   (new component)       (reuses               (new component)
   pitch, intervals      StrumPatterns)        a tap, a claim
        |                     |                     |
   MEASURED              MEASURED              CLAIMED
        |                     |                     |
        +---------------------+                     |
                    |                               |
        drillResults / DrillRun            recallClaims (separate)
                    |                               |
        src/lib/readiness.ts three-run rule         |
                    |                               |
                    +---------------+---------------+
                                    |
                          src/lib/coverage.ts
                          taught vs proven, per lesson
```

One registry. One gate. One scheduler. One segment. Three channels, because a
channel is defined by what it is entitled to claim.

## 4. Curriculum gating, made structural

This is the fix for the note finder failure, and it must not be a convention
anyone can forget.

### 4.1 The defect in the current data

`Skill.lessons: string[]` is documented as "Curriculum lesson codes that
introduce or drill it". It is a bag. `theory.note-names` carries
`['b1-504', 'b1-605']`, and nothing says which of those two *delivers* the
knowledge and which merely exercises it. There is no way to ask "when did the
course teach this", so the note finder could not have gated itself even if it
had tried.

Do not change `Skill.lessons`. Too much reads it, and its meaning ("this lesson
touches this skill") is right for what it does. Put the new fact where the new
thing needs it.

### 4.2 The item's own field

Every recall item carries exactly one lesson code, and the field is required and
singular:

```ts
/**
 * The one lesson that delivers this fact.
 *
 * Singular and required. Not "lessons that touch it": the only question this
 * answers is whether the course has said the thing yet, and a list cannot
 * answer it. Where a fact needs two lessons (a minor third needs both what a
 * minor chord is and what a semitone is), this is the LATER of them, because
 * that is when the item first becomes askable.
 */
taughtBy: string;
```

### 4.3 Taught order, from data

```ts
// Position of a lesson in its own track's taught order.
// Modules first, then position within the module. Companion series
// (module === null) are not on the taught path and return null.
export function taughtIndex(code: string): { track: string; order: number } | null;
```

Derived from `CurriculumLesson.module` and `.position` in
`src/data/curriculum.ts`, which the file's own comment calls authoritative for
ordering. Grade 1 to Grade 3 share one continuous module numbering (0 to 22),
which `src/lib/beginnerCourse.ts` already relies on, so ordering across the three
`bg` tracks works without special-casing.

### 4.4 The gate

```ts
export function askableItems(
  all: readonly RecallItem[],
  currentLesson: string | undefined,
): RecallItem[];
```

An item is askable when `taughtIndex(item.taughtBy).order <= taughtIndex(currentLesson).order`
and both are in the same track, or `item.taughtBy` is in a track the learner has
already completed.

**Make it structurally impossible to bypass.** Three requirements on the
implementation, all testable:

1. `src/data/recall.ts` exports **no** unfiltered array. The registry constant is
   module-private. The only exported accessor is `askableItems`, and
   `currentLesson` is a required positional parameter, so a caller cannot forget
   it and cannot pass it by accident.
2. `currentLesson === undefined` returns `[]`. Not "everything", not "Module 0".
   The app does not know where the learner is, so it asks nothing. This is the
   same instinct as `positionStanding`'s `unasked`: saying nothing is the honest
   answer.
3. A test asserts every item's `taughtBy` resolves through `getLessonByCode`. A
   typo makes an item unaskable forever and silently, which is the worst possible
   failure of this design.

### 4.5 The note finder gets the same gate

`FinderRung` gains `taughtBy`, and `currentRung()` gains `currentLesson` as a
required parameter and skips rungs not yet taught. If no rung is taught, the
drill is not offered at all and `buildSegments` drops the segment.

Every rung in the current ladder needs note names, so every rung is
`taughtBy: 'b1-605'` unless the rebuild in flight adds an earlier one. The
open-strings rung that agent is building is also `b1-605`: open string note names
are precisely what that lesson is.

Consequence for today's player, on b1-504: **the note finder is correctly
unavailable**, and the recall segment fills the slot with interval work instead.
When he reaches b1-605 the finder appears on its own. Neither drill needs to know
about the other.

## 5. Mechanism A: played recall

The app states a relationship. The player plays any two notes satisfying it. The
microphone measures the gap.

> Play any note. Now the note one tone above it.

### 5.1 Why this is the right mechanism at Module 5

It needs **no note names**, so it works for a player the course has not yet
taught any. It is physical, so it rehearses the thing the hand will actually do.
And it measures a *distance* rather than an absolute pitch, which is materially
more robust for reasons section 9 measures rather than asserts.

### 5.2 The measurement

```ts
/**
 * The interval between two heard pitches, in semitones.
 *
 * Measured in cents from the raw frequencies and rounded ONCE. Rounding each
 * pitch to its own MIDI number first and subtracting is wrong, and measurably
 * so: on a guitar sitting 45 cents from the app's reference the two roundings
 * disagree and a tone reads as a semitone or a minor third about half the time.
 * Rounding once cancels the offset instead of doubling it. See section 9.
 */
export const intervalBetween = (fromHz: number, toHz: number): number =>
  Math.round((1200 * Math.log2(toHz / fromHz)) / 100);
```

Store `hz`, never `midi`, in the event trail. This single line is the most
load-bearing implementation detail in the document.

### 5.3 Note events, and the pair rule

Feed from `usePitchDetector`. A settled event is a reading that is not
`provisional`, not `fading`, has `secondNoteAt === null`, and whose MIDI differs
from the last accepted event (the `judgedRef` dedupe pattern from
`NoteFinder.tsx`).

**The pair rule.** The prompt says "any two notes", so there is no correct
absolute answer and there must be no single correct pair. Accept the item when
**any adjacent pair among the last four settled events** satisfies the
relationship. Reasons:

- A false start (playing the wrong note first) does not lock in a failure. The
  player simply keeps going and the right pair arrives.
- It is the exact semantics of the prompt. "Any two notes a tone apart" is a
  claim about a pair, not about the first thing you played.
- It bounds cost: four events, three comparisons, no search.

Two guards, both from measurement in section 9:

- **Decay-tail ghosts.** A note decaying into room noise occasionally throws one
  extra confident reading several seconds later (observed once in 36 at the
  harshest profile, reading 21 semitones below the true note). Require both notes
  of an accepted pair to be within 4 seconds of each other, and drop any event
  arriving more than 2.5 seconds after the previous one with no intervening
  silence-to-signal transition.
- **Repeated notes.** Two plucks of the same pitch produce one event, not two.
  This is forgiving and correct, but it means **no item may ever ask for a
  unison**, and the octave item must never be answered by playing the same note
  twice.

### 5.4 The ladder

Same instrument as the note finder's rungs and the pattern deck: a ladder,
lowest first, and the session runs the lowest rung not yet cleared **and taught**.
Never above a pace the player has proven, which is the rule `src/lib/tempo.ts`
applies to BPM and `noteFinder.ts` applies to rungs.

| # | id | Asks | Interval | taughtBy | Notes |
|---|---|---|---|---|---|
| 1 | `step-up` | a note, then one semitone above | +1 | b1-504 | one fret, same string |
| 2 | `step-down` | a note, then one semitone below | -1 | b1-504 | direction matters |
| 3 | `tone-up` | a note, then one tone above | +2 | b1-504 | |
| 4 | `tone-mixed` | semitone and tone, alternating, up and down | +/-1, +/-2 | b1-504 | the discrimination |
| 5 | `natural-halfstep` | a note, then the one directly above with nothing between | +1 from pc 4 or 11 | b1-504 | only B-C and E-F. See caveat below |
| 6 | `octave` | a note, then the same note an octave up | +12 | b1-504 | weakest. See 9.4 |
| 7 | `thirds` | a note, then three semitones above; then four | +3, +4 | b1-504 | this IS what makes a chord minor (b1-301) |
| 8 | `fifths` | a note, then seven semitones above | +7 | b1-602 | power chord roots |
| 9 | `fourth-fifth` | told apart, alternating | +5, +7 | Grade 2 | |
| 10 | `degrees` | scale degrees in a stated key | varies | Grade 2 | needs a key, post-Grade-1 |
| 11 | `echo` | the app plays an interval, the player plays it back | varies | b1-708 | reverses direction. `ear` family |

Rungs 1 to 7 are all `b1-504` and are therefore **all askable today**. That is the
whole point: the mechanism has seven rungs of real work available to a Module 5
player who has never been taught a note name.

Rung 5 caveat, stated because it is the one item that breaks the invariance the
mechanism is chosen for: checking "B to C" requires the *absolute* pitch class of
the first note, not just the gap. It therefore inherits capo and tuning
sensitivity. Compensate with the stored `capoFret` the way the chord detector
already does, and skip the rung when `capoFret` is unknown rather than judging
through it.

Rung 11 needs the app to *play* two tones. `src/audio/outputContext.ts` and
`src/audio/metronome.ts` already own output, and two oscillator notes is a small
addition. It is listed for completeness and is not Grade 1 work.

### 5.5 How the prompt is drawn, not said

`src/components/practice/NoteCircle.tsx` already draws exactly this. Its header
is the standard, and it is worth quoting because it settles the question:

> B1-504 makes six claims: twelve notes in a loop, one step is a semitone, one
> fret is a semitone, two semitones are a tone, a lap is an octave, and a sharp
> and the flat above it are one note with two names. Five of those are
> relationships between two things, and a relationship written in a sentence has
> to be believed, while a relationship drawn as two figures that move together is
> just watched. So there is no explanatory copy on this surface at all.

The recall prompt is the same two figures **with the far end withheld**:

- The ring shows an arc cut into N semitone segments. No letters anywhere. A
  Module 5 player has no note names and the figure must not imply they should.
- The string shows the same N frets.
- The near end is **unplaced** until the player plays. The prompt is a shape, not
  a position, which is precisely what "any note" means.

The interaction:

1. Player plays a note. The near end of the arc snaps to it and the figure
   completes its own first half. This is the confirmation that the app heard
   something, delivered as movement rather than as a word.
2. Player plays the second note. The arc closes.
3. Right: the arc lands in the accent, one beat of motion, and the next prompt
   arrives.
4. Wrong: the arc they *played* is drawn against the arc that was *asked for*,
   both visible at once, at the same origin. The error is a length difference
   you can see. No sentence explains it. This is also the whole of the feedback:
   it does not say what the right answer was, because the right answer is any of
   twelve notes and naming one would be teaching.

Word budget for the whole surface: the `toneReading(n)` caption ("1 tone",
"½ tone", "octave"), which already exists in `src/lib/noteCircle.ts`, plus the
existing honesty line about what the microphone settled. That is the entire
visible text. Anything more is a regression.

**This surface must be built through the `impeccable` skill.** It is new UI, the
rules are unambiguous about it, and this document is a design brief, not a
substitute for that pass.

### 5.6 The voice

`public/coach/manifest.json` is a **closed set of pre-rendered clips**
(`counts` and `names`), not text-to-speech. `src/audio/coachVoice.ts` degrades
to silence when a clip is absent. So the coach cannot speak an arbitrary
sentence, and every spoken prompt must be an authored clip generated through
`scripts/gen-coach-voice.mjs`.

This is a constraint and also a discipline: it forces the prompt vocabulary to be
a **finite authored deck**, which is what "curriculum is data" wants anyway. Clip
naming `recall-<itemId>.mp3`, added to `manifest.names`. Eleven rungs is eleven
clips. Where a clip is missing the figure carries it alone, which the product
already requires: "the visual UI must remain a complete fallback when the voice
is off or unavailable".

## 6. The scheduler

One scheduler for all three channels. Two questions that must not be conflated:

- **Which items get asked today?** Spacing.
- **Is this known?** The existing three-run rule.

Merging them would be the second scoring system the brief forbids.

### 6.1 Spacing

Per-item state, persisted in the store:

```ts
export interface RecallSchedule {
  /** Rung on the interval ladder below. */
  step: number;
  /** YYYY-MM-DD this item next wants asking. */
  dueOn: string;
  /** YYYY-MM-DD it was last asked. */
  askedOn: string;
  /** The last few outcomes, newest last, capped at RECALL_RECENT. */
  recent: ('right' | 'wrong' | 'unheard')[];
}

export type RecallBook = Record<string, RecallSchedule>;  // item id -> schedule
```

The interval ladder, in **days**, because practice is daily and the app already
reasons in days (`STALE_DAYS = 14`, `RUST_DAYS = 14`):

```ts
export const RECALL_STEPS = [0, 1, 2, 4, 7, 14, 30] as const;
```

- Right: `step + 1`, capped at the last rung.
- Wrong: back to `step = 0`, not out of the deck. Due again the same day, later
  in the deal, and again tomorrow.
- Unheard (the microphone did not settle anything): `step` and `dueOn` unchanged.
  This is the same instinct as `readiness()` refusing to count a stored zero. A
  blocked microphone must not be able to reschedule a fact the player may know
  perfectly well.

Step 0 means "later in this same session". An item answered wrong is asked again
before the segment ends, which is how a wrong answer becomes practice rather than
a mark.

### 6.2 Filling one run

A run is one coached segment. Fill to the item budget:

1. Every askable item with `dueOn <= today`, earliest due first.
2. If short, the next-soonest askable items, soonest first.

Step 2 is not padding, it does real work. Without it, a run contains only the
weakest items, the score is biased downward forever, and a run's value stops
being a fair sample of what the player knows. It also gives spacing a study-ahead
behaviour for free.

### 6.3 Backfill, and the prerequisite rule

Backfill is not an edge case in this design. It is what the scheduler does by
default, because "askable" reaches **backwards over everything taught**, not
sideways into the current module. An item from Module 0 and an item from Module 5
sit in the same pool and are ordered by when they are due, not by when they were
taught.

On top of that, one ordering rule implements section 2's conclusion:

> When two items are both due, and one item's skill is a transitive prerequisite
> of the other's, the prerequisite is dealt first, and the dependent item is
> **held out of the deal entirely** until the prerequisite's skill is `proven`.

Read prerequisites through `prerequisitesOf` in `src/data/skills.ts`, which
already exists and already resolves transitively. The effect on today's player:
counting (b1-305, `rhythm.up-strums`) is dealt, and any Module 6 item resting on
it waits. He does not get to skip the first link again.

**Burn-down is honest about its length.** Thirty-five open lessons at roughly
eight items a session is a matter of weeks, not one session. Say so on the
coverage view (section 8) and let the number come down. Do not compress it by
raising the budget; that is the guitar losing time to knowledge, which section 7
forbids.

### 6.4 Standing, and how it feeds the three-run rule

A recall **run** is one segment. Its value is a percentage, the same unit the
rhythm drills already store:

```
value = items answered right / items asked, as a percentage
```

Items answered `unheard` are excluded from both numerator and denominator. A run
with no heard items produces no number at all and files a `TimedOutcome` through
the existing `onTimedRun` path, exactly as `NoteFinder` does.

That value goes into `drillResults` under a new key prefix and is read by
`readiness()` against a new bar. **No new rule.** The three-run rule decides
whether the skill is held, exactly as it does for every other drill.

```ts
// src/lib/readiness.ts
/**
 * A recall run held.
 *
 * The app's own, inferred rather than taught: no lesson puts a number on
 * remembering something, so it must not be presented as the course's. Eighty,
 * which is four items in five. Set below the rhythm bar deliberately: a recall
 * deck is filled from the items that are due, which are the ones least well
 * known, so a run of it is a harder sample than a run of a pattern the player
 * chose to practise.
 */
export const RECALL_BAR = 80;
```

### 6.5 The exit criterion

The owner's ask, verbatim:

> mastery of taught material is what lets an item leave the drills and make room
> for new work

An item leaves the active deck when **both** are true:

1. Its own spacing has reached the top rung (`step === RECALL_STEPS.length - 1`,
   a 30-day interval), and
2. The skill it belongs to is `proven` in `src/lib/progression.ts`.

Both, because they are different claims. The first says the fact has survived a
month. The second says the skill it belongs to has cleared its bar three runs
running. Either alone is a weaker statement than the owner is asking for.

It **leaves the deck, not the record**. A retired item still comes round every 30
days, still counts towards coverage, and returns to `step = 0` the moment it is
missed. Nothing is ever finished in a way that cannot be un-finished, which is the
same instinct as `readiness()`'s `lapsed`.

## 7. Budget: how much of the session

The session is 27 to 30 minutes. Knowledge must not eat the guitar.

| | Items | Seconds |
|---|---|---|
| Played recall (incl. counting) | 8 | 150 |
| Stated recall | 3 | 30 |
| **Total** | **11** | **180** |

Three minutes. Ten per cent of a thirty-minute session, once per session, one
segment.

Working: a played item is two notes at roughly 130 ms each from onset to a
settled reading (measured, section 9.3), plus think time and the occasional wrong
turn. Fifteen seconds an item is a realistic average and ten items is the ceiling
inside 150 seconds. Target eight so the segment ends when it says it will.

**Enforce the cap in `buildSegments`, not in the routine editor.** A routine
author who sets a recall block to twelve minutes has misunderstood the product,
and the flattening is where the product gets to have an opinion.

Two numbers, and they are not the same number. `RECALL_TARGET_SECONDS = 180` is
what an unconfigured recall task runs for, and is the figure the table above
budgets. `RECALL_MAX_SECONDS = 240` is the ceiling `buildSegments` clamps a
routine-authored duration to, so a deliberate longer session is possible and a
runaway one is not.

**Placement:** after the change drills, before the song. Two reasons. The change
drills are the hardest physical work in the session and already take a
60-second announced rest afterwards (`REST_AFTER.changes`); a recall segment is
cognitive rather than physical, so it does that rest's job while doing real work.
And the session still ends on playing, which is where a practice should end.

`REST_AFTER` entries for the new kinds:

```
recall     15   Sitting still and thinking. The hands have not been working.
counting   20   One strum per slot at a fixed tempo, same as patterns.
stated      8   Nothing physical happened at all.
```

## 8. Coverage: taught versus proven

The record the owner asked for when he asked to "look back later on for our
journey". A deliverable, not a side effect.

New module `src/lib/coverage.ts`. Everything it needs is already data.

```ts
export type LessonCoverage =
  /** Taught, and something the app can ask has been proven. */
  | { state: 'proven'; source: 'measured' | 'claimed'; skills: Skill[] }
  /** Taught, askable, and not proven yet. This is the backlog. */
  | { state: 'open'; skills: Skill[]; nextItem: RecallItem | null }
  /**
   * Taught, and the app has nothing it could ask. Not the learner's gap: the
   * product's. Drawn as the app's own missing work and never as a failure.
   */
  | { state: 'unaskable'; skills: Skill[]; why: string }
  /** The course has not reached it. Says nothing about the learner. */
  | { state: 'ahead' };

export function coverage(
  currentLesson: string | undefined,
  standings: readonly SkillStanding[],
  book: RecallBook,
): Map<string, LessonCoverage>;   // lesson code -> coverage
```

Derivation, in full:

1. Taught set: every lesson in the active track with
   `taughtIndex(code).order <= taughtIndex(currentLesson).order`, plus every
   lesson of every earlier track in the same course.
2. For each, `skillsForLesson(code)` from `src/data/skills.ts`.
3. For each skill, its `SkillStanding` from `allStandings()`.
4. `proven` when every mapped skill has `standing.proven`. `source` is
   `'claimed'` if any contributing standing has `source === 'claimed'`, else
   `'measured'`. **A lesson proven only by claims must never render identically
   to one proven by measurement.**
5. `open` when any mapped skill is not proven and at least one askable item
   exists for it.
6. `unaskable` when no item and no drill exists. `why` comes straight from
   `skill.measure.needs` where the taxonomy already states it.
7. Lessons mapping to no skill at all are excluded, not counted as gaps. Fifteen
   of Grade 1's seventy-five are practice-routine pages and course admin
   ("Module 4 Practice Routine", "Grade 1 Feedback Please!"). They are not
   material and counting them would inflate the backlog with noise.

The `unaskable` bucket is the important one and it is the product being honest
about itself. Today it holds finger placement, string accuracy, air changes and
dynamics: four things the taxonomy already says need per-string energy or a
shorter refractory than the analyser holds. The app should say "there is nothing
I can ask about this yet" rather than quietly omitting the lesson.

The view that draws this is UI and **must go through `impeccable`**. Two notes
for whoever builds it, from this document's analysis rather than from taste:

- It is a burn-down, so draw the count coming down over time rather than
  reporting it in a sentence.
- Measured and claimed are different marks. Do not unify them for visual
  tidiness; the distinction is the product's core promise.

## 9. Feasibility, measured

Probes were run against the real `src/audio/pitch.ts` and a re-implementation of
the `usePitchDetector` smoothing layer, with a plucked-string model harsher than
the one in `tests/pitch.test.mjs`: suppressed fundamental, one-pole microphone
high-pass, broadband pick attack, inharmonicity, room noise. Four profiles from
`clean` to `brutal` (fundamental at 5 per cent, 200 Hz high-pass, 3.5 per cent
noise). Probe scripts were throwaway and are not committed.

### 9.1 The brief's assumed hazard did not appear

The brief warned about characteristic octave errors on low strings. They did not
occur.

```
ABSOLUTE pitch, exact MIDI, 36 positions across all six strings, frets 0-5:
  clean       36/36    octave errors 0
  laptop-mic  36/36    octave errors 0
  phone-mic   36/36    octave errors 0
  brutal      36/36    octave errors 0
```

This is not luck. `src/audio/pitch.ts` divides the difference function by the
overlap length, and its own comment says why: it "removes the shrinking-window
bias, which otherwise makes large lags look artificially good and produces
octave-down errors". YIN's first-dip-below-threshold rule then scans upward from
`tauMin`, which is octave-down resistant by construction. The octave error was
engineered out of this detector before the note finder was written.

**So the note finder was not broken by octave errors.** It was broken by the
sequencing failure in section 1, and by requiring `midi === prompt.midi`, which
is a much stronger demand than anyone noticed. See 9.2.

### 9.2 Interval is more robust than absolute, for a different reason

The real advantage is invariance. An interval is a ratio of two frequencies. A
capo, a guitar tuned away from A440, and an alternate tuning all shift both
notes equally, so the ratio survives all three. An absolute MIDI match survives
none of them.

Measured. Same 30 positions, guitar detuned by a fixed offset, absolute judged
against the MIDI the app expected and interval judged as a tone:

```
offset      absolute exact     interval correct
   0c          30/30              30/30
  20c          30/30              30/30
  35c          30/30              30/30
  45c           0/30              30/30
  55c           0/30              30/30
 100c           0/30              30/30
 150c           0/30              30/30
```

Absolute pitch falls off a cliff the moment the instrument is more than about 40
cents from the app's reference. A capo on the second fret is 200 cents. The note
finder's exact-MIDI rule would have been wrong for **every single prompt** with a
capo fitted, and the app stores `capoFret` precisely because it knows a capo
transposes everything it hears.

Interval judging holds flat across the whole range, on one condition, which is
9.3.

### 9.3 The one implementation detail that decides it

The interval column above is 30/30 everywhere **only when the interval is
measured in cents from the raw frequencies and rounded once**. Rounding each
note to its own MIDI number first and subtracting produces this instead:

```
  45c          0/30              13/30    <-- rounding each note independently
```

At a 45-cent offset each note rounds to whichever side its own cents happen to
fall, the two errors do not cancel, and a tone reads as a semitone or a minor
third about half the time. Rounding once fixes it completely (30/30 at every
offset tested). Section 5.2 is that fix. It is one line and the mechanism does
not work without it.

Latency, measured from pluck onset to first settled reading:

```
  E2 172 ms;  A2, D3, G3, B3, E4 all 125 ms
```

Two notes therefore cost roughly 0.5 seconds of detector time. Nothing in the
budget of section 7 is at risk from the detector.

Interval accuracy across the ladder, sequential, same string, `laptop-mic`
profile, 36 positions each:

```
  3 semitones 36/36    4 semitones 36/36    5 semitones 36/36
  7 semitones 36/36   12 semitones 36/36
```

### 9.4 Where it is genuinely not robust, and what to do

**The octave item is the weak one, and the cause is the detector's own guard.**
Two notes an octave apart ringing together are one periodic signal at the lower
note's period. `pitch.ts` detects this deliberately (`secondNoteAt`) and
`usePitchDetector` suppresses the reading, because reporting it would be an
identification the detector cannot make. Correct behaviour, and it eats the
octave item:

```
Octave pair, second note struck while the first still rings:
  gap 0.10s   0/12 read correctly     gap 0.30s   0/12
  gap 0.20s   0/12                    gap 0.40s   4/12
  gap 0.25s   0/12                    gap 0.50s  10/12
```

Below half a second of separation the octave item cannot be measured at all. The
semitone item is unaffected (11/12 at a 0.15 s gap), because a semitone is not a
whole-number multiple and never trips the guard.

An inversion was tested and **rejected**: since `secondNoteAt === 2` is exactly
"an octave is sounding", it looked like the guard could *be* the measurement. It
reports 2 correctly in 10 to 12 of 12 octave takes. But its false-alarm rate
under microphone low-end roll-off is fatal:

```
  a single note alone, no second note:   multiple reported in 14/36  (want 0)
  two notes a fifth apart:               multiple reported in 25/30  (want 0)
```

A drill that decides you played an octave when you played one note would be the
exact dishonesty the product exists to avoid. Do not build it.

Note that `tests/pitch.test.mjs` asserts zero false alarms with *its* signal
model, which has no high-pass filter. The disagreement is the high-pass: it
attenuates the low partials asymmetrically and breaks the partial-balance
assumption the test rests on. **Which model is right is unresolved and I could
not settle it from synthetic audio.** See section 12.

Verdict on the octave item: keep it, rank it last of the Grade 1 rungs, and

- require deliberate separation, shown by the figure damping the first note
  rather than said in a sentence;
- report a suppressed reading as **not heard**, never as wrong, so the spacing
  ladder is untouched (section 6.1);
- before it ships, measure the false-alarm rate on real audio from the owner's
  own guitar rather than on synthesis.

**A second-order hazard, mitigated.** At the harshest profile one take in 36
produced a spurious third event from the decay tail, reading 21 semitones below
the true note, seconds after the note died. The 4-second pairing window and the
2.5-second staleness rule in section 5.3 both come from this observation.

### 9.5 Overall verdict

**Played recall is feasible and should be built.** The pitch path already carries
everything it needs, the accuracy is better than the note finder required, and
interval measurement is genuinely more robust than absolute-pitch measurement,
though for invariance reasons rather than the octave-error reasons the brief
assumed. Two conditions: round once (5.2), and treat the octave rung as the
weakest and gate it accordingly (9.4).

## 10. Counting: verdict, and it is a strong yes

The coordinator asked for a verdict on counting as played recall. The verdict is
that it is **measurable today with no new DSP whatsoever**, and it is the highest
value item in the whole backlog because it is the broken first link of the chain
in section 2.

`src/lib/strumPattern.ts` already assigns onsets to eighth-note slots against a
beat grid read from the click as the microphone hears it, with per-direction
detection-lag compensation. "Play on the ands only" is not a new drill. It is a
pattern:

```
  play on the beat        D-D-D-D-
  play on the ands only   -U-U-U-U
  play on beat one        D-------
  play on beat three      ----D---
  one and three           D---D---
  every eighth            DUDUDUDU
```

Each parses through `parsePattern` unchanged (8 slots, `SLOTS_PER_BAR = 8`) and
scores through `matchPattern` unchanged. Direction is not needed: the pattern
matcher's own header already establishes that grid adherence measures the motion
indirectly, and for counting only the slot positions matter.

### 10.1 It reuses the component and does not reuse the key

Add a drill kind `rhythm-counting` that renders the existing `StrumPatterns`
component with a counting deck. A new **kind**, not a new component, because in
this codebase a drill kind is defined by what it is entitled to claim, and this
claims something different.

The key must be distinct or the results fold into the wrong skill:

```ts
export const COUNT_PREFIX = 'count:';
export const countKey = (id: string, bpm: number) =>
  `${COUNT_PREFIX}${id}${PATTERN_TEMPO_SEP}${bucket(bpm)}`;
// count:ands~80
```

`src/lib/progression.ts` gains a branch for `rhythm.up-strums` reading
`COUNT_PREFIX`, following the `theory.note-names` branch verbatim, whose own
comment states the reason: without it "the fall-through below would report the
note names from a chord-change rate, which is a number about a different hand
doing a different thing". Same hazard here.

`rhythm.up-strums` moves from `measurable` to `measured`. **That is the chain
repair**: the moment it is measured, `progression.ts` lets it gate
`rhythm.patterns`, and THE pattern stops being offered ahead of the counting it
rests on.

### 10.2 One thing that does not fit yet

The 6/8 item (b1-604, Module 6) needs a six-slot bar. `parsePattern` accepts
lengths of 8 or 4 only, and `SLOTS_PER_BAR` is a constant. This is real work, not
a one-liner, and it is out of scope here. Author the item, gate it on b1-604,
and let it sit in the `unaskable` bucket where the coverage view will show it as
the product's own missing work rather than the learner's.

### 10.3 Headphones

`strum-timing` and everything built on it requires the click to reach the
microphone and says so. Counting recall inherits that limitation exactly and must
inherit the same plain statement.

## 11. Mechanism B: stated recall

The owner overruled the argument that these deserve no drill, and he was right:

> for things that are inevitable, isn't a flash card or something implementation
> still not bad? ... it's still practicing too cause practicing is also learning.
> don't think we should be so rigid.

Two problems have to be solved honestly.

### 11.1 The honesty problem

The precedent is already in the codebase, in `src/components/Onboarding.tsx`:

> A chord the app heard is evidence; a chord they tapped is a claim.

A stated-recall answer is a claim. The record keeps them apart structurally, not
by labelling:

- Stated recall **never writes to `drillResults`**. Not under a new prefix, not
  under any prefix. If it can reach that map, something downstream will
  eventually average it into a measured number.
- It writes to a new store field, `recallClaims: Record<string, RecallClaim>`,
  and sets `TaskRecord.stated = true` on the day, which `src/types/index.ts`
  already documents as "Kept beside the evidence rather than folded into it, so
  'you marked this' can never be presented as 'the app heard it'".
- What a claim is allowed to feed, and nothing else:
  1. `claimedSkills`, through the existing claim path in `progression.ts`, which
     already renders a claim as `source: 'claimed'` and already says out loud
     "You have said you have this. Nothing measured yet."
  2. The `source: 'claimed'` half of the coverage map (section 8.4).
- What it may never feed: any `DrillRun`, any readiness streak, XP, awards,
  tempo prescription, or any figure a player would read as measured.
- The existing override rule stands unchanged and is the reason this is safe: a
  claim counts only while there is no evidence, and the moment a drill produces a
  number the number decides.

### 11.2 The friction problem, weighed honestly

The screen is propped and out of reach, both hands are on the instrument, and
reading costs a stopped hand. Four options:

| Option | Cost | Verdict |
|---|---|---|
| Tap an answer | One hand off the guitar, eyes on screen | Cheapest that is unambiguous |
| Spoken answer | Needs speech recognition. Not in the stack, weak in Safari, and the app would be claiming to have understood speech | Rejected |
| Coach reads the answer, player self-grades | Still a tap, and a tap after being told the answer. Hindsight makes it the weakest evidence available | Rejected as the default |
| Answer by playing something adjacent | Zero extra friction: the hands are already there | **Preferred wherever it exists** |

**There is no zero-friction answer for a fact with no sound.** Say so rather than
pretending. The tap is the cheapest, and the real mitigation is to keep shrinking
how many items need one.

### 11.3 B is the residue after A has taken everything it can

Worked through the actual Grade 1 backlog, most of B turns out to be A in
disguise:

| Fact | Looks like | Actually |
|---|---|---|
| What makes a chord minor (b1-301) | flashcard | **Played.** Play a third, then a flattened third. It is rung 7. |
| Time signatures (b1-603) | flashcard | **Played.** Play three strums to the click and stop. Counting channel. |
| Where "and" is (b1-305) | flashcard | **Played.** `-U-U-U-U`. Section 10. |
| Reading a chord box (b1-104) | flashcard | **Played.** Draw the box, play the shape. The chord detector already knows all nine. |
| Reading tab (b1-405) | flashcard | **Played.** Draw four notes, play them. The pitch detector reads a monophonic line; `riffs.single-note` says it "needs a component, not an algorithm". |
| Capo arithmetic (b1-308) | flashcard | **Stated.** Needs a capo in the room to play the answer. Genuinely B. |
| Posture, pick grip (b1-102, b1-106) | flashcard | **Neither.** Visual, learned once, no repetition value. Claim once in onboarding. |

So the recommendation is: build B properly, because the owner asked for it and
because there will always be a residue, and then **keep the residue small on
purpose**. For Grade 1 that is roughly two items, not twenty. Later grades add
key signatures and the CAGED shapes, and CAGED is playable too.

### 11.4 The form

Three items maximum, thirty seconds, at the very end of the session where the
guitar is already down.

Two large targets, both drawn, never two lines of text. The chord-box item is the
model even though it should be played: two boxes side by side, one question. A
two-way choice at practice distance is a target you can hit without looking
carefully, which is the point.

An item is asked as a **recognition** rather than a recall wherever possible,
because recognition needs one glance and recall needs sustained reading. The
distinction costs nothing and buys back most of the friction.

It feeds the spacing ladder in section 6.1 identically to A. Same book, same
steps, same exit criterion. What differs is only what it may write.

## 12. Decisions, and the questions I would have asked

The human partner was out of the loop for this design. Where the brainstorming
process calls for a question, the question and the assumption I made are both
recorded here.

| # | Question I would have asked | Assumption made |
|---|---|---|
| 1 | `currentLesson` is set by hand and only `JourneyPanel` reads it today. Is the owner willing to keep it accurate, given the whole gate now depends on it? | Yes, and the design fails safe: an absent or stale `currentLesson` asks **fewer** items, never more. A stale one under-serves; it cannot repeat the note finder failure. |
| 2 | Which lesson delivers "semitone and tone": b1-504 alone, or is it assumed earlier? | b1-504 alone. Its title is "Understanding Music Notes" and `NoteCircle.tsx` already enumerates its six claims, which include both. This is the single most load-bearing gating decision in the document. |
| 3 | Should recall replace an existing segment or extend the session? | Extend, by three minutes. The alternative is taking time from the guitar, which section 7 forbids. If 33 minutes is too long, the right cut is elsewhere and is a separate decision. |
| 4 | Is a percentage the right unit for a recall run, or should it be items-per-minute like the note finder? | Percentage. Speed of recall is a real thing but items-per-minute would reward guessing, and the deck is deliberately filled with the items least well known so the rate would be unstable. |
| 5 | Should a claimed item be able to mark a lesson covered at all? | Yes, but never rendered the same as a measured one. This follows the existing claim path rather than inventing a stricter rule the rest of the app does not apply. |
| 6 | 6/8 counting needs `SLOTS_PER_BAR` to stop being a constant. Worth doing now? | No. Out of scope, authored as an item, visible in the `unaskable` bucket. |

### Unresolved

- **The `secondNoteAt` false-alarm rate on real audio.** My harsher model and
  `tests/pitch.test.mjs` disagree, and the difference is the microphone
  high-pass. Synthesis cannot settle which is right. The ten
  `daily-fret-diagnostics-*.json` files in the repository root carry chord-detector
  gate outcomes, not pitch frames, so they cannot settle it either. **This blocks
  the octave rung and nothing else.** Resolve it by capturing real pitch frames
  from the owner's guitar before that rung ships.
- **Whether the owner is on Module 4 or Module 5.** Stored memory says Module 4
  ("Metronome, Stretches & The Pattern"); the brief says Module 5
  (`understanding-music-notes-b1-504`). I took the brief. If it is Module 4, the
  entire played-recall ladder is not yet askable and the subsystem opens with
  counting alone, which is Module 3 and askable either way. The design degrades
  correctly without changes; only the opening content differs.
- **Where the coverage view lives.** No page navigation is allowed, so it is an
  overlay or a panel, and which is a design question for `impeccable` rather
  than for this document.

### Things asked for that I think are bad ideas

- **`secondNoteAt` as the octave measurement.** It was the obvious shortcut, it
  is not in the brief but it is the first thing an implementer will reach for,
  and section 9.4 shows it fabricates octaves out of single notes. Recorded here
  so it is rejected once rather than re-discovered.
- **Self-grading after the coach reads the answer.** Listed in the brief as an
  option to weigh. It is the weakest evidence available and costs the same tap as
  the honest version. Rejected in 11.2.
- **Letting stated recall have a score at all.** Not asked for, but it is the
  natural drift: once items are counted, someone will want a percentage, and a
  percentage of claims looks exactly like a percentage of measurements. Section
  11.1 makes it structurally impossible rather than merely discouraged.

## 13. Seed data for Grade 1

Concrete enough to build against.

```ts
// src/data/recall.ts
export type RecallChannel = 'played' | 'counting' | 'stated';

export interface RecallItem {
  /** Stable, part of every key a run is filed under. Never edited. */
  id: string;
  channel: RecallChannel;
  /** The one lesson that delivers this fact. See section 4.2. */
  taughtBy: string;
  /** The skill this rehearses. Must exist in src/data/skills.ts. */
  skill: string;
  /** Rung order within its channel, lowest first. */
  rung: number;
  /** What a person would call it. Never shown as the prompt. */
  label: string;
}

export interface PlayedItem extends RecallItem {
  channel: 'played';
  /** Semitones, signed. Several means the item alternates between them. */
  intervals: readonly number[];
  /** Pitch classes the lower note must be, where the item constrains it. */
  fromPitchClasses?: readonly number[];
}

export interface CountingItem extends RecallItem {
  channel: 'counting';
  /** Eight slots, D/U/-, parsed by parsePattern. */
  pattern: string;
}

export interface StatedItem extends RecallItem {
  channel: 'stated';
  /** Two drawn options. Exactly two: see section 11.4. */
  options: readonly [string, string];
  answer: 0 | 1;
}
```

The registry, module-private, reached only through `askableItems`:

```ts
const ITEMS: readonly RecallItem[] = [
  // --- Counting. Module 3, askable today, and the broken first link. ---------
  { id: 'ct.downbeats',  channel: 'counting', taughtBy: 'b1-305', skill: 'rhythm.up-strums', rung: 1, label: 'On the beat',        pattern: 'D-D-D-D-' },
  { id: 'ct.beat-one',   channel: 'counting', taughtBy: 'b1-305', skill: 'rhythm.up-strums', rung: 2, label: 'Beat one only',      pattern: 'D-------' },
  { id: 'ct.beat-three', channel: 'counting', taughtBy: 'b1-305', skill: 'rhythm.up-strums', rung: 3, label: 'Beat three only',    pattern: '----D---' },
  { id: 'ct.one-three',  channel: 'counting', taughtBy: 'b1-305', skill: 'rhythm.up-strums', rung: 4, label: 'One and three',      pattern: 'D---D---' },
  { id: 'ct.ands',       channel: 'counting', taughtBy: 'b1-305', skill: 'rhythm.up-strums', rung: 5, label: 'The ands only',      pattern: '-U-U-U-U' },
  { id: 'ct.eighths',    channel: 'counting', taughtBy: 'b1-306', skill: 'rhythm.up-strums', rung: 6, label: 'Every eighth',       pattern: 'DUDUDUDU' },

  // --- Played. Module 5, all askable the day b1-504 is reached. -------------
  { id: 'pr.step-up',    channel: 'played', taughtBy: 'b1-504', skill: 'theory.note-names', rung: 1, label: 'A semitone up',   intervals: [1] },
  { id: 'pr.step-down',  channel: 'played', taughtBy: 'b1-504', skill: 'theory.note-names', rung: 2, label: 'A semitone down', intervals: [-1] },
  { id: 'pr.tone-up',    channel: 'played', taughtBy: 'b1-504', skill: 'theory.note-names', rung: 3, label: 'A tone up',       intervals: [2] },
  { id: 'pr.tone-mixed', channel: 'played', taughtBy: 'b1-504', skill: 'theory.note-names', rung: 4, label: 'Tone or semitone', intervals: [1, 2, -1, -2] },
  // Only B-C and E-F have nothing between them. Pitch classes 11 and 4.
  // The one item that is NOT capo-invariant: see section 5.4.
  { id: 'pr.natural-halfstep', channel: 'played', taughtBy: 'b1-504', skill: 'theory.note-names', rung: 5,
    label: 'Nothing in between', intervals: [1], fromPitchClasses: [11, 4] },
  { id: 'pr.octave',     channel: 'played', taughtBy: 'b1-504', skill: 'theory.note-names', rung: 6, label: 'An octave',      intervals: [12] },
  // A minor third and a major third, which is what makes a chord minor (b1-301).
  { id: 'pr.thirds',     channel: 'played', taughtBy: 'b1-504', skill: 'theory.minor-chords', rung: 7, label: 'Thirds', intervals: [3, 4] },

  // --- Played. Module 6 and later, correctly not askable today. -------------
  { id: 'pr.fifths',     channel: 'played', taughtBy: 'b1-602', skill: 'theory.note-names', rung: 8, label: 'A fifth', intervals: [7] },
  { id: 'ct.six-eight',  channel: 'counting', taughtBy: 'b1-604', skill: 'rhythm.six-eight', rung: 7,
    label: 'Six eight', pattern: 'DUDUDU' },  // BLOCKED: needs SLOTS_PER_BAR. Section 10.2.

  // --- Stated. The residue after everything playable has left. --------------
  { id: 'sr.capo-shape', channel: 'stated', taughtBy: 'b1-308', skill: 'setup.capo', rung: 1,
    label: 'What the capo makes', options: ['A', 'G'], answer: 0 },  // G shape, capo 2
];
```

## 14. Files touched

New:

```
src/data/recall.ts               the item registry
src/lib/recallGate.ts            taughtIndex, askableItems
src/lib/recallSchedule.ts        the spacing ladder, filling a run
src/lib/coverage.ts              taught vs proven
src/components/practice/PlayedRecall.tsx     new UI, via impeccable
src/components/practice/StatedRecall.tsx     new UI, via impeccable
tests/recall.test.mjs            gate, spacing, exit criterion
tests/coverage.test.mjs          derivation over the real curriculum
tests/browser/recall.mjs         a run against fake audio
```

Changed:

```
src/types/index.ts        DrillKind += 'recall-played' | 'recall-stated' | 'rhythm-counting'
                          DrillConfig += itemIds?: string[]
src/lib/coached.ts        CoachSegment += three kinds; buildSegments branches;
                          REST_AFTER entries; RECALL_MAX_SECONDS clamp
src/components/practice/CoachedSession.tsx
                          segment dispatch, tempo plan, result writing
src/lib/drillKeys.ts      RECALL_PREFIX, COUNT_PREFIX, key builders and parsers,
                          describeDrillKey, isDrillKey
src/lib/readiness.ts      RECALL_BAR
src/lib/progression.ts    branches for RECALL_PREFIX and COUNT_PREFIX
src/data/skills.ts        rhythm.up-strums measurable -> measured (counting);
                          theory.minor-chords known -> measured (thirds);
                          theory.note-names gains the played channel
src/lib/noteFinder.ts     FinderRung.taughtBy; currentRung takes currentLesson
src/lib/routineBuilder.ts the known / theory-family filter admits recall-backed skills
src/store/index.ts        recallBook, recallClaims, and their sync merge
```

## 15. Failure modes

| Failure | Behaviour |
|---|---|
| `currentLesson` absent | Ask nothing. Segment not scheduled. Never guess forward. |
| `currentLesson` in an unrelated track | Items outside that track are unaskable. Stated, not guessed. |
| An item's `taughtBy` does not resolve | Build-time test failure. Silent forever otherwise. |
| Microphone blocked or unheard | `TimedOutcome`, no number, spacing untouched. Existing `onTimedRun` path. |
| Detector reads a decay-tail ghost | 4-second pairing window, 2.5-second staleness rule (5.3). |
| Player plays the same note twice | One event, item stays open. No item may ask for a unison. |
| Octave rung, notes overlapping | Suppressed as `unheard`, never as wrong. Rung ranked last. |
| Capo fitted | Intervals unaffected. `pr.natural-halfstep` compensates via `capoFret`, or is skipped when unknown. |
| Counting on headphones | Same limitation as `strum-timing`, stated the same way. |
| Two devices, both practise offline | `recallBook` merges per item, later `askedOn` wins, following `mergeNoteMaps`. |
| Recall run with zero heard items | No `drillResults` entry at all. |

## 16. Answers to the questions asked

**One drill kind or two?** **Two, plus a third that reuses an existing
component.** The controlling rule in this codebase is that a drill kind is
defined by what it is entitled to claim, not by what it renders.
`src/lib/coached.ts` gives `strum-timing` and `strum-pattern` separate segments
despite sharing the entire timing analyser, and says why: the timer branch "would
announce it, count it in and then measure nothing". Played recall produces a
measurement; stated recall produces a claim; they differ in whether the
microphone is involved, whether `MicGate` applies, whether a run can be silent,
what they may write, and how long a rest they earn. That is a kind boundary.
Counting is a third kind because it claims something different from
`rhythm.patterns`, but it renders the existing `StrumPatterns` component
unchanged. One registry, one gate, one scheduler, one segment slot.

**What happens to the note finder?** **Kept separate, and gated by the same
mechanism.** It measures a different claim: not "you know a tone is two
semitones" but "the prompt named a position and the pitch that position makes
came back". Absorbing it would lose that. What changes is that its rungs gain
`taughtBy` and `currentRung` refuses untaught ones, which is the direct repair
for the failure that started this. The rebuild in flight is unaffected: its
open-strings first rung is `b1-605`, so it appears when Module 6 arrives.
Meanwhile played recall covers Module 5 with seven rungs, and the two hand off
without either knowing the other exists.

**How many items and how much time?** Eleven items, three minutes, one segment,
once per session. Section 7 shows the working and says why the cap belongs in
`buildSegments`.

**Is the feasibility real?** Yes, and section 9 measures rather than assumes.
Two conditions: round the interval once from raw frequencies, and treat the
octave rung as the weak one pending a real-audio measurement.
