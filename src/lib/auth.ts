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

export const initAuthListener = () => {
  onAuthStateChanged(auth, async (user) => {
    useAuthStore.getState().setUser(user);
    
    if (user) {
      useStore.getState().switchAccount(user.uid);
      
      // Setup Firestore sync
      const userRef = doc(db, "users", user.uid);
      
      // Initial fetch to see if data exists remotely
      const docSnap = await getDoc(userRef);
      if (docSnap.exists()) {
        useStore.getState().syncFromRemote(user.uid, docSnap.data() as any);
      } else {
        // If no remote data, upload the local default data for this user
        const localData = useStore.getState().accounts[user.uid];
        if (localData) {
          await setDoc(userRef, localData);
        }
      }

      // Listen for remote changes
      onSnapshot(userRef, (snapshot) => {
        if (snapshot.exists() && !snapshot.metadata.hasPendingWrites) {
           useStore.getState().syncFromRemote(user.uid, snapshot.data() as any);
        }
      });
      
      // Setup a subscriber to sync local changes up to Firestore
      useStore.subscribe((state, prevState) => {
        const currentData = state.accounts[user.uid];
        const prevData = prevState.accounts[user.uid];
        
        if (currentData && currentData !== prevData) {
          setDoc(userRef, currentData, { merge: true }).catch(err => {
            console.error("Firestore sync error", err);
          });
        }
      });

    } else {
      useStore.getState().switchAccount('anonymous');
    }
    
    useAuthStore.getState().setLoading(false);
  });
};
