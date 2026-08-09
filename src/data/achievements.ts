// Achievements, as conditions over the practice history.
//
// Every one is a predicate on data the app already has, so like points and
// standings they are derived rather than stored: there is no flag to set, no
// migration, and no way for a badge to survive a correction to the history that
// earned it.
//
// The bar for including one: it has to mark something a guitarist would actually
// tell someone about. "Opened the app five times" is not that. Most of these are
// moments Justin's course itself treats as milestones, which is the point.

import type { DailyLog } from '../types';
import type { XpTotals } from '../lib/xp';
import type { SkillStanding } from '../lib/progression';
import { parsePairKey } from '../lib/pairs';

export type AchievementTier = 'start' | 'craft' | 'persistence' | 'milestone';

export interface AchievementContext {
  logs: Record<string, DailyLog>;
  xp: XpTotals;
  standings: readonly SkillStanding[];
  /** Best value ever recorded per drill key. */
  bests: Map<string, number>;
}

export interface Achievement {
  id: string;
  title: string;
  /** What earns it, in the second person, before it is earned. */
  goal: string;
  tier: AchievementTier;
  /** Mark drawn for it. Names an icon in src/components/icons. */
  icon: 'plectrum' | 'flame' | 'trophy' | 'target' | 'metronome' | 'tuningFork' | 'bolt' | 'chart' | 'session';
  /** Earned, and how far along if not. `progress` is 0 to 1. */
  test: (ctx: AchievementContext) => { earned: boolean; progress: number; detail?: string };
}

const ratio = (have: number, need: number) => Math.min(1, need > 0 ? have / need : 0);

/** Best change rate on any single pair. */
function bestPair(bests: Map<string, number>): number {
  let top = 0;
  for (const [key, value] of bests) if (parsePairKey(key) && value > top) top = value;
  return top;
}

/** How many distinct pairs have cleared Justin's thirty-a-minute gate. */
function pairsPastGate(bests: Map<string, number>): number {
  let n = 0;
  for (const [key, value] of bests) if (parsePairKey(key) && value >= 30) n += 1;
  return n;
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first-drill',
    title: 'First one down',
    goal: 'Finish a drill that listens.',
    tier: 'start',
    icon: 'plectrum',
    test: ({ xp }) => ({ earned: xp.totalResults >= 1, progress: ratio(xp.totalResults, 1) }),
  },
  {
    id: 'first-best',
    title: 'Beat yourself',
    goal: 'Beat your own score on a drill you have run before.',
    tier: 'craft',
    icon: 'trophy',
    test: ({ xp }) => ({ earned: xp.totalBests >= 1, progress: ratio(xp.totalBests, 1) }),
  },
  {
    id: 'week',
    title: 'Seven days',
    goal: 'Practise seven days running.',
    tier: 'persistence',
    icon: 'flame',
    test: ({ xp }) => ({
      earned: xp.bestStreak >= 7,
      progress: ratio(xp.bestStreak, 7),
      detail: `Best run so far: ${xp.bestStreak} day${xp.bestStreak === 1 ? '' : 's'}.`,
    }),
  },
  {
    id: 'month',
    title: 'Thirty days',
    goal: 'Practise thirty days running.',
    tier: 'persistence',
    icon: 'flame',
    test: ({ xp }) => ({ earned: xp.bestStreak >= 30, progress: ratio(xp.bestStreak, 30) }),
  },
  {
    id: 'fifty-sessions',
    title: 'Fifty days in',
    goal: 'Practise on fifty separate days. They do not have to be in a row.',
    tier: 'persistence',
    icon: 'session',
    test: ({ xp }) => ({
      earned: xp.practiceDays >= 50,
      progress: ratio(xp.practiceDays, 50),
      detail: `${xp.practiceDays} so far.`,
    }),
  },
  {
    id: 'the-gate',
    title: 'Through the gate',
    goal: 'Thirty clean changes in a minute on any pair. This is the bar the course sets.',
    tier: 'milestone',
    icon: 'target',
    test: ({ bests }) => {
      const top = bestPair(bests);
      return { earned: top >= 30, progress: ratio(top, 30), detail: `Best pair: ${top} a minute.` };
    },
  },
  {
    id: 'five-pairs',
    title: 'Five pairs past the gate',
    goal: 'Get five different chord pairs to thirty a minute.',
    tier: 'milestone',
    icon: 'bolt',
    test: ({ bests }) => {
      const n = pairsPastGate(bests);
      return { earned: n >= 5, progress: ratio(n, 5), detail: `${n} so far.` };
    },
  },
  {
    id: 'sixty',
    title: 'Sixty a minute',
    goal: 'Double the gate on a single pair.',
    tier: 'craft',
    icon: 'chart',
    test: ({ bests }) => {
      const top = bestPair(bests);
      return { earned: top >= 60, progress: ratio(top, 60) };
    },
  },
  {
    id: 'open-chords',
    title: 'All eight grips',
    goal: 'Prove every open chord the beginner course teaches.',
    tier: 'milestone',
    icon: 'trophy',
    test: ({ standings }) => {
      const chords = standings.filter(
        (s) => s.skill.family === 'chords' && s.skill.chords?.length === 1,
      );
      const solid = chords.filter((s) => s.state === 'solid').length;
      return {
        earned: solid >= chords.length && chords.length > 0,
        progress: ratio(solid, chords.length),
        detail: `${solid} of ${chords.length}.`,
      };
    },
  },
  {
    id: 'consistency',
    title: 'Four weeks of it',
    goal: 'Practise on twenty days inside a month. Consistency beats marathons.',
    tier: 'persistence',
    icon: 'metronome',
    test: ({ xp }) => {
      // Twenty practised days inside any 30-day window.
      const dates = xp.days.map((d) => Date.parse(`${d.date}T12:00:00Z`)).sort((a, b) => a - b);
      let best = 0;
      for (let i = 0; i < dates.length; i++) {
        let n = 0;
        for (let j = i; j < dates.length && dates[j] - dates[i] < 30 * 86_400_000; j++) n += 1;
        best = Math.max(best, n);
      }
      return { earned: best >= 20, progress: ratio(best, 20), detail: `Best month: ${best} days.` };
    },
  },
  {
    id: 'in-tune',
    title: 'In tune first',
    goal: 'Say where your capo is, or confirm there is none, so the drills hear you properly.',
    tier: 'start',
    icon: 'tuningFork',
    test: ({ standings }) => {
      const solid = standings.some((s) => s.skill.id === 'setup.capo' && s.state === 'solid');
      return { earned: solid, progress: solid ? 1 : 0 };
    },
  },
];

export interface EarnedAchievement extends Achievement {
  earned: boolean;
  progress: number;
  detail?: string;
}

export function evaluateAchievements(ctx: AchievementContext): EarnedAchievement[] {
  return ACHIEVEMENTS.map((a) => ({ ...a, ...a.test(ctx) }));
}
