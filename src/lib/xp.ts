// Points, levels and standing, all derived from the practice logs.
//
// Nothing here is stored. That is the same rule the progression model follows
// and it matters more here, not less: a stored points total is a number that can
// drift from what someone actually did, and the first time it disagrees with the
// logs the whole thing becomes decoration. Derived, it is always exactly the
// history, it replays identically on any device, and a leaderboard would sum the
// same function rather than trusting a counter.
//
// ## What a point is
//
// **One point is about one minute of practice the app can stand behind.**
//
// Everything is denominated in that. A drill run costs its minute plus the
// announcement, the count-in and the rest around it, so a run pays three. A
// timed block pays the minutes the clock actually ran. A session off the routine
// builder comes to about thirty, which is about what it takes.
//
// Anchoring the point to a minute is what stops the total inflating: minutes are
// bounded by the day, so five years of daily practice lands in the tens of
// thousands rather than the millions, and the number stays legible to someone
// reading it in 2031 without knowing the formula. Levels are generous and
// unbounded (see `LEVEL_COST` below), but that generosity lives entirely in the
// mapping from points to levels. The points themselves stay honest.
//
// ## Doing the work is what earns
//
// A run is worth a **base for having done it, plus modifiers for what the app
// can honestly say about the run itself**. The reference point is the run, never
// the player's history: being slower than your own best is a bad day and costs
// nothing, because a rough day is still a day at the guitar.
//
// One modifier exists today, and it is the one the signal supports: **how many
// repetitions the app counted**. More clean changes, placements or rotations is
// more work, and it is measured rather than inferred. It is concave and capped
// at the size of the base, so a hard new pair that yields eight changes still
// earns most of what an easy one yielding fifty does, and there is never a
// reason to duck the hard drill.
//
// Nothing subtracts. That is a statement about the evidence, not a decision to
// be lenient. The three drills all discard a detection that is not the chord
// they asked for (see `handleChord` in OneMinuteChanges, ChordRotation, and
// `onFrame` in ChordTrainer): a wrong shape is not counted, not stored, and not
// distinguishable from the chromagram passing through an ambiguous state
// mid-transition. `DrillRun` carries a value and a timestamp and nothing else.
// So the app cannot presently tell a fumble from a transition, a buzzing string
// from a clean one, or an early finish from a short run, and a deduction built
// on any of those would be the product asserting something about the player's
// technique that it did not hear. `RUN_FLOOR` is the promise that holds when one
// of them does become real: whatever the modifiers come to, a run the app heard
// is never worth less than that.
//
// Beating a personal best adds one modest bonus on the day it happens, as
// recognition. It is deliberately flat and deliberately once a day: an economy
// where the payout tracks the margin over your best turns every session into a
// comparison with your best session, which is not what practice is for, and it
// goes quiet through the plateaus that make up most of learning an instrument.
//
// ## What the app can and cannot hear
//
// Three kinds of evidence, credited differently because they are different:
//
// - **Heard.** The microphone counted something. Full rate, per run.
// - **Timed.** A timer for the task ran inside the app. The clock is real
//   evidence of time spent even though it says nothing about what was played, so
//   it pays the minutes it witnessed. Part-finished blocks pay too: the minutes
//   happened.
// - **Stated.** The player said so. Paid, because refusing would teach them to
//   skip everything the app cannot hear, but paid least.
//
// Timed and stated work together may **match what the microphone heard and never
// exceed it**. Someone practising properly never touches that ceiling. Someone
// starting timers and walking away earns nothing, which is the property this has
// to have.

import type { DailyLog, TaskRecord } from '../types';
import { runsFor } from '../store/completion';

/** One run of a drill the app heard, whatever the number was. */
const RUN_POINTS = 3;
/**
 * The least a run the app heard can ever be worth.
 *
 * No modifier today can push a run below its base, so this does not bind yet. It
 * is here because the first one that can must not be able to make showing up
 * worthless, and a floor written after the fact is a floor nobody trusts.
 */
