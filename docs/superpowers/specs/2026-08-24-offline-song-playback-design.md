# Playing songs without the internet

Design, 2026-08-24. Not implemented. Hand this to an implementing agent.

Classified ARCHITECTURAL: it adds a second playback engine beside YouTube, a new
clock, a new audio scheduler, a service worker, and it changes what a song has to
carry to be playable. It also splits a component that is already carrying two
jobs.

This spec was written by an agent that could not ask the owner questions in
real time. Every place a question would have changed the design is marked
**ASSUMPTION** with the alternative that was rejected and why. Correct any of
them and the affected section changes, not the spine.

---

## 1. The two requests, separated

The owner asked for one thing and it is two.

**Request one: the app loading with no connection at all.** He believes this
already works. It does not. Section 2.

**Request two: playing a song with no connection, since songs come from
YouTube.** Section 3 onward. This is the substantial one, and the answer turns
out to be better than a fallback.

---

## 2. The app shell does not load offline today

Verified, not assumed:

- No service worker anywhere. `public/` holds `pcm-worklet.js`, fonts, the coach
  voice pack and `icons.svg`, and nothing else.
- No web app manifest. `index.html` links a favicon and inlines two `@font-face`
  rules. There is no `<link rel="manifest">`.
- `src/main.tsx` registers nothing.
- `vite.config.ts` has one plugin, `@vitejs/plugin-react`, and a `cssTarget`.
- `grep -rn "navigator.onLine|serviceWorker" src/` returns nothing.

What genuinely survives a disconnection today is **data, not the app**: Zustand
persist writes to localStorage, detection diagnostics live in IndexedDB, footage
lives in OPFS, and Firebase Auth persists its session to IndexedDB. So a tab that
is already open keeps working well. A cold load with no network asks Cloudflare
Pages for `index.html` and fails. The browser HTTP cache may sometimes rescue a
warm reload, but `index.html` is served revalidating and every deploy rehashes
the chunks, so it is luck rather than a guarantee.

That gap has to close first, because the whole of section 3 is worthless if the
page that hosts it cannot open.

### 2.1 What to build

`vite-plugin-pwa` as a dev dependency, Workbox under it, plus a web app manifest
so the app can be installed to a home screen.

**Precache** (generated from the build, hashed, so an update is atomic):
the entry HTML, every JS and CSS chunk, `icons.svg`, `favicon.svg`, both
`.woff2` faces, `pcm-worklet.js`.

**Runtime cache, cache-first, never precached:** `public/coach/*.mp3` and
`public/coach/manifest.json`. There are sixty-odd clips. Precaching them spends
the owner's mobile data on the first load of every deploy to fetch audio he may
not hear that day. Cache-first means a line he has heard once is a line he owns.

**Never cached:** anything on `firestore.googleapis.com`,
`identitytoolkit.googleapis.com`, or `youtube.com`. Firestore has its own offline
machinery and a service worker sitting in front of it is a way to serve stale
user data. YouTube's embed is cross-origin and opaque; see section 4.4.

**Updates are shown, not silent.** `registerType: 'prompt'`. When a new build is
waiting, the app shows a small mark that reloads on tap. It never swaps the
running app underneath a session in progress, and it never leaves the owner on a
build he cannot tell is old. Ethos: the app must not lie about which version it
is.

> **ASSUMPTION A1.** `vite-plugin-pwa` rather than a hand-written service worker.
> Rejected: hand-rolling it, roughly 120 lines plus a Vite plugin to read the
> bundle's asset list. The failure mode of a hand-rolled SPA service worker is
> always the same, a user pinned to a stale build forever, and it is the one
> failure this app can least afford. The dependency is a dev dependency and its
> runtime cost is around ten kilobytes.

> **ASSUMPTION A2.** Coach voice is runtime-cached, not precached. Rejected:
> precaching the pack, so a first coached session offline is fully voiced. The
> owner is on a constrained connection and a silent coached session already
> degrades gracefully by design (`src/audio/coachVoice.ts` is a no-op without
> clips).

### 2.2 What must be verified, not reasoned about

Before this is called done: build, serve the `dist`, load once, kill the network,
cold-load again in a new tab. The app must reach the routine. Then repeat with
the app installed to the home screen. Anything short of that observation is the
failure the `verification-lesson` memory is about.

---

## 3. The finding that changes the shape of request two

Three things in the code, in order of how much they matter.

