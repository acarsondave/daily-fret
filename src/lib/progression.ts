// Where a learner actually stands, per skill.
//
// The design rule here is that competence is *derived*, never stored. Every
// number comes from the practice logs that already exist, so nothing can go
// stale, nothing needs migrating, and the app can never claim a skill is solid
// on the strength of a flag somebody set once. The only thing written down is a
// self-report for the skills the app admits it cannot measure, and that is
// recorded as a claim rather than as a fact.
//
// What "solid" means is not decided here. lib/readiness.ts owns it: the bar, and
// the three runs running that turn clearing it into a fact about the player.
// This module used to fold the history into a lifetime maximum and call anything
// over the bar solid, which meant one lucky minute on one pair marked a chord
// permanently learned, unlocked what sat behind it, and took it off the list of
// things to work on. The two halves of the app then disagreed out loud: Numbers
// said "1 of 3" while the Journey said the same pair was done. Runs are carried
// through to the rule now, and there is exactly one definition of good enough.
//
// Chord competence is read from *change* results rather than from Chord
// Perfect. Chord Perfect does now say which shape earned what, but it counts
// placements per block and the bar for a chord is a change rate, and folding
// one unit into the other would be inventing a conversion nobody measured. Pair
// results are per pair, they go back the full history, and a pair moving at
// speed is real evidence for both of its chords.

import type { DailyLog } from '../types';
import { ALL_SKILLS, getSkill, type Skill } from '../data/skills';
import { PAIR_PREFIX, parsePairKey } from './pairs';
import { FIND_PREFIX, RING_PREFIX, SWEEP_PREFIX, ratePerMinute } from './drillKeys';
import { baseKey } from './drillWindow';
import {
  CHANGES_BAR,
  CHORD_BAR,
  HELD_RUNS,
  FIND_BAR,
  ROTATION_BAR,
  everHeld,
  readiness,
  type DrillRun,
  type Readiness,
  type ReadinessState,
} from './readiness';

/**
 * - `solid`   clears its bar on the last {@link HELD_RUNS} runs, and still fresh.
 * - `lapsed`  did that, and has not been run since the evidence went cold.
 * - `working` measured, not yet repeatable.
 * - `ready`   nothing measured, and nothing in the way.
 * - `locked`  a prerequisite the app can measure has not been shown yet.
 */
export type SkillState = 'locked' | 'ready' | 'working' | 'solid' | 'lapsed';

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
  /** 0 to 1 toward being solid. 0 when there is no bar to be at. */
  progress: number;
  /** Clearing runs banked, counting back from the latest, out of HELD_RUNS. */
  runs: number;
  /**
   * Cleared its bar {@link HELD_RUNS} runs running at some point, ever.
   *
   * What the course reads to decide what to offer next, and the only sticky fact
   * on this record. `state` is the current answer and can go back down; this one
   * cannot, because a bad session does not un-teach a chord. Nothing that
   * reports competence to the player may read it.
   */
  proven: boolean;
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

// The bars live in lib/readiness.ts, which owns both halves of "good enough":
// what clears the bar, and how many times it has to be cleared before that
// means anything. Re-exported here because this module has been their public
// door since they existed, and a bar is meaningless without the standings that
// read it.
export { CHANGES_BAR, CHORD_BAR, FIND_BAR, ROTATION_BAR };

export interface Evidence {
  /**
   * Every run recorded under each pair key, oldest first, as a per-minute rate.
   *
   * Rates rather than the counts they are stored as, because the bars they are
   * measured against are per minute and a block is not always a minute long. See
   * lib/drillWindow.ts. Runs measured over different windows sit in one series
   * under the key that names the drill, not one series per length.
   */
  pairs: Map<string, DrillRun[]>;
  /**
   * The same, under every other drill key: a shape, a Chord Perfect pool, an
   * anchor ring, and any task id left over from before keys named the drill.
   * Read by prefix, never in bulk, so one drill's numbers can never be taken
   * for another's.
   */
  tasks: Map<string, DrillRun[]>;
  /** Days on which anything at all was practised. */
  days: number;
}

/**
 * Fold the whole practice history into the runs progression reads.
 *
 * Runs, not a lifetime maximum. A maximum answers "what is the best you have
 * ever done", which is a record and belongs on the awards screen; competence is
 * "can you do it again", and no single number can answer that. Keeping the runs
 * is what lets the three-run rule in lib/readiness.ts actually decide anything.
 */
