// Fetching the tuner's code, kept apart from the component that waits on it so
// the button in DailyPath can warm the chunk without importing a React tree.

import type { ComponentType } from 'react';

export type TunerComponent = ComponentType<{ onClose: () => void }>;

let inFlight: Promise<TunerComponent> | null = null;

export function loadTuner(): Promise<TunerComponent> {
  if (inFlight) return inFlight;
  const attempt = import('./Tuner').then((m) => m.Tuner);
  // A rejection must not be remembered. The browser's own module map already
  // refuses to refetch a failed URL, and holding the rejected promise here would
  // mean even a reload-free retry never reached the network again.
  attempt.catch(() => {
    inFlight = null;
  });
  inFlight = attempt;
  return attempt;
}

/**
 * Fetch the tuner ahead of the click that needs it.
 *
 * Worth doing for more than speed. The tuner asks for the microphone as it
 * mounts, and on Safari the user activation from the tap is what decides whether
 * the audio route is allowed to start. A chunk fetched between the tap and the
 * mount spends that activation on the network, so warming it on pointerdown puts
 * the microphone request back inside the gesture that asked for it.
 */
export function preloadTuner(): void {
  // A speculative warm-up that fails is not an event: the real open reports it,
  // with a retry and a way out.
  void loadTuner().catch(() => {});
}
