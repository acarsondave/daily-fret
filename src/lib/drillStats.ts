import { useMemo } from 'react';
import { useUserData, getTodayString } from '../store';
import { parsePairKey } from './pairs';
import type { DailyLog } from '../types';

export interface DrillHistory {
  best: number; // personal best across all days
  series: number[]; // chronological, one point per day
}

// History for a drill stored under its task id (e.g. the chord trainer's score),
// oldest first. The chord-changes drill is keyed by pair instead — see pairs.ts.
export function taskDrillHistory(
  dailyLogs: Record<string, DailyLog>,
  taskId: string,
): DrillHistory {
  const points = Object.values(dailyLogs ?? {})
    .filter((l) => typeof l.drillResults?.[taskId] === 'number')
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((l) => l.drillResults![taskId]);
  return { best: points.reduce((m, v) => Math.max(m, v), 0), series: points };
}

export interface PairStat {
  key: string; // the pair storage key
  from: string;
  to: string;
  best: number; // personal best cpm across all days
  today: number | null; // today's best cpm, if practiced today
  series: { date: string; cpm: number }[]; // chronological, one point per day
}

// Aggregates chord-change history by *pair* (e.g. A↔D) across every routine and
// day, reading the per-pair keys written by recordDrillResult. Each pair keeps
// its own benchmark — D↔A is no longer conflated with E↔A.
export function useDrillStats(): PairStat[] {
  const userData = useUserData();
  const today = getTodayString();

  return useMemo(() => {
    const dailyLogs = userData?.dailyLogs ?? {};
    const byPair = new Map<string, PairStat>();

    for (const log of Object.values(dailyLogs)) {
      const results = log.drillResults;
      if (!results) continue;
      for (const [key, cpm] of Object.entries(results)) {
        const pair = parsePairKey(key);
        if (!pair || typeof cpm !== 'number') continue;
        let stat = byPair.get(key);
        if (!stat) {
          stat = { key, from: pair.from, to: pair.to, best: 0, today: null, series: [] };
          byPair.set(key, stat);
        }
        stat.series.push({ date: log.date, cpm });
        stat.best = Math.max(stat.best, cpm);
        if (log.date === today) stat.today = cpm;
      }
    }

    const stats = [...byPair.values()];
    for (const s of stats) s.series.sort((a, b) => a.date.localeCompare(b.date));
    return stats;
  }, [userData, today]);
}

export interface Recommendation {
  stat: PairStat;
  reason: string;
}

// Pick the single pair most worth drilling next. Priority: a pair not yet
// practiced today, then the weakest by personal best. Returns null with no data.
export function recommendNext(stats: PairStat[]): Recommendation | null {
  const withHistory = stats.filter((s) => s.series.length > 0);
  if (withHistory.length === 0) return null;

  const notToday = withHistory.filter((s) => s.today === null);
  const pool = notToday.length ? notToday : withHistory;
  const pick = [...pool].sort((a, b) => a.best - b.best)[0];

  const reason =
    pick.today === null ? 'Not practiced today' : 'Your slowest pair — push it';
  return { stat: pick, reason };
}