export function readEvidence(dailyLogs: Record<string, DailyLog>): Evidence {
  const pairs = new Map<string, DrillRun[]>();
  const tasks = new Map<string, DrillRun[]>();
  let days = 0;
  // Chronological, because every reader downstream takes ordered runs as a
  // precondition and an object's key order is not a promise about dates.
  const inOrder = Object.values(dailyLogs).sort((a, b) => a.date.localeCompare(b.date));
  for (const log of inOrder) {
    if (log.completedTaskIds?.length || log.drillResults) days += 1;
    for (const [key, value] of Object.entries(log.drillResults ?? {})) {
      // A stored zero is the signature of a run the microphone never heard, and
      // a negative is a bug in whatever wrote it. Neither is a run the player
      // made, and counting either as one would let a blocked mic break a streak.
      if (!Number.isFinite(value) || value <= 0) continue;
      const target = key.startsWith(PAIR_PREFIX) ? pairs : tasks;
      // Bars are per minute, so the runs handed to them are rates, not raw
      // counts. And the window a run was measured over is a property of that
      // run, not of the drill, so every window of one drill folds back onto the
      // key that names the drill: the three-run rule is about the last three
      // times this was played, whatever length each of them ran for.
      const drill = baseKey(key);
      const rate = ratePerMinute(key, value);
      const runs = target.get(drill);
      if (runs) runs.push({ date: log.date, value: rate });
      else target.set(drill, [{ date: log.date, value: rate }]);
    }
  }
  return { pairs, tasks, days };
}

/** Highest value in a series, or null for a series with nothing in it. */
export function bestRun(runs: readonly DrillRun[]): number | null {
  let best: number | null = null;
  for (const run of runs) if (best === null || run.value > best) best = run.value;
  return best;
}

/**
 * Best ever recorded under each drill key, both families in one map.
 *
 * For the awards, which are records of things that happened and are meant to
 * read as a lifetime best. A standing is a claim about today and must never be
 * built from this.
 */
export function lifetimeBests(evidence: Evidence): Map<string, number> {
  const bests = new Map<string, number>();
  for (const source of [evidence.pairs, evidence.tasks]) {
    for (const [key, runs] of source) {
      const best = bestRun(runs);
      if (best !== null) bests.set(key, best);
    }
  }
  return bests;
}

/**
 * One drill's series read against its bar: where it stands today, and whether it
 * has ever stood there.
 */
interface Reading {
  runs: readonly DrillRun[];
  standing: Readiness;
  proven: boolean;
  best: number;
}

function read(runs: readonly DrillRun[], bar: number, today: string): Reading | null {
  const best = bestRun(runs);
  if (best === null) return null;
  return { runs, standing: readiness(runs, bar, today), proven: everHeld(runs, bar), best };
}

/**
 * Which reading speaks for a skill when several drills could.
 *
 * Held first, then lapsed, because a drill that has been held and gone cold is a
 * stronger statement about the player than one part-way through its first
 * streak, and burying it under a fresher but weaker drill would understate what
 * they have done. Ties go to the longer streak, then to the bigger number.
 */
const STATE_RANK: Record<ReadinessState, number> = {
  held: 4,
  lapsed: 3,
  hit: 2,
  working: 1,
  none: 0,
};

function stronger(a: Reading, b: Reading): Reading {
  const byState = STATE_RANK[b.standing.state] - STATE_RANK[a.standing.state];
  if (byState !== 0) return byState < 0 ? a : b;
  if (a.standing.streak !== b.standing.streak) return a.standing.streak > b.standing.streak ? a : b;
  return b.best > a.best ? b : a;
}

/** The pair that speaks best for this chord, and which chord it was paired with. */
function chordReading(
  chord: string,
  evidence: Evidence,
  today: string,
): { reading: Reading; other: string; proven: boolean } | null {
  let best: { reading: Reading; other: string } | null = null;
  // Proven is asked of every pair, not only of the one that speaks: the point of
  // it is that the player has shown the chord somewhere, and the display picking
  // a different pair to talk about must not quietly withdraw that.
  let proven = false;
  for (const [key, runs] of evidence.pairs) {
    const pair = parsePairKey(key);
    if (!pair) continue;
    if (pair.from !== chord && pair.to !== chord) continue;
    const reading = read(runs, CHORD_BAR, today);
    if (!reading) continue;
    proven = proven || reading.proven;
    const other = pair.from === chord ? pair.to : pair.from;
    if (!best || stronger(best.reading, reading) === reading) best = { reading, other };
  }
  return best ? { ...best, proven } : null;
}

