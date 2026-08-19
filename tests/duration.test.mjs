// What a written duration means.
//
// parseDuration is the only thing standing between a legacy free-form label and
// the clock a timed block actually runs for, and it had no test. Its own doc
// comment named "90s" as a supported spelling while the regex behind it could
// not match one: \b never falls between a digit and the letter written against
// it, so "90s" and "30 seconds" both fell through to the minutes branch and hit
// the half-hour ceiling. A ninety-second warm-up became a thirty-minute block,
// and in Coached mode that is a session that never reaches its next drill.
//
// So this states the whole contract, spelling by spelling, including the ones
// that must NOT be read as seconds.

import { parseDuration } from '../src/lib/coached.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${d ? ' — ' + d : ''}`); };
const is = (label, input, expected) =>
  check(label, parseDuration(input) === expected, `${JSON.stringify(input)} -> ${parseDuration(input)}, wanted ${expected}`);

console.log('\nA bare number is minutes\n');
{
  is('the shape the app writes today', '5', 300);
  is('and one minute is sixty seconds', '1', 60);
}

console.log('\nSpelled-out minutes\n');
{
  is('"5 mins"', '5 mins', 300);
  is('"1 min"', '1 min', 60);
  is('"10 minutes"', '10 minutes', 600);
  is('a range takes the first number', '2-3 mins', 120);
}

console.log('\nSeconds, in every spelling the label might carry\n');
{
  is('"90s", the one the doc comment named and the code could not read', '90s', 90);
  is('"90 s"', '90 s', 90);
  is('"45 sec"', '45 sec', 45);
  is('"45 secs"', '45 secs', 45);
  is('"30 seconds"', '30 seconds', 30);
  is('"30 second"', '30 second', 30);
}

console.log('\nAnd the words that are not a unit at all\n');
{
  // The fix reads the word attached to the number. A word that merely starts
  // with an s is not the second's abbreviation, and reading it as one would turn
  // a three-minute block into fifteen seconds.
  is('"3 sets" is not three seconds', '3 sets', 180);
  is('"2 songs" is not two seconds', '2 songs', 120);
}

console.log('\nThe bounds\n');
{
  is('nothing at all falls back to three minutes', undefined, 180);
  is('a label with no number does too', 'a while', 180);
  is('anything under fifteen seconds is fifteen', '5s', 15);
  is('and nothing runs longer than half an hour', '90 mins', 1800);
}

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures ? 1 : 0);
