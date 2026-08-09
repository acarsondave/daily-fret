// The auth facade. Everything outside this file talks to auth through here, so
// nothing else has a static path to the Firebase SDK.
//
// Before this split, `lib/auth.ts` imported firebase/auth and firebase/firestore
// at module scope and App.tsx imported it at module scope in turn, so the whole
// SDK sat in the entry chunk and every first-time visitor downloaded Firestore
// before they could see a single task, in an app that is local-first and fully
// usable signed out. It also gated first paint: `loading` started true and only
// cleared inside onAuthStateChanged, so the splash sat there until an auth
// round-trip finished.

import { useAuthStore, hadSession } from './authStore';

export { useAuthStore } from './authStore';

type SyncModule = typeof import('./firebaseSync');

let pending: Promise<SyncModule> | null = null;

function loadSync(): Promise<SyncModule> {
  if (!pending) pending = import('./firebaseSync');
  return pending;
}

// If the SDK cannot load at all (offline, blocked, ad-blocker on the auth
// domain), a returning user must not be left staring at the splash forever.
// Local practice data is already in the store; fall through to it.
const LOAD_TIMEOUT_MS = 8000;

function runIdle(fn: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback;
  if (ric) ric(fn, { timeout: 2000 });
  else setTimeout(fn, 200);
}

export function initAuthListener(): void {
  const start = () => {
    const failSafe = setTimeout(() => {
      console.warn('Cloud sync did not load in time; continuing locally');
      useAuthStore.getState().setLoading(false);
    }, LOAD_TIMEOUT_MS);

    void loadSync()
      .then((m) => m.startAuthListener())
      .catch((err) => {
        console.error('Cloud sync unavailable; continuing locally', err);
        useAuthStore.getState().setLoading(false);
      })
      .finally(() => clearTimeout(failSafe));
  };

  // A returning signed-in user is watching a splash until this resolves, so it
  // goes first. A signed-out visitor is already looking at their routine, so the
  // SDK waits for an idle moment rather than competing with first paint.
  if (hadSession()) start();
  else runIdle(start);
}

export async function signIn(email: string, password: string) {
  return (await loadSync()).signIn(email, password);
}

export async function signUp(email: string, password: string) {
  return (await loadSync()).signUp(email, password);
}

// Routine backlog, read on demand. Goes through the facade like everything else
// so opening the restore panel is what pulls the SDK, not loading the app.
export async function listArchivedRoutines(limitTo?: number) {
  const mod = await import('./firebaseSync');
  return mod.listArchivedRoutines(limitTo);
}

export type { ArchivedRoutine } from './firebaseSync';

export async function signOutUser() {
  return (await loadSync()).signOutUser();
}
