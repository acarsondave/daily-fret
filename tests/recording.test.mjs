// What is kept, what goes, and what it costs.
//
// The retention rules are the part of practice recording that can lose
// something irreplaceable, so they are pure functions and they are tested here
// rather than discovered on the day a week of footage disappears.

import {
  DEFAULT_KEEP_SESSIONS,
  MAX_KEEP_SESSIONS,
  MIN_KEEP_SESSIONS,
  clampKeepSessions,
  isProtected,
  planPrune,
  pruneEvent,
  sessionCount,
  totalBytes,
} from '../src/media/retention.ts';
import {
  BYTES_PER_MB,
  DEFAULT_QUALITY,
  QUALITY_PRESETS,
  chooseMimeType,
  extensionFor,
  formatMegabytes,
  megabytesPerMinute,
  presetFor,
} from '../src/media/quality.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${!ok && d ? ' — ' + d : ''}`); };

let seq = 0;
const clip = (over = {}) => {
  seq += 1;
  return {
    id: `c${seq}`,
    sessionId: over.sessionId ?? `s${seq}`,
    kind: 'session',
    date: '2026-08-14',
    taskId: 't1',
    routineId: 'r1',
    label: 'Changes',
    startedAt: over.startedAt ?? seq * 1000,
    durationMs: 60_000,
    bytes: over.bytes ?? 1_000_000,
    mimeType: 'video/webm;codecs=vp9,opus',
    quality: 'standard',
    width: 1280,
    height: 720,
    hasAudio: true,
    starred: false,
    endedBy: 'complete',
    location: { backend: 'opfs', key: `${seq}.webm` },
    ...over,
  };
};

// One session per clip unless a sessionId is given, so a plain list of N clips
// is a list of N sessions.
const sessions = (n) =>
  Array.from({ length: n }, (_, i) => clip({ sessionId: `s-${i}`, startedAt: (i + 1) * 1000 }));

console.log('\nThe retention count\n');
{
  check('a sane default', DEFAULT_KEEP_SESSIONS >= MIN_KEEP_SESSIONS && DEFAULT_KEEP_SESSIONS <= MAX_KEEP_SESSIONS);
  check('zero is refused', clampKeepSessions(0) === MIN_KEEP_SESSIONS);
  check('a negative is refused', clampKeepSessions(-40) === MIN_KEEP_SESSIONS);
  check('an absurd number is capped', clampKeepSessions(9999) === MAX_KEEP_SESSIONS);
  check('a fraction is rounded', clampKeepSessions(7.6) === 8);
  check('nonsense falls back to the default', clampKeepSessions(Number.NaN) === DEFAULT_KEEP_SESSIONS);
}

console.log('\nWhat may never be pruned\n');
{
  check('a starred clip', isProtected(clip({ starred: true })) === true);
  check('a technique check, starred or not', isProtected(clip({ kind: 'technique-check', starred: false })) === true);
  check('an ordinary session clip is not', isProtected(clip()) === false);
}

console.log('\nPruning to a limit\n');
{
  const under = sessions(3);
  const { keep, drop } = planPrune(under, 8);
  check('nothing goes while under the limit', drop.length === 0 && keep.length === 3);
}
{
  const over = sessions(10);
  const { keep, drop } = planPrune(over, 4);
  check('the oldest sessions go', drop.length === 6);
  check('the newest are the ones kept', keep.every((r) => r.startedAt > 6000), keep.map((r) => r.startedAt).join(','));
  check('exactly the limit survives', sessionCount(keep) === 4);
}
{
  // A whole session's worth of clips is one unit, not three. Limits below
  // MIN_KEEP_SESSIONS are clamped, so the fixtures work at the real floor.
  const many = [
    clip({ sessionId: 'a', startedAt: 1000 }),
    clip({ sessionId: 'a', startedAt: 1500 }),
    clip({ sessionId: 'a', startedAt: 2000 }),
    clip({ sessionId: 'b', startedAt: 5000 }),
    clip({ sessionId: 'b', startedAt: 5500 }),
    clip({ sessionId: 'c', startedAt: 6000 }),
    clip({ sessionId: 'd', startedAt: 7000 }),
  ];
  const { keep, drop } = planPrune(many, MIN_KEEP_SESSIONS);
  check('a session is kept or dropped whole', drop.length === 3 && drop.every((r) => r.sessionId === 'a'));
  check('and the survivors keep all of their clips', keep.length === 4);
}
{
  // The reason a session is ranked by when it started rather than by its last
  // clip: a long session that began first is still the older one.
  const mixed = [
    clip({ sessionId: 'early-long', startedAt: 1000 }),
    clip({ sessionId: 'early-long', startedAt: 9000 }),
    clip({ sessionId: 'later-short', startedAt: 4000 }),
    clip({ sessionId: 'c', startedAt: 5000 }),
    clip({ sessionId: 'd', startedAt: 6000 }),
  ];
  const { drop } = planPrune(mixed, MIN_KEEP_SESSIONS);
  check('ordered by when a session began', drop.length === 2 && drop.every((r) => r.sessionId === 'early-long'),
    drop.map((r) => r.sessionId).join(','));
}

