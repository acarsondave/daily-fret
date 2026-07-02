// Detection diagnostics recorder. Every mic capture automatically records a
// session: per-frame gate outcomes from the detector, onsets, emitted chords,
// and drill-level marks. Sessions persist to localStorage and can be exported
// as one JSON file from Account Settings (or window.dailyFretDiag.download()).
//
// Purpose: when detection misbehaves ("it wasn't counting today"), the export
// shows exactly which gate ate each frame instead of guessing from symptoms.

// Frame outcome codes. Kept numeric so a long session stays compact.
export const DIAG_CODE = {
  SILENT: 0, // below the active RMS gate (stored as aggregated spans)
  WINDOW_FILLING: 1, // chromagram window not filled yet (right after onset reset)
  LOW_SALIENCE: 2, // chroma too flat to be a chord (noise/percussive)
  NO_MATCH: 3, // no template cleared the score threshold
  AMBIGUOUS: 4, // restricted mode: margin to runner-up too small (in-flight)
  VOTE_PENDING: 5, // stability vote not yet won
  HOLD: 6, // stable chord equals the last emitted one (no change)
  BLOCKED_UNARMED: 7, // chord CHANGE ready but the arming gate blocked it
  EMIT: 8, // chord change emitted (this is what drills count)
} as const;

export type DiagCode = (typeof DIAG_CODE)[keyof typeof DIAG_CODE];

const CODE_LEGEND: Record<DiagCode, string> = {
  [DIAG_CODE.SILENT]: 'silent (below RMS gate)',
  [DIAG_CODE.WINDOW_FILLING]: 'window filling after onset reset',
  [DIAG_CODE.LOW_SALIENCE]: 'rejected: low tonal salience',
  [DIAG_CODE.NO_MATCH]: 'rejected: no template match',
  [DIAG_CODE.AMBIGUOUS]: 'rejected: ambiguous (restricted margin)',
  [DIAG_CODE.VOTE_PENDING]: 'stability vote pending',
  [DIAG_CODE.HOLD]: 'stable, same chord as last emit',
  [DIAG_CODE.BLOCKED_UNARMED]: 'change BLOCKED by arming gate',
  [DIAG_CODE.EMIT]: 'chord change emitted',
};

// One frame = [tMs, code, rms, noiseFloor, salience, margin, chordIdx].
// chordIdx indexes the session's chord name table; -1 = none.
type FrameTuple = [number, number, number, number, number, number, number];

export interface DiagSession {
  id: string;
  startedAt: string;
  endedAt?: string;
  label: string;
  sampleRate: number;
  restrictTo: string[] | null;
  constants: Record<string, number>;
  chordTable: string[];
  frameFields: string[];
  frames: FrameTuple[];
  // [tMs, "silence span"] durations of aggregated below-gate stretches
  silences: Array<[number, number]>;
  onsets: Array<{ t: number; rms: number; armed: boolean }>;
  emits: Array<{ t: number; chord: string; confidence: number }>;
  marks: Array<{ t: number; label: string }>;
  truncated: boolean;
}

const STORAGE_KEY = 'df-diag-v1';
const MAX_STORED_SESSIONS = 6;
// ~11 minutes of active (non-silent) audio at ~43 frames/sec. Beyond this the
// buffer wraps and keeps the most recent frames; marks/emits/onsets are small
// and always kept in full.
const MAX_FRAMES = 30_000;

const FRAME_FIELDS = ['tMs', 'code', 'rms', 'noiseFloor', 'salience', 'margin', 'chordIdx'];

function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

class DiagRecorder {
  private session: DiagSession | null = null;
  private startPerf = 0;
  private chordIdx = new Map<string, number>();
  // Circular frame buffer, unrolled into session.frames on end.
  private ring: FrameTuple[] = [];
  private ringHead = 0;
  private wrapped = false;
  private silenceStart = -1;
  private silenceLastT = 0;

  get active(): boolean {
    return this.session !== null;
  }

  private now(): number {
    return Math.round(performance.now() - this.startPerf);
  }

  private chordToIdx(chord: string | null): number {
    if (!this.session || chord === null) return -1;
    const existing = this.chordIdx.get(chord);
    if (existing !== undefined) return existing;
    const idx = this.session.chordTable.length;
    this.session.chordTable.push(chord);
    this.chordIdx.set(chord, idx);
    return idx;
  }

