import { useStreak } from '../hooks/useStreak';
import './StreakGraph.css';

export function StreakGraph() {
  const { currentStreak, graphData } = useStreak();

  return (
    <div className="streak-container">
      <div className="streak-header-info">
        {currentStreak > 0 && (
          <span className="streak-count">
            {currentStreak} Day{currentStreak > 1 ? 's' : ''} Streak
          </span>
        )}
      </div>
      <div className="streak-graph">
        {graphData.map((day) => (
          <div key={day.date} className="streak-day-col">
            <div 
              className={`streak-block intensity-${day.intensity}`} 
              title={`${day.count} tasks completed on ${day.date}`}
            />
            <span className="streak-day-label">{day.dayOfWeek}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
