import clsx from 'clsx';
import {
  BoltIcon, ChartIcon, FlameIcon, GripIcon, PlectrumIcon, SunriseIcon,
  TallyIcon, TargetIcon, TrophyIcon,
} from '../icons';
import { useAchievements } from '../../hooks/useAchievements';
import { BANDS, restAdvice, type LevelStanding, type XpTotals } from '../../lib/xp';
import { useUserData, getTodayString } from '../../store';
import type { EarnedAchievement } from '../../data/achievements';
import './achievements.css';

/**
 * Points, level and awards.
 *
 * Every number here is replayed from the practice logs, so it is always exactly
 * what was done. Nothing is awarded for opening the app or saying you can do
 * something, and work the app could not hear is credited as exactly that, in its
 * own line, at its own rate: points that can be farmed stop being evidence, and
 * evidence is the whole product.
 *
 * The marks are the app's own icon set rather than an imported achievement pack.
 * A grab-bag of stock badges would read as bolted on next to a hand-drawn
 * plectrum and a hand-drawn capo, and it would carry a licence question for no
 * gain.
 */
const MARKS = {
  plectrum: PlectrumIcon,
  chart: ChartIcon,
  target: TargetIcon,
  bolt: BoltIcon,
  grip: GripIcon,
  flame: FlameIcon,
  tally: TallyIcon,
  trophy: TrophyIcon,
  sunrise: SunriseIcon,
} as const;

/**
 * How far into the earned row the settling stagger keeps counting. Past this
 * the wait costs more than the moment is worth, so the tail arrives together.
 */
const STAGGER_STEP_MS = 70;
const STAGGER_CAP = 6;

