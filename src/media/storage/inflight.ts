// Keys that are open for writing right now.
//
// A clip's file exists on disk before its index row exists: the recorder opens
// the file, films into it for minutes, and only writes the row once it knows the
// duration and the byte count. For that whole window the file looks exactly like
// an orphan, because by every test available it is one.
//
// So reconciling the disk against the index has to know what is still being
// written, or the first thing it would reclaim is the recording in progress.

const open = new Set<string>();

export function markWriting(key: string): void {
  open.add(key);
}

export function markFinished(key: string): void {
  open.delete(key);
}

export function isWriting(key: string): boolean {
  return open.has(key);
}
