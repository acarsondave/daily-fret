import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
const R = '/Users/acarson/Documents/guitar-journey/daily-fret/.claude/worktrees/agent-ab68edbc0afad5fc5';
register(pathToFileURL(`${R}/tests/_resolve.mjs`).href);
const { keyDrillHistory } = await import(`${R}/src/lib/drillStats.ts`);
const { poolKey } = await import(`${R}/src/lib/drillKeys.ts`);
const { ringScale } = await import(`${R}/src/lib/ringScale.ts`);

// The key shape the app actually writes for Chord Perfect: no window suffix
// (CoachedSession.tsx:908 and PracticeOverlay.tsx:456 pass no durationSec).
const logs = { '2026-08-20': { date: '2026-08-20', drillResults: { 'pool:C|Dm': 74 } } };
const { best } = keyDrillHistory(logs, poolKey(['Dm', 'C']));
console.log('poolBest handed to the ring:', best, '(the whole block, both shapes)');
console.log('');
console.log('LIVE ring during the Dm block. reps is this shape only, 0..45;');
console.log('the mark is the best for BOTH shapes, so the arc cannot reach it:');
for (const reps of [0, 5, 15, 25, 35, 45]) {
  const r = ringScale(reps, best);
  console.log(`  Dm reps=${String(reps).padStart(2)}  arc=${r.progress.toFixed(3)}  mark=${r.benchmark}`);
}
console.log('  ...chord changes to C, reps resets to 0, arc snaps back:');
for (const reps of [0, 10, 20, 29]) {
  const r = ringScale(reps, best);
  console.log(`  C  reps=${String(reps).padStart(2)}  arc=${r.progress.toFixed(3)}  mark=${r.benchmark}`);
}
console.log('');
console.log('best arc reached in the whole 150s drill:', ringScale(45, best).progress.toFixed(3),
  'against a mark at', ringScale(45, best).benchmark);
console.log('');
console.log('LIVE ring with no previous best (a first run on this pool):');
for (const reps of [0, 1, 5, 20, 45]) {
  const r = ringScale(reps, 0);
  console.log(`  reps=${String(reps).padStart(2)}  arc=${r.progress.toFixed(3)}  mark=${r.benchmark}`);
}
