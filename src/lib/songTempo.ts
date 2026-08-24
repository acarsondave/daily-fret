// Where every bar of a chart sits when the app is the one keeping time.
//
// The sibling of songTiming.ts, and deliberately not a function inside it. That
// file answers "where is this bar in the recording", which is a question about a
// performance somebody else played and needs an anchor per section because a
// real band's tempo wanders. This one answers "where is this bar at this
// tempo", which is a question about a grid we are generating, and a generated
// grid does not wander. Blurring the two would put a "no drift here" branch
// through three hundred lines that exist entirely to handle drift.
//
// The output is byte-for-byte the same `SongTimeline` shape, which is the whole
// point: SyncedChart, the section loop, the count-in and PlaybackControls take a
// timeline and a clock, and none of them ever knew what a recording was.
//
// Time starts at zero on the first downbeat. A count-in is the clock starting
// negative, not a bar bolted onto the front of the chart.

import type { Song, SongStepDef } from '../data/songs';
import type { TempoPlan } from './tempo';
import { DEFAULT_BEATS_PER_BAR, type TimedBar, type TimedSection, type TimelineGap, type TimelineResult } from './songTiming';

const gap = (code: TimelineGap['code'], message: string, sectionIndex?: number): TimelineResult => ({
  ok: false,
  gap: sectionIndex === undefined ? { code, message } : { code, message, sectionIndex },
});

const beatsOf = (song: Song, sectionBeats: number | undefined): number => {
  const declared = sectionBeats ?? song.beatsPerBar ?? DEFAULT_BEATS_PER_BAR;
  return Number.isFinite(declared) && declared > 0 ? Math.round(declared) : DEFAULT_BEATS_PER_BAR;
};

const strumOf = (song: Song, step: SongStepDef): string => step.strum ?? song.strum;

/** Slowest and fastest a chart may be driven at. Wider than the click's band. */
export const MIN_CHART_BPM = 20;
export const MAX_CHART_BPM = 300;

export const clampChartBpm = (bpm: number): number =>
  Math.min(MAX_CHART_BPM, Math.max(MIN_CHART_BPM, Math.round(bpm)));

/**
 * Lay a chart out at a tempo, or say why it cannot be.
 *
 * The gaps this can return are a subset of the anchored ones: everything about
 * an anchor is gone, so all that is left is a chart with nothing in it. The
 * messages are the anchored engine's own, so a player who meets the empty case
 * reads the same words whichever mode they were in.
 */
export function buildTempoTimeline(song: Song, bpm: number): TimelineResult {
  const sections = song.sections;
  if (!sections.length) return gap('empty', 'This chart has no sections yet.');
  if (!sections.some((s) => s.steps.length)) return gap('empty', 'This chart has no bars yet.');
  for (let i = 0; i < sections.length; i++) {
    if (!sections[i].steps.length) return gap('empty-section', `${sections[i].label} has no bars.`, i);
  }
  if (!(Number.isFinite(bpm) && bpm > 0)) {
    return gap('no-anchors', 'This chart has no tempo to play at yet.');
  }

  const secondsPerBeat = 60 / clampChartBpm(bpm);
  const bars: TimedBar[] = [];
  const timedSections: TimedSection[] = [];
  let beatCursor = 0;

  for (let si = 0; si < sections.length; si++) {
    const section = sections[si];
    const perBar = beatsOf(song, section.beatsPerBar);
    const sectionBeats = section.steps.length * perBar;

    timedSections.push({
      index: si,
      label: section.label,
      startSeconds: beatCursor * secondsPerBeat,
      endSeconds: (beatCursor + sectionBeats) * secondsPerBeat,
      firstBar: bars.length,
      barCount: section.steps.length,
      beatStart: beatCursor,
      beats: sectionBeats,
    });

    for (let bi = 0; bi < section.steps.length; bi++) {
      const step = section.steps[bi];
      const beatStart = beatCursor + bi * perBar;
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
        beatStart,
        startSeconds: beatStart * secondsPerBeat,
        endSeconds: (beatStart + perBar) * secondsPerBeat,
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

/**
 * The tempo a chart opens at, and whose number it is.
 *
 * `source` is the honest part. Only two of the eight built-in songs carried a
 * written tempo before this feature, and a screen that draws a played tempo as a
 * fraction of the record's has to know when there is no record tempo to be a
 * fraction of. It never invents one to make a nicer picture.
 */
export interface SongPace {
  bpm: number;
  source: 'song' | 'practice' | 'chosen';
  /** The song's own tempo, when it has one. Null is not a missing number. */
  fullBpm: number | null;
}

export function songPace(song: Song, plan: TempoPlan | null, chosen?: number): SongPace {
  const full = Number.isFinite(song.bpm) && (song.bpm ?? 0) > 0 ? (song.bpm as number) : null;
  if (chosen !== undefined && Number.isFinite(chosen)) {
    return { bpm: clampChartBpm(chosen), source: 'chosen', fullBpm: full };
  }
  if (full !== null) return { bpm: clampChartBpm(full), source: 'song', fullBpm: full };
  if (plan) return { bpm: clampChartBpm(plan.bpm), source: 'practice', fullBpm: null };
  return { bpm: clampChartBpm(DEFAULT_SONG_BPM), source: 'practice', fullBpm: null };
}

/** A song with no written tempo and no history of its own opens here. */
export const DEFAULT_SONG_BPM = 80;
