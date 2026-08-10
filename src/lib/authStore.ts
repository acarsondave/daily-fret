import { create } from 'zustand';
// Type-only: erased at build time, so this file never pulls the Firebase SDK
// into the bundle. That is the whole point of keeping the store separate from
// the sync layer.
import type { User } from 'firebase/auth';

const SESSION_HINT_KEY = 'daily-fret-had-session';

// Whether this browser has ever completed a sign-in. Firebase keeps the real
// session in IndexedDB and only the SDK can read it, so this is a cheap,
// synchronous hint used for one decision: whether the header should say the
// cloud copy is still coming. It no longer decides anything about first paint;
// nothing waits for the cloud any more.
export function hadSession(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberSession(has: boolean): void {
  try {
    if (has) localStorage.setItem(SESSION_HINT_KEY, '1');
    else localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    /* storage disabled (private mode) */
  }
}

interface AuthState {
  user: User | null;
  /**
   * The cloud copy is still being fetched and reconciled. This is reported, not
   * waited on: the screen is already painted from the local copy by the time it
   * is ever true.
   */
  syncing: boolean;
  setUser: (user: User | null) => void;
  setSyncing: (syncing: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  // A browser that has signed in before will reconcile with the cloud on this
  // load, so say so from the first frame rather than flashing "This device" and
  // correcting itself a few seconds later.
  syncing: hadSession(),
  setUser: (user) => set({ user }),
  setSyncing: (syncing) => set({ syncing }),
}));
