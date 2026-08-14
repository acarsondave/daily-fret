// How a pile of clips becomes something you can look through.
//
// Grouping is the part of the review library that decides whether a technique
// check reads as one act of looking at your hands or as three unrelated files,
// and whether a practice day reads as a day. It is pure, so it is tested here
// rather than eyeballed in a browser with a camera plugged in.

import {
  buildLibrary,
  endNote,
  formatDuration,
  viewName,
} from '../src/media/library.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${!ok && d ? ' · ' + d : ''}`); };

const clip = (over = {}) => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  sessionId: 's1',
  kind: 'session',
  date: '2026-08-14',
  taskId: 't1',
  routineId: 'r1',
  label: 'Chord Perfect',
  startedAt: 1000,
  durationMs: 60000,
  bytes: 1024 * 1024,
  mimeType: 'video/webm;codecs=vp9,opus',
  quality: 'standard',
  width: 1280,
  height: 720,
  hasAudio: true,
  starred: false,
  endedBy: 'complete',
  location: { backend: 'opfs', key: 'k' },
  ...over,
});

console.log('\nGrouping\n');
{
  const lib = buildLibrary([
    clip({ id: 'a', sessionId: 's1', startedAt: 3000 }),
    clip({ id: 'b', sessionId: 's1', startedAt: 1000 }),
    clip({ id: 'c', sessionId: 's2', startedAt: 9000 }),
  ]);
  check('clips sharing a session become one sitting', lib.days[0].sessions.length === 2,
    String(lib.days[0].sessions.length));
  const s1 = lib.days[0].sessions.find((s) => s.sessionId === 's1');
  check('a sitting starts when its first clip did', s1.startedAt === 1000, String(s1.startedAt));
  check('clips inside a sitting run oldest first, the order they were filmed',
    s1.clips[0].id === 'b' && s1.clips[1].id === 'a', s1.clips.map((c) => c.id).join(','));
  check('sittings run newest first', lib.days[0].sessions[0].sessionId === 's2',
    lib.days[0].sessions[0].sessionId);
  check('a sitting sums its clips', s1.totalMs === 120000 && s1.totalBytes === 2 * 1024 * 1024,
    `${s1.totalMs}ms ${s1.totalBytes}B`);
}

{
  const lib = buildLibrary([
    clip({ sessionId: 'x', date: '2026-08-10' }),
    clip({ sessionId: 'y', date: '2026-08-14' }),
  ]);
  check('days run newest first', lib.days[0].date === '2026-08-14', lib.days[0].date);
  check('every day is its own group', lib.days.length === 2, String(lib.days.length));
}

console.log('\nTechnique checks are not practice sessions\n');
{
  const lib = buildLibrary([
    clip({ kind: 'technique-check', sessionId: 'tc', view: 'front', startedAt: 1, starred: true }),
    clip({ kind: 'technique-check', sessionId: 'tc', view: 'neck', startedAt: 2, starred: true }),
    clip({ kind: 'technique-check', sessionId: 'tc', view: 'strumming', startedAt: 3, starred: true }),
    clip({ sessionId: 'p1' }),
  ]);
  check('checks are kept out of the day feed', lib.days[0].sessions.length === 1,
    String(lib.days[0].sessions.length));
  check('three angles are one sitting', lib.checks.length === 1, String(lib.checks.length));
  check('and stay in filming order', lib.checks[0].clips.map((c) => c.view).join(',') === 'front,neck,strumming',
    lib.checks[0].clips.map((c) => c.view).join(','));
  check('a sitting knows it is kept', lib.checks[0].starred === true);
}

{
  const lib = buildLibrary([]);
  check('an empty library is empty, not broken', lib.checks.length === 0 && lib.days.length === 0);
}

console.log('\nWhat the rows say\n');
{
  check('under a minute', formatDuration(42000) === '0:42', formatDuration(42000));
  check('minutes and seconds', formatDuration(195000) === '3:15', formatDuration(195000));
  check('past the hour', formatDuration(3723000) === '1:02:03', formatDuration(3723000));
  check('nothing is not negative', formatDuration(0) === '0:00', formatDuration(0));

  check('a clean end says nothing', endNote('complete') === null);
  check('a lost camera says so', (endNote('device-lost') ?? '').includes('disconnected'),
    String(endNote('device-lost')));
  check('every cut-short end has words', ['time-limit', 'device-lost', 'hidden', 'storage-full']
    .every((e) => typeof endNote(e) === 'string' && endNote(e).length > 0));

  check('angles are named for a person', viewName('neck') === 'Down the neck', viewName('neck'));
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
