# Progress and progression: a replacement

Written 2026-08-10. This is a design for approval, not a change. Nothing under
`src/` was touched to produce it.

Method: impeccable, Operate mode, replacement rather than refinement. The
structure was chosen through the surface concept seed (key `e5a490dd`, assigned
index 6 against the grounded list in section 2.2) rather than by picking the
arrangement that ranked first, which is the arrangement every run ships. The
oscilloscope challenger from that roll is fused into the assigned structure and
named where it lands.

Evidence: the running app at `localhost:5199`, seeded with a real learner
history (110 days, 78 practised, six measured drills, four chord pairs, level
52), screenshotted at 390x844 and 1280x1000, all four tabs, both viewports, and
read back as images. Every number quoted below was measured from that render,
not estimated.

---

## 1. The audit

### 1.1 What is on each tab now, and how much of it is prose

Measured from the rendered panel text for a learner with history. A "sentence"
is three or more words ending in terminal punctuation.

| Tab | Words | Sentences | Longest sentence | What it is |
| --- | --- | --- | --- | --- |
| Journey | 406 | 13 | 24 words | Course map, one grade and one module open |
| Numbers | 124 | 2 | 9 words | Recommendation, focus chart, drill rows |
| Awards | 214 | 14 | 17 words | Level ladder, points ledger, nine awards |
| History | 164 | 3 | 15 words | Weekly bars, day list |
| **Total** | **908** | **32** | | |

The Journey figure is the floor, not the ceiling. Grades and modules are
single-open accordions, so 406 words is what one grade and one module cost. Open
each grade in turn and the panel renders 440, 356 and 347 words respectively,
and behind those accordions sit 210 lesson titles.

Longest sentences on the surface, verbatim:

- "6 of them are paid lessons the course counts but does not name, so they are
  in the totals and not in the lists." (24 words, Journey)
- "Both are credited against what it did hear, so neither can carry a level on
  its own." (17 words, Awards)
- "Of this module's 8 lessons, Daily Fret maps 6 to practise and 1 taught but
  not drilled." (16 words, Journey)

Each of those is true, careful, and unread.

### 1.2 What specifically does not mesh

Five findings, all from the live render.

**Finding 1. The surface contradicts itself inside one viewport.** On Numbers,
the recommendation card reads `PRACTICE NEXT / D <-> Em / Slipping on your
recent runs`. Four rows below it, the same pair reads `D <-> Em  HELD  32 CPM`.
The app tells the player a pair is slipping and that the pair is held, in the
same scroll position, on a phone. `recommendNext` in `src/lib/drillStats.ts`
sorts on `recentTrend` direction alone and never consults `readiness`, so a
held, fresh pair that dipped one percent outranks a pair that has never cleared
the bar.

**Finding 2. The chart is about a third thing.** The recommendation names
`D <-> Em`, the rows are sorted by best, and the chart shows `C <-> G`, a pair
the seeded learner last drilled 45 days ago. `pickFocus` picks whichever drill
moved most in percentage terms, which on a stale series is whichever drill is
noisiest. Three elements, three subjects, no stated relationship.

**Finding 3. The app tells a level-52 player where to start.** Journey renders
`WHERE TO START / Dm chord / No change drill has used Dm yet / 20 to clear` for
a learner with 78 practised days, four pairs past the gate, and 421 recorded
results. `nextUp` filters to `working` first and falls back to `ready`, and
`ready` means never attempted, so the moment the working set empties, the panel
recommends the least-touched thing in the taxonomy as a place to begin.

**Finding 4. Two thirds of the course map is inert.** Of 23 modules, 16 render
as `no drills mapped yet` or `nothing here the app can score yet`. Fifteen of
those are modules 8 to 22, the whole of Grade 2 and Grade 3, holding 135 of the
course's 210 lessons. Sixty-four per cent of the lessons on display are a
directory of somebody else's website reproduced inside a modal, with no state of
ours attached to any row.

