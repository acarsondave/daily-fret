# Module 6: a living routine

## What the player does

On Home, open **Module 6 routine** to preview **Module 6**, **From your numbers**,
**Kept**, and **Out**, then tap **Update**. **Later** snoozes the offer. **Undo**
restores the previous routine exactly; it does not rewind practice history.
The offer appears from B1-501 onward or for a routine named Module 5. Accepting records
B1-608 unless the player has already reached a later lesson.

The update keeps the routine ID, finger exercises, C practice, Come As You Are,
and Sunshine Of Your Love. It removes Dm exercises, other recognised riffs and
old song tasks. Unrelated custom tasks stay. It adds G and D Chord Perfect,
G–C/G–D/C–D changes, the weakest eligible D pair from measured history, alternate
picking, 6/8 patterns, a light Note Finder block and the two songs below. Changes
split into individual tasks through the existing store migration. G Chord Perfect
starts with Justin's two-finger grip; the three-finger alternative is noted.

`src/lib/moduleRoutine.ts` is data (`ModulePlan`) plus a pure planner. A later
module can use a new plan, without another migration architecture. `source`
marks module material and carried work, including derived split tasks. Replaying
an accepted update preserves subsequent edits.

## Recovery and sync

Acceptance writes the replacement routine, its receipt and the original snapshot
in one persisted account mutation. `moduleRoutineArchive` is an append-only
recovery map on the account, uploaded alongside it; it is separate from the
existing debounced Firestore `routineArchive` subcollection. This protects offline
and accept/Undo cycles that could otherwise collapse before a network upload.
Undo also archives the outgoing routine, including edits made after acceptance.

An explicit `outcome: 'undone'` replaces an accepted receipt, because deleting a
nested local key would not remove it from Firestore's recursive merge. Remote
reconciliation unions immutable snapshots. Daily logs, per-drill results and
lesson progress are never rolled back. There is no archive-browsing screen yet.
No owner-account credentials were used for this release: the owner applies the
change in-app, rather than a server-side write to his real routine.

## Meter and measurement

- The click supports **4/4, 3/4 and 6/8**, with saved per-meter accents. Tap a
  beat to cycle strong, light and ordinary. Defaults in 6/8: strong 1, light 4.
- 6/8 BPM counts **eighth notes**: six clicks per bar, not six dotted-quarter
  pulses. Both metronome and generated song backing count in for one whole bar.
- `68.` explicitly marks a six-beat pattern. A deck has one meter; 4/4 cards
  never leak into a 6/8 drill. Fixed coached blocks prescribe their meter even
  with automatic tempo off, without overwriting the user's saved preference.
- The three 6/8 rungs are all downs, the B1-604 skip/up pattern, then its final-up
  variant. Written arrows are cues; the matcher scores **attack timing**, not
  actual stroke direction or accent loudness. Full-pattern prescription is capped
  at **126 eighth-BPM** by the analyser's 200 ms refractory; all-down practice
  can use 130. The routine starts the mixed deck at 110.
- Alternate picking uses one pick per click, with a drawn in/out path, a flat
  half and an angled half, and timing feedback/comparison. Supported measured
  practice is at or below 140 BPM. The detector does **not** recognise pick
  direction, angle or tone; the halves are instructed conditions, not inferred
  technique. It needs the click audible to the microphone, not headphones.
- New practice lives inside Coached and Quick paths, with the same rest,
  persistence and result machinery. Picking history uses tempo-bucketed
  `pick:<bpm>` keys. A stale/absent grid produces no confident timing score.

The coach's existing readiness phrase is still “three, two, one”; this is not the
musical bar count-in. New task names are listed in `scripts/drill-names.json`, but
new recordings have **not** been rendered: the synthesis credential was unavailable.
Unknown names use the existing generic introduction, not silence. No API key ships.

## Songs and provenance

Both are ungraded play-alongs using the existing editable YouTube-link path and
supported open-chord vocabulary. Recording-speed tempos are separate from slower
measured practice. The chart begins at musical bar 1; recordings may need the
player's existing sync adjustment. Fade-out endpoints remain less certain than
the core harmonic cycles.

| Song | Shapes / capo | Recording chart |
|---|---|---|
| Fade Into You — Mazzy Star | G, D, Am, C; capo 2 | 6/8; 157 eighth-BPM; 127 bars; strum `D-DUDU` (his sheet); album audio `avv2IIdDnnk`; lesson `iDdUpxZQhpc` |
| Stand By Me — Ben E. King | G, Em, C, D; capo 2 | 4/4; 119 BPM; 88 bars; strum `D-XU-UX-` (his sheet); Atlantic master `b-D5yAAXYng`; lesson `kvAFzZjGlCg` |

