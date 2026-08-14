// Where every bar of a chart sits in the recording.
//
// The whole feature turns on one number being right: the video time of the bar
// you are currently playing. Getting there from a single tempo and a single
// offset does not work. A record is played by people, so its tempo wanders, and
// the error compounds: half a percent over four minutes is more than a full bar
// out by the last chorus, which is worse than showing no chart at all.
//
// So the source of truth is a per-section anchor (`SongSection.atSeconds`), and
// bars are interpolated only between one anchor and the next. Error is then
// bounded to the length of a section rather than to the length of the song, and
// over fifteen or thirty seconds half a percent is about a tenth of a second,
// which nobody can see.
//
// A second consequence of interpolating inside sections: each section's real
// tempo is derived from its own span rather than declared, so a chorus that the
// band pushed and a verse they sat back on both stay in time without anyone
// having to notice they differ.
//
// Positions are carried in beats, not pixels and not seconds. The chart lays
// bars out at a fixed width per beat, so the beat coordinate is what the view
// translates by; and because a beat is a musical unit, a section played faster
// scrolls faster, which is what "in time with the record" looks like.
//
// No React in here on purpose: this is the part that has to be right, and it is
// tested against a fake clock rather than against a video.

import type { Song, SongStepDef } from '../data/songs';

/** Four, unless a song says otherwise. Nearly every chart in the app is in four. */
export const DEFAULT_BEATS_PER_BAR = 4;

export interface TimedBar {
  /** Position in the flattened song, so a bar can be addressed by one number. */
  index: number;
  sectionIndex: number;
  sectionLabel: string;
  /** True for the first bar of its section, which is where the label rides. */
  opensSection: boolean;
  chord: string;
  /** The bar's own strum, with the song default already resolved in. */
  strum: string;
  lyric?: string;
  tag?: string;
  beats: number;
  /** Cumulative beats from the chart's first downbeat. The layout coordinate. */
  beatStart: number;
  startSeconds: number;
  endSeconds: number;
}

export interface TimedSection {
  index: number;
  label: string;
  startSeconds: number;
  endSeconds: number;
  /** Index of this section's first bar in `bars`. */
  firstBar: number;
  barCount: number;
  beatStart: number;
  beats: number;
}

export interface SongTimeline {
  bars: TimedBar[];
  sections: TimedSection[];
  /** The first downbeat and the end of the last bar, in video time. */
  startSeconds: number;
  endSeconds: number;
  /** Total beats in the chart. The full width of the ribbon, in beat units. */
  beats: number;
}

/**
 * Why a chart could not be timed, in words the editor can show as-is.
 *
 * Returned rather than thrown, and never papered over with a guessed tempo: a
 * chart that scrolls to the wrong place is a worse failure than a chart that
 * admits it has no timing, because the player trusts it and blames their hands.
 */
export interface TimelineGap {
  code: 'empty' | 'empty-section' | 'no-anchors' | 'missing-anchor' | 'out-of-order' | 'no-end';
  message: string;
  /** The section that needs attention, when one section is at fault. */
  sectionIndex?: number;
}

export type TimelineResult =
  | { ok: true; timeline: SongTimeline }
  | { ok: false; gap: TimelineGap };

const gap = (code: TimelineGap['code'], message: string, sectionIndex?: number): TimelineResult => ({
  ok: false,
  gap: sectionIndex === undefined ? { code, message } : { code, message, sectionIndex },
});

const beatsOf = (song: Song, sectionBeats: number | undefined): number => {
  const declared = sectionBeats ?? song.beatsPerBar ?? DEFAULT_BEATS_PER_BAR;
  return Number.isFinite(declared) && declared > 0 ? Math.round(declared) : DEFAULT_BEATS_PER_BAR;
};

const strumOf = (song: Song, step: SongStepDef): string => step.strum ?? song.strum;

const anchored = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * Lay a chart out against its recording, or say why it cannot be.
 *
 * Timing is all-or-nothing by decision. A song where half the sections are
 * anchored would scroll correctly through the tapped half and drift silently
 * through the rest, and the player has no way to tell which half they are in.
 * One pass through the editor anchors a whole song, so the strict rule costs
 * nothing and removes the failure mode entirely.
 */
