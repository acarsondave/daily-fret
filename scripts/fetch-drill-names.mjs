// Fetches YOUR distinct drill names from Firebase so the voice generator can
// pre-render a spoken clip per name. Run locally — it signs in with your own
// daily-fret login and reads only your `users/{uid}` doc (Firestore rules block
// reading anyone else's data, so this is your account only).
//
// Usage:
//   FIREBASE_EMAIL=you@example.com FIREBASE_PASSWORD=secret npm run names
//
// Reads the public web config from .env (VITE_FIREBASE_*). Writes
// scripts/drill-names.json — review it, then run `npm run gen:voice -- --force`.
//
// Idempotency: titles are de-duped by slug. Two routines that both have a task
// titled "C to G changes" map to one clip saying "C to G changes" — which is
// exactly right. Different wording → different slug → its own clip.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { initializeFirestore, doc, getDoc } from 'firebase/firestore';
import { slugify } from './slugify.mjs';
import { loadEnv } from './load-env.mjs';

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (no dependency): only fills vars not already in the env.

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

if (!firebaseConfig.apiKey) {
  console.error('✗ Missing VITE_FIREBASE_* in .env');
  process.exit(1);
}
if (!email || !password) {
  console.error('✗ Set FIREBASE_EMAIL and FIREBASE_PASSWORD (your daily-fret login).');
  console.error('  e.g. FIREBASE_EMAIL=you@example.com FIREBASE_PASSWORD=secret npm run names');
  process.exit(1);
}

async function main() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  // Force long polling — WebChannel can hang under Node.
  const db = initializeFirestore(app, { experimentalForceLongPolling: true });

  console.log(`Signing in as ${email}…`);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const snap = await getDoc(doc(db, 'users', cred.user.uid));
  if (!snap.exists()) {
    console.error('✗ No saved data found for your account yet.');
    process.exit(1);
  }

  const data = snap.data();
  const bySlug = new Map(); // slug -> title (first spelling wins)
  const remember = (raw) => {
    const title = (raw ?? '').trim();
    if (!title) return;
    const slug = slugify(title);
    if (slug && !bySlug.has(slug)) bySlug.set(slug, title);
  };
  for (const r of data.routines ?? []) {
    for (const t of r.tasks ?? []) {
      remember(t.title);
      // Configurable timed tasks announce each block by its own label.
      for (const b of t.blocks ?? []) remember(b.label);
    }
  }

  const list = [...bySlug.entries()]
    .map(([slug, title]) => ({ slug, title }))
    .sort((a, b) => a.title.localeCompare(b.title));

  console.log(`\nFound ${list.length} distinct drill name(s):\n`);
  for (const { title, slug } of list) console.log(`  • ${title}   →  name-${slug}.mp3`);

  const dest = path.join(__dirname, 'drill-names.json');
  writeFileSync(dest, JSON.stringify(list, null, 2) + '\n');
  console.log(`\n✓ Wrote ${path.relative(process.cwd(), dest)}.`);
  console.log('  Review it, then run:  ELEVENLABS_API_KEY=sk_xxx npm run gen:voice -- --force');
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n✗ ${err?.message || err}`);
  process.exit(1);
});
