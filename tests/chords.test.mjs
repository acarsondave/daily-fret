import { CHORD_SHAPES, getChordShape, fretWindow, FRET_COUNT } from '../src/data/chordShapes.ts';

const OPEN = [40, 45, 50, 55, 59, 64];       // low E .. high E, standard tuning
const PC = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const ROOT = { C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11 };
const QUALITY = {
  '':      [0,4,7],   'm':     [0,3,7],   '7':  [0,4,7,10], 'm7': [0,3,7,10],
  'maj7':  [0,4,7,11], 'sus2': [0,2,7],   'sus4':[0,5,7],   'add9':[0,4,7,2],
};
let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?' — '+d:''}`); };

function parse(name) {
  const m = name.match(/^([A-G][#b]?)(.*)$/);
  return { root: ROOT[m[1]], quality: m[2] };
}

console.log(`\nVerifying ${CHORD_SHAPES.length} chord shapes against theory\n`);
for (const shape of CHORD_SHAPES) {
  const { root, quality } = parse(shape.name);
  const formula = QUALITY[quality];
  if (formula === undefined) { check(`${shape.name} quality understood`, false, `unknown suffix "${quality}"`); continue; }
  const expected = new Set(formula.map((i) => (root + i) % 12));
  // The perfect fifth is the tone guitarists drop when the hand runs out of
  // fingers; C7 as x32310 has no G and is still the shape everyone teaches.
  // Required: root, third, and any seventh or added tone. Optional: the fifth.
  const required = new Set([...expected].filter((p) => p !== (root + 7) % 12));

  const sounded = [];
  shape.frets.forEach((fret, i) => { if (fret >= 0) sounded.push(OPEN[i] + fret); });
  const heard = new Set(sounded.map((m) => m % 12));

  const missing = [...required].filter((p) => !heard.has(p)).map((p) => PC[p]);
  const foreign = [...heard].filter((p) => !expected.has(p)).map((p) => PC[p]);
  const bassIsRoot = sounded.length && Math.min(...sounded) % 12 === root;

  const ok = !missing.length && !foreign.length && bassIsRoot;
  check(shape.name.padEnd(6) + shape.frets.map(f => f < 0 ? 'x' : f).join(''), ok,
    ok ? [...heard].sort((a,b)=>a-b).map(p=>PC[p]).join(' ')
       : [missing.length && `missing ${missing}`, foreign.length && `foreign ${foreign}`,
          !bassIsRoot && `bass is ${PC[Math.min(...sounded)%12]}, not ${PC[root]}`].filter(Boolean).join('; '));
}

console.log('\nShape integrity\n');
for (const shape of CHORD_SHAPES) {
  const n = shape.name;
  check(`${n}: six strings`, shape.frets.length === 6 && shape.fingers.length === 6);
  check(`${n}: fingers are 0-4`, shape.fingers.every((f) => f >= 0 && f <= 4));
  check(`${n}: open and muted strings take no finger`,
    shape.frets.every((f, i) => f > 0 || shape.fingers[i] === 0));
  check(`${n}: every fretted note has a finger`,
    shape.frets.every((f, i) => f <= 0 || shape.fingers[i] > 0));
  check(`${n}: frets stay in the first twelve`, shape.frets.every((f) => f >= -1 && f <= 12));
  // A finger can only be in one place at a time, unless it is barring.
  const byFinger = new Map();
  shape.frets.forEach((f, i) => {
    if (f <= 0) return;
    const fin = shape.fingers[i];
    if (!byFinger.has(fin)) byFinger.set(fin, new Set());
    byFinger.get(fin).add(f);
  });
  for (const [fin, frets] of byFinger) {
    const barring = shape.barre?.finger === fin;
    check(`${n}: finger ${fin} is in one place${barring ? ' or barring' : ''}`,
      frets.size === 1, `frets ${[...frets]}`);
  }
  if (shape.barre) {
    const b = shape.barre;
    check(`${n}: barre range is ordered and in bounds`, b.from >= 0 && b.to <= 5 && b.from < b.to);
    check(`${n}: nothing inside the barre sits below it`,
      shape.frets.slice(b.from, b.to + 1).every((f) => f < 0 || f >= b.fret));
    check(`${n}: the barre finger owns the strings at its fret`,
      shape.frets.every((f, i) =>
        !(i >= b.from && i <= b.to && f === b.fret) || shape.fingers[i] === b.finger));
    check(`${n}: the barre's outer strings are actually on it`,
      shape.frets[b.from] >= b.fret && shape.frets[b.to] >= b.fret);
  }
}

console.log('\nCoverage\n');
const DETECTABLE = ['A','Am','C','D','Dm','E','Em','G','F'];
check('every chord the detector can hear has a shape',
  DETECTABLE.every((c) => getChordShape(c)), DETECTABLE.filter(c=>!getChordShape(c)).join(' '));
const songChords = ['A','Am','C','D','Dm','E','Em','G'];
check('every chord the songs use has a shape', songChords.every((c) => getChordShape(c)));
check('unknown chords return null, not a wrong shape', getChordShape('Xdim9') === null);
check('no duplicate names', new Set(CHORD_SHAPES.map(s=>s.name)).size === CHORD_SHAPES.length);

console.log('\nFret window\n');
{
  const mk = (frets, barre) => ({ name:'T', frets, fingers:[0,0,0,0,0,0], barre });
  check('an all-open shape sits against the nut',
    JSON.stringify(fretWindow(mk([0,0,0,0,0,0]))) === '{"start":1,"showNut":true}');
  check('a shape inside the first four frets sits against the nut',
    JSON.stringify(fretWindow(mk([-1,2,4,4,3,2]))) === '{"start":1,"showNut":true}');
  check('a shape touching the fourth fret still sits against the nut',
    fretWindow(mk([-1,-1,4,4,4,-1])).showNut === true);
  check('a shape past the fourth fret slides up and drops the nut',
    JSON.stringify(fretWindow(mk([3,5,5,4,3,3]))) === '{"start":3,"showNut":false}');
  check('the window starts at the lowest fretted note, ignoring open strings',
    JSON.stringify(fretWindow(mk([0,7,9,9,8,7]))) === '{"start":7,"showNut":false}');
  check('every shipped shape fits its own window',
    CHORD_SHAPES.every((sh) => {
      const w = fretWindow(sh);
      return sh.frets.every((f) => f <= 0 || (f >= w.start && f < w.start + FRET_COUNT));
    }),
    CHORD_SHAPES.filter((sh) => { const w = fretWindow(sh);
      return !sh.frets.every((f) => f <= 0 || (f >= w.start && f < w.start + FRET_COUNT)); })
      .map(sh=>sh.name).join(' '));
}

console.log(failures===0?'\nALL PASS\n':`\n${failures} FAILURE(S)\n`);
process.exit(failures?1:0);