### 3.1 The chart does not know what YouTube is

`SyncedChart` (`src/components/practice/SyncedChart.tsx`) takes a `SongTimeline`
and a `TimeSource`. `TimeSource` is one method:

```ts
export interface TimeSource {
  read(): MediaClockRead; // { seconds, playing, rate, snapped }
}
```

`MediaClock` implements it by polling YouTube and smoothing. Nothing else in the
chart, the section tracking, the loop, the count-in or `PlaybackControls` touches
the player. **Anything that can say what second it is can drive the entire moving
chart.** This is the seam, and it was built as a seam on purpose.

### 3.2 The synced chart has never run for a single shipped song

`atSeconds` appears exactly twice in `src/data/songs.ts`: once in the authoring
comment and once in the type. No song literal carries one, and no song carries
`endSeconds`. `buildTimeline()` is strict and all-or-nothing by design, so for
every one of the eight built-in songs it returns
`{ ok: false, gap: 'no-anchors' }`.

So today, every play-along in the app is: a YouTube video, plus the sentence
"This chart has no timing yet. Play along with the chords above."

The scrolling chart, the per-section anchors, the drift model, the tap-to-anchor
editor: all built, all correct, all currently unreachable, because the two
minutes per song of tapping has been paid zero times in ten days.

That is the decisive fact for this design. **A feature whose value is gated on
that same unpaid authoring cost is building on sand.** An offline mode that
derives its own timeline needs no anchors and lights the chart up for all eight
songs on the first run.

### 3.3 A song is already a complete performance

`getLucky` in `src/data/songs.ts` carries `bpm: 116`, `capo: 2`,
`chords: ['Am','C','Em','D']`, a sixteenth-note strum phrase, and eight sections
of bar-by-bar chords with lyrics. `src/data/chordShapes.ts` carries exact
per-string fret positions for twenty-five chords, including which strings are
muted. `src/audio/metronome.ts` is a lookahead scheduler on a shared
`AudioContext` that already renders its own voices into buffers and schedules
them sample-accurately.

Everything needed to *perform* these songs is in the repository. What is missing
is a clock that is ours and a voice that plays chords.

---

## 4. Approaches weighed

### 4.1 The app drives the chart on its own clock (recommended, as the spine)

A click at the song's tempo, the chart advancing on our clock, chords changing
where the section says, the strum lighting slot by slot.

Removes YouTube. Removes drift entirely, because our clock is not tracking
anything, it *is* the truth. Needs zero storage and zero anchors. Works for every
song the moment it has a tempo.

What is lost, stated plainly and never to be papered over: the record. The bass,
the drums, the vocal that tells you where you are, the feel of a band pushing and
pulling. Playing to a bare click for four minutes is a different activity from
playing along to Get Lucky, and a design that pretends otherwise is dishonest.

Alone, this is a metronome with lyrics. The owner would use it twice.

### 4.2 A generated backing (recommended, as the second half)

Same clock, plus the chords actually sounded, strummed on the pattern's own
slots, from the fret shapes the app already holds.

Cost: one string-voice renderer and one scheduler, both modelled on code that
already exists (`renderClick`, `Metronome.schedule`). Karplus-Strong plucked
strings rendered offline into cached buffers, six per chord, spread by fifteen to
twenty-five milliseconds across the strum, order and brightness reversing on an
up stroke.

Does a bad backing hurt more than none? Yes, and that sets the bar precisely.
The bar is not "sounds like Daft Punk". The bar is "sounds like someone sitting
on the sofa playing the chords with you", which a plucked-string voice clears,
and which the metronome's bell-and-stick family is proof this codebase can reach
without sounding cheap.

This is what turns 4.1 from a click into something worth opening.

### 4.3 User-supplied audio in OPFS (sequenced later, gated on a question)

The owner drops in an MP3 he owns, stored in OPFS, anchored per section the way
YouTube already is.

Legally defensible: a file he owns, on his own machine, never uploaded, in an
origin-private store no other site and no file manager can reach. Practically
uncertain: it is not known whether he has such files, and the storage would share
a quota with footage that has already leaked 469 MB once
(`src/media/storage/backend.ts`).

The decisive objection is not legal or practical. It is that this path **re-incurs
the exact authoring cost that section 3.2 shows has never been paid.** A local
file makes anchoring cheaper (precise seeking, no ads, offline) but it does not
make it free, and nine taps a song is still nine taps a song.

