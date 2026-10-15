// A module's routine update, as data and one pure function.
//
// The owner's routine is a living one, not one routine per module. When he
// moves on, four things happen to it: the new module's material comes in, the
// weaknesses his own numbers show carry over, what he is still consolidating
// stays, and what he has outgrown goes. This file states one module's update as
// data (MODULE_6) and applies any such update to a routine (planModuleUpdate),
// so Module 7 is a new constant rather than new code.
//
// Rules it keeps, all of them the owner's:
// - Nothing he wrote himself and that the update does not name is touched.
// - Kept tasks keep their ids, so every result filed under them still counts.
// - Results are never edited here. A removed task's history stays in the days
//   it was earned on; Progress already shows it as "a drill since removed".
// - Applying an update twice is applying it once.

import type { DailyLog, DrillConfig, Routine, Task, TaskSource } from '../types';
import { SIX_EIGHT_PATTERNS } from '../data/strumPatterns';
import { pairKey } from './pairs';
import { keyDrillHistory } from './drillStats';
import { CHANGES_BAR } from './readiness';

/** One task a module adds, with a fixed id so a second application finds it. */
export interface ModuleTask {
  task: Task;
  source: TaskSource;
  /** Where in the session it sits. Lower runs earlier. */
  slot: Slot;
}

/** The parts of a session, in the order a session runs them. */
export type Slot = 'hands' | 'picking' | 'chords' | 'changes' | 'rhythm' | 'theory' | 'other' | 'riffs' | 'songs';
const SLOT_ORDER: Slot[] = ['hands', 'picking', 'chords', 'changes', 'rhythm', 'theory', 'other', 'riffs', 'songs'];

export interface ModulePlan {
  /** Stored on the routine and in the account's record of updates. */
  id: string;
  module: number;
  name: string;
  /** The lesson that opens the module before this one: a player past it is offered the update. */
  offeredFrom: string;
  /** The module's last lesson, which accepting marks as reached. */
  lastLesson: string;
  /** A chord taken out of every drill that asks for it. */
  dropChords: string[];
  /** Riffs that stay. Every other riff goes. */
  keepRiffs: RegExp[];
  /** Song ids that stay or come in. Every other song goes. */
  songs: string[];
  /** Chords that join the routine's working vocabulary. */
  addChords: string[];
  /** Chords the owner named as weak; the history is searched for their worst change. */
  weakChords: string[];
  add: ModuleTask[];
  /**
   * Set on a revision: the id of the update whose routine this one corrects.
   *
   * A revision is narrow on purpose. The routine it meets has been practised
   * from, and maybe edited, since its module update was accepted, so re-running
   * the whole update would undo the player's own changes. A revision swaps only
   * what it names and leaves the name, the module receipt, the chords and every
   * other task exactly as they are.
   */
  revises?: string;
  /** Song tasks a revision replaces one for one, in place. `to` is added from `add`. */
  swapSongs?: { from: string; to: string }[];
}

const drill = (config: DrillConfig): DrillConfig => config;

const M6_STAND_BY_ME: Task = {
  id: 'm6-stand-by-me',
  title: 'Song: Stand By Me',
  drill: drill({ kind: 'song', songId: 'stand-by-me' }),
};

