// One still from each clip, so the shelf has the footage on it.
//
// A library of video that shows no video is a filing cabinet. The still is what
// makes a row recognisable at a glance: which angle, which room, whether the
// guitar is even in shot, all of which a filename cannot say.
//
// Three constraints shaped this, and the first two came from the owner, whose
// stated objection to the previous design was that it must not be slow or heavy:
//
//  1. Nothing is decoded until it is about to be looked at. The caller drives
//     that with an intersection observer; this module only promises that asking
//     twice for the same still costs once.
//  2. The still is written to disk beside the footage, so the decode happens
//     once in the clip's life rather than once per visit. A 320px JPEG is around
//     ten kilobytes against a clip's two hundred megabytes, which is a rounding
//     error on a feature already storing video.
//  3. It is a data URL rather than an object URL. Object URLs have to be revoked
//     by whoever made them, and a grid of eighty of them is eighty leaks waiting
//     for one missed cleanup. A string is a string.
//
// Failure is not an error here. A clip whose bytes have gone, or a container the
// browser will not decode, simply has no still, and the row says so in its own
// way rather than this throwing into a render.

import type { Recording } from './types';

/** Wide enough to read the shape of a room, small enough to be nothing. */
const POSTER_WIDTH = 320;
const POSTER_QUALITY = 0.72;
/**
 * Where in the clip to grab.
 *
 * Not the first frame: a camera opening on a practice session gives a frame of
 * an empty chair or a lens still adjusting. A second and a half in, the player
 * is usually in shot and the exposure has settled.
 */
const POSTER_AT_SECONDS = 1.5;
const DECODE_TIMEOUT_MS = 8000;

const POSTER_DIR = 'posters';

const memory = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

function posterName(recording: Recording): string {
  return `${recording.id}.jpg`;
}

async function posterDirectory(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(POSTER_DIR, { create });
  } catch {
    return null;
  }
}

async function readCached(recording: Recording): Promise<string | null> {
  const dir = await posterDirectory(false);
  if (!dir) return null;
  try {
    const handle = await dir.getFileHandle(posterName(recording));
    const file = await handle.getFile();
    if (file.size === 0) return null;
    return await file.text();
  } catch {
    return null;
  }
}

async function writeCached(recording: Recording, dataUrl: string): Promise<void> {
  const dir = await posterDirectory(true);
  if (!dir) return;
  try {
    const handle = await dir.getFileHandle(posterName(recording), { create: true });
    const sink = await handle.createWritable();
    await sink.write(dataUrl);
    await sink.close();
  } catch {
    // A still that could not be cached is still a still. The next visit pays the
    // decode again, which is slower than we would like and not worth surfacing.
  }
}

/**
 * Decode one frame out of a video blob.
 *
 * Everything here is torn down on every path, including the failures: an
 * abandoned `<video>` holding a blob URL keeps the whole clip in memory, and
 * this runs once per row in a grid.
 */
function grabFrame(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    let settled = false;

    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), DECODE_TIMEOUT_MS);

    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';

    video.addEventListener('error', () => finish(null), { once: true });

    video.addEventListener('loadeddata', () => {
      // MediaRecorder writes no duration into a container it is still
      // streaming, so `duration` is often Infinity here. Seeking to a fixed
      // moment near the start works either way and avoids having to resolve it.
      const target = Number.isFinite(video.duration)
        ? Math.min(POSTER_AT_SECONDS, video.duration / 2)
        : POSTER_AT_SECONDS;
      video.currentTime = target;
    }, { once: true });

    video.addEventListener('seeked', () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return finish(null);

      const scale = POSTER_WIDTH / width;
      const canvas = document.createElement('canvas');
      canvas.width = POSTER_WIDTH;
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return finish(null);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        finish(canvas.toDataURL('image/jpeg', POSTER_QUALITY));
      } catch {
        finish(null);
      }
    }, { once: true });

    video.src = url;
  });
}

/**
 * The still for a clip, from memory, then disk, then by decoding it.
 *
 * `load` is passed in rather than imported so this module never has to know
 * which backend a clip lives in, and so a caller can hand it an already-open
 * blob it happens to be holding.
 */
export function posterFor(
  recording: Recording,
  load: (recording: Recording) => Promise<Blob>,
): Promise<string | null> {
  const cached = memory.get(recording.id);
  if (cached) return Promise.resolve(cached);

  const running = inFlight.get(recording.id);
  if (running) return running;

  const work = (async () => {
    const onDisk = await readCached(recording);
    if (onDisk) {
      memory.set(recording.id, onDisk);
      return onDisk;
    }
    try {
      const frame = await grabFrame(await load(recording));
      if (!frame) return null;
      memory.set(recording.id, frame);
      void writeCached(recording, frame);
      return frame;
    } catch {
      return null;
    } finally {
      inFlight.delete(recording.id);
    }
  })();

  inFlight.set(recording.id, work);
  return work;
}

/** Drop a clip's still when the clip goes, so the directory cannot outgrow it. */
export async function forgetPoster(recording: Recording): Promise<void> {
  memory.delete(recording.id);
  const dir = await posterDirectory(false);
  if (!dir) return;
  try {
    await dir.removeEntry(posterName(recording));
  } catch {
    // Nothing there is the outcome we wanted.
  }
}
