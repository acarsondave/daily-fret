// What the file actually contains, as opposed to what the camera was asked for.
//
// `MediaStreamTrack.getSettings()` is the obvious source for a clip's width and
// height, and it is wrong often enough to matter. Measured against Chromium's
// capture device, a portrait request reports 720x1280 at every point in the
// track's life, from the moment it opens to after the recorder has stopped,
// while the file the encoder wrote is 1216x2160. Landscape agrees; portrait does
// not. A phone camera reporting a rotated frame is the same class of
// disagreement, and a phone stood on its end is the framing this feature is most
// likely to be used in.
//
// It matters because the index is a claim about the file. The library sizes its
// player from these numbers rather than forcing every clip into one aspect box,
// so a clip filed as landscape when it is portrait is a player of the wrong
// shape, and any later analysis pass reading coordinates out of a frame would be
// reading them against the wrong picture.
//
// So the number is measured from the finished file rather than inferred. It
// costs one metadata decode, which is roughly 100ms on a seven-megabyte clip and
// happens after the drill has already ended.

export interface VideoSize {
  width: number;
  height: number;
}

/**
 * The encoded frame size of a finished clip, or null if it cannot be read.
 *
 * Null is a real answer and the caller must decide what to do about it: this
 * runs after a recording has been safely written, and failing a save because a
 * measurement did not come back would trade the footage for the label on it.
 */
export function measureVideoSize(blob: Blob, timeoutMs = 5000): Promise<VideoSize | null> {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    let settled = false;

    const finish = (size: VideoSize | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      // Both, and in this order. Dropping the source before revoking stops the
      // element holding a decoder open on bytes that no longer have a URL.
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(size);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    video.onloadedmetadata = () => {
      const { videoWidth, videoHeight } = video;
      finish(videoWidth > 0 && videoHeight > 0 ? { width: videoWidth, height: videoHeight } : null);
    };
    video.onerror = () => finish(null);

    // Only the header is needed, so the whole clip is never pulled into memory.
    video.preload = 'metadata';
    video.muted = true;
    video.src = url;
  });
}
