# What the app can measure

Derived from `src/data/skills.ts`. Regenerate the numbers with the skills test.

|            | count | meaning |
|------------|-------|---------|
| measured   | 13 | a drill exists and produces a number today |
| measurable | 12 | the signal is there, the analysis is not built |
| timed      |  3 | a clock is the honest measure |
| known      | 10 | knowledge, not motor skill; could be asked, never heard |

60 of Grade 1's 74 lessons map to a skill. The 14 that do not are practice
routines, song lists and "when to move on" lessons: correctly not skills.

## The work list, clustered

The twelve `measurable` skills need only four things, and two of them are
already sitting in the codebase.

**Nothing new needed (2 skills).**
- `rhythm.dynamics` — attack loudness is already on every level event. This is a
  component and a stat, not DSP.
- `riffs.single-note` — the tuner shipped a monophonic pitch detector accurate
  to a fraction of a cent. Following a written note sequence needs a drill
  component wrapped around it, not an algorithm. Grade 1 alone has four riffs
  (Peter Gunn, Seven Nation Army, Sunshine Of Your Love, Come As You Are) that
  currently run on a timer.

**Attack timing (5 skills).** `rhythm.on-the-beat`, `rhythm.metronome`,
`rhythm.up-strums`, `rhythm.patterns`, `rhythm.six-eight`.
`OnsetDetector.detect()` returns a bare boolean: whether a frame contained an
attack, not when within the frame, and not how hard. Everything rhythmic is
blocked on that one return type. This is the single highest-leverage change in
the audio engine.

Note the standing rule it runs into: rhythm grading was rejected once already
because a wrong verdict costs more trust than no verdict. Timing analysis has to
clear a high bar for correctness before it is allowed to say anything.

**Per-string energy (3 skills).** `technique.finger-placement`,
`technique.string-accuracy`, `technique.muting`. The chromagram collapses the
spectrum to twelve pitch classes, which is exactly the information that says
"the high E is buzzing". These are the deepest and riskiest, and they are the
three that would let the app say something about *how* a chord sounds rather
than *which* chord it is.

**Unstrummed chord recognition (1 skill).** `changes.air` needs the detector to
recognise a shape that is not being strummed, and the onset gate exists
specifically to require a strum. Not hard, but it fights a deliberate guard.

## What this means for order

The two free ones first, because they convert timer-only practice into measured
practice for no engine risk. Then attack timing, which unlocks five skills and
the whole rhythmic half of the beginner course. Per-string energy last: highest
cost, highest risk of a wrong verdict, and it can wait until there is real usage
data to tune against.
