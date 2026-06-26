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
- `npm run names` — fetch your drill names from Firebase
- `npm run gen:voice` — render coach-voice clips
