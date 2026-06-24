import { onAuthStateChanged, type User } from "firebase/auth";
import { auth, db } from "./firebase";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import { create } from "zustand";
import { useStore } from "../store";

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
    
    try {
    if (user) {
      useStore.getState().switchAccount(user.uid);
      
      // Setup Firestore sync
      const userRef = doc(db, "users", user.uid);
      
      // Initial fetch to see if data exists remotely
      const docSnap = await getDoc(userRef);
      if (docSnap.exists()) {
        const cloudData = docSnap.data() as any;
        const anonData = useStore.getState().accounts['anonymous'];
        
        // Merge anonymous local data into existing cloud data
        const mergedData = { ...cloudData };
        if (anonData) {
          const newRoutines = (anonData.routines || []).filter(r => !r.isDefault && !cloudData.routines?.some((cr: any) => cr.id === r.id));
          mergedData.routines = [...(cloudData.routines || []), ...newRoutines];
          mergedData.dailyLogs = { ...(cloudData.dailyLogs || {}), ...(anonData.dailyLogs || {}) };
          
          // Push the merged result up immediately
          await setDoc(userRef, mergedData);
        }
        
        useStore.getState().syncFromRemote(user.uid, mergedData);
        // Sync downwards to local anonymous so they stay in perfect sync
        useStore.getState().syncFromRemote('anonymous', mergedData);
      } else {
        // New account! Push the anonymous data so they don't lose their local progress
        const anonData = useStore.getState().accounts['anonymous'];
        if (anonData) {
          useStore.getState().syncFromRemote(user.uid, JSON.parse(JSON.stringify(anonData)));
          await setDoc(userRef, anonData);
        }
      }

      let isSyncing = false;
      let uploadTimeout: ReturnType<typeof setTimeout> | null = null;

      // Listen for remote changes
      firestoreUnsubscribe = onSnapshot(userRef, (snapshot) => {
        if (snapshot.exists() && !snapshot.metadata.hasPendingWrites) {
           isSyncing = true;
           const remoteData = snapshot.data() as any;
           useStore.getState().syncFromRemote(user.uid, remoteData);
           // Also keep local anonymous in sync with remote changes
           useStore.getState().syncFromRemote('anonymous', remoteData);
           setTimeout(() => { isSyncing = false; }, 50);
        }
      });
      
      // Setup a subscriber to sync local changes up to Firestore
      storeUnsubscribe = useStore.subscribe((state, prevState) => {
        if (isSyncing) return;

        const currentData = state.accounts[user.uid];
        const prevData = prevState.accounts[user.uid];
        
        if (currentData && currentData !== prevData) {
          // Debounce the network request to prevent memory spikes and high write volume
          if (uploadTimeout) clearTimeout(uploadTimeout);
          
          uploadTimeout = setTimeout(() => {
            setDoc(userRef, currentData, { merge: true }).catch(err => {
              console.error("Firestore sync error", err);
            });
          }, 1500);
        }
      });

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
