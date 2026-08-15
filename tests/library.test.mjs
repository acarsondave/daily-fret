// How a pile of clips becomes something you can look through.
//
// Grouping is the part of the review library that decides whether a technique
// check reads as one act of looking at your hands or as three unrelated files,
// and whether a practice day reads as a day. It is pure, so it is tested here
// rather than eyeballed in a browser with a camera plugged in.

import {
  buildLibrary,
  buildSpine,
  endNote,
  formatDuration,
  gapLabel,
  sameViewBefore,
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

console.log('\nThe spine\n');
{
  const spine = buildSpine([
    clip({ id: 'a', sessionId: 's1', date: '2026-08-14' }),
    clip({ id: 'b', sessionId: 's2', date: '2026-08-02' }),
    clip({ id: 'c', sessionId: 's3', date: '2026-07-28' }),
    clip({ id: 'd', sessionId: 's4', date: '2026-07-28' }),
  ]);

  check('months come back newest first', spine.months.map((m) => m.key).join(',') === '2026-08,2026-07',
    spine.months.map((m) => m.key).join(','));
  check('a month is named for a person', spine.months[0].label === 'August', spine.months[0].label);
  check('days inside a month run newest first',
    spine.months[0].days.map((d) => d.dayOfMonth).join(',') === '14,2',
    spine.months[0].days.map((d) => d.dayOfMonth).join(','));
  check('two sittings on one day stay one day',
    spine.months[1].days.length === 1 && spine.months[1].days[0].sessions.length === 2,
    String(spine.months[1].days[0].sessions.length));
  check('filmed days are counted, not clips', spine.filmedDays === 3, String(spine.filmedDays));

  // The density row is one tick per real day, so August must offer 31 and July 31.
  check('a month knows its own length',
    spine.months[0].daysInMonth === 31 && spine.months[1].daysInMonth === 31,
    `${spine.months[0].daysInMonth}/${spine.months[1].daysInMonth}`);
  check('and how much of it was filmed', spine.months[0].filmedDays === 2,
    String(spine.months[0].filmedDays));

  check('the span is reported from the real dates',
    spine.earliest === '2026-07-28' && spine.latest === '2026-08-14',
    `${spine.earliest}..${spine.latest}`);
}

{
  // A date is parsed as local time on purpose: UTC midnight renders as the day
  // before in any negative offset, and a practice diary that files a session
  // under the wrong day is worse than no diary.
  const spine = buildSpine([clip({ date: '2026-03-01' })]);
  check('the first of a month stays the first', spine.months[0].days[0].dayOfMonth === 1,
    String(spine.months[0].days[0].dayOfMonth));
  check('February is measured, not assumed', buildSpine([clip({ date: '2024-02-10' })])
    .months[0].daysInMonth === 29, String(buildSpine([clip({ date: '2024-02-10' })]).months[0].daysInMonth));
}

{
  const spine = buildSpine([
    clip({ sessionId: 'k', kind: 'technique-check', view: 'front', date: '2026-08-14' }),
  ]);
  check('a day with a check is marked as one', spine.months[0].days[0].hasCheck === true);
}

{
  check('an empty spine is empty, not broken',
    buildSpine([]).months.length === 0 && buildSpine([]).earliest === null);
}

console.log('\nHolding one take against another\n');
{
  const now = clip({ id: 'now', kind: 'technique-check', view: 'neck', startedAt: 5000 });
  const pool = [
    now,
    clip({ id: 'older', kind: 'technique-check', view: 'neck', startedAt: 3000 }),
    clip({ id: 'oldest', kind: 'technique-check', view: 'neck', startedAt: 1000 }),
    clip({ id: 'other-angle', kind: 'technique-check', view: 'front', startedAt: 2000 }),
    clip({ id: 'later', kind: 'technique-check', view: 'neck', startedAt: 9000 }),
    clip({ id: 'a-session', kind: 'session', startedAt: 2500 }),
  ];
  const found = sameViewBefore(pool, now);

  check('only the same angle is offered', found.every((r) => r.view === 'neck'),
    found.map((r) => r.view).join(','));
  check('only earlier takes', found.every((r) => r.startedAt < now.startedAt),
    found.map((r) => r.startedAt).join(','));
  check('newest of them first', found.map((r) => r.id).join(',') === 'older,oldest',
    found.map((r) => r.id).join(','));
  check('a practice session is never offered as a comparison',
    !found.some((r) => r.kind === 'session'));
  check('a session clip has nothing to compare against',
    sameViewBefore(pool, clip({ id: 'x', kind: 'session' })).length === 0);
}

{
  const DAY = 86_400_000;
  check('same day', gapLabel(0, 1000) === 'the same day', gapLabel(0, 1000));
  check('a day', gapLabel(0, DAY) === 'a day apart', gapLabel(0, DAY));
  check('within a fortnight, days', gapLabel(0, 9 * DAY) === '9 days apart', gapLabel(0, 9 * DAY));
  check('past that, weeks', gapLabel(0, 28 * DAY) === '4 weeks apart', gapLabel(0, 28 * DAY));
  check('past two months, months', gapLabel(0, 90 * DAY) === '3 months apart', gapLabel(0, 90 * DAY));
  check('order does not matter', gapLabel(90 * DAY, 0) === '3 months apart', gapLabel(90 * DAY, 0));
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
