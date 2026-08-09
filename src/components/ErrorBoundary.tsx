import { Component, type ReactNode } from 'react';
import { RetryIcon } from './icons';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// App-level safety net: a thrown render error would otherwise leave a blank
// screen. This shows a calm, on-brand recovery surface instead.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('Unhandled UI error', error, info);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="error-fallback">
        <div className="error-fallback-card">
          <h1>Something broke</h1>
          <p>The app hit an unexpected error. Your saved progress is safe.</p>
          <div className="error-fallback-actions">
            <button className="error-fallback-btn primary" onClick={() => window.location.reload()}>
              <RetryIcon size={18} /> Reload
            </button>
            <button className="error-fallback-btn" onClick={this.reset}>
              Try to continue
            </button>
          </div>
        </div>
      </div>
    );
  }
}
