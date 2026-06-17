import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Routine, DailyLog } from '../types';

const defaultRoutines: Routine[] = [
  {
    id: 'r_empty_1',
    name: 'My Routine',
    description: '',
    isDefault: true,
    tasks: []
  }
];

const getTodayString = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

interface UserData {
  routines: Routine[];
  dailyLogs: Record<string, DailyLog>;
  activeRoutineId: string;
}

const defaultUserData: UserData = {
  routines: defaultRoutines,
  dailyLogs: {},
  activeRoutineId: 'r_empty_1'
};

interface AppState {
  accounts: Record<string, UserData>;
  currentAccountId: string; // 'anonymous' or firebase UID
  
  // Actions
  switchAccount: (uid: string) => void;
  syncFromRemote: (uid: string, data: UserData) => void;
  
  addRoutine: (routine: Routine) => void;
  toggleTaskCompletion: (date: string, taskId: string) => void;
  saveFeedback: (date: string, feedback: string) => void;
  setActiveRoutine: (routineId: string) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      accounts: {
        'anonymous': defaultUserData
      },
      currentAccountId: 'anonymous',
      
      switchAccount: (uid) => set((state) => {
        if (!state.accounts[uid]) {
          // Initialize new account with default data or empty
          return {
            currentAccountId: uid,
            accounts: {
              ...state.accounts,
              [uid]: defaultUserData
            }
          };
        }
        return { currentAccountId: uid };
      }),

      syncFromRemote: (uid, data) => set((state) => ({
        accounts: {
          ...state.accounts,
          [uid]: data
        }
      })),

      addRoutine: (routine) => set((state) => {
        const accId = state.currentAccountId;
        const acc = state.accounts[accId];
        return {
          accounts: {
            ...state.accounts,
            [accId]: {
              ...acc,
              routines: [...acc.routines, routine]
            }
          }
        };
      }),

      toggleTaskCompletion: (date, taskId) => set((state) => {
        const accId = state.currentAccountId;
        const acc = state.accounts[accId];
        const log = acc.dailyLogs[date] || {
          date,
          routineId: acc.activeRoutineId,
          completedTaskIds: []
        };
        
        const isCompleted = log.completedTaskIds.includes(taskId);
        const updatedTaskIds = isCompleted 
          ? log.completedTaskIds.filter(id => id !== taskId)
          : [...log.completedTaskIds, taskId];
          
        return {
          accounts: {
            ...state.accounts,
            [accId]: {
              ...acc,
              dailyLogs: {
                ...acc.dailyLogs,
                [date]: { ...log, completedTaskIds: updatedTaskIds }
              }
            }
          }
        };
      }),

      saveFeedback: (date, feedback) => set((state) => {
        const accId = state.currentAccountId;
        const acc = state.accounts[accId];
        const log = acc.dailyLogs[date];
        if (!log) return state;
        
        return {
          accounts: {
            ...state.accounts,
            [accId]: {
              ...acc,
              dailyLogs: {
                ...acc.dailyLogs,
                [date]: { ...log, feedback }
              }
            }
          }
        };
      }),

      setActiveRoutine: (routineId) => set((state) => {
        const accId = state.currentAccountId;
        const acc = state.accounts[accId];
        return {
          accounts: {
            ...state.accounts,
            [accId]: {
              ...acc,
              activeRoutineId: routineId
            }
          }
        };
      })
    }),
    {
      name: 'daily-fret-storage'
    }
  )
);

// Selector hook for convenience
export const useUserData = () => {
  const store = useStore();
  return store.accounts[store.currentAccountId] || defaultUserData;
};

export { getTodayString };