export const MODULE_6: ModulePlan = {
  id: 'bg1-m6',
  module: 6,
  name: 'Module 6 \u00b7 G, 6/8 & picking',
  offeredFrom: 'b1-501',
  lastLesson: 'b1-608',
  dropChords: ['Dm'],
  keepRiffs: [/come as you are/i, /sunshine/i],
  // Stand By Me replaced This Year's Love on 2026-10-15, at the owner's request.
  songs: ['fade-into-you', 'stand-by-me'],
  addChords: ['G'],
  weakChords: ['D'],
  // Justin's B1-608 twenty minutes, with his blanks filled from the owner's own
  // numbers: "Perfect Chord You Struggle" is D, and "OMC C to D (or most
  // challenging one)" gains the weakest D change the history holds.
  add: [
    {
      slot: 'picking',
      source: 'module',
      task: {
        id: 'm6-alternate-picking',
        title: 'Alternate Picking',
        drill: drill({ kind: 'alternate-picking', durationSec: 60, bpm: 90 }),
      },
    },
    {
      slot: 'chords',
      source: 'module',
      task: {
        id: 'm6-g-perfect',
        title: 'G Chord Perfect',
        description: 'Two-finger G first. Three-finger alternative: add finger 1 on string 5, fret 2.',
        drill: drill({ kind: 'chord-trainer', chords: ['G'], durationSec: 120 }),
      },
    },
    {
      slot: 'chords',
      source: 'carry',
      task: {
        id: 'm6-d-perfect',
        title: 'D Chord Perfect',
        drill: drill({ kind: 'chord-trainer', chords: ['D'], durationSec: 60 }),
      },
    },
    {
      slot: 'changes',
      source: 'module',
      task: {
        id: 'm6-changes',
        title: 'Module 6 Changes',
        drill: drill({
          kind: 'one-minute-changes',
          chords: ['G', 'C', 'D'],
          pairs: [
            { from: 'G', to: 'C' },
            { from: 'G', to: 'D' },
            { from: 'C', to: 'D' },
          ],
          durationSec: 60,
        }),
      },
    },
    {
      slot: 'rhythm',
      source: 'module',
      task: {
        id: 'm6-six-eight',
        title: '6/8 Strumming',
        // Under the 6/8 pattern's grading ceiling (about 127 on the eighth
        // click), so the app can hear every stroke it asks for.
        drill: drill({
          kind: 'strum-pattern',
          durationSec: 120,
          bpm: 110,
          patterns: SIX_EIGHT_PATTERNS.map((p) => p.pattern),
        }),
      },
    },
    {
      slot: 'theory',
      source: 'module',
      task: { id: 'm6-note-finder', title: 'Note Finder', drill: drill({ kind: 'note-finder', durationSec: 60 }) },
    },
    {
      slot: 'songs',
      source: 'module',
      task: { id: 'm6-fade-into-you', title: 'Song: Fade Into You', drill: drill({ kind: 'song', songId: 'fade-into-you' }) },
    },
    {
      slot: 'songs',
      source: 'module',
      task: M6_STAND_BY_ME,
    },
  ],
};

/**
 * Stand By Me for a routine that already took Module 6 with This Year's Love.
 *
 * Offered, previewed and undone like any module update, and only to a routine
 * carrying the first Module 6 receipt. A Module 5 routine gets Stand By Me from
 * MODULE_6 itself and never sees this.
 */
export const MODULE_6_SONGS: ModulePlan = {
  id: 'bg1-m6-songs',
  module: 6,
  name: MODULE_6.name,
  offeredFrom: MODULE_6.offeredFrom,
  lastLesson: MODULE_6.lastLesson,
  dropChords: [],
  keepRiffs: [],
  songs: MODULE_6.songs,
  addChords: [],
  weakChords: [],
  add: [{ slot: 'songs', source: 'module', task: M6_STAND_BY_ME }],
  revises: MODULE_6.id,
  swapSongs: [{ from: 'this-years-love', to: 'stand-by-me' }],
};

export interface ModuleChanges {
  removed: { task: Task; reason: string }[];
  /** Kept, with something taken out of it. */
  edited: { task: Task; what: string }[];
  added: { task: Task; source: TaskSource }[];
  kept: Task[];
}

const FINGER = /spider|stretch|finger|bateman|push-?up/i;
const RIFF = /riff|seven nation|smoke on the water|iron man|sunshine|come as you are|wild thing riff/i;
const SONG_TITLE = /^song\b/i;

function slotOf(task: Task): Slot {
  const kind = task.drill?.kind;
  if (kind === 'alternate-picking') return 'picking';
  if (kind === 'chord-trainer') return 'chords';
  if (kind === 'one-minute-changes' || kind === 'chord-rotation') return 'changes';
  if (kind === 'strum-pattern' || kind === 'strum-timing') return 'rhythm';
  if (kind === 'note-finder') return 'theory';
  if (kind === 'song' || SONG_TITLE.test(task.title)) return 'songs';
  if (RIFF.test(task.title)) return 'riffs';
  if (FINGER.test(task.title)) return 'hands';
  return 'other';
}

/** The weakest change into or out of a weak chord, read from the player's own runs. */
function weakestPair(
  logs: Record<string, DailyLog>,
  chords: readonly string[],
  skip: readonly string[],
  dropped: readonly string[],
): { from: string; to: string } | null {
  const seen = new Set<string>();
  for (const log of Object.values(logs ?? {})) {
    for (const key of Object.keys(log.drillResults ?? {})) {
      if (key.startsWith('pair:')) seen.add(key.split('@')[0]);
    }
  }
  let worst: { from: string; to: string; latest: number } | null = null;
  for (const key of seen) {
    const [a, b] = key.slice('pair:'.length).split('|');
    if (!a || !b || !chords.some((c) => c === a || c === b)) continue;
    if (dropped.includes(a) || dropped.includes(b)) continue;
    if (skip.includes(pairKey(a, b))) continue;
    const series = keyDrillHistory(logs, key).series.filter((v) => v > 0);
    if (!series.length) continue;
    const latest = series[series.length - 1];
    if (latest >= CHANGES_BAR) continue;
    if (!worst || latest < worst.latest) worst = { from: a, to: b, latest };
  }
  return worst ? { from: worst.from, to: worst.to } : null;
}

