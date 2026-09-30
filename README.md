# Daily Fret 🎸

A local-first daily practice tracker for guitar. You build your own routines,
check off tasks each day, and run interactive drills that listen to your playing
through the mic. A guided "Coached" mode strings a routine's drills into one
hands-free session with a spoken coach.

## Features

- **Build your own routines.** Starts empty; add tasks, reorder them, and turn
  any task into a live drill.
- **Live drills.** One-Minute Changes (counts clean chord switches per minute)
  and Chord Trainer (calls a target chord and confirms when you nail it), both
  driven by real-time pitch/chord detection.
- **Coached mode.** Runs a routine end to end: announces each drill by name,
  counts you in, runs the drill, then a short rest, and repeats. Optional spoken
  coach voice and sound effects; resumes where you left off.
- **Quick paths.** For days the whole routine isn't happening: tap **Quick**
  beside **Coached**, tick any of the routine's tasks, and run just those in the
  same coached session (coach, click, camera, record, streak). The last choice
  is remembered per routine.
- **One exercise per task.** A changes task over several chords is one task per
  pair, and a timed task with several blocks is one task per block, so any one
  of them can be run on its own. Older routines are split on load without
  touching past days (`src/lib/taskSplit.ts`).
- **Progress.** Per-chord-pair history and best scores over time.
- **Local-first with optional sync.** Works offline via `localStorage`; signing
  in with Firebase syncs routines and progress across devices.

## Stack

- React 19, TypeScript, Vite
- Zustand (persisted) for state
- Vanilla CSS + Framer Motion
- Firebase Auth + Firestore for sync
- Cloudflare Pages for hosting

## Getting started

```bash
npm install
cp .env.example .env   # fill in your Firebase web config
npm run dev
```

The `VITE_FIREBASE_*` values are client-side config (inlined into the bundle),
not secrets — access is governed by Firestore security rules. For deploys, set
the same variables as build-time environment variables in Cloudflare Pages
instead of committing `.env`.

## Coach voice

The coach voice is pre-rendered to static MP3s at build time, so the deployed
app ships no API key and costs nothing at runtime. To (re)generate after adding
or renaming drills:

```bash
# pull your distinct drill names from Firebase (your account only)
FIREBASE_EMAIL=you@example.com FIREBASE_PASSWORD=... npm run names

# render phrase + drill-name clips into public/coach/
ELEVENLABS_API_KEY=sk_... npm run gen:voice -- --force
```

Then commit `public/coach/` and `scripts/drill-names.json`. Phrases live in
`scripts/coach-phrases.mjs`.

## Scripts

- `npm run dev` — dev server
- `npm run build` — typecheck and production build
- `npm run lint` — ESLint
- `npm test` — unit suites (`tests/*.test.mjs`, no framework)
- `npm run health` — the maintenance check (below)
- `npm run names` — fetch your drill names from Firebase
- `npm run gen:voice` — render coach-voice clips

## Health check

One command for a maintenance pass:

```bash
npm run health               # build, unit tests, lint, npm audit, live smoke
npm run health -- --live     # live site only, a few seconds
npm run health -- --browser  # also every browser suite, one at a time (slow)
```

The live part loads https://routines.minirecc.com in a throwaway headless
browser (nothing signed in, nothing written anywhere), checks the shell, the
service worker, the coach pack and a deep link, seeds a routine with one
combined task and checks that it is split and that Quick paths opens. With
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment it also
reports whether production was built from `origin/main`. Point it elsewhere
with `HEALTH_URL=…`. The exit code is the number of failed checks.

Deploys are automatic: Cloudflare Pages builds `main` on every push, with the
`VITE_FIREBASE_*` values set as production build variables in the project.

Two machine notes. If `NODE_ENV=production` is set in your shell, `npm ci`
skips the dev dependencies; use `NODE_ENV=development npm ci` (the health
script sets it for its own steps). The browser suites need
`npx playwright install chromium` once.

## Browser suites

`tests/browser/*.mjs` drive a real Chromium against a preview build:

```bash
npm run build && npx vite preview --port 4173
PREVIEW_URL=http://localhost:4173/ node tests/browser/quickPaths.mjs
```

Run them one at a time: several feed synthesised guitar audio through a fake
microphone and are timing-sensitive on a busy machine.
