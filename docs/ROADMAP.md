# Roadmap — next features

Captured 2026-06-25. These are the agreed next steps to pick up later. The PWA /
offline-install route was explicitly **dropped** for now — not needed.

Ordered roughly by value-to-effort. Each item lists the intent, the concrete
work, and the files most likely involved.

---

## 1. Mic-reliability indicator

**Why.** Detection quality depends entirely on input level and noise floor. When
the mic is weak, far, or noisy the user currently has no idea *why* chords aren't
registering — they just blame the app. A small live signal-quality readout turns
an invisible failure into something the user can fix (move closer, raise volume).

**What.**
- A compact meter shown during any drill: green (good signal), amber (low /
  marginal), red (silence or clipping).
- Derive from data the detector already emits via `onLevel`: `rms`, `noiseFloor`,
  and `salience`. Good = rms comfortably above `noiseFloor * 2` and salience over
  the chord-match floor; amber = active but low salience; red = below the active
  threshold (effectively silence).
- Place it unobtrusively (e.g. near the chroma viz in Free Play, near the timer
  in 1-Minute Changes).

**Files.** `src/audio/detector.ts` (already exposes the needed fields on
`LevelEvent` — no DSP change required), a new `src/components/practice/SignalMeter.tsx`,
wired into `FreePlay.tsx` and `OneMinuteChanges.tsx`, styles in `practice.css`.

---

## 2. Chord Trainer drill

**Why.** Today the only structured drill is 1-Minute Changes between *two* chords.
A trainer that calls out a target chord and confirms when you play it cleanly
covers single-chord accuracy and broader vocabulary — the natural companion drill.

**What.**
- New drill kind `chord-trainer` in `DrillConfig` (`src/types.ts`).
- Flow: app shows a target chord → user strums → detector confirms a stable
  match → score/advance to the next target. Configurable chord set and round
  length.
- Reuse the existing detection stack (`useChordDetector`, `ChordDetector`); this
  is mostly UI + scoring on top of signals we already produce.
- Record results through `recordDrillResult` so it shows up in Progress like the
  other drills (may want a separate stat shape in `drillStats.ts`).

**Files.** `src/types.ts`, new `src/components/practice/ChordTrainer.tsx`,
`PracticeOverlay.tsx` (route the new kind), `src/lib/drillStats.ts`,
`TaskCreatorModal.tsx` (let users create the drill).

---

## 3. Coached session flow

**Why.** Practice is currently a flat list of tasks the user drives manually. A
"coached" mode strings a routine's drills into one guided, hands-free run
(intro → drill → short rest → next), so the user can put the guitar in their
hands and not touch the screen.

**What.**
- A "Start coached session" entry that walks the active routine's drill-bearing
  tasks in order, with countdowns and on-screen cues between segments.
- Auto-advance on completion; allow skip/pause.
- Summary screen at the end (totals, PRs hit) feeding the same result plumbing.

**Files.** new `src/components/practice/CoachedSession.tsx`, `DailyPath.tsx`
(launch entry), reuse `OneMinuteChanges` / future `ChordTrainer` as embedded
segments, `store` for progress + completion.

---

## 4. Close-the-loop recommendations

**Why.** We collect per-pair history but never tell the user *what to practice
next*. A lightweight recommendation ("your G→C is lagging your others — drill
it") closes the loop between tracking and action, which is the whole point of the
Progress view.

**What.**
- A small "Recommended next" surface (on the home screen and/or top of the
  Progress panel) that picks the weakest / least-recently-practiced pair from
  `useDrillStats()` and offers a one-tap launch into that drill.
- Heuristic v1: lowest `best`, or not practiced today, or biggest gap below the
  user's top pair. No ML needed.

**Files.** `src/lib/drillStats.ts` (add a `recommendNext` selector),
`ProgressPanel.tsx` and/or `DailyPath.tsx` for the surface, reuse the existing
practice-overlay launch path.

---

### Explicitly out of scope (for now)
- **PWA / installable app / offline mode** — dropped per owner; revisit only if
  there's a concrete need for offline practice.