**2026-10-15, the owner's sheets.** Both songs now follow the owner's own
Ultimate Guitar sheets (Fade Into You: UG 910099, capo 2; Stand By Me: UG
1724608, capo 2). Chords only: no lyric is stored or shown.

**Stand By Me replaced This Year's Love** at the owner's request. Routines that
already took Module 6 are offered a narrow revision (`bg1-m6-songs`): This Year's
Love's task is swapped for `Song: Stand By Me` in place, nothing else changes,
the old routine is archived and Undo restores it exactly. Module 5 routines get
Stand By Me directly from the Module 6 update. This Year's Love stays as a
retired chart so anything still naming it keeps resolving; it is not offered.

**Fade Into You:** concert A–E–Bm translates to G–D–Am at capo 2, not Em. The C
shape replaces the final Am on the third cycle in chorus/solo blocks (bars 52,
68, 100, 116, confirmed against the record by chord chroma). Tempo moved from
156 to 157: a bar of the record measures 2.288 s and 156 fell a bar behind by the
outro. Strum is the sheet's down 1, down 3, up 4, down 5, up 6, one slot per
eighth-note click; Justin's B1-604 pattern remains the "6/8 Strumming" task.
His sheet's ninth final-chorus line is the chart's outro cycle. The shorter VEVO
edit `ImKY6TZEyrI` is not the chart's reference recording.

**Stand By Me:** capo 2 G/Em/C/D is the record's A/F#m/D/E. Measured on the
master: first downbeat 1.03 s, 8 bars of bass intro, then V V Ch V V Ch Solo
Solo Ch Ch in eight-bar cycles `G G Em Em C D G G`, in phase to the fade. The
record averages 119.0 BPM (the sheet says 120, which runs 1.5 s ahead by bar 73).
It fades inside the last cycle (below −40 dB at bar 85); the chart keeps the
sheet's and Songsterr's 88 bars. Songsterr s61064 and Hooktheory agree on form
and harmony. The linked lesson strums `D XD DU`; the sheet's strum is kept.

**Strum warm-up before songs** (Settings → Practice), off by default since
2026-10-15: a coached song task goes straight to the song unless it is turned on.

Sources checked when authoring:
- [Justin B1-603, 6/8 time](https://www.justinguitar.com/guitar-lessons/6-8-time-signature-b1-603)
- [Justin B1-604, 6/8 strumming](https://www.justinguitar.com/guitar-lessons/6-8-strumming-patterns-b1-604)
- [Justin B1-607, songs for Module 6](https://www.justinguitar.com/guitar-lessons/songs-for-module-6-b1-607)
- [Fade Into You, Songsterr](https://www.songsterr.com/a/wsa/mazzy-star-fade-into-you-chords-s12522)
- [Fade Into You, Ultimate Guitar (the owner's sheet)](https://tabs.ultimate-guitar.com/tab/mazzy-star/fade-into-you-chords-910099)
- [Stand By Me, Ultimate Guitar (the owner's sheet)](https://tabs.ultimate-guitar.com/tab/ben-e-king/stand-by-me-chords-1724608)
- [Stand By Me, Songsterr](https://www.songsterr.com/a/wsa/ben-e-king-stand-by-me-tab-s61064)
- [Stand By Me, Hooktheory](https://www.hooktheory.com/theorytab/view/ben-e-king/stand-by-me)

## Verification boundaries

`tests/browser/module6Visual.mjs` sweeps 390/820/1440 in both OS colour
preferences, including standalone single-G startability and saved-meter isolation.

`tests/browser/module6.mjs` runs in Chromium and with `BROWSER=webkit` (iPhone
emulation). It verifies the offer, Undo, preserved logs, six-cell accents and a
real coached picking → rest → 6/8 transition. The audio fixture replaces only the
microphone source with decoded PCM on the capture AudioContext's clock. Real
worklet, filters, timing analyser, grid fit, scorer, UI and persistence remain.
It does not prove physical microphone permissions or OS audio routing.

`M6_AUDIO_SOURCE=native` retains Chromium's native fake-microphone diagnostic.
On this shared Linux host that source dropped chunks: an isolated source/capture
probe scored 100 vs 73. The deterministic test did not lower its ≥85 threshold.
For iOS permission prompts, interrupted audio sessions, AirPods, silent-switch
behaviour and home-screen updates, see `STATUS.md`.
