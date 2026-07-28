import { useEffect, useRef } from 'react';
import { loadYouTubeApi, type YTPlayer } from '../../lib/youtube';

interface Props {
  videoId: string;
  onEnded: () => void; // fired when the video reaches its real end
  // Skip a long intro so playback opens where the song actually starts.
  startSeconds?: number;
}

// Renders the actual recording via the YouTube IFrame Player API. The player is
// created imperatively into a child node (React only owns the wrapper) so YT can
// swap it for its iframe without fighting React's reconciler.
export function YouTubePlayer({ videoId, onEnded, startSeconds }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const onEndedRef = useRef(onEnded);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    let cancelled = false;
    let player: YTPlayer | null = null;
    const mount = document.createElement('div');
    wrapper.appendChild(mount);

    loadYouTubeApi().then((YT) => {
      if (cancelled) return;
      player = new YT.Player(mount, {
        videoId,
        host: 'https://www.youtube-nocookie.com',
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 1,
          rel: 0,
          modestbranding: 1,
          iv_load_policy: 3,
          playsinline: 1,
          color: 'white',
          ...(startSeconds ? { start: Math.floor(startSeconds) } : {}),
        },
        events: {
          onReady: (e) => {
            try {
              e.target.playVideo();
            } catch {
              // Autoplay can be blocked; the user can press play. Not fatal.
            }
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED) onEndedRef.current();
          },
        },
      });
    });

    return () => {
      cancelled = true;
      try {
        player?.destroy();
      } catch {
        // Player may not have finished initializing; nothing to clean up.
      }
      wrapper.innerHTML = '';
    };
  }, [videoId, startSeconds]);

  return <div className="song-real-video" ref={wrapperRef} />;
}