**Finding 5. The unchecked rows are the app's own admission, rendered as the
player's debt.** Module 4 opens to six practice rows. One carries a number.
Three carry the chip `NOT MEASURED YET` beside a hollow circle that is
visually indistinguishable from an unticked checkbox. Two carry `ON THE CLOCK`.
Above them the module header reads `8 lessons - 0 of 1 cleared`. Across the
taxonomy, 26 of 38 skills are of a kind the app can never measure. The row said
"not measured yet" because it was trying to be honest, and the hollow circle
next to it said "you have not done this", which is a different claim and a
false one.

### 1.3 The tabs are four answers to two questions

- Journey and Awards both answer "how far have I come". One answers it in
  course units, the other in points, and the two never reference each other.
- Numbers and History both answer "what happened". One aggregates, the other
  enumerates, and both derive from the same `dailyLogs`.
- Nothing answers "what do I play in the next thirty seconds" except a
  recommendation card that, as of finding 1, is wrong.

Three taps are needed to reach a module's practice list. The tab strip is a
roving-tabindex tablist with arrow-key handling in `DailyPath.tsx`, an
accessibility apparatus built to serve a structure that should not exist. The
same strip already caused a shipped defect (`docs/progress.txt` line 234: the
History tab sat off the right edge on a 375px phone).

---

## 2. The decision on structure

### 2.1 The decision

**One surface. No tabs. Four panels become one scroll, and two of the four lose
almost all of their content.**

- **Journey is deleted as a panel.** It survives as one row: a position marker
  on the 23-module spine and a compact picker to change which module you say
  you are on. `JourneyPanel.tsx` (513 lines), `journeyCopy.ts` (138 lines) and
  `journey.css` go.
- **Awards is deleted as a panel.** The level and band move to the main screen
  and to the top of Progress. The points ledger goes. The grid of unearned
  awards goes. Earned awards become events on the thread, dated. One unearned
  award survives, as a single row at the very bottom.
- **Numbers is dissolved.** The recommendation moves to the top of the surface
  and to the main screen. The rows become a strip. The chart stops being a
  default view and becomes what opens when you tap a row.
- **History becomes the spine of the whole surface.**

### 2.2 Why this structure and not the obvious one

The grounded structural candidates, ordered by resonance before the roll:

1. One scrolling read: the four tabs stacked in one column.
2. The session bracket: a before screen and an after screen around each session.
3. Absorb and delete: everything moves to the main screen, nothing remains.
4. The instrument panel: every measurable as a gauge against its bar.
5. The card deck: one question per swipeable card.
6. **The thread: time as the single axis, everything else an annotation on it.**
7. The logbook: a written practice diary with an index.

The roll assigned 6. Interrogated rather than accepted, it is the right one, for
a reason the safe candidate 1 cannot claim:

**A thread has no unchecked rows.** The only citizens of a timeline are things
that happened. Nothing unmeasurable can appear as pending, because pending is
not a shape a timeline has. Candidate 1 solves the tab problem and leaves finding
5 entirely intact; it would still need a copy fix, a chip vocabulary, and a
sentence explaining what the chips mean. Candidate 6 solves finding 5
structurally, and the structural fix cannot be undone by a later pass adding a
row back.

It also matches the data. The app does not hold a course with a completion
state. It holds a stream of dated measurements. A thread claims exactly what
exists and nothing more, which is the product's first principle applied to
information architecture rather than to copy.

And it carries the gamification the owner wants without a single word of hype.
The pathos of a long thread behind you is the same pathos a streak counter
reaches for, and it is honest, because the thread is the practice.

**The oscilloscope challenger, fused.** The roll dealt a CRT signal bench whose
grammar includes "channels overlay in the same graticule space rather than
separate views" and "everything on screen is measured against the ten-division
graticule". The palette is refused outright: the visual world is committed and
phosphor green is not in it. The grammar is taken, and it becomes section 4.3,
the graticule strip: every measured drill drawn against one shared ruled line
with the bar as a tick on it, so past-the-bar and short-of-the-bar reads without
a number and without a word. That is the challenger informing the assigned
structure, not beating it. The remaining challengers fuse poorly and are named
for the record: HyperCard (a one-bit palette replaces the identity), LCARS
(same), the jet-age ticket wallet (its coupon-tear-off topology is a checklist,
which is the thing being removed), the drawcord cape and the alphabet storm
(both Experience-mode worlds with no Operate grammar to lend).

