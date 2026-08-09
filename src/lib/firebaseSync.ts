// Everything that touches the Firebase SDK. This module is ONLY ever reached
// through a dynamic import (see ./auth), which is what keeps ~250kB of Auth and
// Firestore out of the entry chunk of an app that works fully signed out.
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { auth, db } from "./firebase";
import {
  doc, getDoc, setDoc, onSnapshot, collection, addDoc, getDocs, query, orderBy, limit,
} from "firebase/firestore";
import { useStore, type UserData } from "../store";
import { useAuthStore, rememberSession } from "./authStore";
import type { Routine } from "../types";

export const signIn = (email: string, password: string) =>
  signInWithEmailAndPassword(auth, email, password);

export const signUp = (email: string, password: string) =>
  createUserWithEmailAndPassword(auth, email, password);

export const signOutUser = () => signOut(auth);

export interface ArchivedRoutine {
  id: string;
  routineId: string;
  name: string;
  reason: "edited" | "deleted";
  archivedAt: number;
  snapshot: Routine;
}

/**
 * Read the routine backlog, newest first.
 *
 * Every edit and delete has been snapshotted here since the feature shipped and
 * nothing has ever read it back, which made it a write-only archive: all of the
 * storage cost and none of the point.
 */
export const listArchivedRoutines = async (limitTo = 40): Promise<ArchivedRoutine[]> => {
  const user = auth.currentUser;
  if (!user) return [];
  const snap = await getDocs(
    query(
      collection(db, "users", user.uid, "routineArchive"),
      orderBy("archivedAt", "desc"),
      limit(limitTo),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ArchivedRoutine, "id">) }));
};

// Shape one routine-backlog entry: the routine as it was before this change,
// plus why and when it was captured.
const snapshotDoc = (routineJson: string, reason: "edited" | "deleted") => {
  const routine = JSON.parse(routineJson) as Routine;
  return {
    routineId: routine.id,
    name: routine.name,
    reason,
    archivedAt: Date.now(),
    snapshot: routine,
  };
};

let firestoreUnsubscribe: (() => void) | null = null;
let storeUnsubscribe: (() => void) | null = null;
let detachFlush: (() => void) | null = null;