console.log('\nWhat pruning may not touch\n');
{
  const withStars = [
    ...sessions(3),
    clip({ sessionId: 'kept', startedAt: 10, starred: true }),
    clip({ sessionId: 'check', startedAt: 20, kind: 'technique-check' }),
  ];
  const { keep, drop } = planPrune(withStars, 1);
  check('a starred clip survives being the oldest thing there is',
    keep.some((r) => r.sessionId === 'kept'));
  check('so does a technique check', keep.some((r) => r.sessionId === 'check'));
  check('only ordinary clips were dropped', drop.every((r) => !isProtected(r)));
}
{
  // A protected session must not spend one of the limited slots, or a week of
  // starred practice would evict every recent ordinary session.
  const list = [
    clip({ sessionId: 'star-1', startedAt: 9000, starred: true }),
    clip({ sessionId: 'star-2', startedAt: 8000, starred: true }),
    clip({ sessionId: 'plain-a', startedAt: 7000 }),
    clip({ sessionId: 'plain-b', startedAt: 6000 }),
    clip({ sessionId: 'plain-c', startedAt: 5000 }),
    clip({ sessionId: 'plain-old', startedAt: 1000 }),
  ];
  const { keep, drop } = planPrune(list, MIN_KEEP_SESSIONS);
  check('starred sessions do not use up the window',
    ['plain-a', 'plain-b', 'plain-c'].every((id) => keep.some((r) => r.sessionId === id)),
    keep.map((r) => r.sessionId).join(','));
  check('and the oldest ordinary one still goes',
    drop.length === 1 && drop[0].sessionId === 'plain-old');
}
{
  // A session where one clip is starred and one is not: the star saves its own
  // clip, and only its own.
  const half = [
    clip({ sessionId: 'mixed', startedAt: 100, starred: true }),
    clip({ sessionId: 'mixed', startedAt: 200 }),
    ...sessions(3),
  ];
  const { keep, drop } = planPrune(half, MIN_KEEP_SESSIONS);
  check('a star saves its own clip out of a doomed session',
    keep.some((r) => r.sessionId === 'mixed' && r.starred) &&
    drop.some((r) => r.sessionId === 'mixed' && !r.starred));
}

console.log('\nSaying so\n');
{
  check('nothing pruned means nothing to report', pruneEvent([], 5) === null);
  const event = pruneEvent([clip({ bytes: 2_000_000 }), clip({ bytes: 3_000_000 })], 777);
  check('a prune reports its count', event.clips === 2);
  check('and its bytes', event.bytes === 5_000_000);
  check('and when', event.at === 777);
  check('totals add up', totalBytes([clip({ bytes: 10 }), clip({ bytes: 32 })]) === 42);
}

console.log('\nWhat it costs\n');
{
  check('there is a default preset', QUALITY_PRESETS.some((p) => p.id === DEFAULT_QUALITY));
  check('the default is 720p', presetFor(DEFAULT_QUALITY).height === 720);
  check('an unknown quality is refused rather than guessed', (() => {
    try {
      presetFor('cinema');
      return false;
    } catch {
      return true;
    }
  })());

  // The number the settings pane shows has to be the number the encoder is
  // actually asked for, or the interface is quoting a price nobody charges.
  for (const preset of QUALITY_PRESETS) {
    const expected =
      ((preset.videoBitsPerSecond + preset.audioBitsPerSecond) * 60) / 8 / BYTES_PER_MB;
    check(`${preset.id} quotes its own bitrate`, Math.abs(megabytesPerMinute(preset.id) - expected) < 1e-9);
  }
  check('presets get more expensive in order',
    megabytesPerMinute('light') < megabytesPerMinute('standard') &&
    megabytesPerMinute('standard') < megabytesPerMinute('detail'));
  check('standard is roughly ten megabytes a minute',
    megabytesPerMinute('standard') > 9 && megabytesPerMinute('standard') < 13,
    megabytesPerMinute('standard').toFixed(2));
}

console.log('\nSizes, as read by a person\n');
{
  check('bytes', formatMegabytes(524_288) === '0.50 MB', formatMegabytes(524_288));
  check('a few megabytes keep a decimal', formatMegabytes(3.5 * BYTES_PER_MB) === '3.5 MB');
  check('tens of megabytes keep one', formatMegabytes(42.25 * BYTES_PER_MB) === '42.3 MB', formatMegabytes(42.25 * BYTES_PER_MB));
  check('hundreds are whole', formatMegabytes(340.6 * BYTES_PER_MB) === '341 MB', formatMegabytes(340.6 * BYTES_PER_MB));
  check('gigabytes switch unit', formatMegabytes(2.5 * 1024 * BYTES_PER_MB) === '2.5 GB');
}

console.log('\nContainers\n');
{
  // Node has no MediaRecorder, which is exactly the "this browser cannot" case.
  check('a runtime with no MediaRecorder gets null, not a guess', chooseMimeType() === null);
  check('webm is named webm', extensionFor('video/webm;codecs=vp9,opus') === 'webm');
  check('mp4 is named mp4', extensionFor('video/mp4') === 'mp4');
  check('anything else is not given a lying extension', extensionFor('video/quicktime') === 'bin');
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
