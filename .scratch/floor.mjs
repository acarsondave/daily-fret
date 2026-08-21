import { readdirSync, readFileSync } from 'node:fs';
const DIR = '/Users/acarson/Documents/guitar-journey/daily-fret';
const files = readdirSync(DIR).filter((f) => /^daily-fret-diagnostics-.*\.json$/.test(f)).sort();

// Replay each block's counted placements through a candidate refractory floor.
// A rejected placement spends its strum, exactly as the counter does, so the
// clock for the next one still runs from the last placement KEPT.
function survivors(times, floor) {
  const kept = [];
  let last = -Infinity;
  for (const t of times) {
    if (t - last < floor) continue;
    kept.push(t); last = t;
  }
  return kept;
}

const blocks = [];
for (const f of files) {
  let d; try { d = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')); } catch { continue; }
  for (const [si, s] of (d.sessions ?? []).entries()) {
    const p = (s.marks ?? []).filter((m) => /chord-perfect placed/.test(m.label));
    if (p.length < 3) continue;
    let cur = null;
    for (const m of p) {
      const n = Number(/\((\d+)\)$/.exec(m.label)[1]);
      const chord = /placed (\S+) \(/.exec(m.label)[1];
      if (n === 1 || !cur) { cur = { file: f.slice(24, 34), si, chord, times: [] }; blocks.push(cur); }
      cur.times.push(m.t);
    }
  }
}
console.log('blocks:', blocks.length, 'placements:', blocks.reduce((a, b) => a + b.times.length, 0));
for (const floor of [250, 400, 500, 550, 600, 700, 800]) {
  let before = 0, after = 0;
  for (const b of blocks) { before += b.times.length; after += survivors(b.times, floor).length; }
  console.log(`floor ${String(floor).padStart(4)}ms: ${before} -> ${after}  (${(100 * (before - after) / before).toFixed(1)}% removed)`);
}
console.log('\nper block at 600ms:');
for (const b of blocks) {
  const k = survivors(b.times, 600).length;
  const span = ((b.times[b.times.length - 1] - b.times[0]) / 1000).toFixed(0);
  console.log(`  ${b.file} s${b.si} ${b.chord.padEnd(3)} ${String(b.times.length).padStart(3)} -> ${String(k).padStart(3)} over ${span}s`);
}
