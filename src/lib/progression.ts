// Where a learner actually stands, per skill.
//
// The design rule here is that competence is *derived*, never stored. Every
// number comes from the practice logs that already exist, so nothing can go
// stale, nothing needs migrating, and the app can never claim a skill is solid
// on the strength of a flag somebody set once. The only thing written down is a
// self-report for the skills the app admits it cannot measure, and that is
// recorded as a claim rather than as a fact.
//
// Chord competence is read from *change* results rather than from Chord
// Perfect, which stores one total for a whole pool and so cannot say which
// shape earned it. Pair results are per pair, they go back the full history,
// and a pair moving at speed is real evidence for both of its chords.

import type { DailyLog } from '../types';
import { ALL_SKILLS, getSkill, type Skill } from '../data/skills';
import { PAIR_PREFIX, parsePairKey } from './pairs';

export type SkillState = 'locked' | 'ready' | 'working' | 'solid';

/**
 * Why a skill is where it is.
 *
 * A self-report and a measurement are not the same kind of fact, and a display
 * that renders them identically is quietly claiming the app watched something it
 * never heard. Measurement always wins: a claim only counts while there is no
 * evidence, and the moment a drill produces a number the number decides.
 */
export type StandingSource = 'measured' | 'claimed' | 'none';

export interface SkillStanding {
  skill: Skill;
  state: SkillState;
  source: StandingSource;
  /** 0 to 1 toward the bar. 0 when there is no bar to be at. */
  progress: number;
  /** Best evidence found, in this skill's own unit. Null when none. */
  best: number | null;
  unit: string | null;
  /** The bar this skill is judged against, when it has one. */
  bar: number | null;
  /** One sentence naming the evidence, or what is missing. */
  evidence: string;
  /**
   * Prerequisites that genuinely gate this skill: not yet solid, and of a kind
   * the app can actually measure. A prerequisite it cannot measure is advice,
   * not a lock — otherwise "positive finger placement", which needs per-string
   * energy the app does not have, would gate all eight chords forever and the
   * whole course would read as unavailable.
   */
  blockedBy: Skill[];
}

/**
 * Justin's gate for a chord change, and the app's too: thirty clean changes in
 * a minute means the pair is no longer the thing holding you up.
 */
export const CHANGES_BAR = 30;
/** A chord counts as under the hand once a pair using it moves at this rate. */
export const CHORD_BAR = 20;
/** Anchor rotation is a harder motion than a single pair, so the bar is lower. */
export const ROTATION_BAR = 25;
/** Placements in a Chord Perfect block that say the shape is genuinely known. */
export const PLACEMENT_BAR = 30;

export interface Evidence {
  /** Best changes per minute, per pair key. */
  pairs: Map<string, number>;
  /** Best score per task id, for the drills that store one number. */
  tasks: Map<string, number>;
  /** Days on which anything at all was practised. */
  days: number;
}

/** Fold the whole practice history into the few numbers progression needs. */
export function readEvidence(dailyLogs: Record<string, DailyLog>): Evidence {
  const pairs = new Map<string, number>();
  const tasks = new Map<string, number>();
  let days = 0;
  for (const log of Object.values(dailyLogs)) {
    if (log.completedTaskIds?.length || log.drillResults) days += 1;
    for (const [key, value] of Object.entries(log.drillResults ?? {})) {
      const target = key.startsWith(PAIR_PREFIX) ? pairs : tasks;
      target.set(key, Math.max(target.get(key) ?? 0, value));
    }
  }
  return { pairs, tasks, days };
}

/** Best change rate across every pair that used this chord. */
function bestPairFor(chord: string, evidence: Evidence): { rate: number; other: string } | null {
  let best: { rate: number; other: string } | null = null;
  for (const [key, rate] of evidence.pairs) {
    const pair = parsePairKey(key);
    if (!pair) continue;
    if (pair.from !== chord && pair.to !== chord) continue;
    const other = pair.from === chord ? pair.to : pair.from;
    if (!best || rate > best.rate) best = { rate, other };
  }
  return best;
}

