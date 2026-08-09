import { useStreak } from '../hooks/useStreak';
import { getTodayString } from '../store';
import { FlameIcon } from './icons';
import clsx from 'clsx';
import './StreakGraph.css';

export function StreakGraph() {
  const { currentStreak, graphData } = useStreak();
  const today = getTodayString();

  return (
    <div className="streak-container">
      <div className="streak-header-info">
        {currentStreak > 0 && (
          <span className="streak-count">
            <FlameIcon size={13} />
            {currentStreak} day{currentStreak > 1 ? 's' : ''}
          </span>
        )}
      </div>
      {/* The seven blocks are a summary, not a control: one accessible sentence
          beats seven title attributes a keyboard can never reach. */}
      <div
        className="streak-graph"
        role="img"
        aria-label={
          currentStreak > 0
            ? `Practice streak: ${currentStreak} day${currentStreak > 1 ? 's' : ''}. Last seven days shown.`
            : 'No current practice streak. Last seven days shown.'
        }
      >
        {graphData.map((day) => (
          <div
            key={day.date}
            className={clsx('streak-day-col', day.date === today && 'is-today')}
          >
            <div className={`streak-block intensity-${day.intensity}`} aria-hidden="true" />
            <span className="streak-day-label" aria-hidden="true">
              {day.dayOfWeek}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
