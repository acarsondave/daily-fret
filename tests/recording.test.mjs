// What is kept, what goes, and what it costs.
//
// The retention rules are the part of practice recording that can lose
// something irreplaceable, so they are pure functions and they are tested here
// rather than discovered on the day a week of footage disappears.

import {
  BUDGET_CHOICES,
  DEFAULT_KEEP_BYTES,
  DEFAULT_KEEP_SESSIONS,
  MAX_KEEP_BYTES,
  MAX_KEEP_SESSIONS,
  MIN_KEEP_BYTES,
  MIN_KEEP_SESSIONS,
  TECHNIQUE_POOL,
  clampKeepBytes,
  clampKeepSessions,
  isProtected,
  minutesInBudget,
  planPrune,
  pruneEvent,
  sessionCount,
  techniquePool,
  totalBytes,
  typicalSessionMinutes,
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

/** Limits with a budget too large to bite, for the checks about the count. */
const roomy = (keepSessions) => ({ keepSessions, keepBytes: MAX_KEEP_BYTES });
/** Limits with a session count too large to bite, for the checks about bytes. */
const budget = (keepBytes) => ({ keepSessions: MAX_KEEP_SESSIONS, keepBytes });

const MB = 1024 * 1024;
/**
 * A coached run of a routine, as it really lands: one session, one clip per
 * segment, at the standard preset's own bitrate. Thirty minutes of practice is
 * roughly 340 MB in a single session, which is the number that made counting
 * sessions the wrong bound.
 */
const routineRun = (id, startedAt, minutes) => {
  const perClip = Math.round((minutes / 6) * 11.4 * MB);
  return Array.from({ length: 6 }, (_, i) =>
    clip({
      sessionId: id,
      startedAt: startedAt + i,
      bytes: perClip,
      durationMs: (minutes / 6) * 60_000,
    }),
  );
};

/** One technique check: three angles filmed together, one session. */
const techniqueCheck = (id, startedAt, over = {}) =>
  ['front', 'neck', 'strumming'].map((view, i) =>
    clip({
      sessionId: id,
      startedAt: startedAt + i,
      kind: 'technique-check',
      view,
      durationMs: 25_000,
      bytes: Math.round(4.75 * MB),
      ...over,
    }),
  );

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
  // Starring is the only permanent exemption there is. Technique checks used to
  // be exempt in their own right and had no prune path of any kind, which is not
  // a retention policy but a leak with a good reason attached to it.
  check('a starred clip', isProtected(clip({ starred: true })) === true);
  check('an ordinary session clip is not', isProtected(clip()) === false);
  check('and neither is a technique check on its own',
    isProtected(clip({ kind: 'technique-check', starred: false })) === false);
}

console.log('\nThe technique pool\n');
{
  // Twenty megabytes an angle, so six checks come to 360 MB and a budget can
  // actually bite. Real ones are smaller; what is under test is the ordering.
  const checks = Array.from({ length: TECHNIQUE_POOL + 2 }, (_, i) =>
    techniqueCheck(`chk-${i}`, (i + 1) * 10_000, { bytes: 20 * MB })).flat();
  const pool = techniquePool(checks);
  check('the newest checks are held out of the budget', pool.size === TECHNIQUE_POOL * 3,
    `${pool.size} clips`);
  check('counted as checks rather than clips, so a check is never half kept',
    [...new Set(checks.filter((c) => pool.has(c.id)).map((c) => c.sessionId))].length === TECHNIQUE_POOL);
  check('and it is the newest ones that are held',
    checks.filter((c) => pool.has(c.id)).every((c) => c.startedAt >= 30_000),
    checks.filter((c) => pool.has(c.id)).map((c) => c.startedAt).join(','));

  // The whole point of bounding it: the oldest checks can now go when the disk
  // needs the room, where before they could not go at all.
  const tight = planPrune(checks, budget(MIN_KEEP_BYTES));
  check('the oldest checks are prunable once the pool is full',
    tight.drop.length === 6 && tight.drop.every((c) => c.startedAt < 30_000),
    tight.drop.map((c) => c.startedAt).join(','));
  check('and the pool itself is never touched',
    tight.keep.filter((c) => c.kind === 'technique-check').length === TECHNIQUE_POOL * 3);
  check('a pool bigger than the budget is reported, never deleted',
    tight.overBudget === 0 || tight.keep.length === TECHNIQUE_POOL * 3,
    formatMegabytes(tight.overBudget));
  check('a starred check outlives the pool',
    planPrune(
      [...techniqueCheck('old', 1, { starred: true }), ...checks],
      budget(MIN_KEEP_BYTES),
    ).keep.some((c) => c.sessionId === 'old'));
}