Sequenced fifth. Build only if the owner says he has the files and wants them.

### 4.4 Caching YouTube itself (rejected, plainly)

No. Not "hard", not "fragile". Against the terms this codebase already keeps.

The IFrame embed is cross-origin and opaque; a service worker cannot cache it in
any useful form, and the player phones home on every load regardless. There is no
supported API that returns media bytes. Extracting them anyway would breach the
Terms of Service, which forbid downloading and forbid separating the audio from
the player.

The repository has already taken a position on this, twice, in code comments:

> "The video stays on screen at a real size whatever else is showing... YouTube's
> terms are clear that the player is not a hidden audio source for something
> else."

Reversing that quietly to get offline audio would be the app breaking a rule it
has been visibly keeping. Not worth it, and not needed, because 4.1 plus 4.2 is
better than a cached video would have been.

---

## 5. Recommendation

**Build an app-driven song mode: our own clock, our own tempo, the chart moving,
the chords sounding. Ship the clock and chart first, the chord voice immediately
after.**

The argument is not that it works offline. That is a side effect.

**It is a better practice mode that happens to need no network.**

- **The chart finally runs.** Zero of eight songs can scroll today. All eight can,
  the day this lands, with no anchoring.
- **The tempo is ours.** YouTube offers a fixed set of rates and its slow ones are
  unusable. Our clock plays any tempo cleanly, because there is no recording to
  time-stretch.
- **The tempo can be prescribed and can accumulate.** `src/lib/tempo.ts` already
  plans a BPM from a drill's own history and never above proven pace. A song
  practised at 70 percent of its tempo this month and 85 percent next month is
  exactly the "somewhere for difficulty to go, and a record that accumulates"
  that the `long-term-value-rule` demands. The song shelf currently has none: a
  song is played or not played, forever.
- **The loop is exact.** No `LOOP_LEAD_SECONDS` fudge, no seek latency, no ad
  break to resync through.
- **The count-in is real**, from the existing metronome count-in.

So the two modes are not a good one and a degraded one. They are two different
things, both honest:

> **Record mode: play with the band.**
> **Chart mode: play the song.**

The second one is where you get it under your hands. The first one is where you
find out if you did.

### Sequencing

1. Service worker and install manifest. Section 2. Small, and the owner's stated
   premise is currently false without it.
2. Chart mode: clock, tempo timeline, chart, click, count-in. All eight songs
   become playable with no network.
3. The chord backing voice. Chart mode stops being a metronome with lyrics.
4. Tempo prescription and an accumulating per-song record, wired to the existing
   tempo model.
5. User-supplied audio in OPFS, only if the owner has files and wants them.
6. Never: caching YouTube.

---

## 6. Architecture

Five new units, each with one job, plus one component split. Nothing existing is
rewritten.

```
Song + chosen BPM
      |
      v
buildTempoTimeline()  ------> SongTimeline  (the same struct YouTube mode uses)
                                   |
SongClock (AudioContext) ----------+-------> SyncedChart      (unchanged)
   |  read(): TimeSource           |         PlaybackControls (unchanged)
   |                               |         section index, loop (unchanged)
   +--> SongBacking (lookahead scheduler)
             |
             +--> songVoice buffers --> shared output AudioContext
```

### 6.1 `src/lib/songTempo.ts`

```ts
export function buildTempoTimeline(song: Song, bpm: number): TimelineResult
```

Produces the **identical** `SongTimeline` structure that `buildTimeline` produces,
from a tempo instead of anchors. Section bounds are cumulative bar counts times
seconds per beat. Honours `song.beatsPerBar` and per-section `beatsPerBar` exactly
as `songTiming.ts` does, and returns the same `TimelineGap` shape for a chart with
no bars.

Deliberately a new file, not a function added to `songTiming.ts`. That file is
351 lines and its stated job is "where every bar of a chart sits in the
recording". This one answers a different question and must not blur it.

Also here:

```ts
export interface SongPace { bpm: number; source: 'song' | 'practice' | 'chosen' }
export function songPace(song: Song, plan: TempoPlan | null): SongPace
```

`source` exists so the surface never claims a number is the record's tempo when
nobody wrote one down. Only two of eight songs carry a `bpm` today (505 at 140,
Get Lucky at 116).

### 6.2 `src/lib/songClock.ts`

```ts
export class SongClock implements TimeSource {
  start(fromSeconds: number): void
  pause(): void
  resume(): void
  seek(seconds: number): void
  setRate(rate: number): void
  read(): MediaClockRead
}
```

