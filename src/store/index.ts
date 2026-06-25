import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Routine, DailyLog, Task } from '../types';

const defaultRoutines: Routine[] = [
  {
    id: 'r_10min',
    name: '10-Min Muscle Memory',
    description: 'Low energy day. 100% focused on physical mechanics.',
    isDefault: true,
    tasks: [
      { id: 't1', title: 'Spider Exercises', description: '1st fret start. Low E to high E.', duration: '5 mins' },
      { id: 't2', title: 'Lauren Bateman Pushups', description: '20 reps per finger on the G string.', duration: '2-3 mins' },
      { id: 't3', title: 'Chord Speed Training', description: 'A, D, E transitions. Goal: 65+ cpm.', duration: '3 mins', drill: { kind: 'one-minute-changes', chordFrom: 'A', chordTo: 'D', durationSec: 60 } }
    ]
  },
  {
    id: 'r_30min',
    name: '30-Min Concept Mastery',
    description: 'High energy day. Focus on JustinGuitar module concepts.',
    isDefault: true,
    tasks: [
      { id: 'c1', title: 'Spider Exercises', description: '1st fret start. Low E to high E.', duration: '5 mins' },
      { id: 'c2', title: 'Lauren Bateman Pushups', description: '20 reps per finger on the G string.', duration: '2-3 mins' },
      { id: 'c3', title: 'Chord Speed Training', description: 'A, D, E transitions. Goal: 65+ cpm.', duration: '3 mins', drill: { kind: 'one-minute-changes', chordFrom: 'A', chordTo: 'D', durationSec: 60 } },
      { id: 'c4', title: 'JustinGuitar Lesson', description: 'Watch and grasp new concepts from Module 2.', duration: '10 mins' },
      { id: 'c5', title: 'Song Integration', description: '"Wild Thing" by The Troggs practice.', duration: '10 mins' }
    ]
  }
];

const getTodayString = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

// Monotonic-ish wall clock used to stamp the last local mutation, so cloud sync
// can do last-write-wins and never clobber un-uploaded local changes.
const now = () => Date.now();

export interface UserData {
  routines: Routine[];
  dailyLogs: Record<string, DailyLog>;
  activeRoutineId: string;
  // Epoch ms of the last local mutation to this account. Drives conflict
  // resolution against the cloud copy. Older/legacy data defaults to 0.
  updatedAt: number;
}

const defaultUserData: UserData = {
  routines: defaultRoutines,
  dailyLogs: {},
  activeRoutineId: 'r_10min',
  updatedAt: 0,
};

interface AppState {
  accounts: Record<string, UserData>;
  currentAccountId: string; // 'anonymous' or firebase UID

  // Actions
  switchAccount: (uid: string) => void;
  syncFromRemote: (uid: string, data: Partial<UserData>) => void;

  addRoutine: (routine: Routine) => void;
  updateRoutine: (routineId: string, updates: Partial<Routine>) => void;
  deleteRoutine: (routineId: string) => void;
  addTask: (routineId: string, task: Task) => void;
  updateTask: (routineId: string, taskId: string, updates: Partial<Task>) => void;
  deleteTask: (routineId: string, taskId: string) => void;

