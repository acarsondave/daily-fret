// READ-ONLY progress report. Signs in with your own daily-fret login, reads your
// `users/{uid}` doc, and prints a coaching summary: routine structure, per-pair
// change history, trainer scores, streak and consistency. Writes nothing.
//
// Usage:
//   FIREBASE_EMAIL=you@example.com FIREBASE_PASSWORD=secret npm run report
//
// Reads the public web config from .env (VITE_FIREBASE_*).

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { initializeFirestore, doc, getDoc } from 'firebase/firestore';
import { loadEnv } from './load-env.mjs';

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

if (!firebaseConfig.apiKey) {
  console.error('✗ Missing VITE_FIREBASE_* in .env');
  process.exit(1);
}
if (!email || !password) {
  console.error('✗ Set FIREBASE_EMAIL and FIREBASE_PASSWORD (your daily-fret login).');
  process.exit(1);
}

const PAIR_PREFIX = 'pair:';

async function main() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = initializeFirestore(app, { experimentalForceLongPolling: true });

  const cred = await signInWithEmailAndPassword(auth, email, password);
  const snap = await getDoc(doc(db, 'users', cred.user.uid));
  if (!snap.exists()) {
    console.error('✗ No saved data found for your account yet.');
    process.exit(1);
  }
  const data = snap.data();

  console.log('\n═══ ROUTINES ═══');
  for (const r of data.routines ?? []) {
    const active = r.id === data.activeRoutineId ? '  ← ACTIVE' : '';
    console.log(`\n[${r.id}] "${r.name}"${active}`);
    if (r.description) console.log(`   ${r.description}`);
    if (r.chords) console.log(`   chords: ${r.chords.join(', ')}`);
    for (const t of r.tasks ?? []) {
      const d = t.drill;
      const kind = d ? d.kind : t.blocks?.length ? `blocks(${t.blocks.length})` : 'timed';
      console.log(`   • [${t.id}] ${t.title}  (${kind}, ${t.duration ?? '?'} min)`);
      if (d?.chords) console.log(`       chords: ${d.chords.join(',')}`);
      if (d?.pairs) console.log(`       pairs: ${d.pairs.map((p) => `${p.from}-${p.to}`).join(' ')}`);
      if (d?.songId) console.log(`       song: ${d.songId}${d.playOnly ? ' (play-only)' : ''}`);
      if (d?.durationSec) console.log(`       durationSec: ${d.durationSec}`);
      if (t.description) console.log(`       "${t.description}"`);
      for (const b of t.blocks ?? []) {
        console.log(`       - ${b.label} (${b.durationSec}s)${b.pattern ? ` [${b.pattern}]` : ''}${b.note ? ` "${b.note}"` : ''}`);
      }
    }
  }

  const logs = Object.values(data.dailyLogs ?? {}).sort((a, b) => a.date.localeCompare(b.date));
  console.log(`\n═══ ACTIVITY ═══`);
  console.log(`days logged: ${logs.length}`);
  if (logs.length) console.log(`first: ${logs[0].date}   last: ${logs[logs.length - 1].date}`);

  // Last 21 days, one line each.
  console.log('\n--- recent days (last 21) ---');
  for (const l of logs.slice(-21)) {
    const results = Object.entries(l.drillResults ?? {})
      .map(([k, v]) => `${k.startsWith(PAIR_PREFIX) ? k.slice(PAIR_PREFIX.length) : k}=${v}`)
      .join('  ');
    console.log(`${l.date}  done:${(l.completedTaskIds ?? []).length}  ${results}`);
    if (l.feedback) console.log(`            note: ${l.feedback}`);
  }

  // Per-key series.
  const byKey = new Map();
  for (const l of logs) {
    for (const [k, v] of Object.entries(l.drillResults ?? {})) {
      if (typeof v !== 'number') continue;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push({ date: l.date, v });
    }
  }
  console.log('\n═══ DRILL HISTORY (chronological) ═══');
  for (const [k, series] of [...byKey.entries()].sort()) {
    const label = k.startsWith(PAIR_PREFIX) ? k.slice(PAIR_PREFIX.length).replace('|', ' ↔ ') : k;
    const best = Math.max(...series.map((s) => s.v));
    console.log(`\n${label}   best=${best}  n=${series.length}`);
    console.log('   ' + series.map((s) => `${s.date.slice(5)}:${s.v}`).join('  '));
  }

  console.log('\n═══ OTHER ═══');
  console.log(`calibration: ${data.chordCalibration ? Object.keys(data.chordCalibration.chords ?? {}).join(',') : 'none'}`);
  console.log(`metronomeBpm: ${data.metronomeBpm ?? '(unset)'}`);
  console.log(`songLinks: ${JSON.stringify(data.songLinks ?? {})}`);
  console.log(`strumPatterns: ${(data.strumPatterns ?? []).map((p) => `${p.name}=${p.pattern}`).join(' | ') || '(none)'}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n✗ ${err?.message || err}`);
  process.exit(1);
});