export function AchievementsPanel() {
  const { xp, level, achievements } = useAchievements();
  const dailyLogs = useUserData().dailyLogs;
  const rest = restAdvice(dailyLogs, getTodayString());

  const shown = achievements.filter((a) => a.earned || !a.hiddenUntilEarned);
  const earned = shown.filter((a) => a.earned);
  // Closest first: the useful order for a list of things not done yet.
  const pending = shown.filter((a) => !a.earned).sort((a, b) => b.progress - a.progress);
  const [nearest, ...later] = pending;

  return (
    <div className="ach">
      <Standing xp={xp} level={level} />

      {/* The one place the app tells you to stop. A streak counter on its own
          only ever says "do not break it", which is bad advice for hands six
          days into daily practice. */}
      {rest.earned && rest.message && (
        <p className="ach-rest" role="note">
          {rest.message}
        </p>
      )}

      {/* What the points are made of. A total with no breakdown is a score; a
          breakdown is a record of what you did. Withheld until there is
          something in it, because four zeros teach a new player nothing. */}
      {xp.totalRuns > 0 && (
        <section className="ach-figures">
          <Figure value={xp.practiceDays} label="days practised" />
          <Figure value={xp.totalRuns} label="drills heard" />
          <Figure value={xp.totalBests} label="personal bests" />
          <Figure value={xp.bestStreak} label="longest run" />
        </section>
      )}

      {earned.length > 0 && (
        <section className="ach-section">
          <h3 className="ach-section-title">Earned</h3>
          <ul className="ach-grid">
            {earned.map((a, i) => (
              <Tile
                key={a.id}
                achievement={a}
                settleDelayMs={Math.min(i, STAGGER_CAP) * STAGGER_STEP_MS}
              />
            ))}
          </ul>
        </section>
      )}

      {nearest && (
        <section className="ach-section">
          <h3 className="ach-section-title">Next in reach</h3>
          <Nearest achievement={nearest} />
        </section>
      )}

      {later.length > 0 && (
        <section className="ach-section">
          <h3 className="ach-section-title">{earned.length ? 'Still to come' : 'And after that'}</h3>
          <ul className="ach-grid">
            {later.map((a) => (
              <Tile key={a.id} achievement={a} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * The point total, broken into what earned it.
 *
 * A total on its own is a score. These lines are the record: what the app heard,
 * what its own clock witnessed, and what rests on the player's word. That last
 * one is the line that has to be here. Songs, strumming and stretches are real
 * practice the microphone will never hear, so they are paid, but a learner is
 * owed the truth about which part of their standing the app stands behind.
 *
 * Every line names something that happened, and every one of them only ever
 * adds. None of them prices a session against a better one: a rough run earns
 * the same base as a good one, and the panel must not imply otherwise. If a line
 * that subtracts is ever earned by real signal, it belongs here in the same
 * plain words, because a deduction the player cannot read is worse than no
 * deduction at all.
 *
 * Rows with nothing in them are left out. A new account showing five zeros would
 * teach nothing and read as a broken panel.
 */
const LEDGER: ReadonlyArray<{ key: keyof XpTotals['source']; label: string }> = [
  { key: 'heard', label: 'Drills the app heard' },
  { key: 'reps', label: 'Repetitions counted in them' },
  { key: 'timed', label: 'Blocks the app timed' },
  { key: 'bests', label: 'Personal bests' },
  { key: 'streak', label: 'Days in a row' },
  { key: 'stated', label: 'Taken on your word' },
];

/**
 * Where you stand.
 *
 * The level is the number that moves: every couple of days early on, every week
 * or so years in, and there is no last one. The bands are the places, drawn as
 * the ladder, and they arrive rarely enough that reaching one means something.
 * Showing only the number would be a counter; showing only the band would stop
 * moving for months at a time. The rungs are evenly spaced on purpose, because
 * they count bands rather than plotting points, and the real numbers are stated
 * underneath in words.
 */
function Standing({ xp, level }: { xp: XpTotals; level: LevelStanding }) {
  const rows = LEDGER.filter((row) => xp.source[row.key] > 0);
  const unheard = xp.source.timed + xp.source.stated;

  return (
    <section className="ach-standing">
      <h3 className="ach-standing-title">{level.band.title}</h3>
      <p className="ach-standing-rank">
        Level <span className="ach-standing-level">{level.level}</span>
      </p>
      <span className="ach-ladder" aria-hidden="true">
        {BANDS.map((band, i) => (
          <span
            key={band.from}
            className={clsx(
              'ach-rung',
              i < level.bandIndex && 'is-passed',
              i === level.bandIndex && 'is-here',
            )}
          >
            {i === level.bandIndex && (
              <span
                className="ach-rung-fill"
                style={{ width: `${Math.round(level.bandProgress * 100)}%` }}
              />
            )}
          </span>
        ))}
      </span>
      <p className="ach-standing-next">
        {xp.total === 0
          ? 'No points yet. The first drill the app hears starts this.'
          : `${xp.total.toLocaleString()} points. ${level.toNextLevel.toLocaleString()} to level ${level.level + 1}.`}
      </p>

      {/* Every value here is points, and it has to say so. The figures below
          count the same things ("160 drills heard") while these rows price them
          ("480 from drills the app heard"), and unlabelled the two read as the
          panel contradicting itself about your own practice. */}
      {rows.length > 0 && (
        <>
          <p className="ach-ledger-head">Where the points came from</p>
          <dl className="ach-ledger">
            {rows.map((row) => (
              <div className="ach-ledger-row" key={row.key}>
                <dt>{row.label}</dt>
                <dd>
                  {xp.source[row.key].toLocaleString()}
                  <span className="ach-ledger-unit"> pts</span>
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {unheard > 0 && (
        <p className="ach-standing-note">
          The app times what it cannot hear, and takes the rest on your word. Both are credited
          against what it did hear, so neither can carry a level on its own.
        </p>
      )}
    </section>
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

/** The one award closest to being earned, given the room to say what it needs. */
function Nearest({ achievement }: { achievement: EarnedAchievement }) {
  const Mark = MARKS[achievement.icon];
  const pct = Math.round(achievement.progress * 100);
  return (
    <div className="ach-nearest">
      <span className="ach-nearest-mark" aria-hidden="true">
        <Mark size={26} />
      </span>
      <div className="ach-nearest-body">
        <p className="ach-nearest-name">{achievement.title}</p>
        <p className="ach-nearest-goal">{achievement.goal}</p>
        {achievement.progress > 0 && (
          <span className="ach-meter is-live" aria-hidden="true">
            <span className="ach-meter-fill" style={{ width: `${pct}%` }} />
          </span>
        )}
        {/* The sentence carries the real numbers, so the bar can stay decoration
            for assistive tech rather than needing a value of its own. */}
        <p className="ach-nearest-fact">
          {achievement.detail ?? 'Nothing measured toward this one yet.'}
        </p>
      </div>
    </div>
  );
}

function Tile({
  achievement,
  settleDelayMs,
}: {
  achievement: EarnedAchievement;
  settleDelayMs?: number;
}) {
  const Mark = MARKS[achievement.icon];
  const pct = Math.round(achievement.progress * 100);
  return (
    <li className={clsx('ach-tile', achievement.earned && 'is-earned')}>
      <span
        className="ach-tile-mark"
        aria-hidden="true"
        style={settleDelayMs === undefined ? undefined : { animationDelay: `${settleDelayMs}ms` }}
      >
        {/* The award keeps its own mark once it is earned. Swapping in a tick
            erased the badge's identity at the exact moment it became worth
            looking at, and made nine different achievements look like one. */}
        <Mark size={22} />
      </span>
      <span className="ach-tile-name">
        {achievement.title}
        {achievement.earned && <span className="sr-only">, earned</span>}
      </span>
      {/* Earned, the line becomes the record: the title already says what the
          award means, so repeating the goal would waste the one line that could
          hold the learner's own number. */}
      <span className="ach-tile-line">
        {achievement.earned ? (achievement.detail ?? achievement.goal) : achievement.goal}
      </span>
      {!achievement.earned && achievement.progress > 0 && (
        <>
          <span className="ach-meter" aria-hidden="true">
            <span className="ach-meter-fill" style={{ width: `${pct}%` }} />
          </span>
          {achievement.detail && <span className="ach-tile-fact">{achievement.detail}</span>}
        </>
      )}
    </li>
  );
}