function bestPairOverall(evidence: Evidence): { rate: number; from: string; to: string } | null {
  let best: { rate: number; from: string; to: string } | null = null;
  for (const [key, rate] of evidence.pairs) {
    const pair = parsePairKey(key);
    if (!pair) continue;
    if (!best || rate > best.rate) best = { rate, ...pair };
  }
  return best;
}

interface Measurement {
  best: number | null;
  bar: number | null;
  unit: string | null;
  evidence: string;
}

/**
 * What the logs say about one skill.
 *
 * Skills the app cannot measure fall back to the learner's own word, which is
 * why `claimed` is a parameter: for those, saying so is the only evidence there
 * will ever be, and pretending otherwise would be the dishonest option.
 */
function measure(skill: Skill, evidence: Evidence, claimed: boolean): Measurement {
  if (skill.measure.kind === 'known' || skill.measure.kind === 'timed') {
    return {
      best: null,
      bar: null,
      unit: null,
      evidence: claimed
        ? 'You have marked this as done.'
        : skill.measure.kind === 'timed'
          ? 'Time on the instrument is the measure here. Mark it when it feels settled.'
          : 'Nothing to hear. Mark it when you have it.',
    };
  }

  if (skill.measure.kind === 'measurable') {
    return {
      best: null,
      bar: null,
      unit: null,
      evidence: `Not measured yet. ${capitalise(skill.measure.needs)}.`,
    };
  }

  // Measured. Which number counts depends on what the skill is about.
  if (skill.chords?.length === 1) {
    const chord = skill.chords[0];
    const best = bestPairFor(chord, evidence);
    return {
      best: best?.rate ?? null,
      bar: CHORD_BAR,
      unit: 'cpm',
      evidence: best
        ? `Best ${best.rate} changes a minute with ${best.other}.`
        : `No change drill has used ${chord} yet.`,
    };
  }

  if (skill.id === 'chords.grips-review') {
    const covered = (skill.chords ?? []).filter((c) => (bestPairFor(c, evidence)?.rate ?? 0) >= CHORD_BAR);
    return {
      best: covered.length,
      bar: skill.chords?.length ?? 8,
      unit: 'chords',
      evidence: covered.length
        ? `${covered.length} of ${skill.chords?.length} moving at speed: ${covered.join(', ')}.`
        : 'None of the eight are moving at speed yet.',
    };
  }

  if (skill.id === 'technique.anchor-fingers') {
    const best = maxOf(evidence.tasks);
    return {
      best,
      bar: ROTATION_BAR,
      unit: 'changes',
      evidence: best ? `Best ${best} changes in an anchor rotation.` : 'No anchor rotation run yet.',
    };
  }

  if (skill.id === 'setup.tuning') {
    return {
      best: null,
      bar: null,
      unit: null,
      evidence: 'The tuner will tell you. Nothing to track over time.',
    };
  }

  // The change drills.
  const best = bestPairOverall(evidence);
  return {
    best: best?.rate ?? null,
    bar: CHANGES_BAR,
    unit: 'cpm',
    evidence: best
      ? `Best ${best.rate} changes a minute, ${best.from} to ${best.to}.`
      : 'No change drill run yet.',
  };
}