const RUN_FLOOR = 2;
/**
 * Repetitions counted in the run, concave and capped at the base.
 *
 * Concave so that the difference between a hard drill and an easy one stays
 * small: eight changes earns forty percent of what fifty does rather than
 * sixteen percent, which is what stops this being a reason to practise the easy
 * pair. Capped below the base so a modifier adjusts a run and never becomes the
 * thing the economy is made of.
 */
const REPS_SCALE = 0.3;
const REPS_MAX = 2;
/**
 * Repeating one drill pays, but under the root rather than in a line.
 *
 * Four runs of a pair is more work than one and should pay more. Twenty runs of
 * the easiest pair is not four times the practice of a varied session and must
 * not pay like it, or the best strategy becomes grinding one drill.
 */
const repeatDamping = (runs: number) => Math.sqrt(runs) / runs;
/**
 * Beating a personal best, once a day however many fell.
 *
 * Small on purpose, and the size is not arbitrary. With no penalty for a low
 * number, the one strategy worth checking is starting deliberately low and
 * inching up, which collects this bonus every day where playing at your ceiling
 * collects it rarely. At this size a month of that pays under a tenth more than
 * a month of real practice, and costs the player every rep they did not do.
 */
const BEST_DAY_BONUS = 3;
/** A minute the app's own timer witnessed. */
const TIMED_PER_MINUTE = 1;
/** Ceiling per task per day, so a timer left running is bounded. */
const TIMED_TASK_CAP = 10;
/** A completion resting on the player's word. */
const STATED_POINTS = 2;
const STATED_DAY_CAP = 6;
/** What the app did not hear may match what it heard, never exceed it. */
const UNHEARD_SHARE = 1;
/**
 * Each day beyond the second in a row, capped low on purpose.
 *
 * The app tells you to rest after six days (see `restAdvice`), so a streak bonus
 * big enough to argue with that advice would make the product contradict itself.
 * At this size the rest day costs less than a fifth of a session.
 */
const STREAK_POINTS = 1;
const MAX_STREAK_BONUS = 5;
/**
 * Diminishing returns inside a day: full rate to the length of a real session,
 * half to twice that, then a shallow tail.
 *
 * The tail is deliberately not a wall. A hard ceiling would tell someone who
 * genuinely practised for two hours that their last hour was worth nothing,
 * which is a different kind of lie. The marginal rate never reaches zero, so
 * there is never a moment where the points say stop.
 */
const DAY_FULL_UP_TO = 45;
const DAY_HALF_UP_TO = 90;
const DAY_HALF_RATE = 0.5;
const DAY_TAIL_RATE = 0.2;

/**
 * What one run of a drill is worth, split into the base and what the modifiers
 * came to.
 *
 * Split rather than summed because the panel shows both, and a breakdown that
 * does not reconcile with the total is worse than no breakdown. If a modifier
 * ever drives the run down to `RUN_FLOOR`, the base absorbs the reduction and
 * the modifier line goes to zero rather than negative, so the learner never
 * reads a line that says their playing was worth less than nothing.
 */
export interface RunCredit {
  base: number;
  reps: number;
}

export function runCredit(value: number): RunCredit {
  const reps = Math.min(REPS_MAX, REPS_SCALE * Math.sqrt(Math.max(0, value)));
  const total = Math.max(RUN_FLOOR, RUN_POINTS + reps);
  return { base: Math.min(RUN_POINTS, total), reps: Math.max(0, total - RUN_POINTS) };
}

/**
 * Credited points by where they came from. The six always sum to the total,
 * which is the property that lets the panel show the learner a breakdown rather
 * than a score. Nothing may be added here that does not add up.
 */