/**
 * The routine a module update turns this one into, and what it did.
 *
 * Pure: the caller decides whether to store it, which is what lets the update
 * be previewed in full before the player accepts anything.
 */
export function planModuleUpdate(
  routine: Routine,
  plan: ModulePlan,
  logs: Record<string, DailyLog>,
): { routine: Routine; changes: ModuleChanges } {
  if (plan.revises) return planRevision(routine, plan);
  const changes: ModuleChanges = { removed: [], edited: [], added: [], kept: [] };
  // The store splits added tasks into derived ids. The version, not presence
  // of the unsplit parent ids, is the application receipt. Never rebuild an
  // accepted version or overwrite the player's later edits on replay.
  if (routine.module === plan.id) return { routine, changes: { ...changes, kept: routine.tasks } };
  const dropped = new Set(plan.dropChords);
  const ownIds = new Set(plan.add.map((a) => a.task.id));
  const survivors: Task[] = [];

  for (const task of routine.tasks) {
    if (ownIds.has(task.id)) {
      survivors.push(task);
      continue;
    }
    const kind = task.drill?.kind;
    const slot = slotOf(task);

    if (slot === 'songs') {
      if (kind === 'song' && task.drill?.songId && plan.songs.includes(task.drill.songId)) {
        survivors.push(task);
        changes.kept.push(task);
      } else {
        changes.removed.push({ task, reason: 'song' });
      }
      continue;
    }
    if (slot === 'riffs') {
      if (plan.keepRiffs.some((re) => re.test(task.title))) {
        survivors.push(task);
        changes.kept.push(task);
      } else {
        changes.removed.push({ task, reason: 'riff' });
      }
      continue;
    }
    if (kind === 'chord-rotation' && task.drill?.chords?.some((c) => dropped.has(c))) {
      // A ring is its chords. Taking one out would make it a different drill
      // under the same name, so it goes whole.
      changes.removed.push({ task, reason: 'chord' });
      continue;
    }
    if (kind === 'chord-trainer' && task.drill?.chords?.some((c) => dropped.has(c))) {
      const chords = task.drill.chords.filter((c) => !dropped.has(c));
      if (!chords.length) {
        changes.removed.push({ task, reason: 'chord' });
        continue;
      }
      const next = { ...task, drill: { ...task.drill, chords } };
      survivors.push(next);
      changes.edited.push({ task: next, what: [...dropped].join(' ') });
      continue;
    }
    if (kind === 'one-minute-changes') {
      const pairs = task.drill?.pairs;
      if (pairs?.some((p) => dropped.has(p.from) || dropped.has(p.to))) {
        const kept = pairs.filter((p) => !dropped.has(p.from) && !dropped.has(p.to));
        if (!kept.length) {
          changes.removed.push({ task, reason: 'chord' });
          continue;
        }
        const chords = task.drill?.chords?.filter((c) => !dropped.has(c));
        const next = { ...task, drill: { ...task.drill!, pairs: kept, ...(chords ? { chords } : {}) } };
        survivors.push(next);
        changes.edited.push({ task: next, what: [...dropped].join(' ') });
        continue;
      }
    }
    survivors.push(task);
    changes.kept.push(task);
  }

  // The new material, with the carried weakness filled in from the history.
  const present = new Set(survivors.map((t) => t.id));
  const additions: { task: Task; slot: Slot }[] = [];
  for (const entry of plan.add) {
    if (present.has(entry.task.id)) continue;
    let task: Task = { ...entry.task, source: entry.source };
    if (task.drill?.kind === 'one-minute-changes' && task.drill.pairs) {
      const listed = task.drill.pairs.map((p) => pairKey(p.from, p.to));
      const weak = weakestPair(logs, plan.weakChords, listed, plan.dropChords);
      if (weak) {
        const chords = [...new Set([...(task.drill.chords ?? []), weak.from, weak.to])];
        task = { ...task, drill: { ...task.drill, pairs: [...task.drill.pairs, weak], chords } };
      }
    }
    additions.push({ task, slot: entry.slot });
    changes.added.push({ task, source: entry.source });
  }

  // Lay the session out in the order a session runs. Within a part the new
  // material leads, except where something has to come before it (the finger
  // warm-up before picking is its own part), and everything kept stays in the
  // order the player had it.
  const tasks: Task[] = [];
  for (const slot of SLOT_ORDER) {
    tasks.push(...additions.filter((a) => a.slot === slot).map((a) => a.task));
    tasks.push(...survivors.filter((t) => slotOf(t) === slot));
  }

  const chords = [...new Set([...(routine.chords ?? []), ...plan.addChords])];
  return {
    routine: { ...routine, name: plan.name, module: plan.id, chords, tasks },
    changes,
  };
}

