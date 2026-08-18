import { useMemo } from 'react';
import { getTodayString, useDrillLogs, useUserData } from '../store';
import { allStandings, type SkillStanding } from '../lib/progression';

const NO_CLAIMS: string[] = [];

/**
 * Every skill's standing, recomputed only when the practice logs or the
 * learner's own claims actually change.
 *
 * The whole model is derived from the logs, so this is the one place that cost
 * is paid; memoising on the inputs keeps a panel that renders 38 skills from
 * folding the entire practice history on every keystroke elsewhere.
 */
export function useProgression(): SkillStanding[] {
  // The resolved logs, so a drill whose task has since been rebuilt still counts
  // toward the skill it was evidence for.
  const dailyLogs = useDrillLogs();
  const claimed = useUserData().claimedSkills ?? NO_CLAIMS;
  // Standings expire: evidence goes cold two weeks after the last run, so the
  // answer depends on the date and not only on the logs.
  const today = getTodayString();
  return useMemo(() => allStandings(dailyLogs, today, claimed), [dailyLogs, today, claimed]);
}