export interface XpSource {
  /** Base credit for runs of a drill the app heard. */
  heard: number;
  /** What the modifiers on those runs came to. */
  reps: number;
  /** Minutes a timer inside the app witnessed. */
  timed: number;
  /** The bonus for a personal best. */
  bests: number;
  /** Consecutive days. */
  streak: number;
  /** Completions resting on the player's word, after the share above. */
  stated: number;
}

export interface XpDay {
  date: string;
  /** Credited points for the day. Always the sum of `points`. */
  xp: number;
  /** Drill runs the app heard. Zero means nothing was measured that day. */
  runs: number;
  /** How many drills beat their own best. */
  bests: number;
  points: XpSource;
}

export interface XpTotals {
  total: number;
  /** Every day that earned anything, in date order. */
  days: XpDay[];
  /** Longest run of consecutive days the app heard something. */
  bestStreak: number;
  /** Days the app heard at least one run. Timers and claims do not count. */
  practiceDays: number;
  /** Drill runs heard across the whole history. */
  totalRuns: number;
  /**
   * Drills that produced a number, counted once per drill per day.
   *
   * Kept beside `totalRuns` because they answer different questions and the
   * Numbers tab asks this one: how many measurements exist, not how many times
   * the player pressed go.
   */
  totalResults: number;
  totalBests: number;
  source: XpSource;
}

const dayBefore = (date: string): string => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** What a day's raw effort is actually worth once the returns bend. */
function dayReturns(raw: number): number {
  if (raw <= DAY_FULL_UP_TO) return raw;
  const half = DAY_FULL_UP_TO + (Math.min(raw, DAY_HALF_UP_TO) - DAY_FULL_UP_TO) * DAY_HALF_RATE;
  if (raw <= DAY_HALF_UP_TO) return half;
  return half + (raw - DAY_HALF_UP_TO) * DAY_TAIL_RATE;
}

interface Unheard {
  timed: number;
  stated: number;
}

/**
 * What a day's completions earn beyond what the microphone heard.
 *
 * Timed credit is paid on the seconds the clock ran, finished or not: the
 * minutes happened either way, and only the completion depended on reaching the
 * end. Stated credit needs the completion, because a claim that did not even
 * settle the task is not a claim about anything.
 */
function unheardFor(log: DailyLog | undefined, records: Record<string, TaskRecord>): Unheard {
  const out: Unheard = { timed: 0, stated: 0 };
  const done = new Set(log?.completedTaskIds ?? []);
  for (const [taskId, record] of Object.entries(records)) {
    if (record.evidence === 'measured') continue;
    if (record.evidence === 'timed') {
      out.timed += Math.min(TIMED_TASK_CAP, ((record.seconds ?? 0) / 60) * TIMED_PER_MINUTE);
      continue;
    }
    if (record.stated && done.has(taskId)) out.stated += STATED_POINTS;
  }
  out.stated = Math.min(STATED_DAY_CAP, out.stated);
  return out;
}

/**
 * The same question for a day recorded before completion records existed.
 *
 * Those days hold a list of ticked task ids and nothing about how they came to
 * be ticked, so every tick that is not itself a result key is read as the
 * player's word, which is what it was. Reading them as nothing instead would
 * quietly delete months of someone's history the day this shipped.
 */
function legacyUnheard(log: DailyLog | undefined): Unheard {
  const measured = new Set(Object.keys(log?.drillResults ?? {}));
  const ticks = (log?.completedTaskIds ?? []).filter((id) => !measured.has(id)).length;
  return { timed: 0, stated: Math.min(STATED_DAY_CAP, ticks * STATED_POINTS) };
}

interface RawDay {
  date: string;
  runs: number;
  bests: number;
  /** Uncredited, unbent points. The second pass turns these into `XpSource`. */
  raw: XpSource;
}

const noPoints = (): XpSource =>
  ({ heard: 0, reps: 0, timed: 0, bests: 0, streak: 0, stated: 0 });

