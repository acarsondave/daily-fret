import './Loader.css';

interface Props {
  overlay?: boolean; // cover the screen (for lazy full-screen views)
  label?: string;
}

// Reuses the initial guitar-strings strum motion so any deferred load shows a
// calm, on-brand placeholder instead of a blank pause.
export function Loader({ overlay = false, label }: Props) {
  return (
    <div className={overlay ? 'app-loader is-overlay' : 'app-loader'}>
      <div className="app-loader-strings">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="app-loader-string" />
        ))}
      </div>
      {label && <span className="app-loader-label">{label}</span>}
    </div>
  );
}