export function buildTimeline(song: Song): TimelineResult {
  const sections = song.sections;
  if (!sections.length) return gap('empty', 'This chart has no sections yet.');
  if (!sections.some((s) => s.steps.length)) return gap('empty', 'This chart has no bars yet.');
  if (!sections.some((s) => anchored(s.atSeconds))) {
    return gap('no-anchors', 'This chart has not been timed to the recording yet.');
  }

  const bounds: number[] = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (!section.steps.length) return gap('empty-section', `${section.label} has no bars.`, i);
    if (!anchored(section.atSeconds)) {
      return gap('missing-anchor', `${section.label} has no start time yet.`, i);
    }
    bounds.push(section.atSeconds);
  }

  if (!anchored(song.endSeconds)) {
    return gap('no-end', 'The last section has no end time yet.', sections.length - 1);
  }
  bounds.push(song.endSeconds);

  for (let i = 1; i < bounds.length; i++) {
    if (bounds[i] <= bounds[i - 1]) {
      const label = sections[i - 1].label;
      return gap('out-of-order', `${label} does not end after it starts.`, i - 1);
    }
  }

  const bars: TimedBar[] = [];
  const timedSections: TimedSection[] = [];
  let beatCursor = 0;

  for (let si = 0; si < sections.length; si++) {
    const section = sections[si];
    const perBar = beatsOf(song, section.beatsPerBar);
    const sectionBeats = section.steps.length * perBar;
    const start = bounds[si];
    const span = bounds[si + 1] - start;
    // The section's own tempo, derived from the span the anchors actually
    // measured rather than from the nominal one the sleeve prints.
    const secondsPerBeat = span / sectionBeats;

    timedSections.push({
      index: si,
      label: section.label,
      startSeconds: start,
      endSeconds: bounds[si + 1],
      firstBar: bars.length,
      barCount: section.steps.length,
      beatStart: beatCursor,
      beats: sectionBeats,
    });

    for (let bi = 0; bi < section.steps.length; bi++) {
      const step = section.steps[bi];
      bars.push({
        index: bars.length,
        sectionIndex: si,
        sectionLabel: section.label,
        opensSection: bi === 0,
        chord: step.chord,
        strum: strumOf(song, step),
        ...(step.lyric ? { lyric: step.lyric } : {}),
        ...(step.tag ? { tag: step.tag } : {}),
        beats: perBar,
        beatStart: beatCursor + bi * perBar,
        startSeconds: start + bi * perBar * secondsPerBeat,
        endSeconds: start + (bi + 1) * perBar * secondsPerBeat,
      });
    }

    beatCursor += sectionBeats;
  }

  return {
    ok: true,
    timeline: {
      bars,
      sections: timedSections,
      startSeconds: bars[0].startSeconds,
      endSeconds: bars[bars.length - 1].endSeconds,
      beats: beatCursor,
    },
  };
}

/** Seconds one beat lasts in this bar. Derived, because sections set their own pace. */
export function secondsPerBeat(bar: TimedBar): number {
  return (bar.endSeconds - bar.startSeconds) / bar.beats;
}

/**
 * The bar being played at this moment.
 *
 * Returns -1 before the chart starts and `bars.length` after it ends, so the
 * caller distinguishes "not started" from "finished" without a second lookup.
 * Binary search because this runs on every animation frame of a song that can
 * be five hundred bars long.
 */
