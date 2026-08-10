// Awards, as conditions over the practice history.
//
// Every one is a predicate on data the app already has, so like points and
// standings they are derived rather than stored: there is no flag to set, no
// migration, and no way for a badge to survive a correction to the history that
// earned it.
//
// Two bars for including one, and both are hard.
//
// It has to mark something a guitarist would repeat to another person. "Opened
// the app five times" is not that, and neither are three different badges for
// the same number getting bigger.
//
// And it has to be earnable only by playing. A skill the app cannot hear can be
// marked done by the learner, and that self-report is recorded as a claim rather
// than as a fact; an award that accepted a claim would be a trophy for ticking a
// box, which is exactly the thing the points model refuses. Anything read from
// the skill standings therefore insists on `source === 'measured'`.
//
// `xp.days` holds every day that earned points, including days that were only
// timed or asserted, so anything counting days here goes through `heardDays`
// below. That filter is the whole difference between a habit award and an award
// for leaving a timer running.

import type { XpDay, XpTotals } from '../lib/xp';
import { CHANGES_BAR, type SkillStanding } from '../lib/progression';
import { parsePairKey } from '../lib/pairs';
import { ALL_SKILLS } from './skills';

export interface AchievementContext {
  xp: XpTotals;
  standings: readonly SkillStanding[];
  /** Best value ever recorded per drill key. */
  bests: Map<string, number>;
}

/** Marks drawn for the awards. Each names an icon in src/components/icons. */
export type AchievementMark =
  | 'plectrum'
  | 'chart'
  | 'target'
  | 'bolt'
  | 'grip'
  | 'flame'
  | 'tally'
  | 'trophy'
  | 'sunrise';

export interface AchievementResult {
  earned: boolean;
  /** 0 to 1 toward the bar. */
  progress: number;
  /**
   * The fact behind it, in the learner's own numbers. Absent until there is
   * one: "Best pair: 0 a minute" on a brand-new account is a zero dressed up as
   * evidence, and it made every award look broken on first run.
   */
  detail?: string;
}

export interface Achievement {
  id: string;
  title: string;
  /** What earns it, in the second person. */
  goal: string;
  icon: AchievementMark;
  /**
   * A recognition rather than a target. Listing "come back after a week away"
   * among the things to go for reads as the app suggesting a week off, so these
   * stay out of sight until the history actually contains one.
   */
  hiddenUntilEarned?: boolean;
  test: (ctx: AchievementContext) => AchievementResult;
}

/**
 * Progress toward a bar.
 *
 * Every bar below is a positive constant, so there is no zero-denominator case
 * to paper over here. The one bar read from data rather than written down is the
 * open-chord count, and the suite asserts it is eight.
 */
const ratio = (have: number, need: number) => Math.max(0, Math.min(1, have / need));