### 2.3 What gets deleted, exhaustively

| Deleted | Where it lives | Why |
| --- | --- | --- |
| The four-tab strip and its keyboard apparatus | `DailyPath.tsx` | No tabs |
| `JourneyPanel.tsx`, `journeyCopy.ts`, `journey.css` | `components/practice/` | Section 2.1 |
| `moduleContent`, `ModuleContent` | `journeyCourse.ts` | Exists only to render "0 of 1 cleared" |
| The 210-lesson directory | Journey | Findings 4 and 5 |
| The per-module skill lists and chips | Journey | Finding 5 |
| `nextUp` | `progression.ts` | Finding 3 |
| `blockedBy`, `SkillState.locked` | `progression.ts` | Nothing locks; the memory note says so |
| `pickFocus` | `drillStats.ts` | Finding 2; the chart no longer has a default subject |
| The points ledger, six rows plus two sentences | `AchievementsPanel.tsx` | Nobody audits their own XP |
| The four figure tiles | `AchievementsPanel.tsx` | The thread is the record of days |
| The "still to come" award grid | `AchievementsPanel.tsx` | Finding 5 in its purest form |
| The percentage trend chips | `ProgressPanel.tsx` | Section 5.2 |
| The "Practise in 16 of the last 17 weeks" caption | `HistoryPanel.tsx` | Becomes `16 / 17` |

Kept, unchanged or nearly: `ProgressChart.tsx`, the 26-week bar chart, the
23-module `Spine`, the day-expansion behaviour in `HistoryPanel`, the whole of
`xp.ts` bar one addition, `readiness.ts` bar one display rule, the hand-drawn
icon set.

---

## 3. The rule for unmeasurable work

The owner asked for auto progression on things the app cannot track, or at least
for less unchecked material. The strongest available answer is also the cheapest
in honesty: **do not present unmeasurable things as trackable at all.**

Stated as a rule that can be applied to any future element:

> **Everything on the Progress surface is either an event or a live figure.**
>
> An **event** is a thing that happened, with a date. A **live figure** is a
> measurement with a date attached.
>
> There is no third category. Nothing renders as a container awaiting a value, a
> target without a result, a per-item empty state, or a mark the app cannot set.
> If the app cannot measure a thing, that thing does not appear on this surface.
> It appears in the routine, as work to do, where "not done yet today" is both
> true and useful.

Three consequences worth stating so they are not re-litigated later.

**Silence is not dishonesty.** The app is free to stop asking, free to say
nothing, free to advance quietly. What it may never do is set a mark it did not
earn. Strumming disappearing from Progress is not the app claiming strumming
does not matter; it is the app declining to grade something it cannot hear.
Strumming still appears every day, in the routine, as a thing to play.

**Time is an event, so timed work is credited without being assessed.** Five
minutes of spider walk inside the app is a fact with a date. It lands on the
thread as `Spider walk - 5 min` and earns through the existing `timed` channel in
`xp.ts`. That is the owner's "let attendance carry them", and it is not in
tension with the rule above: the app is reporting that a timer ran, which it
witnessed, not that the exercise was done well, which it did not.

**Course position advances on attendance, not on assessment.** The module you
are on is a setting. When the module's measured things are held and its routine
has been practised on six separate days, the app offers to move the pointer
forward. One tap, two words, no sentence:

```
        Module 5?          [ Yes ]  [ Not yet ]
```

Declining costs nothing and it does not ask again for seven days. The app is
advancing a pointer, which is a fact about where you are working. It is not
claiming you have mastered anything, and the offer must never be worded as if it
were. This is the honest version of the owner's "auto progression", and it needs
no disclosure sentence, because it makes no claim to disclose.

