# Status

Updated 2026-09-30.

## Live

- https://routines.minirecc.com (Cloudflare Pages project `daily-fret`, built
  automatically from `main` on every push).
- Check it with `npm run health -- --live`; the full maintenance pass is
  `npm run health` (see README).

## Shipped in this round

- **Quick paths.** A **Quick** button joined to **Coached**. Pick any of the
  routine's tasks and run just those in the full coached session. The last
  choice is remembered per routine, and a paused Quick path resumes only as
  itself.
- **One exercise per task.** Changes tasks split into one task per pair, and
  timed tasks into one per block. Saved routines are migrated on load; past days
  are never rewritten, and a completed combined task counts as every part done.
- **Maintenance audit:** see `docs/AUDIT-2026-09.md` (10 fixes, 5
  recommendations).
- **`npm run health`**, a one-command check.

## Test status

| Suite | State |
|-------|-------|
| Unit (`npm test`, 56 suites) | pass |
| Lint, `tsc -b`, `npm audit` | clean, 0 vulnerabilities |
| Browser suites (run one at a time against a preview) | pass, except the two below |
| `strumTiming`, `strumPatterns` | **fail, pre-existing**: the same checks fail on the previous `main` built on its own. Both feed synthesised strums through a fake microphone and are sensitive to machine load. Not caused by this round. |
| `tuner` WebKit half | skipped on the VPS (no GTK/GStreamer); runs on the Mac |
| `onboarding` signed-in case | skipped on local previews (no Firebase key); runs against a configured build |

## Open decisions

See "Recommendations" in `docs/AUDIT-2026-09.md`: which streak the flame should
mean, lazy-loading the task context menu to cut the bundle, and the held-back
major upgrades.

## Next

- Investigate the two strum suites against a quiet machine (the Mac) to tell
  flake from a real detector drift.
