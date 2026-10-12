// Execute the actual component callbacks in a narrow, DOM-free seam. This is
// wiring evidence, not browser/audio-route evidence; no component copies.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { fixedTempo, DEFAULT_PRACTICE_BPM } from '../src/lib/tempo.ts';
import { deckMeter, deckOf } from '../src/lib/patternDeck.ts';
import { cappedTempo } from '../src/lib/songStrum.ts';
import { meterOf, normaliseAccents } from '../src/audio/meter.ts';
import { buildSegments } from '../src/lib/coached.ts';
import { parsePattern, matchPattern, summarisePattern } from '../src/lib/strumPattern.ts';

function source(file) {
  return ts.createSourceFile(file, readFileSync(new URL(`../src/components/practice/${file}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function nodes(root, predicate) {
  const found = [];
  function visit(n) { if (predicate(n)) found.push(n); ts.forEachChild(n, visit); }
  visit(root);
  return found;
}
function run(node, root, scope) {
  const js = ts.transpileModule(`const callback = (${node.getText(root)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return Function(...Object.keys(scope), `${js}\nreturn callback;`)(...Object.values(scope));
}
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`ok ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}: ${e.message}`); }
}
const deck = deckOf(['68.D--UD-D--UD-']);
for (const file of ['CoachedSession.tsx', 'PracticeOverlay.tsx']) {
  const root = source(file);
  const declaration = nodes(root, n => ts.isVariableDeclaration(n) && n.name.getText(root) === 'tempoPlan')[0];
  const callback = declaration.initializer.arguments[0];
  test(`${file}: capped pattern history reads the tempo actually played`, () => {
    const declaration = nodes(root, n => ts.isVariableDeclaration(n) && n.name.getText(root) === 'patternHistory')[0];
    const history = run(declaration.initializer.arguments[0], root, {
      seg: { kind: 'patterns', bpm: 130 }, drill: { kind: 'strum-pattern', bpm: 130 }, patternDeck: deck,
      useStore: { getState: () => ({ accounts: {}, currentAccountId: 'a' }) },
      DEFAULT_PRACTICE_BPM, cappedTempo, patternRuns: (_logs, _pattern, bpm) => bpm,
    })();
    assert.equal(history[deck[0]], 126);
  });
  test(`${file}: pattern plan caps the ENGINE tempo while retaining six beats`, () => {
    const plan = run(callback, root, {
      seg: { kind: 'patterns', bpm: 130 }, drill: { kind: 'strum-pattern', bpm: 130 },
      patternDeck: deck, useStore: { getState: () => ({ accounts: {}, currentAccountId: 'a' }) },
      fixedTempo, DEFAULT_PRACTICE_BPM, deckMeter, cappedTempo,
    })();
    assert.equal(plan.meter, '6/8');
    assert.equal(plan.beatsPerChange, 6);
    assert.ok(plan.bpm <= cappedTempo(deck, 130), `engine ${plan.bpm} exceeds deck cap ${cappedTempo(deck, 130)}`);
  });
}
{
  const root = source('Metronome.tsx');
  const effect = nodes(root, n => ts.isCallExpression(n) && n.expression.getText(root) === 'useEffect'
    && n.arguments[1]?.getText(root).includes('planKey'))[0].arguments[0];
  for (const auto of [false, true]) test(`6/8 plan overrides saved 3/4 with auto=${auto}, without saving it`, () => {
    const actual = {};
    const engine = {
      setMeter: (id) => { actual.meter = id; },
      setBeatsPerBar: (n) => { actual.beats = n; },
      stop: () => { actual.running = false; }, start: () => { actual.running = true; },
    };
    run(effect, root, {
      plan: fixedTempo(130, undefined, '6/8'), auto, autoPlay: true,
      storedMeter: '3/4', storedAccents: undefined, meterOf, normaliseAccents,
      setTimeout: (fn) => { fn(); return 1; }, clearTimeout: () => {}, metronome: engine,
      setMeter: () => {}, setRunning: () => {}, setBeat: () => {}, setBpm: () => {},
    })();
    assert.equal(actual.meter, '6/8');
    assert.equal(actual.beats, 6);
    assert.equal(actual.running, auto);
  });
}
for (const file of ['CoachedSession.tsx', 'PracticeOverlay.tsx']) {
  const root = source(file);
  const picking = nodes(root, n => ts.isJsxSelfClosingElement(n) && n.tagName.getText(root) === 'AlternatePicking')[0];
  const callback = picking.attributes.properties.find(n => n.name?.getText(root) === 'onResult').initializer.expression;
  for (const [enough, score, expected] of [[false, 88, 0], [true, 88, 88], [true, 0, 0]]) {
    test(`${file}: picking enough=${enough}, score=${score} records ${expected}`, () => {
      let saved;
      run(callback, root, {
        today: '2026-10-12', seg: { taskId: 'pick', title: 'Picking' }, task: { id: 'pick' },
        pickKey: bpm => `pick:${bpm}`, speak: () => {}, settleTask: () => {},
        propose: proposal => proposal.commit(),
        recordMeasurements: (_date, _id, measurements) => { saved = measurements; },
        measured: measurements => { saved = measurements; },
      })({ bpm: 80, summary: { enough, score } });
      assert.equal(saved[0].value, expected);
    });
  }
}
test('six-beat pattern has the exact skip-2-and-5 slots and grades on a six-beat bar', () => {
  const pattern = parsePattern(deck[0]);
  assert.equal(pattern.beatsPerBar, 6);
  assert.equal(pattern.slotsPerBeat, 2);
  assert.deepEqual(pattern.slots.map((s, i) => s ? [i, s] : null).filter(Boolean),
    [[0, 'D'], [3, 'U'], [4, 'D'], [6, 'D'], [9, 'U'], [10, 'D']]);
  const grid = { origin: 1, period: 60 / 126, clicks: 40 };
  const onsets = [];
  for (let pass = 0; pass < 4; pass++) pattern.slots.forEach((s, i) => {
    if (s) onsets.push(grid.origin + (pass * 6 + i / 2) * grid.period);
  });
  const summary = summarisePattern(matchPattern({ onsets, grid, pattern, originBeat: 0, passes: 4 }), pattern);
  assert.equal(summary.enough, true);
  assert.equal(summary.score, 100);
});
test('coached segments retain explicit six-beat deck and separate picking drill', () => {
  const segments = buildSegments({ id: 'routine', tasks: [
    { id: 'six', title: 'Six', drill: { kind: 'strum-pattern', bpm: 130, patterns: deck, bars: 4, durationSec: 90 } },
    { id: 'pick', title: 'Picking', drill: { kind: 'alternate-picking', bpm: 80, durationSec: 60 } },
  ] });
  assert.deepEqual(segments.map(s => s.kind), ['patterns', 'picking']);
  assert.deepEqual(segments[0].patterns, deck);
  assert.equal(segments[0].bpm, 130);
  assert.equal(segments[0].bars, 4);
  assert.equal(segments[1].seconds, 60);
});
process.exitCode = failed ? 1 : 0;