**Rejected: letting the measured thing stand in for the module.** It only stays
honest while carrying a disclosure sentence ("one of five"), the memory note is
right that the disclosure must never be softened, and a rule that stays honest
only by carrying a sentence fails the requirement to remove sentences. Delete
the claim rather than caption it.

---

## 4. What each surface shows

### 4.1 The main screen gains the standing

Today the main screen has a date row, week dots, a routine picker, and three
pills (Coached, Tune, Progress). There is no level, no points, no bar.

**Add a standing strip**, directly under the date row, above the routine picker,
full width, and make it the way into Progress. Delete the `Progress` pill; it is
one of four small targets competing for the same tap, and the strip is a better
door because it already says something.

```
  LV 52   It sounds like a song                  4 |  80 to 53
  ================================----------------------------
```

- `LV` in `--tracking-label` micro caps, `--text-muted`.
- `52` in `--font-primary`, `--text-lg`, `--text-primary`.
- Band name in `--font-secondary`, `--text-sm`, `--text-secondary`.
- Streak, only when greater than zero: `FlameIcon` plus the count, in
  `--record-color`. Not "4 days running".
- `80 to 53` in `--text-micro`, `--text-muted`.
- Bar: 3px, `--accent-primary` on a `--border-subtle` track, `--radius-full`,
  width from `level.progress`.

Words on the strip: seven, four of which are the band name.

**Add the recommendation as one row** above the task list:

```
  (o)  D <-> Em   slipping                                [>]
```

`TargetIcon`, the pair in `--font-primary` `--text-md`, one reason word in
`--text-micro`, a filled play button. Today's card says "Slipping on your recent
runs - best 35 cpm", which is nine words to carry one. The same component is the
first thing inside Progress, so the instruction is identical in both places.

### 4.2 Progress, zone NOW

No heading. This is the top of the sheet.

**Standing block.** The band title at `--text-lg` in `--font-primary`, `LEVEL`
label plus figure, the level bar, `80 to level 53` at `--text-micro`. The
ten-rung band ladder is kept exactly as built: it is one wordless element that
says the number is going somewhere. Everything else currently in `Standing`, the
six ledger rows and the two-sentence footnote, is deleted.

**Next.** The recommendation row from 4.1, at slightly larger scale.

### 4.3 Progress, zone NOW: the graticule strip

This is the heart of it, and it replaces both the drill rows and the verdict
prose.

```
                         bar
  A <-> D      ----------|------o        50   /
  Am <-> E     ----------|---o           40   /
  D <-> Em     ----------|-o             32   /
  C <-> G      ------o---|                24
  A>E>D        ----------|-----o          50   /
  Am D Em      -------o--|                27
```

- One rule per measured drill. Every rule is the same length and **the bar tick
  sits at the same x on every row**, so a single vertical graticule line runs
  down the whole strip. The dot's position is `value / bar` mapped through that
  tick. Left of the line is short of the bar. Right of the line is past it. No
  number is needed to read it and no word is spent on it.
- The dot carries an 18px tail showing the last three runs, so direction is a
  shape rather than a percentage.
- Right of the rule: the latest value, `--font-primary`, `--text-md`.
- The held mark is a `CheckIcon` in `--success-color`. **Not held is drawn as
  nothing.** No hollow circle, no grey tick, no "2 of 3" chip. Absence is the
  state. This is section 3's rule applied at the level of a single glyph, and it
  is the specific fix for the hollow circles in finding 5.
- Tapping a row expands it in place to zone DEPTH. One row open at a time. No
  navigation, no tab, no modal on a modal.

Words in the strip for a six-drill learner: the six drill names, which are chord
letters. Nothing else.

### 4.4 Progress, zone NOW: position

One row under the strip.

```
  Module 4 of 23
  ..||.|.|:|.||...........|.||.|..........
  Grade 1        Grade 2        Grade 3
```

