// How long the session waits between drills, and what decides it.
//
// The rest used to be thirty seconds after everything. Diagnostics from
// thirty-one real sessions put the gap from one drill's finish mark to the next
// drill's start mark at 42.2 to 48.3 seconds, median 43.3, whatever had just
// happened: a counted minute at full effort and a block of muted strumming got
// the same break, and a nine-task routine spent over six minutes of a
// twenty-minute prescription watching a number count down.
//
// So the length is a property of the work that just ended. This states the whole
// table, because every number in it is a claim about what a player's hands need
// and none of them can be read off the code without it.

import { restSecondsAfter, restIsSpoken } from '../src/lib/coached.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${d ? ' — ' + d : ''}`); };

const changes = (taskId = 't1') => ({ kind: 'changes', taskId, title: 'Changes', from: 'A', to: 'D', seconds: 60 });
const rotation = (taskId = 't2') => ({ kind: 'rotation', taskId, title: 'Anchors', chords: ['A', 'D', 'E'], seconds: 60 });
const trainer = (taskId = 't3') => ({ kind: 'trainer', taskId, title: 'Chord Perfect', chords: ['A', 'D'], seconds: 90 });
const timing = (taskId = 't4') => ({ kind: 'timing', taskId, title: 'Timing', seconds: 60 });
const patterns = (taskId = 't5') => ({ kind: 'patterns', taskId, title: 'Patterns', seconds: 90 });
const song = (taskId = 't6') => ({ kind: 'song', taskId, title: 'Song', songId: 's1' });
const timed = (taskId = 't7', title = 'Stretch') => ({ kind: 'timed', taskId, title, seconds: 300 });

const is = (label, ended, next, expected) =>
  check(label, restSecondsAfter(ended, next) === expected,
    `got ${restSecondsAfter(ended, next)}, wanted ${expected}`);

console.log('\nA counted minute at full effort earns a full minute off\n');
{
  is('one-minute changes, which is the course\'s own instruction', changes(), timed(), 60);
  is('the anchor rotation, the same minute over a ring', rotation(), timed(), 60);
  is('Chord Perfect, whose reps carry their own lift-off', trainer(), timed(), 45);
}

console.log('\nWork that costs concentration rather than the hands rests briefly\n');
{
  is('strum timing', timing(), timed(), 20);
  is('strum patterns', patterns(), timed(), 20);
  is('a song played to the record', song(), timed(), 15);
  is('a plain timed block', timed(), changes(), 8);
}

console.log('\nTwo timed blocks of one task are not two exercises\n');
{
  const first = timed('strumming', 'Pattern 1');
  const second = timed('strumming', 'Pattern 2');
  is('so nothing sits between them', first, second, 0);
  is('while two timed blocks of different tasks still get their break',
    timed('strumming', 'Pattern 1'), timed('warmup', 'Spider walk'), 8);
  // Only timed blocks collapse. A counted drill that fans into several segments
  // of one task is several attempts at the same exercise, and the rest between
  // attempts is the exercise.
  is('and a pair of counted segments of one task keeps its full minute',
    changes('speed'), changes('speed'), 60);
}

console.log('\nThe last segment has nothing to rest before\n');
{
  is('a counted minute at the end of the session', changes(), undefined, 0);
  is('a timed block at the end of the session', timed(), undefined, 0);
}

console.log('\nAnd the coach only talks over a break long enough to hold a line\n');
{
  // The second spoken line lands six seconds in. On an eight-second break that
  // is the coach still talking as the next drill is announced.
  check('an eight-second break is silent', restIsSpoken(8) === false);
  check('a twenty-second break is silent', restIsSpoken(20) === false);
  check('a forty-five-second break is spoken', restIsSpoken(45) === true);
  check('a full minute is spoken', restIsSpoken(60) === true);
}

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures ? 1 : 0);
