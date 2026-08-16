// One screen failing to download must not take the app with it.
//
// Every lazy surface in this app sat behind a bare `<Suspense>`, which catches a
// pending import and nothing else. A rejected one throws straight past it into
// the app-level ErrorBoundary, so the whole screen is replaced by "Something
// broke" because a panel did not arrive. Measured with every asset returning
// 404 — which is exactly what a Cloudflare Pages redeploy does to the previous
// build's hashed filenames while a tab is still open — Progress, the coached
// session, settings and every drill each destroyed the entire app.
//
// The design follows from what is actually true in that moment: nothing is
// broken, one piece is missing. So the recovery reads as an absence rather than
// an alarm. It occupies exactly the footprint the surface would have filled,
// drawn as the unfilled outline of the thing that should be there, with the
// practice list still visible around it. Nothing has to claim the failure is
// local, because you can see that it is.
//
// Reload is the primary action and deliberately not "Try again". React caches a
// lazy component's rejected promise, so retrying the same import can only fail
// again; and the usual cause is a newer build having replaced this one, which a
// reload is the actual fix for. Offering a retry that cannot work would be the
// same dishonesty the product refuses everywhere else.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RetryIcon } from './icons';
import './surfaceBoundary.css';

interface Props {
  /**
   * What the user was opening, in their words. Used verbatim, so pass "Progress"
   * and not "JourneyPanel".
   */
  name: string;
  /** A way out that is not a reload, when the surface has somewhere to go back to. */
  onDismiss?: () => void;
  /**
   * True for a surface that would have covered the screen: a drill, the coached
   * session, settings.
   *
   * The inline form takes the room the panel would have taken, which is what
   * makes the failure legibly local. A full-screen surface has no such room in
   * the flow, so its absence is drawn where it would have opened instead, over
   * a scrim, and it is always dismissable.
   */
  overlay?: boolean;
  /**
   * Changes when the guarded surface does: the open task's id, the selected tab,
   * null when nothing is open.
   *
   * An error boundary latches, and it has to, because re-rendering the thing
   * that just threw would only throw again. But a boundary wrapped around a
   * surface that comes and goes would then keep showing the failure over a
   * screen nobody opened. This is the signal that the surface behind it is a
   * different one now, and the failure belonged to the old one.
   *
   * Passed rather than solved by mounting the boundary inside the conditional,
   * because several of these surfaces sit under an AnimatePresence that has to
   * stay mounted for the closing animation to play at all.
   */
  resetKey?: string | null;
  children: ReactNode;
}

interface State {
  failed: boolean;
  shownFor: string | null | undefined;
}

export class SurfaceBoundary extends Component<Props, State> {
  state: State = { failed: false, shownFor: undefined };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (state.failed && state.shownFor !== props.resetKey) {
      return { failed: false, shownFor: props.resetKey };
    }
    if (!state.failed && state.shownFor !== props.resetKey) {
      return { shownFor: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logged rather than swallowed. A chunk that will not load is worth finding
    // in a console when someone reports a screen that would not open.
    console.error(`The ${this.props.name} screen failed to load`, error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <SurfaceMissing
        name={this.props.name}
        onDismiss={this.props.onDismiss}
        overlay={this.props.overlay}
      />
    );
  }
}

interface MissingProps {
  name: string;
  onDismiss?: () => void;
  overlay?: boolean;
}

export function SurfaceMissing({ name, onDismiss, overlay }: MissingProps) {
  const panel = (
    <div className={overlay ? 'surface-missing is-full' : 'surface-missing'} role="alert">
      <p className="surface-missing-title">{name} did not load.</p>
      {/* The one thing worth knowing before pressing reload, and the only claim
          here that is certain: the practice store writes to disk on every
          change, so nothing is lost. Why the chunk failed is not certain, so it
          is not asserted. */}
      <p className="surface-missing-body">
        Your practice is saved. Reloading fetches the current version.
      </p>
      <div className="surface-missing-actions">
        <button
          type="button"
          className="surface-missing-btn is-primary"
          onClick={() => window.location.reload()}
        >
          <RetryIcon size={16} /> Reload
        </button>
        {onDismiss && (
          <button type="button" className="surface-missing-btn" onClick={onDismiss}>
            Go back
          </button>
        )}
      </div>
    </div>
  );

  if (!overlay) return panel;
  return <div className="surface-missing-scrim">{panel}</div>;
}
