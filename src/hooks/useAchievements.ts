import { useMemo } from 'react';
import { useDrillLogs, useUserData } from '../store';
import { useProgression } from './useProgression';
import { computeXp, levelFor } from '../lib/xp';
import { evaluateAchievements, type EarnedAchievement } from '../data/achievements';
import { lifetimeBests, readEvidence } from '../lib/progression';

export interface Standing {
  xp: ReturnType<typeof computeXp>;
  level: ReturnType<typeof levelFor>;
  achievements: EarnedAchievement[];
}

/**
 * Points, level and badges, all replayed from the practice logs.
 *
 * Memoised on the logs alone: nothing here is stored, so the logs changing is
 * the only thing that can change the answer.
 */
export function useAchievements(): Standing {
  const dailyLogs = useUserData().dailyLogs;
  // Points are replayed off the days exactly as they were written, so this
  // screen and Progress can never disagree about a total. What a *drill* is
  // worth has to be read through the resolved keys, or a rebuilt routine would
  // look like a personal best being set from nothing.
  const drillLogs = useDrillLogs();
  const standings = useProgression();
  return useMemo(() => {
    const xp = computeXp(dailyLogs);
    // Deliberately the lifetime best, where a standing is deliberately not. An
    // award marks something that happened, and thirty changes in a minute last
    // April happened; it is the claim that you can still do it today that has to
    // be earned three runs running.
    const bests = lifetimeBests(readEvidence(drillLogs));
    return {
      xp,
      level: levelFor(xp.total),
      achievements: evaluateAchievements({ xp, bests, standings }),
    };
  }, [dailyLogs, drillLogs, standings]);
}
