import clsx from 'clsx';
import {
  BoltIcon, ChartIcon, CheckIcon, FlameIcon, MetronomeIcon, PlectrumIcon,
  SessionIcon, TargetIcon, TrophyIcon, TuningForkIcon,
} from '../icons';
import { useAchievements } from '../../hooks/useAchievements';
import type { EarnedAchievement } from '../../data/achievements';
import './achievements.css';

/**
 * Points, level and badges.
 *
 * Every number here is replayed from the practice logs, so it is always exactly
 * what was done. Nothing is awarded for opening the app or ticking a box: points
 * that can be farmed stop being evidence, and evidence is the whole product.
 *
 * The marks are the app's own icon set rather than an imported achievement pack.
 * A grab-bag of stock badges would read as bolted on next to a hand-drawn
 * plectrum and a hand-drawn capo, and it would carry a licence question for no
 * gain.
 */
const MARKS = {
  plectrum: PlectrumIcon,
  flame: FlameIcon,
  trophy: TrophyIcon,
  target: TargetIcon,
  metronome: MetronomeIcon,
  tuningFork: TuningForkIcon,
  bolt: BoltIcon,
  chart: ChartIcon,
  session: SessionIcon,
} as const;

export function AchievementsPanel() {
  const { xp, level, achievements } = useAchievements();
  const earned = achievements.filter((a) => a.earned);
  const pending = achievements.filter((a) => !a.earned).sort((a, b) => b.progress - a.progress);

  return (
    <div className="ach">
      <section className="ach-level">
        <div className="ach-level-head">
          <span className="ach-level-number">{level.level.number}</span>
          <div className="ach-level-body">
            <span className="ach-level-title">{level.level.title}</span>
            <span className="ach-level-xp">
              {xp.total.toLocaleString()} points from {xp.practiceDays} day
              {xp.practiceDays === 1 ? '' : 's'} of practice
            </span>
          </div>
        </div>
        <span className="ach-level-track" aria-hidden="true">
          <span className="ach-level-fill" style={{ width: `${Math.round(level.progress * 100)}%` }} />
        </span>
        <span className="ach-level-next">
          {level.next
            ? `${(level.next.at - xp.total).toLocaleString()} to "${level.next.title}"`
            : 'Top of the ladder. Keep playing anyway.'}
        </span>
      </section>

      {/* Where the points came from. A total with no breakdown is a score; a
          breakdown is a record of what you did. */}
      <section className="ach-breakdown">
        <Figure value={xp.totalResults} label="drills measured" />
        <Figure value={xp.totalBests} label="times you beat yourself" />
        <Figure value={xp.bestStreak} label="longest run of days" />
      </section>

      {earned.length > 0 && (
        <section className="ach-section">
          <h3 className="ach-title">Earned</h3>
          <ul className="ach-grid">
            {earned.map((a) => (
              <Badge key={a.id} achievement={a} />
            ))}
          </ul>
        </section>
      )}

      <section className="ach-section">
        <h3 className="ach-title">{earned.length ? 'Still to come' : 'What there is to go for'}</h3>
        <ul className="ach-grid">
          {pending.map((a) => (
            <Badge key={a.id} achievement={a} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function Figure({ value, label }: { value: number; label: string }) {
  return (
    <div className="ach-figure">
      <span className="ach-figure-value">{value.toLocaleString()}</span>
      <span className="ach-figure-label">{label}</span>
    </div>
  );
}

function Badge({ achievement }: { achievement: EarnedAchievement }) {
  const Mark = MARKS[achievement.icon];
  const pct = Math.round(achievement.progress * 100);
  return (
    <li className={clsx('ach-badge', `is-${achievement.tier}`, achievement.earned && 'is-earned')}>
      <span className="ach-badge-mark" aria-hidden="true">
        {achievement.earned ? <CheckIcon size={18} /> : <Mark size={18} />}
      </span>
      <span className="ach-badge-body">
        <span className="ach-badge-title">{achievement.title}</span>
        {/* The goal stays visible after it is earned. "Seven days running" is
            what the badge means, and hiding it turns a record into a trinket. */}
        <span className="ach-badge-goal">{achievement.goal}</span>
        {achievement.detail && <span className="ach-badge-detail">{achievement.detail}</span>}
      </span>
      {!achievement.earned && pct > 0 && (
        <span className="ach-badge-progress" aria-label={`${pct} percent of the way there`}>
          {pct}%
        </span>
      )}
    </li>
  );
}
