import { useEffect, useRef, useState } from 'react';
import { CameraIcon } from '../icons';
import { posterFor } from '../../media/posterFrames';
import { readRecording } from '../../media/storage';
import type { Recording } from '../../media/types';

/**
 * A clip's own still, decoded only once it is nearly on screen.
 *
 * Decoding is the expensive thing on this screen: each still costs a video
 * element, a seek and a canvas draw. Doing that for every clip on mount would
 * make a long archive crawl on exactly the machine that has been encoding video,
 * so nothing starts until the tile is within a screen's reach of the viewport,
 * and the first decode is cached to disk so it never happens twice.
 *
 * A still that cannot be made is not an error state. Old footage whose bytes
 * have gone, or a container this browser will not decode, gets the mark instead
 * of a broken image, and the row around it still works.
 */
export function PosterTile({ recording, alt }: { recording: Recording; alt: string }) {
  const [poster, setPoster] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const holderRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = holderRef.current;
    if (!node) return;

    let cancelled = false;
    const decode = () => {
      posterFor(recording, (r) => readRecording(r.location)).then((frame) => {
        if (cancelled) return;
        setPoster(frame);
        setSettled(true);
      });
    };

    if (typeof IntersectionObserver !== 'function') {
      decode();
      return () => { cancelled = true; };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        decode();
      },
      // A screen's worth of lead time, so scrolling at a normal speed meets
      // stills that are already there rather than watching them arrive.
      { rootMargin: '600px 0px' },
    );
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [recording]);

  return (
    <span ref={holderRef} className="poster" aria-hidden={!poster}>
      {poster ? (
        <img className="poster-img" src={poster} alt={alt} loading="lazy" decoding="async" />
      ) : (
        <span className={settled ? 'poster-blank is-settled' : 'poster-blank'}>
          <CameraIcon size={18} />
        </span>
      )}
    </span>
  );
}
