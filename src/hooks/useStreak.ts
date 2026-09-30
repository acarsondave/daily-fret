import { useMemo } from 'react';
import { useUserData } from '../store';
import { completedCount } from '../lib/taskSplit';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The flame count and the week strip, as of `today`.
 *
 * Takes the day rather than reading the clock, because it was memoised on the
 * logs alone: a strip computed at 23:50 was the strip shown the next morning,
 * one day behind, until something happened to write a log (hooks/useToday).
 * Counts are read through the task split map, so a day that completed a task
 * since split into three reads as the three it now is.
 */
export function useStreak(today: string) {
  const { dailyLogs, taskSplits } = useUserData();

  return useMemo(() => {
    const [y, m, d] = today.split('-').map(Number);
    const base = new Date(y, m - 1, d);
    const countOn = (offset: number) => {
      const day = new Date(base);
      day.setDate(base.getDate() - offset);
      const date = iso(day);
      return { date, day, count: completedCount(dailyLogs[date], taskSplits) };
    };

    let currentStreak = 0;
    for (let i = 0; i < 1000; i++) {
      if (countOn(i).count > 0) currentStreak++;
      // Today not practised yet does not break a run that reached yesterday.
      else if (i > 0) break;
    }

    const graphData = [];
    for (let i = 6; i >= 0; i--) {
      const { date, day, count } = countOn(i);
      let intensity = 0;
      if (count > 0) intensity = 1;
      if (count > 2) intensity = 2;
      if (count > 4) intensity = 3;
      if (count > 6) intensity = 4;
      graphData.push({
        date,
        dayOfWeek: day.toLocaleDateString('en-US', { weekday: 'short' }).charAt(0),
        count,
        intensity,
      });
    }

    return { currentStreak, graphData };
  }, [dailyLogs, taskSplits, today]);
}