Chart seconds from a monotonic source. Prefers `getOutputContext().currentTime`
because that is the clock the backing is scheduled against, so the picture and
the sound cannot separate. Falls back to `performance.now()` when there is no
AudioContext, so the chart still runs silently rather than freezing.

No smoothing, no drift correction, no snapping. `MediaClock` exists because
YouTube's clock is coarse and remote; ours is neither. `snapped` is true only on
the first read after a seek, so `SyncedChart`'s existing seek detection keeps
working unchanged.

Rate changes rebase at the instant of the change, the same trick
`Metronome.rebase()` uses, so position is preserved.

No React, no DOM. Testable against a fake clock, like `MediaClock` already is.

> **ASSUMPTION A3.** Rate change rebases the clock in place, taking effect
> immediately. Rejected: rebuilding the timeline at the new tempo, which loses
> position; and deferring the change to the next bar line, which is musically
> tidier but means a tempo control that does not respond when you press it. A
> control must show its effect at the moment of the press.

### 6.3 `src/audio/songVoice.ts`

```ts
export function renderStrum(shape: ChordShape, dir: 'D' | 'U' | 'X',
                            sampleRate: number, semitoneOffset: number): Float32Array
```

Karplus-Strong per string. Six strings from standard tuning plus the shape's
frets plus the capo offset; `-1` strings contribute nothing at all. Onsets spread
across the strum, low to high on a down stroke and high to low on an up stroke.
`X` is the same spread with the delay lines heavily damped, which is what a dead
stroke is.

Buffers are rendered once and cached per `(chord, dir, capo)` exactly as
`Metronome.clickBuffers` caches its voices. A four-chord song is twelve buffers,
rendered in a few milliseconds each.

Peak-normalised, tapered at both ends, following `renderClick`'s existing
discipline: an abrupt edge is itself a broadband click.

> **ASSUMPTION A4.** The backing sounds at capo pitch, matching what the player
> actually hears with the clamp on where the chart tells them to put it.
> Rejected: sounding at written pitch, which would clash a whole tone against
> anyone following Get Lucky's own instruction to capo 2. If the capo setting
> and the chart's capo disagree, the intro screen already says so and the backing
> follows the chart.

### 6.4 `src/audio/songBacking.ts`

A lookahead scheduler, sibling to `Metronome`, not an extension of it. It takes a
`SongTimeline` and a `SongClock` and queues, ahead of the clock:

- one chord voice per sounded slot of each bar's strum, at that slot's time,
- the click, when the click is on,
- the count-in before bar one.

It uses the shared context only: `getOutputContext()`, and brackets audibility
with `requestOutputAudio()` on start and `releaseOutputAudio()` on stop. It never
constructs an `AudioContext`.

Deliberately not the global `metronome` singleton. That singleton carries the
routine's own BPM and beats-per-bar and is owned by drills; a song borrowing and
returning it is a state fight waiting to happen. Two schedulers queueing buffer
sources on one context is unremarkable.

### 6.5 The output-context constraint, and how this design keeps it

`src/audio/outputContext.ts` documents a hard-won failure: opening a microphone
or a camera makes the browser hand the output route away, sometimes with **no
`statechange` fired at all**, and a single attempt at start time then loses the
click for the rest of the session. The recovery is `wanted` plus a one-second
watch plus `nudgeOutputAudio()`.

Three rules this design must not break:

1. **Never create a second `AudioContext`.** Everything goes through
   `getOutputContext()`.
2. **Bracket honestly.** `requestOutputAudio()` when a song starts playing,
   `releaseOutputAudio()` when it stops or the screen unmounts. Not on mount, not
   on the intro screen.
3. **Subscribe to `onOutputAudioChange` and show it.** Chart mode has no
   microphone (play-along is never graded, and that stays), but sessions are
   filmed, and a camera is exactly what takes the route. When the context goes
   quiet the chart must **keep running visually** and must **show** that the sound
   has gone. It must never keep drawing a moving chart while claiming, by
   silence, that everything is fine.

Note also: the clock reads `ctx.currentTime`, which stops advancing on a
suspended context. `SongClock` must detect that and hold the chart rather than
letting it lurch when audio returns.

### 6.6 The component split

`SongPlayer.tsx` is 361 lines holding the intro screen, YouTube wiring, link
editing, the chart, the loop, and the results card. Adding a second engine to it
makes a god component. Split along the seam that is already there:

