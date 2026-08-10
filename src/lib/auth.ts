// The auth facade. Everything outside this file talks to auth through here, so
// nothing else has a static path to the Firebase SDK.
//
// Before this split, `lib/auth.ts` imported firebase/auth and firebase/firestore
// at module scope and App.tsx imported it at module scope in turn, so the whole
// SDK sat in the entry chunk and every first-time visitor downloaded Firestore
// before they could see a single task, in an app that is local-first and fully
// usable signed out.
//
// Splitting the chunk out was only half of it. A returning signed-in user still
// held the splash until this chunk had downloaded, Firebase had refreshed its
// token and Firestore had answered a getDoc: four serial network dependencies
// before a screen the device could have painted from localStorage. Nothing
// waits for the cloud any more. It reconciles behind the painted screen, which
// is what last-write-wins in the store was always for.

import { useAuthStore, hadSession } from './authStore';

export { useAuthStore } from './authStore';

type SyncModule = typeof import('./firebaseSync');

let pending: Promise<SyncModule> | null = null;

function loadSync(): Promise<SyncModule> {
  if (!pending) pending = import('./firebaseSync');
  return pending;
}

// If the SDK never loads (offline, blocked, ad-blocker on the auth domain), the
// header must stop claiming a sync is on its way. Nothing is blocked on this;
// it only stops the affordance lying.
const LOAD_TIMEOUT_MS = 8000;

function runIdle(fn: () => void, timeout: number): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback;
  if (ric) ric(fn, { timeout });
  else setTimeout(fn, Math.min(timeout, 200));
}

export function initAuthListener(): void {
  const start = () => {
    const failSafe = setTimeout(() => {
      console.warn('Cloud sync did not load in time; continuing locally');
      useAuthStore.getState().setSyncing(false);
    }, LOAD_TIMEOUT_MS);

    void loadSync()
      .then((m) => m.startAuthListener())
      .catch((err) => {
        console.error('Cloud sync unavailable; continuing locally', err);
        useAuthStore.getState().setSyncing(false);
      })
      .finally(() => clearTimeout(failSafe));
  };

  // Everyone, signed in or not, is already looking at their routine by now: the
  // app paints from localStorage and the cloud only ever reconciles behind it.
  // So the SDK waits for an idle moment rather than competing with first paint.
  // A returning user gets a shorter leash because their reconcile is the one
  // that can actually change what is on screen.
  runIdle(start, hadSession() ? 300 : 2000);
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
