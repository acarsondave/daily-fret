// The arithmetic and the honesty of the note finder.
//
// Three things are settled here. The first is what a played pitch is allowed to
// prove: a prompt that named a string plus a rung that named the frets pins one
// fret, so the note coming back settles it, and the one window that holds two
// frets for the same note asks for the octave as well. The second is that a
// position played against a lit answer is never counted as one recalled from
// memory, anywhere. The third is the ladder: which rung a session runs at comes
// from that rung's own history, three clean runs clear it, one poor run takes it
// back.
//
// The drawing is checked in a browser; this is where the maths is settled.

import {
  ALL_NOTES,
  CLEAR_FINDS_PER_MIN,
  CLEAR_RUNS,
  NATURALS,
  QUICK_MS,
  QUICK_RUNS,
  RUNGS,
  STRING_POSITIONS,
  TOP_FRET,
  currentRung,
  fretOn,
  fretsForNote,
  getRung,
  isShown,
  judge,
  medianFindMs,
  mergeNoteMaps,
  midiAt,
  namesString,
  nextPrompt,
  parsePositionKey,
  positionKey,
  positionStanding,
  positionsOf,
  reachable,
  recordFind,
  recordShown,
  rungNumber,
  rungPositions,
  rungStanding,
  rungWindow,
  timesShown,
} from '../src/lib/noteFinder.ts';
import { midiToName } from '../src/audio/tuning.ts';
import { pitchClass } from '../src/lib/noteCircle.ts';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail ? `: ${detail}` : ''}`);
};

const pcOf = (name) => Array.from({ length: 12 }, (_, i) => i).find((i) => midiToName(i).name === name);

console.log('\nThe neck\n');

check('six strings, thickest first', STRING_POSITIONS.length === 6 && STRING_POSITIONS[0] === 6);
check('the fifth string open is A2', midiAt(5, 0) === 45);
check('C on the A string is the third fret', midiAt(5, 3) === 48 && midiToName(48).name === 'C');
// The whole reason the drill cannot claim which string was played.
check(
  'the same C also sits at the eighth fret of the low E',
  midiAt(6, 8) === midiAt(5, 3),
);
check('every position below the twelfth is reachable', reachable(midiAt(1, 12)) && reachable(40));
check('a pitch off the end of the neck is not', !reachable(midiAt(1, 13)));

check(
  'C lives in six places below the twelfth fret, one per string',
  positionsOf(pcOf('C')).length === 6,
  String(positionsOf(pcOf('C')).length),
);
check(
  'an open-string note lives in two places on its own string: the nut and the twelfth',
  positionsOf(pcOf('E')).filter((p) => p.stringPosition === 6).map((p) => p.fret).join() === '0,12',
);
check(
  'and every one of them really is a C',
  positionsOf(pcOf('C')).every((p) => pitchClass(p.midi) === pcOf('C') && p.fret <= TOP_FRET),
);

console.log('\nWhat a pitch is allowed to prove\n');

// C on the fifth string, drilled by the opening rung, whose window is the first
// three frets. C has exactly one home in there, so the note coming back is the
// whole of the evidence needed and the octave is not.
const asked = { form: 'string', pc: pcOf('C'), stringPosition: 5, fret: 3, midi: 48, rungId: 'low-naturals' };

check('the window holds one C on this string', fretsForNote(RUNGS[0], 5, pcOf('C')).join() === '3');
check('the exact pitch is a find', judge(asked, 48).kind === 'right');
check('a different letter is not', judge(asked, 47).kind === 'other');
// A fretted note's octave is twelve frets away, which on the fifth string is
// past the end of the neck. Nothing is loosened here at all: this string simply
// cannot make that C, so it came off another one.
check('nor is the right letter in a register this string cannot reach',
  judge(asked, 60).kind === 'other');
check('nor one below its range', judge(asked, 36).kind === 'other');

// The open string is the one case where a string really can make the note twice
// below the twelfth fret, and it is exactly where a pitch estimator's one
// characteristic mistake lands. The opening rung stops at the third fret, so the
// twelfth is not a place it is asking about and the note settles the fret.
const openLow = { form: 'string', pc: pcOf('E'), stringPosition: 6, fret: 0, midi: 40, rungId: 'low-naturals' };
check('the open string is a find', judge(openLow, 40).kind === 'right');
check(
  'and so is the octave above it, because this rung asks about no other E on this string',
  judge(openLow, 52).kind === 'right',
);
check('the octave below is off the neck entirely and is not', judge(openLow, 28).kind === 'other');

// The one window that does hold the same note twice on one string: the whole
// neck, where an open string's own note is also its twelfth fret. There the
// octave is the only thing separating them, so it is asked for.
const wholeNeck = getRung('whole-neck');
check('the whole neck holds two Es on the sixth string', fretsForNote(wholeNeck, 6, pcOf('E')).join() === '0,12');
const openE = { ...openLow, rungId: 'whole-neck' };
check('the open string itself is still a find', judge(openE, 40).kind === 'right');
check('and the twelfth fret is not, because it is the other one', judge(openE, 52).kind === 'octave');

check('a fret is read back off a string', fretOn(6, 43) === 3 && fretOn(6, 40) === 0);
check('and a pitch that string cannot make reads back as none', fretOn(6, 39) === null);
check('nor can it reach past the twelfth', fretOn(6, 53) === null);

check('a prompt that names a string may be filed against a position', namesString('string'));
check('one that names none may not', !namesString('free') && !namesString('echo'));

check('a rung draws its own frets, with one either side', JSON.stringify(rungWindow(RUNGS[0])) === '{"from":0,"to":4}');
check(
  'and never past the ends of the neck',
  rungWindow(wholeNeck).from === 0 && rungWindow(wholeNeck).to === TOP_FRET,
);

const anywhere = { ...asked, form: 'free' };
check('with no string named, any C on the neck answers', judge(anywhere, 60).kind === 'right');
check('but a C that is not on the neck does not', judge(anywhere, 24).kind === 'other');

const echo = { ...asked, form: 'echo' };
check('an echo wants the same note somewhere else', judge(echo, 60).kind === 'right');
check('and says so when the shown note is simply replayed', judge(echo, 48).kind === 'same');
check('a different letter is still wrong', judge(echo, 50).kind === 'other');

console.log('\nThe rungs\n');

check('the ladder has somewhere to go', RUNGS.length >= 6);
check('rung ids are unique', new Set(RUNGS.map((r) => r.id)).size === RUNGS.length);
check('it starts on the naturals', RUNGS[0].notes === NATURALS);
check('and ends past them', RUNGS[RUNGS.length - 1].notes === ALL_NOTES);
// Within one form the questions only get faster. Across forms it can loosen,
// and does: an echo asks the player to name a position and then find that note
// somewhere else, which is two thoughts rather than one.
const named = RUNGS.filter((r) => r.form === 'string');
check(
  'the budget never loosens while the question stays the same shape',
  named.every((r, i) => i === 0 || r.budgetMs <= named[i - 1].budgetMs),
);
check(
  'every rung has something to ask',
  RUNGS.every((r) => rungPositions(r).length >= 6),
  RUNGS.map((r) => `${r.id}:${rungPositions(r).length}`).join(' '),
);
check(
  'every rung only calls notes it says it calls',
  RUNGS.every((r) => rungPositions(r).every((p) => r.notes.includes(p.pc) && r.strings.includes(p.stringPosition))),
);
check('the first rung stays on the two lowest strings', RUNGS[0].strings.join() === '6,5');
check('getRung finds one', getRung(RUNGS[2].id) === RUNGS[2]);
check('and returns null for one that is gone', getRung('no-such-rung') === null);
check('rungNumber counts from one', rungNumber(RUNGS[0].id) === 1);

console.log('\nWhat to ask next\n');

const rung = RUNGS[0];
const roll0 = nextPrompt(rung, {}, null, 0);
check('a prompt comes out of an empty history', roll0 !== null);
check('and it is one the rung is allowed to call', rung.notes.includes(roll0.pc));
check('it carries the position behind it', roll0.stringPosition === 6 || roll0.stringPosition === 5);
check(
  'the same roll on the same history is the same prompt',
  JSON.stringify(nextPrompt(rung, {}, null, 0)) === JSON.stringify(roll0),
);
check(
  'the previous prompt is never asked twice running',
  Array.from({ length: 60 }, (_, i) => nextPrompt(rung, {}, roll0, i / 60)).every(
    (p) => p.stringPosition !== roll0.stringPosition || p.fret !== roll0.fret,
  ),
);

// A neck where everything but one position is quick. The weighting has to lean
// hard on the one that is not.
const allQuick = {};
for (const p of rungPositions(rung)) {
  if (p.stringPosition === 5 && p.fret === 3) continue;
  allQuick[positionKey(p.stringPosition, p.fret)] = {
    found: 9,
    bestMs: 1000,
    recentMs: [1000, 1000, 1000],
    at: 1,
  };
}
const leaning = Array.from({ length: 200 }, (_, i) => nextPrompt(rung, allQuick, null, i / 200));
const onWeak = leaning.filter((p) => p.stringPosition === 5 && p.fret === 3).length;
check(
  'the one position nothing is known about is asked far more often than its share',
  onWeak / leaning.length > 2 / rungPositions(rung).length,
  `${onWeak} of ${leaning.length} over ${rungPositions(rung).length} positions`,
);
check(
  'but the settled ones are still asked, so they can be shown to have gone cold',
  leaning.some((p) => !(p.stringPosition === 5 && p.fret === 3)),
);

console.log('\nThe neck map\n');

check('a key round-trips', parsePositionKey(positionKey(5, 3)).fret === 3);
check('a key for a string that does not exist is refused', parsePositionKey('9:3') === null);
check('a key past the twelfth fret is refused', parsePositionKey('5:99') === null);
check('and so is nonsense', parsePositionKey('nope') === null);

check('an unasked position says nothing', positionStanding(undefined) === 'unasked');

let map = {};
map = recordFind(map, 5, 3, 2200, 100);
check('one find makes it found', positionStanding(map[positionKey(5, 3)]) === 'found');
check('and nothing else moves', positionStanding(map[positionKey(5, 2)]) === 'unasked');

map = recordFind(map, 5, 3, 1900, 200);
map = recordFind(map, 5, 3, 2400, 300);
check(
  `${QUICK_RUNS} finds inside ${QUICK_MS}ms make it quick`,
  positionStanding(map[positionKey(5, 3)]) === 'quick',
);
check('the best is kept', map[positionKey(5, 3)].bestMs === 1900);
check('and the count', map[positionKey(5, 3)].found === 3);

map = recordFind(map, 5, 3, QUICK_MS + 500, 400);
check(
  'one slow find takes it back down, which is what makes it a standing',
  positionStanding(map[positionKey(5, 3)]) === 'found',
);
check('and the best is not undone by it', map[positionKey(5, 3)].bestMs === 1900);

let threw = false;
try {
  recordFind({}, 5, 3, 0, 1);
} catch {
  threw = true;
}
check('a find of no duration is refused rather than stored', threw);

console.log('\nShown is not found\n');

check('a position nothing is known about is shown before it is asked for', isShown(undefined));

let lit = recordShown({}, 6, 1, 100);
lit = recordShown(lit, 6, 1, 200);
const litFind = lit[positionKey(6, 1)];
check('playing a lit answer is counted', timesShown(litFind) === 2);
check('but it is never counted as a recall', litFind.found === 0);
check('so the neck still says nothing about it', positionStanding(litFind) === 'unasked');
check('and the drill goes on lighting it', isShown(litFind));
check('it carries no time, because a pointed-at fret is not a recall time',
  litFind.recentMs.length === 0);

lit = recordFind(lit, 6, 1, 3000, 300);
check('one recall retires the light', !isShown(lit[positionKey(6, 1)]));
check('and the position finally stands as found', positionStanding(lit[positionKey(6, 1)]) === 'found');
check('the times it was shown are still there to be read',
  timesShown(lit[positionKey(6, 1)]) === 2);
check('and the recall sets the best rather than being beaten by a stored zero',
  lit[positionKey(6, 1)].bestMs === 3000);

// Three quick recalls at a position that was shown first. The light being there
// once must not make the standing any easier or any harder to reach.
let mixed = recordShown({}, 5, 2, 1);
for (const ms of [1200, 1300, 1100]) mixed = recordFind(mixed, 5, 2, ms, 2);
check('a position that was shown first still has to earn quick the same way',
  positionStanding(mixed[positionKey(5, 2)]) === 'quick');

// The weighting: a shown position is asked more than a recalled one and less
// than one nothing at all is known about.
const weighted = {};
for (const p of rungPositions(RUNGS[0])) {
  weighted[positionKey(p.stringPosition, p.fret)] = {
    found: 3, bestMs: 900, recentMs: [900, 900, 900], at: 1,
  };
}
delete weighted[positionKey(6, 0)];
weighted[positionKey(6, 1)] = { found: 0, bestMs: 0, recentMs: [], shown: 4, at: 1 };
const deals = Array.from({ length: 300 }, (_, i) => nextPrompt(RUNGS[0], weighted, null, i / 300));
const onUnasked = deals.filter((p) => p.stringPosition === 6 && p.fret === 0).length;
const onShown = deals.filter((p) => p.stringPosition === 6 && p.fret === 1).length;
const onQuick = deals.length - onUnasked - onShown;
check('a shown position is asked more often than a quick one',
  onShown > onQuick / (rungPositions(RUNGS[0]).length - 2),
  `${onShown} shown vs ${onQuick} over the rest`);
check('and less often than one nothing is known about',
  onUnasked > onShown, `${onUnasked} unasked vs ${onShown} shown`);

const mine = { '6:0': { found: 1, bestMs: 3000, recentMs: [3000], at: 10 } };
const theirs = {
  '6:0': { found: 4, bestMs: 900, recentMs: [900, 900, 900], at: 20 },
  '5:2': { found: 1, bestMs: 2000, recentMs: [2000], at: 5 },
};
const merged = mergeNoteMaps(mine, theirs);
check('a merge keeps what only one side knew', merged['5:2'] !== undefined);
check('and takes the later claim where both did', merged['6:0'].found === 4);
check(
  'the older side wins nothing it should not',
  mergeNoteMaps(theirs, mine)['6:0'].found === 4,
);

console.log('\nWhere the ladder puts you\n');

const clean = (n) =>
  Array.from({ length: n }, (_, i) => ({
    date: `2026-01-0${i + 1}`,
    findsPerMin: CLEAR_FINDS_PER_MIN + 4,
    medianMs: RUNGS[0].budgetMs - 1000,
  }));

check('nothing run is new', rungStanding([], RUNGS[0]) === 'new');
check('one clean run is not enough', rungStanding(clean(1), RUNGS[0]) === 'learning');
check(`${CLEAR_RUNS} clean runs clear it`, rungStanding(clean(CLEAR_RUNS), RUNGS[0]) === 'clear');
check(
  'a run that found enough but found it slowly does not clear it',
  rungStanding(
    [...clean(2), { date: '2026-01-09', findsPerMin: 20, medianMs: RUNGS[0].budgetMs + 1 }],
    RUNGS[0],
  ) === 'learning',
);
check(
  'nor does a fast run that found too little',
  rungStanding(
    [...clean(2), { date: '2026-01-09', findsPerMin: CLEAR_FINDS_PER_MIN - 1, medianMs: 500 }],
    RUNGS[0],
  ) === 'learning',
);
check(
  'a run with no time recorded cannot clear it',
  rungStanding(
    [...clean(2), { date: '2026-01-09', findsPerMin: 30, medianMs: null }],
    RUNGS[0],
  ) === 'learning',
);

check('a player with no history starts at the bottom', currentRung({}).id === RUNGS[0].id);
check(
  'clearing the bottom rung opens the next one',
  currentRung({ [RUNGS[0].id]: clean(CLEAR_RUNS) }).id === RUNGS[1].id,
);
check(
  'and never skips one that has not been cleared',
  currentRung({ [RUNGS[1].id]: clean(CLEAR_RUNS) }).id === RUNGS[0].id,
);
check(
  'a rung that goes soft takes the session back down to it',
  currentRung({
    [RUNGS[0].id]: [...clean(2), { date: '2026-02-01', findsPerMin: 1, medianMs: 20000 }],
    [RUNGS[1].id]: clean(CLEAR_RUNS),
  }).id === RUNGS[0].id,
);

console.log('\nFind times\n');

check('no finds is no median', medianFindMs([]) === null);
check('an odd count takes the middle', medianFindMs([3000, 1000, 2000]) === 2000);
check('an even count takes the pair', medianFindMs([1000, 2000, 3000, 4000]) === 2500);

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
