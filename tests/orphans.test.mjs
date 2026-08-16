// Finding footage the library has lost.
//
// This exists because of a real leak found on the owner's own machine: 29 files
// on disk, 15 rows in the index, 469 MB of video that could not be watched,
// could not be deleted, and counted against the quota until the browser would
// have refused the next recording. Nothing in the app could see those files,
// because the index was the only thing anything ever read.
//
// What is under test is the decision, not the plumbing: which files get called
// orphans, and which are left alone. Two of those cases are dangerous in
// opposite directions. Miss an orphan and the leak continues. Reclaim a file
// that belongs to a recording still being written and the app eats the session
// its owner just played.
//
// The OPFS in this file is fake, but the code exercising it is the real
// opfsStore, including its real list() and remove().

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${!ok && d ? ' · ' + d : ''}`); };

const MINUTE = 60_000;
const NOW = 1_700_000_000_000;

// --- a fake origin private file system ---------------------------------------
//
// Modelled on the two behaviours that matter to the code under test: a file
// reports its own size and its own last write, and a directory can be walked.

class FakeFile {
  constructor(bytes, lastModified) { this.size = bytes; this.lastModified = lastModified; }
}

class FakeFileHandle {
  constructor(name, dir) { this.kind = 'file'; this.name = name; this.dir = dir; }
  async getFile() {
    const f = this.dir.files.get(this.name);
    if (!f) throw new Error('NotFoundError');
    return f;
  }
  // Modelled on the behaviour that actually bit: a writable stream is not a pipe
  // to the file. Chromium buffers into a swap and only moves it into place at
  // close(), so nothing written is recoverable until then. The fake does the
  // same, because a fake that let bytes land immediately would have passed the
  // broken version of the interrupted-clip salvage.
  async createWritable(options) {
    const dir = this.dir, name = this.name;
    const base = options?.keepExistingData ? (dir.files.get(name)?.size ?? 0) : 0;
    let staged = base;
    return {
      async seek(position) { staged = position; },
      async write(chunk) { staged += chunk.size; },
      async close() { dir.files.set(name, new FakeFile(staged, writeClock)); },
      async abort() {},
    };
  }
}

class FakeDirectory {
  constructor() { this.kind = 'directory'; this.files = new Map(); this.dirs = new Map(); }
  async getDirectoryHandle(name, options) {
    if (!this.dirs.has(name)) {
      if (!options?.create) throw new Error('NotFoundError');
      this.dirs.set(name, new FakeDirectory());
    }
    return this.dirs.get(name);
  }
  async getFileHandle(name, options) {
    if (!this.files.has(name)) {
      if (!options?.create) throw new Error('NotFoundError');
      this.files.set(name, new FakeFile(0, writeClock));
    }
    return new FakeFileHandle(name, this);
  }
  async removeEntry(name, options) {
    if (options?.recursive && this.dirs.has(name)) { this.dirs.delete(name); return; }
    if (!this.files.delete(name)) throw new Error('NotFoundError');
  }
  async *entries() {
    for (const name of [...this.files.keys()]) yield [name, new FakeFileHandle(name, this)];
    for (const [name, dir] of this.dirs) yield [name, dir];
  }
}

let writeClock = NOW;
const root = new FakeDirectory();

// Node exposes its own read-only `navigator`, so this has to be redefined
// rather than assigned.
Object.defineProperty(globalThis, 'navigator', {
  value: { storage: { getDirectory: async () => root } },
  configurable: true,
});
// The availability probe deliberately checks createWritable rather than
// getDirectory, because Safari shipped OPFS without it. The fake answers that
// probe the same way the real thing does.
globalThis.FileSystemFileHandle = FakeFileHandle;
// No IndexedDB here, which is also the honest shape of a browser that has OPFS:
// findOrphans must not fall over on the backend that is absent.
globalThis.indexedDB = undefined;

const { opfsStore } = await import('../src/media/storage/opfs.ts');
const { findOrphans, deleteOrphans } = await import('../src/media/storage/index.ts');

/** Put a finished file of a known size on the fake disk, written at `at`. */
async function put(key, bytes, at = NOW) {
  writeClock = at;
  const sink = await opfsStore.open(key);
  sink.write({ size: bytes });
  await sink.close();
  writeClock = NOW;
}

const loc = (key) => ({ backend: 'opfs', key });
const OLD = NOW - 2 * 60 * MINUTE;

console.log('\nWhat counts as recoverable while a take is still running\n');
{
  const sink = await opfsStore.open('mid-take.webm');
  sink.write({ size: 5_000_000 });
  // Nothing has been landed yet, and saying otherwise is how the library gains
  // a row pointing at an empty file.
  await new Promise((r) => setTimeout(r, 0));
  check('bytes still in the stream do not count as saved', sink.bytesFlushed() === 0,
    `${sink.bytesFlushed()} bytes`);
  const total = await sink.close();
  check('and they do the moment the file is closed', total === 5_000_000, `${total} bytes`);
  await opfsStore.remove('mid-take.webm');
}

console.log('\nWhat is on the disk, versus what the library claims\n');
{
  await put('kept.webm', 10_000_000, OLD);
  await put('lost-a.webm', 30_000_000, OLD);
  await put('lost-b.webm', 5_000_000, OLD);

  const report = await findOrphans([loc('kept.webm')], NOW);

  check('the two files no clip points at are found', report.files.length === 2,
    report.files.map((f) => f.location.key).join(', '));
  check('the clip the library knows about is left alone',
    !report.files.some((f) => f.location.key === 'kept.webm'));
  check('and their real size is reported, not estimated', report.bytes === 35_000_000,
    `${report.bytes} bytes`);
  check('nothing is reported as unsized on this backend', report.unsized === 0);
}

console.log('\nA recording that is still being written\n');
{
  // The exact shape of the danger: the recorder creates the file, films into it
  // for eight minutes, and only writes the index row at the end. For that whole
  // window the file is on disk with nothing pointing at it.
  const sink = await opfsStore.open('in-progress.webm');
  sink.write({ size: 4_000_000 });

  const during = await findOrphans([loc('kept.webm')], NOW);
  check('is never called an orphan while it is open',
    !during.files.some((f) => f.location.key === 'in-progress.webm'),
    during.files.map((f) => f.location.key).join(', '));

  await sink.close();
  // Still within the grace period now that it is closed, because a row that is
  // about to be written has not been written yet.
  const justClosed = await findOrphans([loc('kept.webm')], NOW);
  check('and not the moment it closes either',
    !justClosed.files.some((f) => f.location.key === 'in-progress.webm'));

  // Half an hour later nothing is coming back for it.
  const later = await findOrphans([loc('kept.webm')], NOW + 31 * MINUTE);
  check('but it is reclaimable once the grace period has passed',
    later.files.some((f) => f.location.key === 'in-progress.webm'));
}

console.log('\nReclaiming\n');
{
  const before = await findOrphans([loc('kept.webm')], NOW);
  const removed = await deleteOrphans(before.files);
  check('every orphan found is deleted', removed === before.files.length,
    `${removed} of ${before.files.length}`);

  // The point of all of this: the bytes are actually back.
  const left = await opfsStore.list();
  check('the disk is left holding only the clip the library knows about',
    left.length === 2 && left.some((f) => f.key === 'kept.webm'),
    left.map((f) => f.key).join(', '));

  const after = await findOrphans([loc('kept.webm')], NOW);
  check('and a second sweep finds nothing more to take', after.files.length === 0);
}

console.log('\nThe file the library points at is never at risk\n');
{
  const file = await opfsStore.read('kept.webm');
  check('it is still readable after a reclaim', file.size === 10_000_000, `${file?.size} bytes`);

  // An index with rows whose files are gone is the inverse failure, and it must
  // not cause the survivors to be swept up.
  const report = await findOrphans([loc('kept.webm'), loc('deleted-by-browser.webm')], NOW);
  check('a row with no file does not make other files orphans', report.files.length === 0);
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