/**
 * Replay the whole history in date order.
 *
 * A personal best can only be recognised against what came before it, so this
 * has to be a replay rather than a fold over an unordered map. It is also why
 * correcting a past result changes the totals: that is correct, the points
 * describe the history and the history changed.
 *
 * Two passes, because the share that unheard work is allowed to take is a
 * property of the whole history rather than of a day. The first pass is the
 * replay; the second spends that allowance and bends the day's returns.
 */
export function computeXp(dailyLogs: Record<string, DailyLog>): XpTotals {
  const dates = Object.keys(dailyLogs).sort();
  const best = new Map<string, number>();
  const raw: RawDay[] = [];
  let streak = 0;
  let bestStreak = 0;
  let previous: string | null = null;
  let totalRuns = 0;
  let totalResults = 0;
  let totalBests = 0;
  let heardRaw = 0;
  let unheardRaw = 0;

  for (const date of dates) {
    const log = dailyLogs[date];
    const records = log?.taskRecords;
    const unheard = records ? unheardFor(log, records) : legacyUnheard(log);

    const points = noPoints();
    let runs = 0;
    let bests = 0;
    for (const key of Object.keys(log?.drillResults ?? {})) {
      const heard = runsFor(log, key).filter((r) => Number.isFinite(r.value) && r.value > 0);
      if (!heard.length) continue;
      runs += heard.length;
      totalResults += 1;
      const damping = repeatDamping(heard.length);
      for (const run of heard) {
        const credit = runCredit(run.value);
        points.heard += credit.base * damping;
        points.reps += credit.reps * damping;
      }
      const top = Math.max(...heard.map((r) => r.value));
      const prior = best.get(key) ?? 0;
      // The first run of a drill is a baseline, not an achievement: there was
      // nothing there to beat.
      if (top > prior) {
        if (prior > 0) bests += 1;
        best.set(key, top);
      }
    }
    points.bests = bests > 0 ? BEST_DAY_BONUS : 0;

    if (!runs) {
      // A day the app heard nothing does not extend a streak. A timer running
      // and a box ticked are both worth something, and neither is evidence that
      // the guitar was played, which is what a run of practice days claims.
      streak = 0;
      previous = date;
    } else {
      streak = previous !== null && dayBefore(date) === previous ? streak + 1 : 1;
      bestStreak = Math.max(bestStreak, streak);
      previous = date;
      points.streak = Math.min(MAX_STREAK_BONUS, Math.max(0, streak - 2) * STREAK_POINTS);
    }

    points.timed = unheard.timed;
    points.stated = unheard.stated;
    heardRaw += points.heard + points.reps + points.bests;
    unheardRaw += unheard.timed + unheard.stated;
    totalRuns += runs;
    totalBests += bests;
    if (points.heard + points.reps + unheard.timed + unheard.stated + points.streak > 0) {
      raw.push({ date, runs, bests, raw: points });
    }
  }

  // Work the app did not hear is credited against work it did. A history with no
  // heard practice in it spends nothing, which is what stops a level from being
  // reachable by starting timers or asserting completions.
  const allowance = heardRaw * UNHEARD_SHARE;
  const unheardFactor = unheardRaw > 0 ? Math.min(1, allowance / unheardRaw) : 0;

  const days: XpDay[] = [];
  const source = noPoints();
  let total = 0;
  let practiceDays = 0;

  for (const day of raw) {
    const timed = day.raw.timed * unheardFactor;
    const stated = day.raw.stated * unheardFactor;
    const effort = day.raw.heard + day.raw.reps + day.raw.bests + timed + stated;
    // One bend across every effort figure in the day, and every figure rounded
    // before the day's total is taken from them. The breakdown the learner reads
    // is then the total they are standing on, to the point, rather than five
    // numbers that nearly add up.
    const bend = effort > 0 ? dayReturns(effort) / effort : 0;
    const points: XpSource = {
      heard: Math.round(day.raw.heard * bend),
      reps: Math.round(day.raw.reps * bend),
      // The two figures the app did not hear are taken DOWN to the point, never
      // to the nearest one, and that asymmetry is the whole point of them.
      //
      // The clamp above is applied to the raw figures. Rounding all six
      // independently afterwards then broke the promise at the top of this file
      // by a point a day: on a day built of timers and claims both unheard
      // figures round up while the heard ones round either way. Measured over 1,
      // 5, 20, 60 and 200 days it never washed out — unheard ran a quarter ahead
      // of heard, permanently.
      //
      // A guarantee that only holds before rounding is not one the learner can
      // read off their own screen. So the bias runs the way the promise does,
      // and the cost is at most a point a day of credit for work nobody heard.
      timed: Math.floor(timed * bend),
      bests: Math.round(day.raw.bests * bend),
      streak: day.raw.streak,
      stated: Math.floor(stated * bend),
    };
    const xp = points.heard + points.reps + points.timed + points.bests
      + points.streak + points.stated;
    if (xp <= 0) continue;

    source.heard += points.heard;
    source.reps += points.reps;
    source.timed += points.timed;
    source.bests += points.bests;
    source.streak += points.streak;
    source.stated += points.stated;
    total += xp;
    if (day.runs > 0) practiceDays += 1;
    days.push({ date: day.date, xp, runs: day.runs, bests: day.bests, points });
  }

  return { total, days, bestStreak, practiceDays, totalRuns, totalResults, totalBests, source };
}