/** The same, across every pair the player has ever run. */
function changesReading(
  evidence: Evidence,
  today: string,
): { reading: Reading; from: string; to: string; proven: boolean } | null {
  let best: { reading: Reading; from: string; to: string } | null = null;
  let proven = false;
  for (const [key, runs] of evidence.pairs) {
    const pair = parsePairKey(key);
    if (!pair) continue;
    const reading = read(runs, CHANGES_BAR, today);
    if (!reading) continue;
    proven = proven || reading.proven;
    if (!best || stronger(best.reading, reading) === reading) best = { reading, ...pair };
  }
  return best ? { ...best, proven } : null;
}

interface Measurement {
  best: number | null;
  bar: number | null;
  unit: string | null;
  evidence: string;
  /** Clears the three-run rule as of today. The only thing that means solid. */
  held: boolean;
  /** Has cleared it at least once, ever. What unlocks read. */
  proven: boolean;
  /** Was held, and the evidence has since gone cold. */
  lapsed: boolean;
  /** Clearing runs banked, counting back from the latest. */
  runs: number;
  /** 0 to 1 toward being solid. */
  progress: number;
}

/** A skill with nothing to measure at all: no bar, no state, no progress. */
const unmeasured = (evidence: string): Measurement => ({
  best: null,
  bar: null,
  unit: null,
  evidence,
  held: false,
  proven: false,
  lapsed: false,
  runs: 0,
  progress: 0,
});

/**
 * A measurable skill nobody has run yet.
 *
 * It keeps its bar. The bar belongs to the skill, not to the history: a chord
 * nobody has drilled is still a chord that wants twenty changes a minute, and
 * the Journey draws that as "20 to clear" rather than as a blank. What it has no
 * business carrying is a number, which is why `best` stays null.
 */
const noRuns = (bar: number, unit: string, evidence: string): Measurement => ({
  best: null,
  bar,
  unit,
  evidence,
  held: false,
  proven: false,
  lapsed: false,
  runs: 0,
  progress: 0,
});

/**
 * How far along the three-run rule a drill is: runs banked, plus how close the
 * latest run came to the bar.
 *
 * Only held reaches 1, so a bar drawn from this can never look full beside a
 * skill that is not. A lapsed drill counts as one run short, which is exactly
 * what it takes to bring it back.
 */
function progressToward(reading: Reading, bar: number): number {
  const { state, streak } = reading.standing;
  if (state === 'held') return 1;
  const latest = reading.runs[reading.runs.length - 1]?.value ?? 0;
  const reach = Math.min(1, latest / bar);
  const banked = state === 'lapsed' ? HELD_RUNS - 1 : Math.min(streak, HELD_RUNS - 1);
  return (banked + reach) / (HELD_RUNS + 1);
}

/** A measured skill's standing, from the drill that speaks for it. */
function fromReading(
  reading: Reading,
  bar: number,
  unit: string,
  evidence: string,
  proven: boolean,
): Measurement {
  return {
    best: reading.best,
    bar,
    unit,
    evidence,
    held: reading.standing.state === 'held',
    proven,
    lapsed: reading.standing.state === 'lapsed',
    runs: reading.standing.streak,
    progress: progressToward(reading, bar),
  };
}

/**
 * What the logs say about one skill.
 *
 * Skills the app cannot measure fall back to the learner's own word, which is
 * why `claimed` is a parameter: for those, saying so is the only evidence there
 * will ever be, and pretending otherwise would be the dishonest option.
 */
