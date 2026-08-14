import { useEffect, useRef } from 'react';
import { loadYouTubeApi, type YTPlayer, type YTPlayerStates } from '../../lib/youtube';

/** What the recording is doing, named rather than left as YouTube's integers. */
export type PlaybackPhase = 'idle' | 'playing' | 'paused' | 'buffering' | 'ended';

interface Props {
  videoId: string;
  onEnded: () => void; // fired when the video reaches its real end
  // Skip a long intro so playback opens where the song actually starts.
  startSeconds?: number;
  /**
   * Handed the live player as soon as it exists, and null on teardown.
   *
   * The chart has to read a time off this object every frame, so it needs the
   * player itself; wrapping every method in a prop would be a second, thinner
   * copy of an API that is already typed in lib/youtube.
   */
  onPlayer?: (player: YTPlayer | null) => void;
  /** Every state change, including the ones that mean the clock is now wrong. */
  onPhase?: (phase: PlaybackPhase) => void;
  onRateChange?: (rate: number) => void;
  /** The video would not play at all: removed, private, or embedding refused. */
  onError?: (code: number) => void;
}

const phaseOf = (state: number, states: YTPlayerStates): PlaybackPhase => {
  if (state === states.PLAYING) return 'playing';
  if (state === states.PAUSED) return 'paused';
  if (state === states.BUFFERING) return 'buffering';
  if (state === states.ENDED) return 'ended';
  return 'idle';
};

// Renders the actual recording via the YouTube IFrame Player API. The player is
// created imperatively into a child node (React only owns the wrapper) so YT can
// swap it for its iframe without fighting React's reconciler.
export function YouTubePlayer({
  videoId,
  onEnded,
  startSeconds,
  onPlayer,
  onPhase,
  onRateChange,
  onError,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Held in a ref so a caller re-rendering does not tear the player down and
  // restart the record. Only the video itself may cause that.
  const handlers = useRef({ onEnded, onPlayer, onPhase, onRateChange, onError });
  useEffect(() => {
    handlers.current = { onEnded, onPlayer, onPhase, onRateChange, onError };
  }, [onEnded, onPlayer, onPhase, onRateChange, onError]);

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
            handlers.current.onPlayer?.(e.target);
            try {
              e.target.playVideo();
            } catch {
              // Autoplay can be blocked; the user can press play. Not fatal.
            }
          },
          onStateChange: (e) => {
            handlers.current.onPhase?.(phaseOf(e.data, YT.PlayerState));
            if (e.data === YT.PlayerState.ENDED) handlers.current.onEnded();
          },
          onPlaybackRateChange: (e) => handlers.current.onRateChange?.(e.data),
          onError: (e) => handlers.current.onError?.(e.data),
        },
      });
    });

    return () => {
      cancelled = true;
      handlers.current.onPlayer?.(null);
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
