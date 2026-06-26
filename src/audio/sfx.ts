// Tiny synthesized sound-effects engine. No audio files — every cue is generated
// with the Web Audio API, so it adds ~0 KB and stays easy to keep tasteful.
// Sounds fire only at genuinely impactful moments (count-in, start, a new best,
// block/session complete, rest), never per-keystroke.

let ctx: AudioContext | null = null;
const STORAGE_KEY = 'daily-fret-sound';

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

let enabled = readEnabled();

export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(value: boolean): void {
  enabled = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    /* ignore persistence failures */
  }
}

// Lazily create (and resume) a shared AudioContext. All triggers happen after a
// user gesture (opening Coached, starting a drill), so it unlocks cleanly.
function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

interface Note {
  freq: number;
  start?: number; // seconds, relative to play time
  dur?: number;
  type?: OscillatorType;
  peak?: number; // gain peak (kept low so cues stay gentle)
}

function tone(c: AudioContext, t0: number, n: Note): void {
  const { freq, start = 0, dur = 0.15, type = 'sine', peak = 0.12 } = n;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const s = t0 + start;
  gain.gain.setValueAtTime(0.0001, s);
  gain.gain.linearRampToValueAtTime(peak, s + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, s + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(s);
  osc.stop(s + dur + 0.03);
}

function play(notes: Note[]): void {
  if (!enabled) return;
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime;
  for (const n of notes) tone(c, t0, n);
}

export const sfx = {
  // Count-in blip (3 · 2 · 1)
  tick: () => play([{ freq: 880, dur: 0.06, type: 'triangle', peak: 0.07 }]),
  // A drill begins
  go: () =>
    play([
      { freq: 523.25, dur: 0.1, type: 'triangle', peak: 0.09 },
      { freq: 783.99, start: 0.08, dur: 0.16, type: 'triangle', peak: 0.09 },
    ]),
  // Entering a rest
  rest: () => play([{ freq: 392, dur: 0.5, type: 'sine', peak: 0.06 }]),
  // A block/drill finished (no personal best)
  complete: () =>
    play([
      { freq: 523.25, dur: 0.14, type: 'sine', peak: 0.09 },
      { freq: 659.25, start: 0.1, dur: 0.22, type: 'sine', peak: 0.09 },
    ]),
  // New personal best / first benchmark — a bright little arpeggio
  best: () =>
    play([
      { freq: 523.25, dur: 0.18, type: 'triangle', peak: 0.09 },
      { freq: 659.25, start: 0.09, dur: 0.18, type: 'triangle', peak: 0.09 },
      { freq: 783.99, start: 0.18, dur: 0.18, type: 'triangle', peak: 0.09 },
      { freq: 1046.5, start: 0.27, dur: 0.32, type: 'triangle', peak: 0.1 },
    ]),
  // Whole session complete — a fuller flourish
  sessionComplete: () =>
    play([
      { freq: 523.25, dur: 0.2, type: 'triangle', peak: 0.09 },
      { freq: 659.25, start: 0.12, dur: 0.2, type: 'triangle', peak: 0.09 },
      { freq: 783.99, start: 0.24, dur: 0.2, type: 'triangle', peak: 0.09 },
      { freq: 1046.5, start: 0.36, dur: 0.45, type: 'triangle', peak: 0.11 },
      { freq: 1318.51, start: 0.46, dur: 0.5, type: 'sine', peak: 0.07 },
    ]),
};