  start(meta: { label: string; sampleRate: number; restrictTo: string[] | null; constants: Record<string, number> }): void {
    if (this.session) this.end();
    this.startPerf = performance.now();
    this.chordIdx = new Map();
    this.ring = [];
    this.ringHead = 0;
    this.wrapped = false;
    this.silenceStart = -1;
    this.session = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      startedAt: new Date().toISOString(),
      label: meta.label,
      sampleRate: meta.sampleRate,
      restrictTo: meta.restrictTo,
      constants: meta.constants,
      chordTable: [],
      frameFields: FRAME_FIELDS,
      frames: [],
      silences: [],
      onsets: [],
      emits: [],
      marks: [],
      truncated: false,
    };
  }

  end(): void {
    const s = this.session;
    if (!s) return;
    this.closeSilence();
    s.frames = this.wrapped
      ? [...this.ring.slice(this.ringHead), ...this.ring.slice(0, this.ringHead)]
      : this.ring;
    s.truncated = this.wrapped;
    s.endedAt = new Date().toISOString();
    this.session = null;
    this.ring = [];
    persistSession(s);
  }

  mark(label: string): void {
    this.session?.marks.push({ t: this.now(), label });
  }

  onset(rms: number, armed: boolean): void {
    this.session?.onsets.push({ t: this.now(), rms: round4(rms), armed });
  }

  emit(chord: string, confidence: number): void {
    this.session?.emits.push({ t: this.now(), chord, confidence: round4(confidence) });
  }

  // Consecutive silent frames collapse into one span so quiet stretches (rests,
  // announcements) cost two numbers instead of thousands of tuples.
  silentFrame(): void {
    if (!this.session) return;
    const t = this.now();
    if (this.silenceStart < 0) this.silenceStart = t;
    this.silenceLastT = t;
  }

  private closeSilence(): void {
    if (!this.session || this.silenceStart < 0) return;
    this.session.silences.push([this.silenceStart, this.silenceLastT - this.silenceStart]);
    this.silenceStart = -1;
  }

  frame(code: DiagCode, rms: number, noiseFloor: number, salience: number, margin: number, chord: string | null): void {
    if (!this.session) return;
    this.closeSilence();
    const tuple: FrameTuple = [
      this.now(),
      code,
      round4(rms),
      round4(noiseFloor),
      round4(salience),
      round4(margin),
      this.chordToIdx(chord),
    ];
    if (this.ring.length < MAX_FRAMES) {
      this.ring.push(tuple);
    } else {
      this.ring[this.ringHead] = tuple;
      this.ringHead = (this.ringHead + 1) % MAX_FRAMES;
      this.wrapped = true;
    }
  }
}

export const diag = new DiagRecorder();

function loadStored(): DiagSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DiagSession[]) : [];
  } catch {
    // Corrupt store is diagnostic data only; recording forward matters more
    // than recovering it.
    return [];
  }
}

function persistSession(session: DiagSession): void {
  // Sessions with no audio activity at all (mic opened then closed) are noise.
  if (session.frames.length === 0 && session.emits.length === 0 && session.silences.length === 0) return;
  const sessions = [...loadStored(), session].slice(-MAX_STORED_SESSIONS);
  for (;;) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
      return;
    } catch {
      if (sessions.length > 1) {
        // Quota: drop the oldest session and retry so the newest survives.
        sessions.shift();
      } else if (session.frames.length > 1000) {
        // Even alone it doesn't fit: keep the most recent frames rather than
        // losing the session (marks/emits/onsets are small and kept whole).
        session.frames = session.frames.slice(-Math.floor(session.frames.length / 2));
        session.truncated = true;
      } else {
        return;
      }
    }
  }
}

export function storedSessionSummaries(): Array<{ startedAt: string; label: string; frames: number; emits: number }> {
  return loadStored().map((s) => ({
    startedAt: s.startedAt,
    label: s.label,
    frames: s.frames.length,
    emits: s.emits.length,
  }));
}

export function clearDiagnostics(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function downloadDiagnostics(): boolean {
  const sessions = loadStored();
  if (sessions.length === 0) return false;
  const payload = {
    exportedAt: new Date().toISOString(),
    codeLegend: CODE_LEGEND,
    frameFields: FRAME_FIELDS,
    note: 'frames are [tMs, code, rms, noiseFloor, salience, margin, chordIdx]; chordIdx indexes chordTable; silences are [startMs, durationMs] spans below the RMS gate',
    sessions,
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `daily-fret-diagnostics-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

// Console escape hatch so the data is reachable even if the UI path is broken.
declare global {
  interface Window {
    dailyFretDiag?: { download: () => boolean; summaries: () => ReturnType<typeof storedSessionSummaries>; clear: () => void };
  }
}
window.dailyFretDiag = {
  download: downloadDiagnostics,
  summaries: storedSessionSummaries,
  clear: clearDiagnostics,
};
