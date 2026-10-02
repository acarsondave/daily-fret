# Status

Updated 2026-10-02.

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

## Shipped

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
| Unit (`npm test`, 56 suites) | pass |
| Lint, `tsc -b`, `npm audit` | clean, 0 vulnerabilities |
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
