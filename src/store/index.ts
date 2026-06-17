import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Routine, DailyLog } from '../types';

const defaultRoutines: Routine[] = [
  {
    id: 'muscle-10',
    name: '10-Min Muscle',
    description: 'Low energy day. 100% focused on physical mechanics.',
    isDefault: true,
    tasks: [
      { id: 't1', title: 'Spider Exercises', description: '1st fret start. Low E to high E.', duration: '5 mins' },
      { id: 't2', title: 'Lauren Bateman Pushups', description: '20 reps per finger on the G string.', duration: '2-3 mins' },
      { id: 't3', title: 'Chord Speed Training', description: 'A, D, E transitions. Goal: 65+ cpm.', duration: '3 mins' }
    ]
  },
  {
    id: 'concept-30',
    name: '30-Min Concept',
    description: 'High energy day. Focus on JustinGuitar module concepts.',
    isDefault: true,
    tasks: [
      { id: 'c1', title: 'Spider Exercises', description: '1st fret start. Low E to high E.', duration: '5 mins' },
      { id: 'c2', title: 'Lauren Bateman Pushups', description: '20 reps per finger on the G string.', duration: '2-3 mins' },
      { id: 'c3', title: 'Chord Speed Training', description: 'A, D, E transitions. Goal: 65+ cpm.', duration: '3 mins' },
      { id: 'c4', title: 'JustinGuitar Lesson', description: 'Watch and grasp new concepts from Module 2.', duration: '10 mins' },
      { id: 'c5', title: 'Song Integration', description: '"Wild Thing" by The Troggs practice.', duration: '10 mins' }
    ]
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
  activeRoutineId: 'muscle-10'
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
    (set, get) => ({
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