export function barIndexAt(timeline: SongTimeline, seconds: number): number {
  const { bars } = timeline;
  if (seconds < bars[0].startSeconds) return -1;
  if (seconds >= bars[bars.length - 1].endSeconds) return bars.length;

  let low = 0;
  let high = bars.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (bars[mid].startSeconds <= seconds) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * The chart's own coordinate: beats elapsed since the first downbeat, as a
 * continuous number.
 *
 * Extrapolated past both ends at the pace of the nearest bar so the ribbon
 * keeps moving through an intro and an outro instead of freezing at the edge
 * and lurching when the first bar arrives.
 */
export function beatPositionAt(timeline: SongTimeline, seconds: number): number {
  const { bars } = timeline;
  const index = barIndexAt(timeline, seconds);
  if (index < 0) {
    const first = bars[0];
    return (seconds - first.startSeconds) / secondsPerBeat(first);
  }
  if (index >= bars.length) {
    const last = bars[bars.length - 1];
    return last.beatStart + last.beats + (seconds - last.endSeconds) / secondsPerBeat(last);
  }
  const bar = bars[index];
  return bar.beatStart + (seconds - bar.startSeconds) / secondsPerBeat(bar);
}

/** Video time of a beat position. The inverse of `beatPositionAt`, for seeking. */
export function secondsAtBeat(timeline: SongTimeline, beat: number): number {
  const { bars } = timeline;
  if (beat < 0) return bars[0].startSeconds + beat * secondsPerBeat(bars[0]);
  const last = bars[bars.length - 1];
  if (beat >= last.beatStart + last.beats) {
    return last.endSeconds + (beat - last.beatStart - last.beats) * secondsPerBeat(last);
  }
  let low = 0;
  let high = bars.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (bars[mid].beatStart <= beat) low = mid;
    else high = mid - 1;
  }
  const bar = bars[low];
  return bar.startSeconds + (beat - bar.beatStart) * secondsPerBeat(bar);
}

export interface BeatCursor {
  /** Which beat of the current bar, from 1. Zero when the chart has not started. */
  beat: number;
  ofBeats: number;
  /** How far through that beat, 0 to 1. Drives the pulse, never a score. */
  phase: number;
}

/** The beat under the playhead, for the tick that runs underneath the chords. */
export function beatCursorAt(timeline: SongTimeline, seconds: number): BeatCursor {
  const index = barIndexAt(timeline, seconds);
  if (index < 0 || index >= timeline.bars.length) {
    return { beat: 0, ofBeats: timeline.bars[0].beats, phase: 0 };
  }
  const bar = timeline.bars[index];
  const into = (seconds - bar.startSeconds) / secondsPerBeat(bar);
  const whole = Math.min(bar.beats - 1, Math.floor(into));
  return { beat: whole + 1, ofBeats: bar.beats, phase: into - whole };
}

/**
 * Whole beats until the next downbeat.
 *
 * This is the count-in. A beginner dropped into the middle of a record needs
 * to be led in rather than to discover, a beat late, that they were already
 * meant to be playing. Before the chart starts it counts towards the first bar;
 * inside a bar it counts towards the next one.
 */
export function beatsUntilNextBar(timeline: SongTimeline, seconds: number): number {
  const index = barIndexAt(timeline, seconds);
  const bars = timeline.bars;
  if (index < 0) return (bars[0].startSeconds - seconds) / secondsPerBeat(bars[0]);
  if (index >= bars.length) return 0;
  const bar = bars[index];
  return (bar.endSeconds - seconds) / secondsPerBeat(bar);
}

/** Which section is playing. -1 before the chart starts, sections.length after. */
export function sectionIndexAt(timeline: SongTimeline, seconds: number): number {
  const index = barIndexAt(timeline, seconds);
  if (index < 0) return -1;
  if (index >= timeline.bars.length) return timeline.sections.length;
  return timeline.bars[index].sectionIndex;
}

/**
 * Where a loop of one section should send the player back to.
 *
 * A hair before the downbeat rather than exactly on it, because seeking lands
 * the video slightly late and arriving after the first beat means the loop
 * clips the chord you came back to hear.
 */
export const LOOP_LEAD_SECONDS = 0.15;

export function loopTarget(timeline: SongTimeline, sectionIndex: number): number {
  const section = timeline.sections[sectionIndex];
  if (!section) return timeline.startSeconds;
  return Math.max(0, section.startSeconds - LOOP_LEAD_SECONDS);
}

// --- Authoring ------------------------------------------------------------

/**
 * How far behind the beat a tapped anchor is assumed to land, in seconds.
 *
 * Reacting to a sound you have already heard is a stimulus-response, and it is
 * reliably late by something in this range. Subtracting a constant removes the
 * part of the error that is constant; whatever is left is what nudging is for.
 */
export const TAP_LATENCY_SECONDS = 0.06;

/** m:ss.t. Tenths, because that is the precision an anchor is nudged in. */
export function formatVideoTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}
