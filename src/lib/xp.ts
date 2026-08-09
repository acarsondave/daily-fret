// Points, levels and achievements, all derived from the practice logs.
//
// Nothing here is stored. That is the same rule the progression model follows
// and it matters more here, not less: a stored points total is a number that can
// drift from what someone actually did, and the first time it disagrees with the
// logs the whole thing becomes decoration. Derived, it is always exactly the
// history, it replays identically on any device, and a leaderboard would sum the
// same function rather than trusting a counter.
//
// The one hard rule on what earns points: **only measured practice**. Opening
// the app earns nothing, and neither does ticking a task you did not do a drill
// for. Points that can be farmed stop being evidence of anything, and evidence is
// the entire product.

import type { DailyLog } from '../types';
import { PAIR_PREFIX } from './pairs';

/** A drill that produced a number. The base unit of everything below. */
const XP_PER_RESULT = 12;
/** Beating your own best on that drill. The reason to come back. */
const XP_PER_BEST = 18;
/** Each day beyond the second in a row, capped so a streak cannot dwarf playing. */
const XP_PER_STREAK_DAY = 4;
const MAX_STREAK_BONUS = 40;

export interface XpDay {
  date: string;
  xp: number;
  results: number;
  bests: number;
  streakBonus: number;
}

export interface XpTotals {
  total: number;
  days: XpDay[];
  /** Longest run of consecutive practised days in the whole history. */
  bestStreak: number;
  /** Days with at least one measured result. */
  practiceDays: number;
  totalResults: number;
  totalBests: number;
}

const dayBefore = (date: string): string => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Replay the whole history in date order.
 *
 * A personal best can only be recognised against what came before it, so this
 * has to be a replay rather than a fold over an unordered map. It is also why
 * correcting a past result changes the totals: that is correct, the points
 * describe the history and the history changed.
 */
export function computeXp(dailyLogs: Record<string, DailyLog>): XpTotals {
  const dates = Object.keys(dailyLogs).sort();
  const best = new Map<string, number>();
  const days: XpDay[] = [];
  let total = 0;
  let streak = 0;
  let bestStreak = 0;
  let previous: string | null = null;
  let totalResults = 0;
  let totalBests = 0;

  for (const date of dates) {
    const results = Object.entries(dailyLogs[date]?.drillResults ?? {}).filter(
      ([, value]) => Number.isFinite(value) && value > 0,
    );
    if (!results.length) {
      // A day with nothing measured does not extend a streak. Ticking boxes is
      // not practice, and a streak that survives on box-ticking is a lie the
      // learner tells themselves with the app's help.
      streak = 0;
      previous = date;
      continue;
    }

    streak = previous !== null && dayBefore(date) === previous ? streak + 1 : 1;
    bestStreak = Math.max(bestStreak, streak);
    previous = date;

    let bests = 0;
    for (const [key, value] of results) {
      const prior = best.get(key) ?? 0;
      if (value > prior) {
        // Only counts as a best when there was something to beat. The first run
        // of a drill is a baseline, not an achievement.
        if (prior > 0) bests += 1;
        best.set(key, value);
      }
    }

    const streakBonus = Math.min(MAX_STREAK_BONUS, Math.max(0, streak - 2) * XP_PER_STREAK_DAY);
    const xp = results.length * XP_PER_RESULT + bests * XP_PER_BEST + streakBonus;
    total += xp;
    totalResults += results.length;
    totalBests += bests;
    days.push({ date, xp, results: results.length, bests, streakBonus });
  }

  return { total, days, bestStreak, practiceDays: days.length, totalResults, totalBests };
}

export interface Level {
  number: number;
  title: string;
  /** Points needed to reach this level. */
  at: number;
}

/**
 * Levels, named for what the practice actually feels like at that point rather
 * than for a rank. "Novice / Apprentice / Master" says nothing about a guitar.
 *
 * The curve is roughly quadratic: early levels arrive in days so the first week
 * has something in it, later ones take months, which is honest about how long
 * this instrument takes.
 */
export const LEVELS: Level[] = [
  { number: 1, title: 'Picked it up', at: 0 },
  { number: 2, title: 'Fingers sore', at: 60 },
  { number: 3, title: 'First changes', at: 180 },
  { number: 4, title: 'Keeping time', at: 380 },
  { number: 5, title: 'It sounds like a song', at: 680 },
  { number: 6, title: 'Changes on the beat', at: 1100 },
  { number: 7, title: 'Playing without looking', at: 1700 },
  { number: 8, title: 'A set you could play', at: 2600 },
  { number: 9, title: 'Hands know it', at: 3900 },
  { number: 10, title: 'Just playing now', at: 5600 },
];

export interface LevelStanding {
  level: Level;
  next: Level | null;
  /** 0 to 1 through the current level. 1 at the top of the ladder. */
  progress: number;
  intoLevel: number;
  levelSpan: number;
}

export function levelFor(xp: number): LevelStanding {
  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i].at) index = i;
  const level = LEVELS[index];
  const next = LEVELS[index + 1] ?? null;
  const intoLevel = xp - level.at;
  const levelSpan = next ? next.at - level.at : 0;
  return {
    level,
    next,
    intoLevel,
    levelSpan,
    progress: next ? Math.min(1, intoLevel / levelSpan) : 1,
  };
}

/** Points from the pair keys only, for a "chord changes" breakdown. */
export function xpByKind(dailyLogs: Record<string, DailyLog>): { changes: number; other: number } {
  let changes = 0;
  let other = 0;
  for (const log of Object.values(dailyLogs)) {
    for (const [key, value] of Object.entries(log.drillResults ?? {})) {
      if (!Number.isFinite(value) || value <= 0) continue;
      if (key.startsWith(PAIR_PREFIX)) changes += XP_PER_RESULT;
      else other += XP_PER_RESULT;
    }
  }
  return { changes, other };
}

export { XP_PER_RESULT, XP_PER_BEST, XP_PER_STREAK_DAY, MAX_STREAK_BONUS };
