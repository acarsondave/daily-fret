// Minimal typed wrapper around the YouTube IFrame Player API. We use the real
// player (not a bare <iframe>) so we get playback events — specifically ENDED,
// which lets the real-play pass advance on its own — and a reliable playVideo().
//
// The synced chart needs more of the surface than that: a time to draw against,
// a rate to project it by, and a seek for looping a section. Everything below is
// typed exactly as the published API declares it and nothing is invented. The
// methods are optional on the interface because they genuinely can be missing:
// the player object exists from construction but only wires its methods up when
// the iframe is ready, so a call made in between throws. Callers go through the
// readers at the bottom, which is the one place that guard lives.

export interface YTPlayer {
  playVideo(): void;
  destroy(): void;
  pauseVideo?(): void;
  getCurrentTime?(): number;
  getDuration?(): number;
  seekTo?(seconds: number, allowSeekAhead: boolean): void;
  getPlayerState?(): number;
  setPlaybackRate?(rate: number): void;
  getPlaybackRate?(): number;
  getAvailablePlaybackRates?(): number[];
}

interface YTPlayerEvent {
  target: YTPlayer;
}

interface YTStateChangeEvent {
  data: number;
  target: YTPlayer;
}

/** onPlaybackRateChange carries the new rate; onError carries a numeric code. */
interface YTNumberEvent {
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
    onPlaybackRateChange?: (e: YTNumberEvent) => void;
    onError?: (e: YTNumberEvent) => void;
  };
}

export interface YTPlayerStates {
  UNSTARTED: number;
  ENDED: number;
  PLAYING: number;
  PAUSED: number;
  BUFFERING: number;
  CUED: number;
}

interface YTNamespace {
  Player: new (el: HTMLElement, opts: YTPlayerOptions) => YTPlayer;
  PlayerState: YTPlayerStates;
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

// --- Reading a player that may not be listening yet -------------------------
//
// Every one of these can be called against a player mid-teardown or mid-load,
// and the API's answer to that is a thrown TypeError rather than a null. The
// alternative to catching is a try/catch at ten call sites, which is worse. A
// failed read returns null and the caller decides; nothing here substitutes a
// plausible number for one it did not get.

const attempt = <T>(read: () => T): T | null => {
  try {
    const value = read();
    return value === undefined ? null : value;
  } catch {
    return null;
  }
};

export function currentTimeOf(player: YTPlayer): number | null {
  const seconds = attempt(() => player.getCurrentTime?.());
  return typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : null;
}

export function playbackRateOf(player: YTPlayer): number | null {
  const rate = attempt(() => player.getPlaybackRate?.());
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * The speeds this video actually offers.
 *
 * Read from the player rather than hardcoded: the list is per-video and the
 * documented range has changed before. An empty array means the player has not
 * answered yet, which is different from a video that offers only normal speed.
 */
export function availableRatesOf(player: YTPlayer): number[] {
  const rates = attempt(() => player.getAvailablePlaybackRates?.());
  if (!Array.isArray(rates)) return [];
  return rates.filter((r): r is number => typeof r === 'number' && Number.isFinite(r) && r > 0);
}

export function playerStateOf(player: YTPlayer): number | null {
  const state = attempt(() => player.getPlayerState?.());
  return typeof state === 'number' ? state : null;
}

export function seekPlayerTo(player: YTPlayer, seconds: number): void {
  attempt(() => player.seekTo?.(Math.max(0, seconds), true));
}

export function setPlayerRate(player: YTPlayer, rate: number): void {
  attempt(() => player.setPlaybackRate?.(rate));
}