export const startAuthListener = () => {
  onAuthStateChanged(auth, async (user) => {
    useAuthStore.getState().setUser(user);
    // Record whether this browser has a session, so the next visit knows
    // whether first paint should wait for the cloud (see ./authStore).
    rememberSession(!!user);

    // Clean up previous listeners
    if (firestoreUnsubscribe) {
      firestoreUnsubscribe();
      firestoreUnsubscribe = null;
    }
    if (storeUnsubscribe) {
      storeUnsubscribe();
      storeUnsubscribe = null;
    }
    if (detachFlush) {
      detachFlush();
      detachFlush = null;
    }

    try {
    if (user) {
      useStore.getState().switchAccount(user.uid);

      const userRef = doc(db, "users", user.uid);

      // Initial reconcile. `syncFromRemote` is last-write-wins: it will KEEP the
      // locally-rehydrated copy when it is newer than the cloud read, so checks
      // made just before a refresh (before the debounced upload landed) survive.
      const docSnap = await getDoc(userRef);
      if (docSnap.exists()) {
        const cloudData = docSnap.data() as Partial<UserData>;
        useStore.getState().syncFromRemote(user.uid, cloudData);

        // If our local copy won the merge (it was newer), push it up so the
        // cloud catches up to what the user actually has.
        const reconciled = useStore.getState().accounts[user.uid];
        if (reconciled && reconciled.updatedAt > (cloudData.updatedAt ?? 0)) {
          await setDoc(userRef, reconciled);
        }
      } else {
        // No cloud doc yet. Seed it from whichever local copy is freshest —
        // the just-created uid account or the guest's anonymous data.
        const uidData = useStore.getState().accounts[user.uid];
        const anonData = useStore.getState().accounts['anonymous'];
        const seed =
          anonData && (anonData.updatedAt ?? 0) > (uidData?.updatedAt ?? 0)
            ? anonData
            : uidData;
        if (seed) {
          useStore.getState().syncFromRemote(user.uid, JSON.parse(JSON.stringify(seed)));
          await setDoc(userRef, useStore.getState().accounts[user.uid]);
        }
      }

      // Keep the local anonymous mirror aligned so logging out preserves data.
      useStore.getState().syncFromRemote('anonymous', useStore.getState().accounts[user.uid]);

      let isSyncing = false;
      let uploadTimeout: ReturnType<typeof setTimeout> | null = null;

      // Backlog: the JSON of each routine we've already captured, so edits/deletes
      // archive the *prior* version once (not on every sync). The live doc always
      // holds the current version, so archive + live = full history.
      const archiveBaseline = new Map<string, string>();
      const seedArchiveBaseline = (routines: Routine[] | undefined) => {
        archiveBaseline.clear();
        for (const r of routines ?? []) archiveBaseline.set(r.id, JSON.stringify(r));
      };
      seedArchiveBaseline(useStore.getState().accounts[user.uid]?.routines);

      const archiveCol = collection(db, "users", user.uid, "routineArchive");
      const archiveRoutineChanges = (routines: Routine[]) => {
        const writes: Promise<unknown>[] = [];
        const present = new Set<string>();
        for (const r of routines) {
          present.add(r.id);
          const json = JSON.stringify(r);
          const prev = archiveBaseline.get(r.id);
          if (prev === undefined) {
            archiveBaseline.set(r.id, json); // new routine, nothing prior to keep
            continue;
          }
          if (prev !== json) {
            writes.push(addDoc(archiveCol, snapshotDoc(prev, "edited")));
            archiveBaseline.set(r.id, json);
          }
        }
        for (const id of [...archiveBaseline.keys()]) {
          if (!present.has(id)) {
            writes.push(addDoc(archiveCol, snapshotDoc(archiveBaseline.get(id)!, "deleted")));
            archiveBaseline.delete(id);
          }
        }
        if (writes.length) {
          Promise.all(writes).catch((err) => console.error("Routine archive error", err));
        }
      };

      const pushNow = () => {
        if (uploadTimeout) {
          clearTimeout(uploadTimeout);
          uploadTimeout = null;
        }
        const data = useStore.getState().accounts[user.uid];
        if (!data) return;
        archiveRoutineChanges(data.routines);
        setDoc(userRef, data, { merge: true }).catch((err) => {
          console.error("Firestore sync error", err);
        });
      };

      // Listen for remote changes (e.g. another device). LWW in the store keeps
      // this from clobbering newer local edits, and the pending-writes guard
      // ignores our own echoes.
      firestoreUnsubscribe = onSnapshot(userRef, (snapshot) => {
        if (snapshot.exists() && !snapshot.metadata.hasPendingWrites) {
          isSyncing = true;
          const remoteData = snapshot.data() as Partial<UserData>;
          useStore.getState().syncFromRemote(user.uid, remoteData);
          useStore.getState().syncFromRemote('anonymous', remoteData);
          // A remote change is the new baseline — don't re-archive another
          // device's edits as if they were local ones.
          seedArchiveBaseline(useStore.getState().accounts[user.uid]?.routines);
          setTimeout(() => { isSyncing = false; }, 50);
        }
      });

      // Sync local changes up to Firestore (debounced).
      storeUnsubscribe = useStore.subscribe((state, prevState) => {
        if (isSyncing) return;
        const currentData = state.accounts[user.uid];
        const prevData = prevState.accounts[user.uid];
        if (currentData && currentData !== prevData) {
          if (uploadTimeout) clearTimeout(uploadTimeout);
          uploadTimeout = setTimeout(pushNow, 1500);
        }
      });

      // Flush any pending upload when the tab is hidden or closing, so a refresh
      // or navigation doesn't drop the debounced write. (LWW also recovers it on
      // next load, but flushing keeps the cloud promptly up to date.)
      const onHide = () => {
        if (document.visibilityState === 'hidden') pushNow();
      };
      const onPageHide = () => pushNow();
      document.addEventListener('visibilitychange', onHide);
      window.addEventListener('pagehide', onPageHide);
      detachFlush = () => {
        document.removeEventListener('visibilitychange', onHide);
        window.removeEventListener('pagehide', onPageHide);
      };

    } else {
      const state = useStore.getState();
      const currentId = state.currentAccountId;
      if (currentId !== 'anonymous' && state.accounts[currentId]) {
        state.syncFromRemote('anonymous', state.accounts[currentId]);
      }
      useStore.getState().switchAccount('anonymous');
    }
    } catch (err) {
      // Never leave the app stuck on the loader: if cloud sync fails (offline,
      // permissions, blocked transport), fall through to the local-first state.
      console.error('Auth/sync initialization failed; continuing locally', err);
    } finally {
      useAuthStore.getState().setLoading(false);
    }
  });
};