const songOf = (task: Task): string | undefined =>
  task.drill?.kind === 'song' ? task.drill.songId : undefined;

/**
 * A revision applied to the routine its update left behind.
 *
 * Only routines carrying the revised update's receipt are touched. Each named
 * song task is replaced where it stands, so the session keeps its order; if the
 * player removed it already, the new song joins after the last song. A song he
 * added himself is never doubled. Nothing to change returns the routine itself.
 */
function planRevision(routine: Routine, plan: ModulePlan): { routine: Routine; changes: ModuleChanges } {
  const changes: ModuleChanges = { removed: [], edited: [], added: [], kept: [] };
  const unchanged = { routine, changes: { ...changes, kept: routine.tasks } };
  if (routine.module !== plan.revises) return unchanged;

  let tasks = [...routine.tasks];
  for (const swap of plan.swapSongs ?? []) {
    const entry = plan.add.find((a) => a.task.drill?.kind === 'song' && a.task.drill.songId === swap.to);
    const incoming: Task | null = entry ? { ...entry.task, source: entry.source } : null;
    let needed = !!incoming && !tasks.some((t) => songOf(t) === swap.to);
    const next: Task[] = [];
    for (const task of tasks) {
      if (songOf(task) !== swap.from) {
        next.push(task);
        continue;
      }
      changes.removed.push({ task, reason: 'song' });
      if (needed && incoming) {
        next.push(incoming);
        changes.added.push({ task: incoming, source: entry!.source });
        needed = false;
      }
    }
    if (needed && incoming) {
      const lastSong = next.reduce((at, t, i) => (slotOf(t) === 'songs' ? i : at), -1);
      next.splice(lastSong + 1 || next.length, 0, incoming);
      changes.added.push({ task: incoming, source: entry!.source });
    }
    tasks = next;
  }

  if (!changes.added.length && !changes.removed.length) return unchanged;
  const touched = new Set([...changes.added.map((a) => a.task), ...changes.removed.map((r) => r.task)]);
  changes.kept = tasks.filter((t) => !touched.has(t));
  return { routine: { ...routine, tasks }, changes };
}

/** A lesson code as a number that orders the course: b1-608 is 1608. */
export function lessonOrder(code: string | null | undefined): number {
  const m = /^b(\d)-(\d{3})$/i.exec(code ?? '');
  return m ? Number(m[1]) * 1000 + Number(m[2]) : 0;
}

export interface ModuleUpdateRecord {
  outcome: 'accepted' | 'snoozed' | 'undone';
  at: number;
  /** Snoozed until. */
  until?: number;
  /** The routine as it stood before an accepted update, kept so it can be put back. */
  previous?: Routine;
}

interface AccountLike {
  routines: Routine[];
  activeRoutineId: string;
  currentLesson?: string;
  moduleUpdates?: Record<string, ModuleUpdateRecord>;
}

/** The routine an update applies to: the one the player is practising from. */
export function updateTarget(acc: AccountLike): Routine | undefined {
  return acc.routines.find((r) => r.id === acc.activeRoutineId) ?? acc.routines[0];
}

/** Whether to offer this update now. */
export function moduleUpdateDue(acc: AccountLike, plan: ModulePlan, now: number): boolean {
  const record = acc.moduleUpdates?.[plan.id];
  if (record?.outcome === 'accepted') return false;
  if (record?.outcome === 'snoozed' && (record.until ?? 0) > now) return false;
  const routine = updateTarget(acc);
  if (plan.revises) {
    // Due exactly when it would change something: a routine already carrying
    // the new song, or not on the revised update at all, has nothing to see.
    if (!routine) return false;
    const { changes } = planRevision(routine, plan);
    return changes.added.length + changes.removed.length > 0;
  }
  if (!routine || routine.module === plan.id) return false;
  const reached = lessonOrder(acc.currentLesson) >= lessonOrder(plan.offeredFrom);
  const named = new RegExp(`module\\s*${plan.module - 1}\\b`, 'i').test(routine.name);
  return reached || named;
}
