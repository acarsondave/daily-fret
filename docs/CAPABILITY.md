# What the app can measure

Derived from `src/data/skills.ts`. Regenerate the numbers with the skills test.

|            | count | meaning |
|------------|-------|---------|
| measured   | 14 | a drill exists and produces a number today |
| measurable | 11 | the signal is there, the analysis is not built |
| timed      |  3 | a clock is the honest measure |
| known      | 10 | knowledge, not motor skill; could be asked, never heard |

60 of Grade 1's 74 lessons map to a skill. The 14 that do not are practice
routines, song lists and "when to move on" lessons: correctly not skills.

## The work list, clustered

**Nothing new needed (2 skills).**
- `rhythm.dynamics` — the timing analyser already reports how far each attack
  rose. This is a component and a stat, not DSP.
- `riffs.single-note` — the tuner shipped a monophonic pitch detector accurate
  to a fraction of a cent, and the timing drill shipped a beat grid, so both the
  notes and their placement can be followed. It needs a drill component wrapped
  around them, not an algorithm. Grade 1 alone has four riffs (Peter Gunn, Seven
  Nation Army, Sunshine Of Your Love, Come As You Are) that currently run on a
  timer.

**Attack timing: done, and what it did not cover (3 skills left).**
`rhythm.on-the-beat` and `rhythm.metronome` are now measured by the strum timing
drill. The standing rule this ran into was that rhythm grading had been rejected
once already, because a wrong verdict costs more trust than no verdict. It was
not relaxed. What changed is that the click and the guitar were made separable in
the signal: the click sits between 2 and 5 kHz where a strummed guitar is
thinnest, `src/audio/timing.ts` splits the input into two bands and detects each
on its own, and the beat is read from the click as the microphone hears it rather
than off the audio clock. The accuracy is measured against synthesised takes with
known answers in `tests/timing.test.mjs` rather than asserted.

Two things it does not do, and they are what the remaining three rhythm skills
need. It cannot see two strums closer than a fifth of a second, because the
attack detector holds that refractory to stay clear of a strum's own ring-out.
And nothing in a band envelope says which way the hand was moving. So
`rhythm.up-strums` needs both a shorter refractory and a direction, and
`rhythm.patterns` and `rhythm.six-eight` need up strums plus a matcher that reads
a written pattern as expected positions on the beat grid that already exists.

It also carries a real limit: the click has to reach the microphone, so the drill
cannot be practised on headphones and says so rather than measuring against a
grid it invented.

**Picking evenness (1 skill).** `technique.alternate-picking` wants the gap
between successive attacks, which the timing analyser now produces, but at
alternate-picking speed those gaps are shorter than its refractory. Same blocker
as up strums, and it falls out of the same fix.

**Per-string energy (3 skills).** `technique.finger-placement`,
`technique.string-accuracy`, `technique.muting`. The chromagram collapses the
spectrum to twelve pitch classes, which is exactly the information that says
"the high E is buzzing". These are the deepest and riskiest, and they are the
three that would let the app say something about *how* a chord sounds rather
than *which* chord it is.

**Unstrummed chord recognition (1 skill).** `changes.air` needs the detector to
recognise a shape that is not being strummed, and the onset gate exists
specifically to require a strum. Not hard, but it fights a deliberate guard.

**Recording what is already heard (1 skill).** `setup.tuning`. The tuner reports
cents per string to a fraction of one and writes none of it to the day.

## What this means for order

The two free ones first, because they convert timer-only practice into measured
practice for no engine risk, and both are now cheaper than they were: dynamics
reads a number the timing analyser already computes, and single-note riffs can be
placed on the beat grid the timing drill fits. Then up strums, which is the one
piece of new DSP the rest of the rhythmic half of the course is waiting on.
Per-string energy last: highest cost, highest risk of a wrong verdict, and it can
wait until there is real usage data to tune against.