  toggleTaskCompletion: (date: string, taskId: string) => void;
  saveFeedback: (date: string, feedback: string) => void;
  recordDrillResult: (date: string, taskId: string, cpm: number) => void;
  setActiveRoutine: (routineId: string) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => {
      // Apply a local mutation to the current account and stamp it as the most
      // recent write. Centralised so every action participates in last-write-wins.
      const mutate = (
        state: AppState,
        updater: (acc: UserData) => UserData,
      ): Partial<AppState> => {
        const accId = state.currentAccountId;
        const acc = state.accounts[accId] ?? defaultUserData;
        return {
          accounts: {
            ...state.accounts,
            [accId]: { ...updater(acc), updatedAt: now() },
          },
        };
      };

      return {
        accounts: {
          anonymous: defaultUserData,
        },
        currentAccountId: 'anonymous',

        switchAccount: (uid) => set((state) => {
          if (!state.accounts[uid]) {
            return {
              currentAccountId: uid,
              accounts: {
                ...state.accounts,
                [uid]: defaultUserData,
              },
            };
          }
          return { currentAccountId: uid };
        }),

        // Reconcile a remote/cloud snapshot into a local account using
        // last-write-wins: a strictly-newer local copy is preserved so a stale
        // cloud read (e.g. before a debounced upload landed) never wipes recent
        // local edits. Equal/newer remote data is applied.
        syncFromRemote: (uid, data) => set((state) => {
          const local = state.accounts[uid];
          const remoteUpdatedAt = data.updatedAt ?? 0;
          const localUpdatedAt = local?.updatedAt ?? 0;

          if (local && localUpdatedAt > remoteUpdatedAt) {
            return state;
          }

          const merged: UserData = {
            routines: data.routines?.length
              ? data.routines
              : local?.routines ?? defaultUserData.routines,
            dailyLogs: data.dailyLogs ?? local?.dailyLogs ?? {},
            activeRoutineId:
              data.activeRoutineId ??
              local?.activeRoutineId ??
              defaultUserData.activeRoutineId,
            updatedAt: remoteUpdatedAt,
          };

          return {
            accounts: { ...state.accounts, [uid]: merged },
          };
        }),

        addRoutine: (routine) => set((state) => {
          const acc = state.accounts[state.currentAccountId];
          if (acc.routines.length >= 10) {
            alert('Maximum limit of 10 routines reached.');
            return state;
          }
          return mutate(state, (a) => ({
            ...a,
            routines: [...a.routines, routine],
            activeRoutineId: a.routines.length === 0 ? routine.id : a.activeRoutineId,
          }));
        }),

        updateRoutine: (routineId, updates) => set((state) =>
          mutate(state, (a) => ({
            ...a,
            routines: a.routines.map((r) =>
              r.id === routineId ? { ...r, ...updates } : r,
            ),
          })),
        ),

        deleteRoutine: (routineId) => set((state) => {
          const acc = state.accounts[state.currentAccountId];
          if (acc.routines.length <= 1) {
            alert('You must have at least one routine.');
            return state;
          }
          return mutate(state, (a) => {
            const updatedRoutines = a.routines.filter((r) => r.id !== routineId);
            return {
              ...a,
              routines: updatedRoutines,
              activeRoutineId:
                a.activeRoutineId === routineId
                  ? updatedRoutines[0].id
                  : a.activeRoutineId,
            };
          });
        }),

        addTask: (routineId, task) => set((state) =>
          mutate(state, (a) => ({
            ...a,
            routines: a.routines.map((r) =>
              r.id === routineId ? { ...r, tasks: [...r.tasks, task] } : r,
            ),
          })),
        ),

        updateTask: (routineId, taskId, updates) => set((state) =>
          mutate(state, (a) => ({
            ...a,
            routines: a.routines.map((r) =>
              r.id !== routineId
                ? r
                : {
                    ...r,
                    tasks: r.tasks.map((t) =>
                      t.id === taskId ? { ...t, ...updates } : t,
                    ),
                  },
            ),
          })),
        ),

        deleteTask: (routineId, taskId) => set((state) =>
          mutate(state, (a) => ({
            ...a,
            routines: a.routines.map((r) =>
              r.id !== routineId
                ? r
                : { ...r, tasks: r.tasks.filter((t) => t.id !== taskId) },
            ),
          })),
        ),

        toggleTaskCompletion: (date, taskId) => set((state) =>
          mutate(state, (a) => {
            const log = a.dailyLogs[date] || {
              date,
              routineId: a.activeRoutineId,
              completedTaskIds: [],
            };
            const isCompleted = log.completedTaskIds.includes(taskId);
            const updatedTaskIds = isCompleted
              ? log.completedTaskIds.filter((id) => id !== taskId)
              : [...log.completedTaskIds, taskId];
            return {
              ...a,
              dailyLogs: {
                ...a.dailyLogs,
                [date]: { ...log, completedTaskIds: updatedTaskIds },
              },
            };
          }),
        ),

        saveFeedback: (date, feedback) => set((state) => {
          const acc = state.accounts[state.currentAccountId];
          if (!acc.dailyLogs[date]) return state;
          return mutate(state, (a) => ({
            ...a,
            dailyLogs: {
              ...a.dailyLogs,
              [date]: { ...a.dailyLogs[date], feedback },
            },
          }));
        }),

        recordDrillResult: (date, taskId, cpm) => set((state) =>
          mutate(state, (a) => {
            const log = a.dailyLogs[date] || {
              date,
              routineId: a.activeRoutineId,
              completedTaskIds: [],
            };
            const previousBest = log.drillResults?.[taskId] ?? 0;
            const completedTaskIds = log.completedTaskIds.includes(taskId)
              ? log.completedTaskIds
              : [...log.completedTaskIds, taskId];
            return {
              ...a,
              dailyLogs: {
                ...a.dailyLogs,
                [date]: {
                  ...log,
                  completedTaskIds,
                  drillResults: {
                    ...log.drillResults,
                    [taskId]: Math.max(previousBest, cpm),
                  },
                },
              },
            };
          }),
        ),

        setActiveRoutine: (routineId) => set((state) =>
          mutate(state, (a) => ({ ...a, activeRoutineId: routineId })),
        ),
      };
    },
    {
      name: 'daily-fret-storage',
    },
  ),
);

// Selector hook for convenience
export const useUserData = () => {
  const store = useStore();
  return store.accounts[store.currentAccountId] || defaultUserData;
};

export { getTodayString, defaultUserData };
