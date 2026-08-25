// The chord voice: six plucked strings, in the order a pick reaches them.
//
// Everything here is checked against the waveform or the plan that produced it,
// never against "the renderer was called". The two that matter most are the
// muted string and the stroke direction, because both are silent failures: a
// muted string played open is a different chord, and a strum that always runs
// low to high is a machine rather than a hand.

import { renderStrum, strumOnsets, STRUM_PEAK, OPEN_STRINGS } from '../src/audio/songVoice.ts';
import { getChordShape } from '../src/data/chordShapes.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${d ? ' — ' + d : ''}`); };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const RATE = 48000;
// A repeatable noise burst, so two renders of the same chord are the same bytes
// and a difference between two buffers means the inputs differed.
const seeded = (seed = 1) => {
  let x = seed;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
};
const peak = (b) => { let m = 0; for (const v of b) m = Math.max(m, Math.abs(v)); return m; };
const silent = (b) => { for (const v of b) if (v !== 0) return false; return true; };

console.log('\nWhich strings sound, and in what order\n');
{
  const A = getChordShape('A'); // [-1, 0, 2, 2, 2, 0]: the low E is muted
  const down = strumOnsets(A, 'D', RATE, 0);
  const up = strumOnsets(A, 'U', RATE, 0);
  check('five of six strings sound in A', down.length === 5, String(down.length));
  check('the muted low E is not one of them', down.every((o) => o.string !== 0));
  check('a down stroke runs low to high',
    down.map((o) => o.string).join(',') === '1,2,3,4,5', down.map((o) => o.string).join(','));
  check('an up stroke is the exact reverse',
    up.map((o) => o.string).join(',') === down.map((o) => o.string).reverse().join(','),
    up.map((o) => o.string).join(','));
  check('the first string struck is struck at once', down[0].startSample === 0 && up[0].startSample === 0);
  check('and each one after it is later', down.every((o, i) => i === 0 || o.startSample > down[i - 1].startSample));
  check('the whole stroke takes about twenty milliseconds',
    down[4].startSample / RATE > 0.012 && down[4].startSample / RATE < 0.03,
    `${(down[4].startSample / RATE * 1000).toFixed(1)}ms`);
  check('an up stroke is the quicker of the two', up[4].startSample < down[4].startSample);
  check('an up stroke leans on the thin strings',
    up[0].string === 5 && up[0].gain > up[4].gain);
  check('a down stroke leans on the thick ones',
    down[0].string === 1 && down[0].gain > down[4].gain);
}

console.log('\nAt the pitch the fingers are actually making\n');
{
  const Em = getChordShape('Em'); // [0, 2, 2, 0, 0, 0]
  const on = strumOnsets(Em, 'D', RATE, 0);
  const of = (string) => on.find((o) => o.string === string);
  check('all six strings of Em sound', on.length === 6);
  check('the open low E is 82.4 Hz', near(of(0).freq, 82.407, 0.01), String(of(0).freq));
  check('the A string at the second fret is a B', near(of(1).freq, 123.471, 0.01), String(of(1).freq));
  check('the open high E is 329.6 Hz', near(of(5).freq, 329.628, 0.01), String(of(5).freq));

  const capoed = strumOnsets(Em, 'D', RATE, 2);
  const ratio = Math.pow(2, 2 / 12);
  check('a capo on two raises every string by a whole tone',
    capoed.every((o, i) => near(o.freq, on[i].freq * ratio, 1e-6)));
  check('the capo does not change which strings sound',
    capoed.map((o) => o.string).join() === on.map((o) => o.string).join());

  const D = getChordShape('D'); // [-1, -1, 0, 2, 3, 2]
  const dOn = strumOnsets(D, 'D', RATE, 0);
  check('D sounds four strings', dOn.length === 4);
  check('and the lowest of them is the open D string',
    dOn[0].string === 2 && near(dOn[0].freq, 146.832, 0.01));
  check('there are six open strings in standard tuning', OPEN_STRINGS.length === 6);
}

