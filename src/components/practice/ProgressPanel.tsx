import { useDrillStats } from '../../lib/drillStats';
import { Sparkline } from './Sparkline';
import './progress.css';

// Maps a normalized speed (0..1) to a cool-to-warm hue: slow pairs read blue,
// fast pairs read amber. This is the heatmap encoding for practiced pairs.
function speedColor(t: number): string {
  const hue = 210 + (40 - 210) * t;
  return `hsl(${hue}, 85%, 62%)`;
}

export function ProgressPanel() {
  const stats = useDrillStats().filter((s) => s.series.length > 0);

  if (stats.length === 0) {
    return (
      <p className="progress-empty">
        Run a 1-Minute Changes drill to start tracking your change speed.
      </p>
    );
  }

  const maxBest = Math.max(...stats.map((s) => s.best));
  const sorted = [...stats].sort((a, b) => b.best - a.best);

  return (
    <div className="progress-grid">
      {sorted.map((s) => {
        const t = maxBest > 0 ? s.best / maxBest : 0;
        const color = speedColor(t);
        return (
          <div key={s.taskId} className="progress-card">
            <div className="progress-card-head">
              <span className="progress-pair">
                {s.from} <span className="progress-arrow">→</span> {s.to}
              </span>
              {s.today !== null && (
                <span className="progress-today">today {s.today}</span>
              )}
            </div>

            <div className="progress-best" style={{ color }}>
              {s.best}
              <span className="progress-best-unit">cpm</span>
            </div>

            {s.series.length >= 2 && (
              <div className="progress-spark" style={{ color }}>
                <Sparkline
                  values={s.series.map((p) => p.cpm)}
                  width={150}
                  height={34}
                />
              </div>
            )}

            <div className="progress-heat">
              <div
                className="progress-heat-fill"
                style={{ width: `${Math.max(8, t * 100)}%`, background: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
