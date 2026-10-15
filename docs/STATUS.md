# Status

Updated 2026-10-15.

## Live

- https://routines.minirecc.com (Cloudflare Pages project `daily-fret`, built
  automatically from `main` on every push).
- Check it with `npm run health -- --live`; the full maintenance pass is
  `npm run health` (see README).
- 2026-09-30: `13393a3` deployed to production. `npm run health -- --live`
  passed all 15 checks (production = origin/main). `tests/browser/quickPaths.mjs`
  and `tests/browser/onboarding.mjs` (including the signed-in second-device
  case, which needs a real Firebase build) both pass against the live URL.
- 2026-10-02: Safari is now checked on the VPS, with no Mac (see below and the
  addendum in `docs/AUDIT-2026-09.md`).

## Module 6 release checks

Implementation and measurement boundaries: [MODULE6.md](MODULE6.md).
- Exact Undo/history and split-idempotent planner tests cover immutable account
  archives, outgoing edits and remote reconciliation.
- Chromium and WebKit/iPhone Module 6 browser checks pass: offer/update/Undo,
  real picking scores above the unchanged 85 threshold, six-cell accents and the
  actual picking → rest → 6/8 coached sequence.
- Native Chromium fake-microphone capture can drop chunks on this shared host;
  the scored fixture uses decoded PCM on the real capture context clock. This is
  not evidence of physical iOS microphone behaviour.
- One existing XP performance assertion hit 98ms against a 60ms budget under
  load; its isolated retry and two subsequent complete 61-suite runs passed.
  No threshold was relaxed. One short synthetic picking take also left a half
  unmeasured under load; the fixture now runs 32 seconds to collect more evidence,
  with the same score threshold and minimum-evidence checks.
- New coach names are listed but not rendered (synthesis credential unavailable).
  The existing generic intro/readiness clips remain the fallback.
- The owner applies the update in-app; no real owner-account write was performed.

## Shipped

- **2026-10-15, Stand By Me and the owner's sheets:** Stand By Me (capo 2,
  119 BPM, 88 bars, `D-XU-UX-`) replaces This Year's Love in Module 6, with a
  narrow in-place swap offered to routines already on Module 6 (preview, archive,
  Undo). Fade Into You follows his UG sheet: strum `D-DUDU` on the eighth-note
  click, 157 BPM. Both songs link a lesson. Settings → Practice has **Strum
  warm-up before songs**, off by default: a coached song task now goes straight
  to the song. Details in [MODULE6.md](MODULE6.md).

- **Module 6:** G/D Chord Perfect (including standalone single-shape start),
  6/8 meter/accents and pattern practice, coached alternate picking, Fade Into
  You and This Year's Love, plus the previewable archived routine update.
  The existing C/finger work and two requested riffs remain.

- **Quick paths.** A **Quick** button joined to **Coached**. Pick any of the
  routine's tasks and run just those in the full coached session. The last
  choice is remembered per routine, and a paused Quick path resumes only as
  itself.
- **One exercise per task.** Changes tasks split into one task per pair, and
  timed tasks into one per block. Saved routines are migrated on load; past days
  are never rewritten, and a completed combined task counts as every part done.
- **Maintenance audit:** see `docs/AUDIT-2026-09.md`.
- **`npm run health`**, a one-command check. It covers Chromium and WebKit
  (iPhone).
- **Safari without the Mac:**
  - WebKit runs on the VPS.
  - `BROWSER=webkit` is supported by `quickPaths` and `layout`.
  - A touch-screen layout fix: two whole tasks fit again on a 360-wide phone.

## Test status

| Suite | State |
|-------|-------|
| Unit (`npm test`, 61 suites) | pass |
| Lint, `tsc -b --force`, production build | pass |
| Runtime dependency audit (2026-10-12) | 4 high dependency roll-ups from existing Firebase → `@grpc/grpc-js <1.13.6`; unchanged manifests/lockfile in M6. The advisories concern Node gRPC certificate context and server error messages, not a newly added app endpoint. Not reported as clean. |
| M6 browser, Chromium + WebKit/iPhone | pass; real scorer, source fixture only |
| M6 visual sweep | 42 screenshots: 390/820/1440 × light/dark OS preferences; no overflow/page errors; single established dark palette |
| Regression smoke, coached, song chart (Chromium), Quick paths (both engines) | pass, serial |
| Browser suites, Chromium (one at a time against a preview) | pass, except the two below |
| `strumTiming`, `strumPatterns` | **fail, pre-existing**: the same checks fail on the previous `main` built on its own. Both feed synthesised strums through a fake microphone and are sensitive to machine load. Not caused by this round. |
| Safari check, WebKit as an iPhone on the VPS | `quickPaths`, `layout` (10 viewports including 390/820/1440) and `tuner` pass; the live smoke passes in WebKit |
| `onboarding` signed-in case | skipped on local previews (no Firebase key); runs against a configured build |

## Needs Acarson's phone

WebKit on the VPS is the Safari check. These need a real iPhone:

- **A real microphone in Safari on iOS:** the permission prompt, the audio
  session after a phone call, and the AirPods route.
- **The coach voice and metronome with the silent switch on.**
- **Home-screen install and the update banner** on iOS.

## Open decisions

See "Recommendations" in `docs/AUDIT-2026-09.md`: which streak the flame should
mean, lazy-loading the task context menu to cut the bundle, and the held-back
major upgrades.

## Next

- Tell flake from real detector drift in the two strum suites. Run them on the
  VPS at a quiet hour (`uptime` load under 3), several times each. Do not wait
  for the Mac.