function measure(skill: Skill, evidence: Evidence, claimed: boolean, today: string): Measurement {
  if (skill.measure.kind === 'known' || skill.measure.kind === 'timed') {
    return unmeasured(
      claimed
        ? 'You have marked this as done.'
        : skill.measure.kind === 'timed'
          ? 'Time on the instrument is the measure here. Mark it when it feels settled.'
          : 'Nothing to hear. Mark it when you have it.',
    );
  }

  if (skill.measure.kind === 'measurable') {
    return unmeasured(`Not measured yet. ${capitalise(skill.measure.needs)}.`);
  }

  // Measured. Which drill counts depends on what the skill is about.
  if (skill.chords?.length === 1) {
    const chord = skill.chords[0];
    const found = chordReading(chord, evidence, today);
    if (!found) return noRuns(CHORD_BAR, 'cpm', `No change drill has used ${chord} yet.`);
    return fromReading(
      found.reading,
      CHORD_BAR,
      'cpm',
      `With ${found.other}: ${found.reading.standing.evidence}`,
      found.proven,
    );
  }

  if (skill.id === 'chords.grips-review') {
    const chords = skill.chords ?? [];
    // Each chord has to be held in its own right, so this counts the same rule
    // eight times rather than inventing a ninth. A review of the grips is
    // exactly the claim that none of them has gone soft.
    const readings = chords.map((c) => ({ chord: c, found: chordReading(c, evidence, today) }));
    const covered = readings.filter((r) => r.found?.reading.standing.state === 'held');
    const provenCount = readings.filter((r) => r.found?.proven).length;
    const bar = chords.length;
    return {
      best: covered.length,
      bar,
      unit: 'chords',
      evidence: covered.length
        ? `${covered.length} of ${bar} held at ${CHORD_BAR} a minute or better: ${covered.map((r) => r.chord).join(', ')}.`
        : `None of the ${bar} are holding at ${CHORD_BAR} a minute yet.`,
      held: covered.length >= bar,
      proven: provenCount >= bar,
      lapsed: false,
      runs: covered.length,
      progress: bar > 0 ? Math.min(1, covered.length / bar) : 0,
    };
  }

  if (skill.id === 'technique.anchor-fingers') {
    // Only a rotation counts. This used to take the best of every task-keyed
    // result there was, which at the time meant Chord Perfect's totals as well,
    // so a good block of placements could carry the anchor skill to solid
    // without a rotation ever having been run. Ring keys name the drill, so the
    // question has an exact answer now.
    //
    // Both prefixes, because the drill changed shape and the practice did not.
    // Rotations used to loop and now sweep back and forth, which is a different
    // enough exercise to deserve its own key and its own personal best; but a
    // player who ran the old loop at the bar really did demonstrate the anchor
    // move, and taking that away would be the app forgetting something true
    // because we renamed something.
    const rotations = runsUnderPrefixes(evidence.tasks, [SWEEP_PREFIX, RING_PREFIX]);
    const reading = read(rotations, ROTATION_BAR, today);
    if (!reading) return noRuns(ROTATION_BAR, 'changes', 'No anchor rotation run yet.');
    return fromReading(
      reading,
      ROTATION_BAR,
      'changes',
      `Anchor rotation: ${reading.standing.evidence}`,
      reading.proven,
    );
  }

  if (skill.id === 'theory.note-names') {
    // Only the note finder speaks for this. Without the branch the fall-through
    // below would report the note names from a chord-change rate, which is a
    // number about a different hand doing a different thing.
    const finds = runsUnderPrefixes(evidence.tasks, [FIND_PREFIX]);
    const reading = read(finds, FIND_BAR, today);
    if (!reading) return noRuns(FIND_BAR, 'finds/min', 'No note find run yet.');
    return fromReading(
      reading,
      FIND_BAR,
      'finds/min',
      `Note finder: ${reading.standing.evidence}`,
      reading.proven,
    );
  }

  // The change drills.
  const found = changesReading(evidence, today);
  if (!found) return noRuns(CHANGES_BAR, 'cpm', 'No change drill run yet.');
  return fromReading(
    found.reading,
    CHANGES_BAR,
    'cpm',
    `${found.from} to ${found.to}: ${found.reading.standing.evidence}`,
    found.proven,
  );
}

/**
 * Every run under any of these prefixes, as one series in date order.
 *
 * Two runs of the same drill on one day collapse to the better of them, which is
 * what the practice log does already; what must not happen is one day producing
 * two entries in a series the three-run rule counts, because that would let a
 * single session bank two thirds of a streak.
 */
