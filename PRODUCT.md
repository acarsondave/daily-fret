# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user today is the owner: an adult beginner guitarist working through a
structured beginner course, practising most days, alone, with the guitar already
in hand.

Confirmed intent is to hold a second audience soon: another self-taught learner
who has never opened the app, arrives with their own lesson source, and must be
able to get to a first useful practice session without the owner present. Nothing
may assume the owner's guitar, grade, routine, or vocabulary.

The practice situation is the design constraint. Both hands are on the instrument,
the screen is propped and out of reach, and the user is listening more than
looking. Reading a screen costs a stopped hand.

## Product Purpose

Daily Fret turns a daily practice intention into a session the learner actually
completes, and then tells them whether it worked.

It runs the routine hands-free: announces each drill by voice, counts in, listens
through the microphone, counts what was actually played, prescribes the tempo, and
records the result. Success is a practice habit that survives bad days, and
measurable evidence that specific weaknesses moved.

The product does not teach guitar. It is the practice layer around whatever
lessons the learner follows.

## Positioning

The mechanism a routine tracker cannot copy: Daily Fret hears the instrument.

Real-time chord detection runs entirely in the browser (a 2-octave chromagram over
1024-sample frames, spectral-flux onset detection, signed 12-bin chord templates
matched by mean-centred cosine, with per-guitar templates learned from the player's
own instrument). Because the app knows what was played, and not merely what was
ticked, it can do three things a checklist cannot:

- Count real chord changes and shape placements instead of trusting self-report.
- Prescribe today's tempo from each drill's own measured history, never above a
  pace the player has already proven.
- Distinguish "did the practice" from "the practice worked".

Positioning is course-agnostic by decision: the skills, drills, and progression are
the product's own. The lesson source belongs to the learner.

## Operating Context

- Practice happens on both a propped Mac laptop and a propped phone, depending on
  the day. Neither viewport is secondary; drill screens must be designed for both.
- The microphone is whatever the device has built in, at roughly arm's length from
  an acoustic guitar, in an ordinary room with ordinary noise.
- Audio output and audio input contend on the same device. The coach voice, the
  metronome click, and the microphone are live in the same session.
- Safari on macOS and iOS is a first-class target and has repeatedly been the
  strictest one (autoplay policy, media element limits, audio session contention).
- Song play-alongs are the real commercial recording, embedded from YouTube via a
  link the learner supplies. Hosting audio is out of the question.
- Sessions are frequently interrupted. A partly finished coached session must be
  resumable.

## Capabilities and Constraints

Confirmed today:

- Routines of ordered tasks. A task is either a timed block (optionally several
  labelled blocks with their own minutes, strum pattern, and tempo) or a live drill.
- Four live drills: one-minute chord changes between a pair, anchor rotation
  through an ordered ring, Chord Perfect (place a shape, strum, lift off, place
  again, one shape per block), and song play-along.
- Coached mode flattens a routine into segments and runs them end to end with
  spoken announcements, a count-in, a rest between segments, auto-advance, and a
  summary. Progress is saved so an interrupted session resumes.
- Tempo coaching derives BPM and beats-per-change from a drill's own result
  history, with a stated reason for the number.
- Per-guitar calibration learns discriminative chord templates from real playing,
  refined passively during normal drills.
- Local-first: Zustand persisted to localStorage, with optional Firebase Auth and
  Firestore sync. The app is fully usable signed out.
- Diagnostics: every microphone session records per-frame gate outcomes, exportable
  as JSON for offline analysis of why detection did or did not fire.

Constraints:

- The detector recognises nine chords: A, C, D, E, G, Am, Dm, Em, F. Everything
  authored, including songs, must stay inside that set.
- Rhythm and strum-timing grading is deliberately rejected. It is not reliable from
  a single microphone, and a wrong verdict on timing destroys trust faster than no
  verdict.
- Full tab or notation transcription is out of scope with the current engine.
  Chords only.
- No page navigation. Overlays, modals, and panels preserve context.
- Vanilla CSS. Tailwind is explicitly excluded.

Decided, not yet built:

- Onboarding calibrates the new player's guitar during first run. Detection is only
  ever as good as calibrated; the app does not guess on an unknown instrument.
- A progression model: skills with prerequisites and unlock criteria driven by
  measured results rather than by ticking a box.
- Adaptive routine composition, so the session is prescribed from results rather
  than authored by hand.
- Deeper feedback than chord identity (cleanliness of the shape, muted or buzzing
  strings, per-finger diagnosis, tuning). The specific mechanism is undecided; the
  rhythm-grading constraint above still stands.
- Song work as musicality rather than accompaniment (charts against the recording,
  sections, key and capo handling, a library that grows with what the player can
  play).

Open decisions, recorded rather than invented:

- Whether the curriculum content that fills the progression engine is authored by
  the product, imported, or supplied by the learner. The engine is to be built so
  curriculum is data.
- Whether calibration becomes multi-profile (the stored shape already carries a
  guitar label, so this is additive).
- Whether other learners get accounts and sync by default, or stay local-first with
  sync as an opt-in as the owner does today.

## Brand Commitments

- Name: Daily Fret. Deployed at routines.minirecc.com.
- Voice is plain, specific, and unhyped. It states what happened and what the
  number means. It does not congratulate the user for showing up.
- The coach speaks. A pre-rendered voice pack announces drills, counts in, and
  covers rests, and the visual UI must remain a complete fallback when the voice is
  off or unavailable.
- The product never claims to have heard something it did not. When audio is
  blocked, detection is degraded, or a value is uncertain, it says so rather than
  showing a confident number.

## Evidence on Hand

- Real practice history: daily logs with per-drill results going back months, used
  today to drive tempo prescription and progress trends.
- Ten exported diagnostics sessions in the repository root
  (`daily-fret-diagnostics-*.json`), each carrying per-frame detector decisions and
  a snapshot of the tuning constants. These are the ground truth for detection
  work and have already produced concrete engine fixes.
- A pre-rendered coach voice pack in `public/coach/` with a manifest.
- An authored song catalogue in `src/data/songs.ts` with per-bar chord, lyric, and
  strum transcriptions. Note: the per-bar section data is currently unread by any
  screen and is preserved deliberately as the source for future chord charts.
- No user research beyond the owner. No testimonials, benchmarks, pricing, or
  third-party validation exist. Future work must not fabricate any.

## Product Principles

1. **The instrument is the input.** Anything the app can verify by listening, it
   should verify by listening rather than ask the user to report.
2. **Never claim more than was heard.** A degraded microphone, blocked audio, or an
   uncertain match is stated plainly. A confident wrong number costs more trust
   than an honest gap.
3. **Hands stay on the guitar.** Every routine moment must be completable without
   touching the screen. Reading is optional; listening is the channel.
4. **Prescribe from evidence, never from ambition.** Tempo, difficulty, and what to
   practise next come from the player's own measured history, and the app explains
   the number it chose.
5. **A stranger's first session must stand alone.** No screen may depend on the
   owner's guitar, grade, vocabulary, or hand-authored routine.

## Accessibility & Inclusion

- The screen is at arm's length while both hands are occupied. Type, targets, and
  state changes must read from practice distance on both a phone and a laptop.
- The spoken coach and the visual UI are each a complete path. Neither may be the
  only way to complete a session.
- No product-specific conformance standard has been set. Recorded as undecided.
  Current implementation has known gaps (no visible focus states, task rows not
  keyboard operable, pinch zoom disabled, no reduced-motion handling) that the
  "stranger's first session" commitment makes material.