The existing `Spine` component, kept: it draws each module at its true lesson
count with the current module marked, and it is the one thing on the old Journey
that earns its space. Its caption sentence ("Each bar is a module, drawn at its
lesson count. 4 behind you, 18 ahead.") is deleted from the visual and moved to
`sr-only`.

Tap it and a compact picker opens: one flat list, one line per module, number
and title and lesson count. No grades to expand, no skills, no chips, no lesson
directory. Choosing one sets `currentLesson` and closes.

The lesson link ("Watch this lesson - justinguitar.com") moves out of Progress
and onto the routine surface, next to the routine's name, because it is a thing
you follow before practising, not a thing you check after.

### 4.5 Progress, zone THREAD

The 26-week bar chart, kept, as the thread's header, with its caption reduced
from "Practised in 16 of the last 17 weeks, busiest 5 days." to `16 / 17 weeks`
at `--text-micro`. The full sentence stays in `sr-only`.

Then the thread, newest first.

```
  |
  @   Sat 8 Aug      6 drills - 24 min
  |                  (trophy) NEW BEST   A <-> D  53
  |                  (check)  HELD       Am <-> E
  |
  @   Thu 6 Aug      6 drills - 22 min
  |
  o   Wed 5 Aug      2 drills - 8 min
  |
  |
  @   Sun 2 Aug      5 drills - 20 min
  |                  (bolt)   LEVEL 52   It sounds like a song
```

- A 2px rail in `--border-default` runs the height of the list.
- Each day is a node on the rail, in one of three sizes by how much was heard.
- **A day with nothing is not on the thread.** Rest reads as space between
  nodes, never as a gap with a mark in it. The app already refuses to scold a
  missed day (`docs/progress.txt`); this is that decision made structural.
- Each day's first line is the plain fact: drills and minutes. Notable events
  get one further line each, in a fixed vocabulary and a fixed order:
  `NEW BEST`, `HELD`, `LEVEL`, an award title, `Module n`. Each is a mark, one
  or two words, and a figure. Never a sentence.
- Tapping a day expands to the per-drill values it already shows today.
- Pagination as built.

**Earned awards appear here, on the day they were earned, and nowhere else.**
Unearned awards do not appear at all. That is what deletes the "still to come"
grid without deleting the awards.

### 4.6 Progress, the last row

```
  NEXT IN REACH
  (grip)  Every open chord                    7 of 8   ====------
```

One row. The single nearest unearned award, its hand-drawn mark, its title, its
own measured figure, a meter. It passes the rule in section 3 because it is a
live figure with a measurement behind it, and it sits at the bottom where it
reads as a horizon rather than as a debt. The other eight unearned awards do not
render.

### 4.7 Progress, zone DEPTH

Opens inline when a graticule row is tapped. Three elements:

- `ProgressChart`, unchanged. It is good.
- `Best 53 - 4 Aug` at `--text-micro` with `TrophyIcon` in `--record-color`.
- The standing, as marks and figures rather than prose:
  `24  -  bar 30  -  2 of 3`.

The sentence that reads today as "24 on your last run. Held is three runs
running at 30 or better." (17 words) becomes those six tokens. **The sentence
itself moves to `sr-only`**, so the screen-reader path keeps every word the
visual drops. Text leaves the screen; it does not leave the product.

### 4.8 Desktop

At 1280 today the sheet is a fixed narrow column with the phone layout inside
it and two thirds of the viewport dark. At `min-width: 900px` the sheet becomes
two columns: zone NOW sticky in a left rail, zone THREAD scrolling in the right
column. That is the only responsive change, and it is structural rather than
fluid, which is what an Operate surface wants.

### 4.9 The session report

After a coached session, and after any single drill:

```
            +38
           POINTS

  (trophy) NEW BEST   A <-> D   53
  (check)  HELD       Am <-> E
  (bolt)   LEVEL 52

  ==========================------------
```

- `+38` in `--accent-primary` at `--text-xl`, `POINTS` beneath in
  `--tracking-label` micro.
- At most three event lines, from the same vocabulary the thread uses, so the
  same fact is spelled the same way in both places.
- If none of the three happened, `+38` stands alone. No consolation copy.
- The level bar animates from its pre-session value to its post-session value,
  once, `--dur-slow`, `--ease-out`, respecting `prefers-reduced-motion`. This is
  the one piece of choreography the whole design permits.

### 4.10 The text budget, stated

| | Words | Sentences |
| --- | --- | --- |
| Today, four tabs, one grade and one module open | 908 | 32 |
| New surface, everything collapsed | about 126 | 0 |
| New surface, non-numeric prose only | about 30 | 0 |

**Thirty-two sentences removed from the visual.** Four of them survive in
`sr-only` (the readiness evidence, the trend basis, the weekly summary, the
spine caption), so the non-visual path loses nothing. The remaining twenty-eight
are deleted outright, because the elements they explained are deleted.

The residual word count is almost entirely dates, chord names, and figures. The
surface's only English is the band name, `LEVEL`, `NEXT`, `NEW BEST`, `HELD`,
`bar`, `drills`, `min`, `Module`, `NEXT IN REACH`, and one reason word on the
recommendation.

---

## 5. The logic changes, per file

### 5.1 `src/lib/readiness.ts`

- `HELD_RUNS = 3` and the strictness argument stand. The memory note's reasoning
  is sound and this design does not reopen it.
- **A held mark stops decaying on the surface.** Today a held pair not run for
  15 days flips to `lapsed`, renders the word "Lapsed", and carries a sentence.
  That is taking a mark away from a player for resting, from an app that tells
  them at six days that resting is the stronger move. Change: `readiness` keeps
  returning `lapsed` because `tempo.ts` needs it, and the graticule strip treats
  `lapsed` as held for the purpose of the tick while treating it as a strong
  signal for the recommendation. The two parts of the app still agree about when
  evidence has gone cold. They stop agreeing about whether cold evidence should
  visibly cost the player something, and that is a display decision, not an
  evidence decision.
- `label` and `evidence` are no longer rendered by the strip. They are not
  deleted: DEPTH and the `sr-only` path both consume them.

### 5.2 `src/lib/drillStats.ts`

**`trendLabel` gains a materiality floor.** It currently renders `+<1%`. One per
cent of a changes-per-minute figure is one change in a hundred, which is well
inside the detector's own run-to-run variance. Printing it is the app claiming a
precision the microphone cannot support, which PRODUCT.md forbids in as many
words. Proposed: a trend whose absolute percent is under `TREND_FLOOR` returns
null, the chip does not render, and the three-point tail carries the shape
instead. This is the one change in this document that is a correctness fix
rather than a taste call, and it should ship whether or not the rest is approved.

`TREND_FLOOR` is proposed at 5 per cent and must be checked against real data
before it ships. See section 8.4.

**`recommendNext` gains an invariant.** It must never return a pair that is held
and fresh while any non-held pair exists. New order of preference:

1. Pairs not held, furthest below the bar first.
2. Pairs held but not run in `STALE_DAYS`.
3. Pairs sliding by more than `TREND_FLOOR`.

with the existing "not drilled today" preference applied within each tier. Add
the invariant as a test: no output whose `readiness` is `held` while a non-held
stat exists. This is finding 1, fixed at the source.

**`pickFocus` is deleted.** Under the new structure the chart has no default
subject: the strip is the default view and DEPTH opens only on tap. Deleting it
removes finding 2 entirely rather than trying to make the heuristic smarter.

### 5.3 `src/lib/progression.ts`

- **`nextUp` is deleted.** It is the direct cause of finding 3, and its only
  consumer is the panel being deleted.
- **`blockedBy` and `SkillState.locked` are deleted.** The progression-direction
  note is explicit that progression advises and nothing locks. A lock state with
  no enforcement is a concept with no consumer, and it costs a filter, a field,
  and a sentence in `evidenceLine`.
- `SkillState` collapses to `solid | working | none`, computed only for skills
  whose `measure.kind` is `measured`.
- `provenChords` stays. It gates which songs are offered, which is real, correct,
  and the best thing progression currently does.
- `allStandings` stops being read by any Progress surface. Its remaining
  consumers are `provenChords` and routine building.

### 5.4 `src/data/skills.ts`

Unchanged. All 38 skills stay, including the 26 the app cannot measure. They are
the taxonomy and `routineBuilder` reads them. **What changes is that the
unmeasurable ones are no longer rendered as standings anywhere.** Keep the data,
delete the display. This is the difference between the app knowing that
strumming is part of module 4 and the app grading the player on strumming.

### 5.5 `src/components/practice/journeyCourse.ts`

Keeps `BEGINNER_PATH`, `BEGINNER_TOTALS`, `gradeOf`, `moduleOfLesson`,
`positionOf`. `moduleContent` and `ModuleContent` are deleted: `measured` and
`atBar` exist only to compute "0 of 1 cleared". `Spine` moves to its own file
and is reused in zone NOW.

### 5.6 `src/lib/xp.ts`

The economy is sound and the formula is not touched. Two changes:

- **New export `xpForDay(dailyLogs, date)`** returning that day's `XpDay`
  together with the level standing before and after it. Nothing today can answer
  "what did this session earn" without recomputing the whole history twice, and
  the session report needs exactly that number.
- The `source` breakdown stays in the model because it is what makes the total
  auditable in tests. Only its display is deleted.

**On the level economy itself.** Level 52 after four months is generous. It is
deliberately generous, it moves every few days, and moving is the property the
owner is asking for. Keep it. The one reservation: `LV 52` alone reads as a big
number with no scale, so the band name must sit beside the number everywhere the
number appears, permanently, and never be treated as optional decoration.

### 5.7 `src/data/achievements.ts`

Nine awards, of which four are about attendance (`week`, `consistency`,
`fifty-days`, `comeback`) and five about playing. That ratio is wrong for a
product whose entire positioning is that it hears the instrument.

- **`five-pairs` is measured wrongly.** It counts pairs whose best ever cleared
  30, which one lucky run buys. It should count pairs whose `readiness` is
  `held`. Same for `the-gate`. The app has a word for "did it three times" and
  the awards should use it.
- **`week` contradicts `restAdvice`.** The app tells the player at six days that
  a rest is the stronger move, and then awards seven days in a row. Change it to
  five days inside one week, which rewards the cadence the course actually
  recommends, and keep the flame.
- **Add two measured awards** so the balance tips back toward the instrument:
  five pairs held rather than touched, and one pair at 60 a minute, double the
  gate.

Under the new rule the unearned set is invisible anyway, so this is about what
lands on the thread, which is the only place an award is now seen.

### 5.8 `src/components/DailyPath.tsx`

Delete `ProgressView`, `PROGRESS_VIEWS`, the `progressView` state, `tabRefs`,
`onTabKey`, the tablist markup, and the roving tabindex. Roughly forty lines.
The phone-overflow risk recorded in `docs/progress.txt` line 234 stops existing
because there is no tab strip to overflow.

---

## 6. Where XP, level and the bar live

| Surface | What it shows | When |
| --- | --- | --- |
| Main screen, standing strip | Level number, band name, level bar, streak | Always |
| Session report | `+N`, up to three event lines, the bar animating | Once per session |
| Progress, zone NOW | Band title, level, bar, ten-rung ladder | On open |
| Progress, thread | Level crossings and awards, as dated events | In the record |
| Nowhere else | | |

The gain is shown as a single number with the bar moving under it. Not a
count-up animation on the digits, not a burst, not a sound. The bar moves once
and stops, and the three lines beneath it name what happened. The feeling being
designed for is momentum, and momentum reads as a thing that moved, not as a
celebration.

Ethos and pathos, named because they drove the choices:

- **Ethos** owns the graticule strip and the thread. Both show only what
  happened, both are derived from the logs on every render, and neither can
  display a mark the app did not earn. That is the trust surface.
- **Pathos** owns the standing strip and the session report. The first thing the
  player sees each day is that they are somewhere and it is moving; the last
  thing they see each session is what it added. That is the momentum surface.
- Where they conflict, ethos wins: the session report will happily show `+12`
  with no event lines under it on a bad day, and will not manufacture
  encouragement to fill the space.

---

## 7. Build order

Smallest genuinely useful slice first. Slices 1 and 2 are independently
shippable and neither deletes anything.

1. **The standing strip and XP in the session report.** Touches `DailyPath.tsx`,
   the session summary, and adds `xpForDay` to `xp.ts`. Delivers the owner's
   explicit ask, changes how every session ends, and deletes nothing. Ship it
   and live with it for a week before slice 3.
2. **The trend floor and the recommendation invariant.** `drillStats.ts` and
   tests only. No UI work. Fixes findings 1 and 2 at the source. Should ship
   regardless of whether the rest of this document is approved.
3. **Collapse Numbers and History into one scroll.** Build the graticule strip
   and the thread. Delete the tab strip. Journey and Awards move to the bottom of
   the same scroll, unchanged, so nothing is lost while the new shape is judged.
4. **Delete Journey.** Ship the position row and the module picker. Delete
   `JourneyPanel`, `journeyCopy`, `journey.css`, `moduleContent`, `nextUp`,
   `blockedBy`.
5. **Awards become thread events.** Delete the ledger, the figure tiles, and the
   unearned grid. Add the nearest-award row. Apply the award corrections in 5.7.
6. **The module advance offer.** The one-tap "Module 5?" prompt from section 3.
7. **Desktop two-column.**

---

## 8. What would tell me I was wrong

Six things, with the evidence that would settle each.

**8.1 The thread is the biggest bet.** If the owner opens Progress and scrolls
past the thread without stopping, it is decoration and the surface should be
zone NOW plus a link to a plain log. Evidence: whether any day row is ever
expanded. That is one boolean and it is worth instrumenting before slice 3.

**8.2 Deleting the course map.** If the owner reports opening Progress in order
to find the lesson link or to check where they are, the map was load-bearing.
The fix would not be to bring it back here; it would be to build it properly on
the routine surface, where choosing what to work on belongs. Evidence: whether
the module picker is used more than once a month.

**8.3 The absence of unchecked rows could read as the app forgetting the
course.** If the reaction is "it does not feel like a course any more", the fix
is not checkboxes. It is naming the module by title on the main screen, so the
course is present as where you are working rather than as what you owe.

**8.4 `TREND_FLOOR` at 5 per cent may be wrong in either direction.** I would
compute the run-to-run standard deviation of `A <-> D` over the owner's last 60
real days before shipping slice 2. If sigma over mean is under 3 per cent, the
floor is too high and real slides get suppressed, which is the failure mode that
matters. This is a ten-line script against the existing history and it is the
one number in this document I would not ship without checking.

**8.5 Level 52 may read as meaningless.** If the owner's reaction to `LV 52` is
"52 of what", the band must be permanently adjacent, and if that still fails,
the main screen should carry the band and the bar and drop the number entirely.

**8.6 The overall test.** If, after all of this, the owner still cannot answer
"what should I play right now" within three seconds of opening the app, then
everything above is cosmetic and the real conclusion is that Progress should not
be a destination at all: it should be section 4.1 and nothing else, with the
record reachable from Setup. That is candidate 3 from section 2.2, and it stays
on the shelf as the answer if this one fails.

---

## Appendix: how the evidence was gathered

A Playwright script seeded `localStorage` in the manner of `tests/browser/smoke.mjs`
with 110 days of history for a learner on Grade 1 Module 4: 78 practised days,
four chord pairs (`A<->D`, `Am<->E`, `Em<->D`, `C<->G`), Chord Perfect, an anchor
rotation, timed strumming and spider-walk blocks, and periodic reflection notes.
Each of the four tabs was screenshotted at 390x844 and 1280x1000 and at a tall
viewport that renders the whole panel, and the panel's `innerText` was extracted
for word and sentence counting. The Journey's grade and module accordions were
driven programmatically to establish the per-module mapping coverage quoted in
finding 4.