function runsUnderPrefixes(
  values: Map<string, DrillRun[]>,
  prefixes: readonly string[],
): DrillRun[] {
  const byDate = new Map<string, number>();
  for (const [key, runs] of values) {
    if (!prefixes.some((p) => key.startsWith(p))) continue;
    for (const run of runs) {
      const seen = byDate.get(run.date);
      if (seen === undefined || run.value > seen) byDate.set(run.date, run.value);
    }
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, value }));
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
  today: string,
  claimedSkills: readonly string[] = [],
): SkillStanding[] {
  const evidence = readEvidence(dailyLogs);
  const claimed = new Set(claimedSkills);
  const solid = new Set<string>();
  const proven = new Set<string>();
  const partial = new Map<string, Measurement>();
  const source = new Map<string, StandingSource>();

  for (const skill of ALL_SKILLS) {
    const m = measure(skill, evidence, claimed.has(skill.id), today);
    partial.set(skill.id, m);
    const hasEvidence = m.bar !== null && m.best !== null;
    if (hasEvidence) {
      source.set(skill.id, 'measured');
      if (m.held) solid.add(skill.id);
      if (m.proven) proven.add(skill.id);
    } else if (claimed.has(skill.id)) {
      source.set(skill.id, 'claimed');
      solid.add(skill.id);
      // A claim is the only evidence these skills will ever have, so it has to
      // open the same doors a measurement would. It is still marked as a claim.
      proven.add(skill.id);
    } else {
      source.set(skill.id, 'none');
    }
  }

  return ALL_SKILLS.map((skill) => {
    const m = partial.get(skill.id)!;
    const blockedBy = skill.requires
      // Locks read `proven` rather than `solid`: what is being decided is
      // whether the player has seen enough to start this, and that does not
      // become untrue after one bad session or a fortnight off. Their standing
      // on the prerequisite still says so on its own row.
      .filter((id) => !proven.has(id))
      .map(getSkill)
      .filter((s): s is Skill => s !== null)
      // Only a skill the app can put a number on is allowed to hold another one
      // back. Anything else is a recommendation, and the taxonomy says so.
      .filter((s) => s.measure.kind === 'measured');

    const hasEvidence = m.bar !== null && m.best !== null;
    const progress = hasEvidence ? m.progress : solid.has(skill.id) ? 1 : 0;

    const state: SkillState = solid.has(skill.id)
      ? 'solid'
      : m.lapsed
        ? 'lapsed'
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
      runs: m.runs,
      proven: proven.has(skill.id),
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
 * Closest to done wins, and done means the three-run rule, not one good result.
 * A learner with two runs banked finishes that this week; one who has never
 * touched a skill is starting from nothing, and putting that at the top of the
 * list is how a plan stops feeling achievable.
 *
 * Lapsed skills belong here and near the top: one run brings them back, which is
 * the cheapest real progress available on the whole list.
 */
export function nextUp(standings: readonly SkillStanding[], count = 5): SkillStanding[] {
  return standings
    .filter((s) => s.state === 'working' || s.state === 'ready' || s.state === 'lapsed')
    .filter((s) => s.skill.measure.kind === 'measured')
    // A skill with no bar has nothing to close the gap on, so putting it on a
    // "work on this" list would be an instruction with no finish line.
    .filter((s) => s.bar !== null)
    .sort((a, b) => {
      const started = (s: SkillStanding) => (s.state === 'ready' ? 1 : 0);
      if (started(a) !== started(b)) return started(a) - started(b);
      return b.progress - a.progress;
    })
    .slice(0, count);
}

/**
 * Chords the learner has actually proven, for gating anything chord-shaped.
 *
 * Reads `proven`, so a chord held three runs running in July still counts in
 * September. What this gates is offers, and the cost of the two mistakes is not
 * symmetric: handing someone a song they cannot play is worse than not offering
 * one, but so is taking back a song they could play last week because they have
 * been drilling something else.
 */
export function provenChords(standings: readonly SkillStanding[]): string[] {
  return standings
    .filter((s) => s.proven && s.skill.family === 'chords' && s.skill.chords?.length === 1)
    .map((s) => s.skill.chords![0]);
}

// byModule used to live here, grouping standings by reading the first digit of a
// lesson code's suffix. That is not where a module number lives: it made module 0
// unreachable, so its five setup skills were filed under module 1, it put every
// BG-15xx lesson there too, and it grouped Grade 3 into nothing at all. The
// Journey resolves membership through the curriculum now, which is the only
// thing that knows. Nothing should reintroduce a parse of the code.