console.log('\nThe byte budget, which is the bound that matters\n');
{
  check('a sane default', DEFAULT_KEEP_BYTES >= MIN_KEEP_BYTES && DEFAULT_KEEP_BYTES <= MAX_KEEP_BYTES);
  check('zero is refused', clampKeepBytes(0) === MIN_KEEP_BYTES);
  check('a negative is refused', clampKeepBytes(-1) === MIN_KEEP_BYTES);
  check('an absurd budget is capped', clampKeepBytes(500 * 1024 * MB) === MAX_KEEP_BYTES);
  check('nonsense falls back to the default', clampKeepBytes(Number.NaN) === DEFAULT_KEEP_BYTES);
  check('every offered budget is one the clamp accepts',
    BUDGET_CHOICES.every((b) => clampKeepBytes(b) === b), BUDGET_CHOICES.join(','));
  check('and they are offered smallest first',
    BUDGET_CHOICES.every((b, i) => i === 0 || BUDGET_CHOICES[i - 1] < b));
  check('the default is one of them', BUDGET_CHOICES.includes(DEFAULT_KEEP_BYTES));

  // The defect, in the numbers it was found with. Eight sessions of a
  // thirty-minute routine is about 2.7 GB, and the session count alone would
  // have kept every byte of it.
  const eight = Array.from({ length: 8 }, (_, i) => routineRun(`day-${i}`, (i + 1) * 100_000, 30)).flat();
  check('eight filmed routines really is about 2.7 GB',
    totalBytes(eight) > 2.6 * 1024 * MB && totalBytes(eight) < 2.8 * 1024 * MB,
    formatMegabytes(totalBytes(eight)));
  const counted = planPrune(eight, roomy(DEFAULT_KEEP_SESSIONS));
  check('counting sessions alone would have kept all of it', counted.drop.length === 0);
  const bounded = planPrune(eight, {
    keepSessions: DEFAULT_KEEP_SESSIONS,
    keepBytes: DEFAULT_KEEP_BYTES,
  });
  check('the budget deletes the oldest sessions instead', bounded.drop.length > 0,
    `${bounded.drop.length} clips`);
  check('and what survives is inside it',
    totalBytes(bounded.keep) <= DEFAULT_KEEP_BYTES,
    `${formatMegabytes(totalBytes(bounded.keep))} of ${formatMegabytes(DEFAULT_KEEP_BYTES)}`);
  check('sessions go whole, not clip by clip',
    [...new Set(bounded.drop.map((c) => c.sessionId))].every(
      (id) => !bounded.keep.some((c) => c.sessionId === id)));
  check('and it is the oldest that go',
    Math.max(...bounded.drop.map((c) => c.startedAt)) < Math.min(...bounded.keep.map((c) => c.startedAt)));
  check('nothing claims to be over budget when it is not', bounded.overBudget === 0,
    formatMegabytes(bounded.overBudget));

  // One session larger than the whole budget. It cannot be met, and the honest
  // answer is to keep the newest session and say how far over it is rather than
  // to delete everything the player just filmed.
  const huge = routineRun('marathon', 500_000, 120);
  const impossible = planPrune(huge, budget(MIN_KEEP_BYTES));
  check('the newest session is never deleted to meet a budget',
    impossible.keep.length === huge.length, `${impossible.drop.length} dropped`);
  check('and the shortfall is reported rather than swallowed',
    impossible.overBudget === totalBytes(huge) - MIN_KEEP_BYTES,
    formatMegabytes(impossible.overBudget));
}

