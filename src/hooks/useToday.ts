import { useSyncExternalStore } from 'react';
import { getTodayString } from '../store';

// The calendar day, as something the screen can listen to.
//
// Every surface used to read the date on render, and nothing renders the home
// screen when the day turns. A phone keeps the installed app alive in the
// background, so the list put down at 23:50 was the list picked up at 07:00:
// yesterday's ticks still showing, the week strip a day behind, the header on
// yesterday's date, and the next practice looking already done.
//
// So the day is an external store with two ways of noticing it changed: a timer
// set for just past the next local midnight, for a screen left open, and the
// page coming back into view, for a phone that slept through it (timers do not
// fire in a frozen tab, and waking one does not run the ones it missed).

let current = getTodayString();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function check() {
  const next = getTodayString();
  if (next !== current) {
    current = next;
    listeners.forEach((l) => l());
  }
  arm();
}

function msToNextMidnight(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

function arm() {
  if (timer) clearTimeout(timer);
  timer = listeners.size ? setTimeout(check, msToNextMidnight()) : null;
}

const onWake = () => {
  if (document.visibilityState !== 'hidden') check();
};

function subscribe(listener: () => void): () => void {
  if (!listeners.size) {
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('pageshow', onWake);
  }
  listeners.add(listener);
  // The day may have turned while nothing was listening.
  check();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('pageshow', onWake);
      arm();
    }
  };
}

const snapshot = () => current;

/** Today's date (YYYY-MM-DD, local), re-rendering the caller when it changes. */
export function useToday(): string {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
