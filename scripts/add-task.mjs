// Appends a task to one of YOUR routines in Firebase. Run locally — it signs in
// with your own daily-fret login and writes only your `users/{uid}` doc
// (Firestore rules block touching anyone else's data).
//
// Usage:
//   FIREBASE_EMAIL=you@example.com FIREBASE_PASSWORD=secret npm run add:task
//   FIREBASE_EMAIL=... FIREBASE_PASSWORD=... ROUTINE="My Routine" npm run add:task
//
// Reads the public web config from .env (VITE_FIREBASE_*). Idempotent: if a task
// with the same title already exists in the target routine it does nothing, so
// it's safe to re-run. Edit TASK below to change what gets added.
//
// After it runs, regenerate the coach voice so the new drill name gets a clip:
//   npm run names && ELEVENLABS_API_KEY=sk_xxx npm run gen:voice -- --force

import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { initializeFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

// Tasks to add. Strumming-pattern drills are plain timed blocks (up/down strums
// on muted strings can't be chord-detected), so they carry no `drill`. One task
// per pattern at 1 min each so coached mode runs them as separate segments.
const TASKS = [
  {
    title: 'Strumming Pattern 1',
    duration: '1',
    description: 'Muted strings, strumming hand always moving. D DU D — up strum after beat 2.',
  },
  {
    title: 'Strumming Pattern 2',
    duration: '1',
    description: 'Muted strings, strumming hand always moving. D DUDU D — up strums after beats 2 and 3.',
  },
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadEnv() {
  const p = path.join(ROOT, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
}
loadEnv();

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};
const email = process.env.FIREBASE_EMAIL;
const password = process.env.FIREBASE_PASSWORD;
const routineName = process.env.ROUTINE?.trim();

if (!firebaseConfig.apiKey) {
  console.error('✗ Missing VITE_FIREBASE_* in .env');
  process.exit(1);
}
if (!email || !password) {
  console.error('✗ Set FIREBASE_EMAIL and FIREBASE_PASSWORD (your daily-fret login).');
  process.exit(1);
}

async function main() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = initializeFirestore(app, { experimentalForceLongPolling: true });

  console.log(`Signing in as ${email}…`);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const ref = doc(db, 'users', cred.user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    console.error('✗ No saved data found for your account yet.');
    process.exit(1);
  }

  const data = snap.data();
  const routines = data.routines ?? [];
  if (!routines.length) {
    console.error('✗ You have no routines yet — create one in the app first.');
    process.exit(1);
  }

  const target = routineName
    ? routines.find((r) => (r.name ?? '').trim().toLowerCase() === routineName.toLowerCase())
    : routines.find((r) => r.id === data.activeRoutineId) ?? routines[0];

  if (!target) {
    console.error(`✗ No routine named "${routineName}". Available:`);
    for (const r of routines) console.error(`  • ${r.name}`);
    process.exit(1);
  }

  target.tasks = target.tasks ?? [];
  const have = new Set(target.tasks.map((t) => (t.title ?? '').trim().toLowerCase()));

  let added = 0;
  for (const task of TASKS) {
    if (have.has(task.title.toLowerCase())) {
      console.log(`· "${task.title}" already in "${target.name}" — skipping.`);
      continue;
    }
    target.tasks.push({ id: randomUUID(), ...task });
    console.log(`✓ Added "${task.title}" to "${target.name}".`);
    added++;
  }

  if (!added) {
    console.log('Nothing to do.');
    process.exit(0);
  }

  await setDoc(ref, { ...data, routines }, { merge: true });
  console.log('  Regenerate voice:  npm run names && ELEVENLABS_API_KEY=sk_xxx npm run gen:voice -- --force');
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n✗ ${err?.message || err}`);
  process.exit(1);
});
