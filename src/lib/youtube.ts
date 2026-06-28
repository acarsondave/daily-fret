// Minimal typed wrapper around the YouTube IFrame Player API. We use the real
// player (not a bare <iframe>) so we get playback events — specifically ENDED,
// which lets the real-play pass advance on its own — and a reliable playVideo().

export interface YTPlayer {
  playVideo(): void;
  destroy(): void;
}

interface YTPlayerEvent {
  target: YTPlayer;
}

interface YTStateChangeEvent {
  data: number;
  target: YTPlayer;
}

export interface YTPlayerOptions {
  videoId: string;
  host?: string;
  width?: string | number;
  height?: string | number;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (e: YTPlayerEvent) => void;
    onStateChange?: (e: YTStateChangeEvent) => void;
  };
}

interface YTNamespace {
  Player: new (el: HTMLElement, opts: YTPlayerOptions) => YTPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

// Loads the IFrame API script once and resolves when YT is ready. Chains any
// existing onYouTubeIframeAPIReady so we don't clobber another consumer.
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });

  return apiPromise;
}
