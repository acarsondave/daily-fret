// The lesson journal: what makes the long look back a path rather than a snapshot.
//
// `currentLesson` is one overwritten string, so without this the day someone
// left module 3 is gone the instant they set module 4. Every other record in
// this app can be rebuilt from what happened later; these days cannot. That is
// the whole reason the journal exists and the reason it is tested on its own.

import { mergeLessonJournals } from '../src/store/lessonJournal.ts';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail !== undefined ? ` - ${detail}` : ''}`);
};

console.log('\nMerging two devices\n');
{
  const phone = [{ code: 'b1-401', from: '2026-07-29' }, { code: 'b1-504', from: '2026-08-18' }];
  const laptop = [{ code: 'b1-401', from: '2026-07-29' }, { code: 'b1-601', from: '2026-08-25' }];
  const merged = mergeLessonJournals(phone, laptop);
  check('every arrival survives', merged.length === 3, merged.length);
  check('the shared one is not doubled',
    merged.filter((s) => s.code === 'b1-401').length === 1);
  check('it comes back in order',
    merged.map((s) => s.from).join(',') === '2026-07-29,2026-08-18,2026-08-25',
    merged.map((s) => s.from).join(','));
}

console.log('\nGoing back to a lesson is a second arrival\n');
{
  // Not folded into one entry. Someone who returns to module 3 in October stood
  // there twice, and one entry would erase the return, which is exactly the
  // kind of thing the journal is for.
  const merged = mergeLessonJournals(
    [{ code: 'b1-301', from: '2026-06-01' }],
    [{ code: 'b1-301', from: '2026-10-01' }],
  );
  check('both stands are kept', merged.length === 2, merged.length);
}

console.log('\nNothing is invented\n');
{
  check('two empties stay empty', mergeLessonJournals(undefined, undefined) === undefined);
  check('one side alone survives',
    mergeLessonJournals([{ code: 'b1-101', from: '2026-01-01' }], undefined)?.length === 1);
  check('the other side alone survives',
    mergeLessonJournals(undefined, [{ code: 'b1-101', from: '2026-01-01' }])?.length === 1);
  // Cloud data is not trusted to be well formed: a half-written entry must not
  // take a real day down with it.
  const dirty = mergeLessonJournals(
    [{ code: 'b1-101', from: '2026-01-01' }],
    [null, { code: 'b1-102' }, { from: '2026-02-02' }, { code: 5, from: 7 }],
  );
  check('a malformed entry is dropped, not thrown on', dirty.length === 1, dirty.length);
}

console.log(failures ? `\n${failures} failed\n` : '\nall good\n');
process.exit(failures ? 1 : 0);
