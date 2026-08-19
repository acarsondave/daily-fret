// Everything the summary screen shows, worked out on the screen before it.
//
// The split is the point. This module pulls the beginner curriculum and the song
// catalogue; the summary screen pulls neither. It runs once, on a tap, between
// two screens, and hands over plain data (./plan.ts).

import type { Routine, Task } from '../../types';
import { SONGS, type Song } from '../../data/songs';
import { songsOneShapeAway } from '../../lib/songCatalog';
import { HEARABLE_CHORDS, buildRoutine, routineMinutes, taskMinutes } from './course';
import type { FirstRunPlan, PlanSong, PlanTask } from './plan';

const asPlanSong = (song: Song): PlanSong => ({
  title: song.title,
  artist: song.artist,
  chords: song.chords,
});

/** Shapes a block plays, in the order the drill will ask for them. */
function chordsOf(task: Task): string[] {
  const drill = task.drill;
  if (!drill) return [];
  if (drill.chords?.length) return drill.chords;
  if (!drill.pairs?.length) return [];
  const seen = new Set<string>();
  for (const pair of drill.pairs) {
    seen.add(pair.from);
    seen.add(pair.to);
  }
  return [...seen];
}

/**
 * How late in the course a shape is taught. The horizon reads it so the shape it
 * points at is the next one the player was going to meet anyway, rather than
 * whichever chart happens to sit first in the catalogue.
 */
const teachingRank = (chord: string): number => {
  const at = HEARABLE_CHORDS.indexOf(chord);
  return at === -1 ? HEARABLE_CHORDS.length : at;
};

/**
 * The chart standing one shape away, and the shape.
 *
 * Ranked by how soon the course teaches the missing shape, then by whether the
 * catalogue has a recording for the chart, then by the richer chart. Shapes the
 * detector cannot hear are excluded: pointing at a chord no drill will ever
 * count would be an offer the rest of the app cannot honour.
 */
function pickHorizon(vocabulary: string[]): { song: PlanSong; missing: string } | null {
  const near = songsOneShapeAway(SONGS, vocabulary).filter((n) =>
    HEARABLE_CHORDS.includes(n.missing),
  );
  if (!near.length) return null;
  const rank = (n: (typeof near)[number]): number[] => [
    teachingRank(n.missing),
    n.song.youtubeId ? 0 : 1,
    -n.song.chords.length,
  ];
  const best = [...near].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return 0;
  })[0];
  return { song: asPlanSong(best.song), missing: best.missing };
}

function planTask(task: Task): PlanTask {
  const song = task.drill?.kind === 'song' ? SONGS.find((s) => s.id === task.drill?.songId) : undefined;
  return {
    id: task.id,
    title: task.title,
    minutes: taskMinutes(task),
    // A play-along is a drill and is not a measurement. The app records nothing
    // from it on purpose, so calling it counted here would put a claim on the
    // one block of the session that never produces a number.
    counted: Boolean(task.drill) && task.drill?.kind !== 'song',
    chords: song ? song.chords : chordsOf(task),
    song: song ? asPlanSong(song) : null,
  };
}

export interface PlanInput {
  /** Curriculum course code the derived module belongs to, or null. */
  track: string | null;
  module: number | null;
  knownChords: string[];
  lessonCode: string | null;
}

export function buildFirstRunPlan(input: PlanInput): FirstRunPlan {
  const routine: Routine = buildRoutine({
    track: input.track,
    module: input.module,
    knownChords: input.knownChords,
  });
  const tasks = routine.tasks.map(planTask);
  return {
    routine,
    minutes: routineMinutes(routine),
    measured: tasks.filter((t) => t.counted).length,
    lessonCode: input.lessonCode,
    tasks,
    horizon: pickHorizon(routine.chords ?? []),
  };
}