console.log('\nThe buffer\n');
{
  const G = getChordShape('G');
  const down = renderStrum(G, 'D', RATE, 0, seeded());
  const up = renderStrum(G, 'U', RATE, 0, seeded());
  const dead = renderStrum(G, 'X', RATE, 0, seeded());

  const spread = strumOnsets(G, 'D', RATE, 0)[5].startSample;
  check('the buffer holds the spread plus the ring',
    down.length === spread + Math.ceil(1.5 * RATE), `${down.length} vs ${spread + Math.ceil(1.5 * RATE)}`);
  check('a stroke rings for over a second', down.length / RATE > 1.4);
  check('a dead stroke does not', dead.length / RATE < 0.15, `${(dead.length / RATE).toFixed(3)}s`);

  check('it is normalised to the same peak every time', near(peak(down), STRUM_PEAK, 1e-6), String(peak(down)));
  check('and so is an up stroke', near(peak(up), STRUM_PEAK, 1e-6));
  check('and so is a dead one', near(peak(dead), STRUM_PEAK, 1e-6));
  check('it sits under the downbeat click', STRUM_PEAK < 0.82);

  check('it ends at exactly zero', down[down.length - 1] === 0);
  // The ring has to have actually rung out by the end of its own buffer. A loss
  // computed per sample rather than per trip round the delay line left every
  // stroke at full volume where the buffer stopped, with the six-millisecond
  // taper doing the whole of the fade.
  const tail = Math.round(0.02 * RATE);
  let loudAtEnd = 0;
  for (let i = down.length - Math.round(0.03 * RATE); i < down.length - tail; i++) {
    loudAtEnd = Math.max(loudAtEnd, Math.abs(down[i]));
  }
  check('and it has rung out before the taper touches it', loudAtEnd < STRUM_PEAK * 0.02,
    `${(loudAtEnd / STRUM_PEAK * 100).toFixed(2)}% of peak`);
  check('it starts quietly enough not to be its own click', Math.abs(down[0]) < STRUM_PEAK * 0.05);

  // A dead stroke is the same gesture with the ring taken out, so it has to be
  // gone by the time an ordinary stroke is still going.
  const energy = (b, from, to) => { let e = 0; for (let i = from; i < to && i < b.length; i++) e += b[i] * b[i]; return e; };
  check('a dead stroke has died away where a strum has not',
    energy(dead, Math.round(0.04 * RATE), Math.round(0.05 * RATE)) <
      energy(down, Math.round(0.04 * RATE), Math.round(0.05 * RATE)) / 10);

  check('the same chord rendered twice is the same buffer',
    renderStrum(G, 'D', RATE, 0, seeded()).every((v, i) => v === down[i]));
  check('a different chord is a different buffer',
    !renderStrum(getChordShape('C'), 'D', RATE, 0, seeded()).every((v, i) => v === down[i]));
  check('a capo makes a different buffer',
    !renderStrum(G, 'D', RATE, 2, seeded()).every((v, i) => v === down[i]));
}

console.log('\nA muted string contributes exactly nothing\n');
{
  // The direct test. Two shapes differing only in whether the low E is muted or
  // open: if -1 were being read as fret 0, these would be the same bytes.
  const muted = { name: 'test', frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0] };
  const open = { name: 'test', frets: [0, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0] };
  const a = renderStrum(muted, 'D', RATE, 0, seeded());
  const b = renderStrum(open, 'D', RATE, 0, seeded());
  check('muting a string changes how many sound',
    strumOnsets(muted, 'D', RATE, 0).length === strumOnsets(open, 'D', RATE, 0).length - 1);
  check('and it changes the sound', !(a.length === b.length && a.every((v, i) => v === b[i])));
  check('the muted one is shorter by one string gap', b.length - a.length === Math.round(0.004 * RATE));

  const all = { name: 'none', frets: [-1, -1, -1, -1, -1, -1], fingers: [0, 0, 0, 0, 0, 0] };
  const nothing = renderStrum(all, 'D', RATE, 0, seeded());
  check('a shape with every string muted is exactly silent', silent(nothing));
  check('and it is still a buffer of the right length', nothing.length === Math.ceil(1.5 * RATE));
  check('normalising silence does not produce a number that is not a number',
    nothing.every((v) => Number.isFinite(v)));
}

console.log(failures ? `\n${failures} failed\n` : '\nall good\n');
process.exit(failures ? 1 : 0);
