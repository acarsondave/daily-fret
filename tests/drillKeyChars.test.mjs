// One character, one meaning.
//
// Two branches met here. One gave `@` to the window a count was counted over
// (lib/drillWindow.ts); the other, written before that existed, had already
// given `@` to the tempo a strumming pattern was held at. Both merged without a
// textual conflict in the files that matter, and the result would have read
// `pattern:D-DU-UD-@80` as a pattern measured over eighty seconds: its tempo
// stripped off the base key, every tempo of one pattern collapsed into a single
// series, and its score, which is a share and not a count, multiplied by 60/80.
//
// The last two checks below are the interesting ones. They assert what the old
// spelling would have done, so this file keeps failing if anyone reaches for
// `@` again on a key that is not a window.

import { patternKey, parsePatternKey, isDrillKey, countedDrillKey, ratePerMinute } from '../src/lib/drillKeys.ts';
import { baseKey, keyWindow } from '../src/lib/drillWindow.ts';
let bad = 0;
const check = (l, ok, d) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${d ? ' - ' + d : ''}`); };

const k = patternKey('D-DU-UD-', 80);
console.log('\nA pattern key and the window separator\n');
console.log(`  key: ${k}`);
check('the key round-trips', parsePatternKey(k)?.pattern === 'D-DU-UD-' && parsePatternKey(k)?.bpm === 80);
check('it is a drill key', isDrillKey(k));
check('the window reader finds no window on it', keyWindow(k) === null, String(keyWindow(k)));
check('so nothing is stripped off it', baseKey(k) === k, baseKey(k));
check('a pattern score is not a count', countedDrillKey(k) === false);
check('and is never divided by a window', ratePerMinute(k, 84) === 84, String(ratePerMinute(k, 84)));

// What would have happened with the old separator.
const old = 'pattern:D-DU-UD-@80';
console.log('\nWhat the old separator would have done\n');
console.log(`  keyWindow('${old}') = ${keyWindow(old)}`);
check('the old form really would have been read as an 80 second window', keyWindow(old) === 80);
check('and its base key would have lost the tempo', baseKey(old) === 'pattern:D-DU-UD-', baseKey(old));

// A real counted key still works.
console.log('\nCounted keys are unaffected\n');
check('a 30 second pair halves to a per-minute rate', ratePerMinute('pair:A|D@30', 20) === 40,
  String(ratePerMinute('pair:A|D@30', 20)));
check('a windowless pair reads as a minute', ratePerMinute('pair:A|D', 20) === 20);
check('a timing score is untouched', ratePerMinute('timing:80', 75) === 75);
console.log(bad ? `\n${bad} FAILED\n` : '\nall good\n');
process.exit(bad ? 1 : 0);