function maxOf(values: Map<string, number>): number | null {
  let best: number | null = null;
  for (const v of values.values()) if (best === null || v > best) best = v;
  return best;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Standings for every skill, resolved together.
 *
 * Done in one pass rather than per skill because a skill's state depends on
 * whether its prerequisites are solid, and answering that per call would either
 * recurse repeatedly or need a cache that could disagree with itself.
 */
export function allStandings(
  dailyLogs: Record<string, DailyLog>,
  claimedSkills: readonly string[] = [],
): SkillStanding[] {
  const evidence = readEvidence(dailyLogs);
  const claimed = new Set(claimedSkills);
  const solid = new Set<string>();
  const partial = new Map<string, Measurement>();
  const source = new Map<string, StandingSource>();

  for (const skill of ALL_SKILLS) {
    const m = measure(skill, evidence, claimed.has(skill.id));
    partial.set(skill.id, m);
    const hasEvidence = m.bar !== null && m.best !== null;
    if (hasEvidence) {
      source.set(skill.id, 'measured');
      if (m.best! >= m.bar!) solid.add(skill.id);
    } else if (claimed.has(skill.id)) {
      source.set(skill.id, 'claimed');
      solid.add(skill.id);
    } else {
      source.set(skill.id, 'none');
    }
  }

  return ALL_SKILLS.map((skill) => {
    const m = partial.get(skill.id)!;
    const blockedBy = skill.requires
      .filter((id) => !solid.has(id))
      .map(getSkill)
      .filter((s): s is Skill => s !== null)
      // Only a skill the app can put a number on is allowed to hold another one
      // back. Anything else is a recommendation, and the taxonomy says so.
      .filter((s) => s.measure.kind === 'measured');

    const progress =
      m.bar !== null && m.best !== null ? Math.min(1, m.best / m.bar) : solid.has(skill.id) ? 1 : 0;

    const state: SkillState = solid.has(skill.id)
      ? 'solid'
      : blockedBy.length
        ? 'locked'
        : m.best !== null && m.best > 0
          ? 'working'
          : 'ready';

    const src = source.get(skill.id)!;
    return {
      skill,
      state,
      source: src,
      progress,
      best: m.best,
      unit: m.unit,
      bar: m.bar,
      // A claim on a skill that *could* be measured has to say so out loud, or
      // "solid" reads as "the app watched you do it".
      evidence:
        src === 'claimed' && skill.measure.kind === 'measured'
          ? `You have said you have this. Nothing measured yet.`
          : m.evidence,
      blockedBy,
    };
  });
}

/**
 * What to work on, best first.
 *
 * Closest to its bar wins. A learner two changes off a gate finishes that this
 * week; one who has never touched a skill is starting from nothing, and putting
 * that at the top of the list is how a plan stops feeling achievable.
 */
export function nextUp(standings: readonly SkillStanding[], count = 5): SkillStanding[] {
  return standings
    .filter((s) => s.state === 'working' || s.state === 'ready')
    .filter((s) => s.skill.measure.kind === 'measured')
    // A skill with no bar has nothing to close the gap on, so putting it on a
    // "work on this" list would be an instruction with no finish line.
    .filter((s) => s.bar !== null)
    .sort((a, b) => {
      if (a.state !== b.state) return a.state === 'working' ? -1 : 1;
      return b.progress - a.progress;
    })
    .slice(0, count);
}

/** Chords the learner has actually proven, for gating anything chord-shaped. */
export function provenChords(standings: readonly SkillStanding[]): string[] {
  return standings
    .filter((s) => s.state === 'solid' && s.skill.family === 'chords' && s.skill.chords?.length === 1)
    .map((s) => s.skill.chords![0]);
}

export interface ModuleStanding {
  module: number;
  skills: SkillStanding[];
  solid: number;
  total: number;
}

/** Standings grouped by the curriculum module that introduces them. */
export function byModule(
  standings: readonly SkillStanding[],
  lessonCodes: readonly string[],
): ModuleStanding[] {
  const modules = new Map<number, SkillStanding[]>();
  for (const standing of standings) {
    for (const code of standing.skill.lessons) {
      if (!lessonCodes.includes(code)) continue;
      const number = Number(code.split('-')[1]?.[0]);
      if (!Number.isFinite(number)) continue;
      const list = modules.get(number) ?? [];
      if (!list.includes(standing)) list.push(standing);
      modules.set(number, list);
      break;
    }
  }
  return [...modules.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([module, skills]) => ({
      module,
      skills,
      solid: skills.filter((s) => s.state === 'solid').length,
      total: skills.length,
    }));
}