/**
 * Levels, unbounded.
 *
 * Level n costs `7.5 * n^1.5` points, so the gap between levels grows as the
 * root of the level and the ladder never runs out. Three properties fall out of
 * that shape, and all three were the point of choosing it:
 *
 * - It is generous, and stays generous. A first session reaches level 2, a first
 *   week the high single figures, a month of daily practice the mid twenties.
 *   Level 100 arrives at about eight months of near-daily practice and inside a
 *   year at four days a week.
 * - It never tops out. There is no last rung to reach and then stand on.
 * - It keeps moving. A level costs about one session at level 10, three at level
 *   100, six at level 350 and seven at level 500. It slows, because five years
 *   of work should be worth more than five days of it, but it never stops.
 */
const LEVEL_COST = 7.5;
const LEVEL_EXPONENT = 1.5;

/** Points needed to reach a level. */
export const pointsForLevel = (level: number): number =>
  Math.ceil(LEVEL_COST * Math.pow(Math.max(1, level), LEVEL_EXPONENT));

/**
 * The level a total stands at.
 *
 * The closed form is the inverse of `pointsForLevel`, but a root and a power in
 * floating point are not exact inverses of each other, and at four figures the
 * drift is enough to report the level below the one whose threshold was just
 * crossed. The two steps after it make the pair exact by construction, which is
 * what lets the panel promise "N to level 58" and mean it.
 */
function levelAt(xp: number): number {
  let level = Math.max(1, Math.floor(Math.pow(Math.max(0, xp) / LEVEL_COST, 1 / LEVEL_EXPONENT)));
  if (xp >= pointsForLevel(level + 1)) level += 1;
  else if (level > 1 && xp < pointsForLevel(level)) level -= 1;
  return level;
}

/**
 * Named stretches of the ladder.
 *
 * An unbounded level number on its own is a counter, and a counter is not a
 * place. The bands are the places: they arrive rarely enough to mean something
 * (they land on the week, the month, the quarter, the half year, the first and
 * second anniversaries, and then years apart) while the number underneath keeps
 * moving every few days. Each is named for what the practice feels like at that point
 * rather than for a rank, because "Novice / Apprentice / Master" says nothing
 * about a guitar.
 *
 * The last band has no end. By then the honest thing to say is that the levels
 * keep coming and the practice is just the practice.
 */
export interface Band {
  /** Lowest level in the band. */
  from: number;
  title: string;
}

