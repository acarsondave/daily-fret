import { create } from 'zustand';
import type { Routine, Task } from '../types';

/**
 * The last thing the user deleted, and how to put it back.
 *
 * Deliberately its own store rather than a field on the account: an undo offer
 * is about this moment at this keyboard, not a fact about the user, and putting
 * it in the persisted account would sync a transient affordance to every other
 * device and back again.
 *
 * Position is kept alongside the item because restoring a task to the end of the
 * routine is not restoring it. The order of a routine is the exact sequence
 * Coached mode plays, so a task that comes back in the wrong place has silently
 * rewritten the session.
 */
export interface TaskDeletion {
  kind: 'task';
  id: string;
  routineId: string;
  task: Task;
  index: number;
  label: string;
}

export interface RoutineDeletion {
  kind: 'routine';
  id: string;
  routine: Routine;
  index: number;
  label: string;
}

export type Deletion = TaskDeletion | RoutineDeletion;

/** How long the offer stands. Long enough to notice, short enough to forget. */
export const UNDO_WINDOW_MS = 9000;

interface UndoState {
  pending: Deletion[];
  offer: (deletion: Omit<TaskDeletion, 'id'> | Omit<RoutineDeletion, 'id'>) => string;
  take: (id: string) => Deletion | null;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useUndoStore = create<UndoState>()((set, get) => ({
  pending: [],

  offer: (deletion) => {
    const id = crypto.randomUUID();
    set((state) => ({ pending: [...state.pending, { ...deletion, id } as Deletion] }));
    return id;
  },

  // Removes and returns in one step, so a double tap on Undo cannot restore the
  // same task twice.
  take: (id) => {
    const found = get().pending.find((d) => d.id === id) ?? null;
    if (found) set((state) => ({ pending: state.pending.filter((d) => d.id !== id) }));
    return found;
  },

  dismiss: (id) => set((state) => ({ pending: state.pending.filter((d) => d.id !== id) })),

  clear: () => set({ pending: [] }),
}));