- `SongPlayer.tsx` keeps the phases, the chord intro, the mode choice and the
  results. It shrinks.
- `SongRecordStage.tsx` takes the YouTube player, `usePlayerClock`, link editing,
  the untimed-chart notice and the player error path. Moves out unchanged.
- `SongChartStage.tsx` is new: `SongClock`, `buildTempoTimeline`, `SongBacking`,
  tempo control.

Both stages render `SyncedChart` and `PlaybackControls`. Neither knows the other
exists.

### 6.7 `src/lib/offline.ts`

```ts
export function useOnline(): boolean
```

`navigator.onLine` plus the `online` and `offline` events. One job. It decides
what the song list and the mode choice can offer, never what they silently do.

---

## 7. The interface

The `impeccable` skill is **mandatory** for every screen below, before any of it
is built. This section states intent and constraints; it is not a substitute for
that pass.

### 7.1 The mode choice is two pictures, not two words

On the song intro screen, after the chord shapes, two cards.

The record card carries the YouTube brand mark (the one legitimate use of a
stock glyph in this app: it names YouTube, and a redrawn YouTube logo would be
worse than the real one).

The chart card carries **a miniature of the chart, already moving**: two bars
looping, chord changing, arrows lighting. It is not an illustration of the mode,
it is the mode, at a quarter scale. Nobody has to be told what it does.

Offline, the record card is struck through in the icon set's own stroke weight
and cannot be picked. **No sentence appears.** Per the design system's standing
rule, availability is never signalled by dimming text with opacity.

> **ASSUMPTION A5.** The player picks the mode; the app never switches
> automatically. Rejected: falling back to chart mode when the connection drops,
> which is exactly the silent degradation the brief forbids. If the connection
> dies mid-song, the record stage stalls where it always stalled and the chart
> card is there, struck-through in reverse.

### 7.2 Tempo is a picture of a fraction

Not a number in a field with a label beside it.

A ring or a bar that fills toward the song's own pace, with the played tempo
marked on it. At 70 percent of Get Lucky, the mark sits at 70 percent. Over weeks
the mark moves right, and that movement is the record the
`long-term-value-rule` asks every surface to keep.

For a song with no written tempo, there is no full mark to fill toward, because
there is nothing to be a fraction of. The control shows the number alone. The app
does not invent a record tempo to make a nicer ring.

### 7.3 Everything else already exists

- **Count-in**: start the timeline one bar before the first downbeat and
  `SyncedChart`'s existing count-in draws itself. No new UI.
- **Section loop and rate**: `PlaybackControls`, unchanged.
- **The strum lighting slot by slot**: `PatternBar` already draws slots, the arm
  travelling through them, and marks per slot. Chart mode drives it from the
  clock instead of from a microphone, with every slot in the `idle` state,
  because nothing here is measured. It is a picture of the arm, not a score.
- **Silence**: reuse whatever treatment the metronome already shows when
  `onAudibleChange` reports false. One mechanism, one appearance.

### 7.4 The song list shows what it can do

Each song row carries small state marks: can this scroll, can this play to a
record. Offline, the record marks go struck across the whole list at once. A song
with no bars carries no chart mark.

Word count added to that screen: zero.

### 7.5 Icons

A chart mark and a record mark, hand-built in
`src/components/icons/practice.tsx` at `ICON_STROKE`, sharing the icon set's
corner language. Not Phosphor, not Lucide, not an emoji. The single exception is
the YouTube brand mark already imported in `SongPlayer.tsx`, which stays only
where it names YouTube itself.

### 7.6 What chart mode must never claim

It must never present itself as the song. The results card in chart mode says
what the app can honestly witness, which is that the chart ran to its end at a
stated tempo, and nothing about how it sounded. There is no score, no accuracy,
no streak inside a song. That rule is older than this feature and this feature
does not touch it.

---

## 8. Data the songs need

`bpm` on the six songs that lack it: Wild Thing, Three Little Birds, Bad Moon
Rising, Knockin' on Heaven's Door, I Belong To You, Sing. One number each,
authored the way the two existing ones were.

Nothing else. No anchors, no audio, no new fields on `Song`.

> **ASSUMPTION A6.** Those six tempos get authored by ear as part of this work.
> Rejected: deriving them from anchors (there are none), and shipping without
> them so every song opens at the default practice tempo (which would silently
> lose the "fraction of the record's pace" picture for three quarters of the
> catalogue).