export const BANDS: Band[] = [
  { from: 1, title: 'Picked it up' },
  { from: 5, title: 'Fingers sore' },
  { from: 12, title: 'First changes' },
  { from: 22, title: 'Keeping time' },
  { from: 50, title: 'It sounds like a song' },
  { from: 80, title: 'Changes on the beat' },
  { from: 130, title: 'Playing without looking' },
  { from: 210, title: 'A set you could play' },
  { from: 330, title: 'Hands know it' },
  { from: 460, title: 'Just playing now' },
];

export interface LevelStanding {
  level: number;
  band: Band;
  /** Index of the band, for drawing the ladder. */
  bandIndex: number;
  /** The next band up, or null at the open end of the ladder. */
  nextBand: Band | null;
  /** Points still to go before the next level. */
  toNextLevel: number;
  /** 0 to 1 through the current level. */
  progress: number;
  /** 0 to 1 through the current band. 1 in the open band. */
  bandProgress: number;
}

export function levelFor(xp: number): LevelStanding {
  const level = levelAt(xp);
  const at = pointsForLevel(level);
  const next = pointsForLevel(level + 1);

  let bandIndex = 0;
  for (let i = 0; i < BANDS.length; i++) if (level >= BANDS[i].from) bandIndex = i;
  const band = BANDS[bandIndex];
  const nextBand = BANDS[bandIndex + 1] ?? null;
  const bandSpan = nextBand ? nextBand.from - band.from : 0;

  return {
    level,
    band,
    bandIndex,
    nextBand,
    toNextLevel: Math.max(0, next - xp),
    progress: Math.min(1, Math.max(0, (xp - at) / (next - at))),
    bandProgress: nextBand ? Math.min(1, (level - band.from) / bandSpan) : 1,
  };
}

/** Consecutive days after which resting is the better call, not the weaker one. */
export const REST_EARNED_AFTER = 6;

export interface RestAdvice {
  /** Days practised in a row, counting back from today or yesterday. */
  run: number;
  /** True once the run is long enough that a day off is the sensible move. */
  earned: boolean;
  message: string | null;
}

/**
 * Whether a rest day is due.
 *
 * A streak counter with nothing else attached turns into pressure: the only
 * thing it ever says is "do not stop", which is bad advice for hands that are
 * six days into daily practice and the reason people quit rather than rest. This
 * is the app being willing to say the opposite.
 *
 * Deliberately does not pause or protect the streak. A streak that survives a
 * day off is not a streak, and quietly redefining it would be a worse lie than
 * the pressure it was meant to relieve.
 */
export function restAdvice(dailyLogs: Record<string, DailyLog>, today: string): RestAdvice {
  const practised = new Set(
    Object.entries(dailyLogs)
      .filter(([, log]) =>
        Object.values(log?.drillResults ?? {}).some((v) => Number.isFinite(v) && v > 0),
      )
      .map(([date]) => date),
  );

  // Count back from today, allowing today itself to be empty: the day is not
  // over yet, and telling someone their streak is broken at breakfast is absurd.
  let cursor = practised.has(today) ? today : dayBefore(today);
  let run = 0;
  while (practised.has(cursor)) {
    run += 1;
    cursor = dayBefore(cursor);
  }

  if (run < REST_EARNED_AFTER) return { run, earned: false, message: null };
  return {
    run,
    earned: true,
    message:
      `${run} days running. Hands build on the days off too, so taking one is ` +
      `the stronger move, not the weaker one.`,
  };
}

export {
  RUN_POINTS,
  RUN_FLOOR,
  REPS_MAX,
  BEST_DAY_BONUS,
  TIMED_PER_MINUTE,
  TIMED_TASK_CAP,
  STATED_POINTS,
  STATED_DAY_CAP,
  UNHEARD_SHARE,
  MAX_STREAK_BONUS,
  DAY_FULL_UP_TO,
  LEVEL_COST,
};
