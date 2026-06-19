import { useMemo } from 'react';
import { useUserData } from '../store';

export function useStreak() {
  const { dailyLogs } = useUserData();

  return useMemo(() => {
    const today = new Date();
    // Normalize to start of day local time
    today.setHours(0, 0, 0, 0);
    
    let currentStreak = 0;
    
    for (let i = 0; i < 1000; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      
      const log = dailyLogs[dateStr];
      const hasCompletedTask = log && log.completedTaskIds && log.completedTaskIds.length > 0;
      
      if (hasCompletedTask) {
        currentStreak++;
      } else {
        if (i === 0) {
          // It's today. Missing today doesn't break an ongoing streak from yesterday.
          continue;
        } else {
          // Missed a past day, streak is broken.
          break;
        }
      }
    }

    // Generate graph data for the last 7 days
    const graphData = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      
      const log = dailyLogs[dateStr];
      const count = log && log.completedTaskIds ? log.completedTaskIds.length : 0;
      
      let intensity = 0;
      if (count > 0) intensity = 1;
      if (count > 2) intensity = 2;
      if (count > 4) intensity = 3;
      if (count > 6) intensity = 4;

      graphData.push({
        date: dateStr,
        dayOfWeek: d.toLocaleDateString('en-US', { weekday: 'short' }).charAt(0), // 'M', 'T', 'W'
        count,
        intensity
      });
    }

    return { currentStreak, graphData };
  }, [dailyLogs]);
}