console.log('\nWhichever bound bites first\n');
{
  const ten = Array.from({ length: 10 }, (_, i) => routineRun(`d-${i}`, (i + 1) * 100_000, 5)).flat();
  const byCount = planPrune(ten, { keepSessions: 4, keepBytes: MAX_KEEP_BYTES });
  check('the count can bite with room to spare', sessionCount(byCount.keep) === 4);
  const byBytes = planPrune(ten, budget(MIN_KEEP_BYTES));
  check('and the budget can bite with slots to spare',
    sessionCount(byBytes.keep) < 10 && totalBytes(byBytes.keep) <= MIN_KEEP_BYTES,
    `${sessionCount(byBytes.keep)} sessions, ${formatMegabytes(totalBytes(byBytes.keep))}`);
  check('a starred session still survives both',
    planPrune(
      [...ten, clip({ sessionId: 'kept', startedAt: 1, starred: true, bytes: 90 * MB })],
      { keepSessions: MIN_KEEP_SESSIONS, keepBytes: MIN_KEEP_BYTES },
    ).keep.some((c) => c.sessionId === 'kept'));
}

console.log('\nWhat a budget buys, before it is spent\n');
{
  // The figure the settings pane quotes has to come from the encoder's own
  // bitrate, or the interface is pricing something nobody is charged for.
  for (const preset of QUALITY_PRESETS) {
    const minutes = minutesInBudget(DEFAULT_KEEP_BYTES, preset.id);
    const expected = DEFAULT_KEEP_BYTES / BYTES_PER_MB / megabytesPerMinute(preset.id);
    check(`${preset.id} is priced from its own bitrate`, Math.abs(minutes - expected) < 1e-9);
  }
  check('a cheaper setting buys more footage for the same budget',
    minutesInBudget(DEFAULT_KEEP_BYTES, 'light') > minutesInBudget(DEFAULT_KEEP_BYTES, 'detail'));
  check('the default budget is a couple of hours at the default quality',
    minutesInBudget(DEFAULT_KEEP_BYTES, DEFAULT_QUALITY) > 100 &&
    minutesInBudget(DEFAULT_KEEP_BYTES, DEFAULT_QUALITY) < 180,
    minutesInBudget(DEFAULT_KEEP_BYTES, DEFAULT_QUALITY).toFixed(0));

  check('nothing filmed yet means no session length to quote',
    typicalSessionMinutes([]) === null);
  check('and technique checks alone are not a session length either',
    typicalSessionMinutes(techniqueCheck('c', 1)) === null);
  const runs = [...routineRun('a', 1000, 20), ...routineRun('b', 2000, 30), ...routineRun('c', 3000, 10)];
  check('a session length is the median of the sessions themselves',
    typicalSessionMinutes(runs) === 20, String(typicalSessionMinutes(runs)));
  check('so one session left running does not set the expectation',
    typicalSessionMinutes([...runs, ...routineRun('door', 4000, 240)]) <= 30,
    String(typicalSessionMinutes([...runs, ...routineRun('door', 4000, 240)])));
}

console.log('\nPruning to a limit\n');
{
  const under = sessions(3);
  const { keep, drop } = planPrune(under, roomy(8));
  check('nothing goes while under the limit', drop.length === 0 && keep.length === 3);
}
{
  const over = sessions(10);
  const { keep, drop } = planPrune(over, roomy(4));
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
  const { keep, drop } = planPrune(many, roomy(MIN_KEEP_SESSIONS));
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
  const { drop } = planPrune(mixed, roomy(MIN_KEEP_SESSIONS));
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
  const { keep, drop } = planPrune(withStars, roomy(1));
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
  const { keep, drop } = planPrune(list, roomy(MIN_KEEP_SESSIONS));
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
  const { keep, drop } = planPrune(half, roomy(MIN_KEEP_SESSIONS));
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
