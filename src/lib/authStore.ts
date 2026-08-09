import { create } from 'zustand';
// Type-only: erased at build time, so this file never pulls the Firebase SDK
// into the bundle. That is the whole point of keeping the store separate from
// the sync layer.
import type { User } from 'firebase/auth';

const SESSION_HINT_KEY = 'daily-fret-had-session';

// Whether this browser has ever completed a sign-in. Firebase keeps the real
// session in IndexedDB and only the SDK can read it, so this is a cheap,
// synchronous hint used for one decision: whether the first paint should wait
// for the cloud, or go straight to the local-first data that is already here.
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
  loading: boolean;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  // A returning signed-in user waits for their cloud state so the routine does
  // not visibly swap under them. Everyone else renders immediately: the app is
  // local-first, their practice is already in localStorage, and holding the
  // screen on an auth check they will never pass is pure delay.
  loading: hadSession(),
  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
}));