const DAY_MS = 86_400_000;
/** A YYYY-MM-DD as a day number, so day arithmetic is integer subtraction. */
const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T12:00:00Z`) / DAY_MS);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The days the app actually heard something. Date order is inherited. */
const heardDays = (days: readonly XpDay[]): XpDay[] => days.filter((d) => d.runs > 0);

/**
 * The single-chord skills, which is what "every open chord" means.
 *
 * Read from the taxonomy rather than written down twice, so the bar and the
 * course can never drift apart. The copy deliberately says "every" rather than
 * "all eight" for the same reason.
 */
const OPEN_CHORD_SKILL_IDS: ReadonlySet<string> = new Set(
  ALL_SKILLS.filter((s) => s.family === 'chords' && s.chords?.length === 1).map((s) => s.id),
);

export const OPEN_CHORD_COUNT = OPEN_CHORD_SKILL_IDS.size;

interface PairBest {
  rate: number;
  from: string;
  to: string;
}

/** Best change rate on any single pair, and which pair it was. */
function bestPair(bests: Map<string, number>): PairBest | null {
  let top: PairBest | null = null;
  for (const [key, rate] of bests) {
    const pair = parsePairKey(key);
    if (!pair) continue;
    if (!top || rate > top.rate) top = { rate, ...pair };
  }
  return top;
}

/** How many distinct pairs have cleared the course's thirty-a-minute gate. */
function pairsPastGate(bests: Map<string, number>): number {
  let n = 0;
  for (const [key, value] of bests) if (parsePairKey(key) && value >= CHANGES_BAR) n += 1;
  return n;
}

/** Pairs that have to clear the gate before the changes are no longer one trick. */
const BREADTH_PAIRS = 5;
/** Consecutive days that make a run worth naming. */
const RUN_DAYS = 7;
/** The window consistency is measured over, and the days needed inside it. */
const WINDOW_DAYS = 30;
const WINDOW_PRACTISED = 20;
/** Separate practised days that add up to a habit rather than a spell. */
const LONG_HAUL_DAYS = 50;
/** Days away after which picking the guitar up again is the achievement. */
const AWAY_DAYS = 7;

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first-drill',
    title: 'First one down',
    goal: 'Finish a drill the app listens to.',
    icon: 'plectrum',
    test: ({ xp }) => ({ earned: xp.totalRuns >= 1, progress: ratio(xp.totalRuns, 1) }),
  },
  {
    id: 'first-best',
    title: 'Beat your own number',
    goal: 'Beat a score you had already set on the same drill.',
    icon: 'chart',
    test: ({ xp }) => ({
      earned: xp.totalBests >= 1,
      progress: ratio(xp.totalBests, 1),
      detail: xp.totalBests > 0 ? `${plural(xp.totalBests, 'time')} so far.` : undefined,
    }),
  },
  {
    id: 'the-gate',
    title: 'Through the gate',
    goal: 'Thirty clean changes in a minute on one pair. This is the bar the course sets.',
    icon: 'target',
    test: ({ bests }) => {
      const top = bestPair(bests);
      return {
        earned: (top?.rate ?? 0) >= CHANGES_BAR,
        progress: ratio(top?.rate ?? 0, CHANGES_BAR),
        detail: top ? `Best so far: ${top.rate} a minute, ${top.from} to ${top.to}.` : undefined,
      };
    },
  },
  {
    id: 'five-pairs',
    title: 'Five pairs past the gate',
    goal: 'Get five different chord pairs to thirty a minute, so it is not one lucky change.',
    icon: 'bolt',
    test: ({ bests }) => {
      const n = pairsPastGate(bests);
      if (n >= BREADTH_PAIRS) {
        // Past the bar the "of five" framing stops being true: "8 of 5" reads as
        // a bug, not as a record.
        return { earned: true, progress: 1, detail: `${plural(n, 'pair')} past it.` };
      }
      return {
        earned: false,
        progress: ratio(n, BREADTH_PAIRS),
        detail: n > 0 ? `${n} of ${BREADTH_PAIRS} so far.` : undefined,
      };
    },
  },
  {
    id: 'open-chords',
    title: 'Every open chord',
    goal: 'Get every open chord the course teaches moving at speed.',
    icon: 'grip',
    test: ({ standings }) => {
      const moving = standings.filter(
        (s) => OPEN_CHORD_SKILL_IDS.has(s.skill.id) && s.state === 'solid' && s.source === 'measured',
      ).length;
      return {
        earned: moving >= OPEN_CHORD_COUNT,
        progress: ratio(moving, OPEN_CHORD_COUNT),
        detail: moving > 0 ? `${moving} of ${OPEN_CHORD_COUNT} moving at speed.` : undefined,
      };
    },
  },
  {
    id: 'week',
    title: 'Seven days running',
    goal: 'Practise seven days in a row.',
    icon: 'flame',
    test: ({ xp }) => ({
      earned: xp.bestStreak >= RUN_DAYS,
      progress: ratio(xp.bestStreak, RUN_DAYS),
      detail: xp.bestStreak > 0 ? `Longest run so far: ${plural(xp.bestStreak, 'day')}.` : undefined,
    }),
  },
  {
    id: 'consistency',
    title: 'Twenty days in a month',
    goal: 'Practise on twenty days inside any thirty. Days off are allowed.',
    icon: 'tally',
    test: ({ xp }) => {
      // A sliding window, not a pair of nested loops. `xp.days` is already in
      // date order and holds only the days something was measured, so one pass
      // with a trailing index answers it; the version that scanned forward from
      // every day was quadratic on exactly the histories that get long.
      const days = heardDays(xp.days).map((d) => dayNumber(d.date));
      let start = 0;
      let best = 0;
      for (let end = 0; end < days.length; end += 1) {
        while (days[end] - days[start] >= WINDOW_DAYS) start += 1;
        best = Math.max(best, end - start + 1);
      }
      return {
        earned: best >= WINDOW_PRACTISED,
        progress: ratio(best, WINDOW_PRACTISED),
        detail: best > 0 ? `Best month so far: ${plural(best, 'day')}.` : undefined,
      };
    },
  },
  {
    id: 'fifty-days',
    title: 'Fifty days in',
    goal: 'Practise on fifty separate days. They do not have to be in a row.',
    icon: 'trophy',
    test: ({ xp }) => ({
      earned: xp.practiceDays >= LONG_HAUL_DAYS,
      progress: ratio(xp.practiceDays, LONG_HAUL_DAYS),
      detail: xp.practiceDays > 0 ? `${plural(xp.practiceDays, 'day')} so far.` : undefined,
    }),
  },
  {
    id: 'comeback',
    title: 'Back at it',
    goal: 'Pick the guitar up again after a week or more away.',
    icon: 'sunrise',
    hiddenUntilEarned: true,
    test: ({ xp }) => {
      const days = heardDays(xp.days);
      let longestAway = 0;
      for (let i = 1; i < days.length; i += 1) {
        const away = dayNumber(days[i].date) - dayNumber(days[i - 1].date) - 1;
        if (away > longestAway) longestAway = away;
      }
      const earned = longestAway >= AWAY_DAYS;
      return {
        earned,
        progress: earned ? 1 : 0,
        detail: earned ? `You came back after ${plural(longestAway, 'day')} off.` : undefined,
      };
    },
  },
];

export interface EarnedAchievement extends Achievement, AchievementResult {}

export function evaluateAchievements(ctx: AchievementContext): EarnedAchievement[] {
  return ACHIEVEMENTS.map((a) => ({ ...a, ...a.test(ctx) }));
}
