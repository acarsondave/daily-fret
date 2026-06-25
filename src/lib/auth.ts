import { onAuthStateChanged, type User } from "firebase/auth";
import { auth, db } from "./firebase";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import { create } from "zustand";
import { useStore, type UserData } from "../store";

interface AuthState {
  user: User | null;
  loading: boolean;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading })
}));

let firestoreUnsubscribe: (() => void) | null = null;
let storeUnsubscribe: (() => void) | null = null;
let detachFlush: (() => void) | null = null;

export const initAuthListener = () => {
  onAuthStateChanged(auth, async (user) => {
    useAuthStore.getState().setUser(user);

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

      const pushNow = () => {
        if (uploadTimeout) {
          clearTimeout(uploadTimeout);
          uploadTimeout = null;
        }
        const data = useStore.getState().accounts[user.uid];
        if (!data) return;
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