> **ASSUMPTION A7.** The click is audible through the count-in and then off by
> default once the chord backing is playing, with a toggle. Rejected: click
> always on, which fights a backing that is already strumming the rhythm; and
> click always off, which leaves a beginner with no downbeat before step 3 of the
> sequencing lands. Between step 2 and step 3 the click is the only sound there
> is, so it is on.

---

## 9. Failure and edge cases

| Case | Behaviour |
|---|---|
| No `AudioContext`, or it stays suspended | Chart runs on `performance.now()`. Silence is shown, not implied. |
| Context suspended mid-song (camera takes the route) | Clock holds, chart holds, silence shown, `outputContext`'s existing one-second watch recovers it and the chart resumes from where it held. Never lurches forward. |
| Song has no sections or no bars | Same `TimelineGap` shape and message as anchored mode. The chart card is absent from the mode choice. |
| Song has no `bpm` | Opens at the player's prescribed practice tempo, labelled as the player's number and never as the record's. |
| Tempo above `MAX_BPM` (240) | Chart mode has no metronome ceiling of its own, but the click does. Clamp the click, not the chart, and only where a song genuinely exceeds it. |
| Connection dies mid record-mode song | Record stage stalls as it always has. The chart card becomes available. Nothing auto-switches. |
| A stale service worker holds an old build | The update mark appears. The app never swaps under a running session. |
| OPFS unavailable | Irrelevant to steps 1 to 4. Only step 5 touches it. |

---

## 10. Testing

Tests run under `node tests/run.mjs`. All of the following are pure and testable
with no browser:

- `buildTempoTimeline`: bar and section boundaries against hand-computed
  positions, mixed `beatsPerBar`, and byte-for-byte structural equivalence with
  `buildTimeline` output given an anchored song whose anchors are exactly on the
  nominal tempo. That last one is the real test: it proves the two engines
  produce the same kind of thing.
- `SongClock`: pause, resume, seek, rate change, each against a fake clock;
  monotonic under every sequence; position preserved across a rate change.
- `renderStrum`: buffer length, peak normalisation, a muted string contributing
  exactly zero, an up stroke's onset order being the reverse of a down stroke's.
- `SongBacking`: against a fake context, every sounded slot gets exactly one
  scheduled source at the right time, nothing is double-queued across a rebase,
  and stopping cancels everything queued.

**What none of these may be.** A test that asserts the scheduler was called is a
test that confirms the code ran. The `verification-lesson` memory is about
exactly that failure. Each test above asserts a value the feature would get wrong
if it were broken.

Beyond the suite, two observations that must actually be made, not reasoned
about: the offline cold load in section 2.2, and a full song played through in
chart mode with a guitar in hand, listening for whether the chord under the hand
and the chord in the speaker are the same chord at the same moment.

---

## 11. What this deliberately does not do

- No grading, no score, no accuracy, no miss count anywhere inside a song. That
  rule predates this design and has two independent reasons behind it.
- No microphone in chart mode.
- No attempt to reproduce a recording. The backing is chords in time, and the
  interface never suggests it is anything else.
- No automatic mode switching.
- No YouTube caching, ever.
- No new dependency beyond `vite-plugin-pwa` as a dev dependency.

---

## 12. Assumption summary

| # | Assumption | Rejected alternative |
|---|---|---|
| A1 | `vite-plugin-pwa` for the service worker | Hand-rolled SW; its classic failure is pinning a user to a stale build |
| A2 | Coach voice runtime-cached on first play | Precaching sixty clips; spends the owner's data on every deploy |
| A3 | Rate change rebases the clock immediately | Rebuild timeline (loses position); defer to bar line (control feels dead) |
| A4 | Backing sounds at capo pitch | Written pitch; clashes for anyone following the chart's own capo instruction |
| A5 | Player picks the mode; no auto-switch | Auto-fallback offline; that is the silent degradation the brief forbids |
| A6 | Six missing tempos authored by ear now | Ship without them; loses the pace picture on three quarters of the catalogue |
| A7 | Click through the count-in, then off under the backing | Always on (fights the backing); always off (no downbeat before step 3) |

Also worth the owner's explicit yes or no, because the answer moves step 5 in the
sequence: **does he have MP3s of these songs that he owns?** If yes, section 4.3
becomes worth building and moves up. If no, it should not be built at all.
