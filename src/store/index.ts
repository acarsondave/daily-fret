import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { guardedStorage } from './persistence';
import type { Routine, DailyLog, Task } from '../types';
import {
  applyMeasurements,
  applyStated,
  applyTime,
  blankLog,
  clearRecord,
  settle,
  type DrillMeasurement,
  type TimedOutcome,
} from './completion';
import {
  captureDrillKeyAliases,
  mergeDrillKeyAliases,
  resolveDrillLogs,
} from '../lib/drillKeys';
import type { Song } from '../data/songs';
import type { StrumPattern } from '../data/strumPatterns';
import type { CalibrationData, ChordCalibration } from '../audio/calibration';
import type { ReminderSettings } from '../lib/reminders';
import {
  activeProfileOf,
  makeProfile,
  newProfileId,
  nextProfileLabel,
  profilesOf,
  type ChordProfile,
} from '../lib/chordProfiles';

// No seeded routines — a fresh user starts from a clean, Notion-style empty
// state and builds their own routines/tasks from scratch.
const defaultRoutines: Routine[] = [];

const getTodayString = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

// Monotonic-ish wall clock used to stamp the last local mutation, so cloud sync
// can do last-write-wins and never clobber un-uploaded local changes.
const now = () => Date.now();

export interface CoachStepResult {
  title: string;
  value: number | null;
  unit: string;
  // Whether this step earned its task a completion. Optional so a session saved
  // by an older build still resumes; absent means the step was not judged.
  done?: boolean;
}

// In-progress coached session, persisted so an interruption (pause, close, or
// reload) can be resumed from where it left off.
export interface CoachProgress {
  routineId: string;
  /**
   * The day the session started, and the day everything it records is filed
   * under. Not "the day it is now": a session begun at 23:50 keeps this date
   * through the whole of the next hour, because the alternative is a
   * measurement on one date and a settle on the next, which settles nothing.
   */
  date: string;
  index: number;
  results: CoachStepResult[];
  /**
   * Epoch ms of when the session started, which is what decides whether it is
   * still the same sitting. The calendar date cannot answer that: it says a
   * session paused at 23:50 is stale ten minutes later and one paused at 00:10
   * is fresh all day. Absent on progress saved by an older build, which falls
   * back to the date it carries.
   */
  startedAt?: number;
}

/**
 * Which of two saved sessions is the one still being played, local or cloud.
 *
 * The merge used to take the cloud's answer outright: `data.coachProgress ??
 * null`. Every other field in the snapshot falls back to the local copy, and
 * this one alone threw it away, so a session paused mid-routine on this device
 * was deleted by the next write from any other device — which carries no
 * session of its own precisely because the session is here. Nothing else holds
 * the segment index or the results so far, so there is no recovering it.
 *
 * A session is replaced only by a session, and the later one wins: `startedAt`
 * when both builds wrote one, the date they are filed under otherwise. What
 * this deliberately does not do is treat the absence of a remote session as a
 * finish. A session completed on the laptop therefore lingers on the phone
 * until it is finished or abandoned there, which costs one dismissal; the
 * alternative cost a live session.
 */
function laterSession(
  local: CoachProgress | null | undefined,
  remote: CoachProgress | null | undefined,
): CoachProgress | null {
  if (!remote) return local ?? null;
  if (!local) return remote;
  if (local.startedAt !== undefined && remote.startedAt !== undefined) {
    return remote.startedAt > local.startedAt ? remote : local;
  }
  return remote.date > local.date ? remote : local;
}

export interface UserData {
  routines: Routine[];
  dailyLogs: Record<string, DailyLog>;
  activeRoutineId: string;
  // Last chord pair practiced, so the changes drill reopens on it instead of
  // resetting to A/D every time.
  lastPair?: { from: string; to: string };
  coachProgress?: CoachProgress | null;
  // User's own strum patterns (built-ins live in code; these are the custom ones).
  strumPatterns?: StrumPattern[];
  // YouTube link per song id, used by the real-play pass to stream the actual
  // recording. Set once by the user; persisted so it just plays next time.
  songLinks?: Record<string, string>;
  // Charts the user wrote themselves. The built-in seven live in code and can
  // never cover what someone is actually learning this week, so these sit
  // alongside them and every consumer reads the merged list
  // (src/lib/songCatalog.ts) rather than the constant.
  userSongs?: Song[];
  // The single calibration this app stored before it understood that people own
  // more than one guitar. Read once by src/lib/chordProfiles.ts to migrate it
  // into the list below, and never written again.
  chordCalibration?: ChordCalibration;
  // Per-guitar learned chord fingerprints (src/audio/calibration.ts). Absent
  // until the user calibrates; the detector falls back to built-in templates.
  chordProfiles?: ChordProfile[];
  // Which guitar is in the room. Falls back to the first profile when stale.
  activeProfileId?: string;
  // Last metronome tempo the user set by hand, used as the manual fallback and
  // whenever there is no prescription to derive a tempo from.
  metronomeBpm?: number;
  // Whether coached drills set the tempo (and start the click) themselves from
  // the player's own results. Defaults on; absent means never chosen.
  metronomeAuto?: boolean;
  // Skills the learner has said they have, for the ones the app cannot hear:
  // posture, reading tab, knowing what a time signature is. Never used to
  // override a measurement, only to fill the gap where there will never be one.
  // See src/lib/progression.ts.
  claimedSkills?: string[];
  // Where the learner says they are in their course, as a curriculum lesson
  // code. Set in onboarding, moved on by hand. Absent means never asked.
  currentLesson?: string;
  // Mirrors chord diagrams. A left-handed player reading a right-handed chord
  // box has to flip every shape in their head before their hand can use it.
  leftHanded?: boolean;
  // Which fret the capo is on, 0 for none. The detector matches pitch-class
  // templates, so a capo transposes everything it hears and every drill would
  // silently stop counting without this. Absent means none.
  capoFret?: number;
  // When to be reminded to practise, and how. Absent until the user sets one;
  // there is no default reminder, because an app that starts notifying you
  // without being asked is one you turn off rather than tune.
  reminder?: ReminderSettings;
  // What a task id used to mean, for the two drills that once filed their
  // results under one.
  //
  // Chord Perfect and the anchor rotation wrote their numbers under the id of
  // the task they were launched from, so renaming, rebuilding or regenerating a
  // routine orphaned every one of them. They are keyed by what was played now
  // (src/lib/drillKeys.ts), and this map is the only thing left that can say
  // what a given task id was drilling. It is captured from the routines the
  // first time this build loads them and is append-only after that, because the
  // task an entry describes may already be gone by the time anything asks.
  //
  // Nothing rewrites a day. Old logs are read through this map and stay on disk
  // exactly as they were recorded.
  drillKeyAliases?: Record<string, string>;
  // Epoch ms of the last local mutation to this account. Drives conflict
  // resolution against the cloud copy. Older/legacy data defaults to 0.
  updatedAt: number;
}

const defaultUserData: UserData = {
  routines: defaultRoutines,
  dailyLogs: {},
  activeRoutineId: '',
  strumPatterns: [],
  songLinks: {},
  userSongs: [],
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
  restoreTask: (routineId: string, task: Task, index: number) => void;
  restoreRoutine: (routine: Routine, index: number) => void;
  moveTask: (routineId: string, taskId: string, direction: 'up' | 'down') => void;

  saveFeedback: (date: string, feedback: string) => void;
  // The four doors onto a day's record. Nothing else writes completion, and the
  // rules they apply live in ./completion.ts rather than in any call site.
  //
  // A drill run reported its numbers, each under the key naming what was
  // played. Zero is recorded as an attempt the app could not hear, never as a
  // result. Does not complete the task on its own.
  recordMeasurements: (date: string, taskId: string, results: readonly DrillMeasurement[]) => void;
  // A timer for this task ran. Reaching the end is what earns the completion.
  recordTime: (date: string, taskId: string, outcome: TimedOutcome) => void;
  // This task is finished with for now: complete it if the evidence supports it.
  settleTask: (date: string, taskId: string) => void;
  // The user's own word, kept as their word.
  markTaskDone: (date: string, taskId: string) => void;
  // Take today's claim back. Leaves measured numbers alone.
  clearTaskRecord: (date: string, taskId: string) => void;
  setActiveRoutine: (routineId: string) => void;
  setLastPair: (from: string, to: string) => void;
  saveCoachProgress: (progress: CoachProgress) => void;
  clearCoachProgress: () => void;
  addStrumPattern: (pattern: StrumPattern) => void;
  removeStrumPattern: (id: string) => void;
  setSongLink: (songId: string, url: string) => void;
  // Insert or replace a user-written chart by id, so the editor can save an
  // edit and a new song through one door.
  saveUserSong: (song: Song) => void;
  deleteUserSong: (songId: string) => void;
  // Write a freshly fitted set (guided flow or a passive-refine merge) into the
  // guitar currently selected, creating the first profile if there is none.
  setChordCalibration: (chords: CalibrationData, label?: string) => void;
  // Forget the selected guitar's calibration and fall back to the next one.
  clearChordCalibration: () => void;
  // Start a profile for another instrument and switch to it. It holds no
  // fingerprints until that guitar is actually calibrated.
  addChordProfile: (label?: string) => void;
  setActiveChordProfile: (id: string) => void;
  renameChordProfile: (id: string, label: string) => void;
  deleteChordProfile: (id: string) => void;
  setMetronomeBpm: (bpm: number) => void;
  setMetronomeAuto: (auto: boolean) => void;
  setCapoFret: (fret: number) => void;
  setLeftHanded: (left: boolean) => void;
  setSkillClaimed: (skillId: string, claimed: boolean) => void;
  setCurrentLesson: (code: string | null) => void;
  setReminder: (reminder: ReminderSettings | null) => void;
  // Records that today's nudge has been shown, so a missed day is mentioned
  // once rather than on every visit.
  markNudged: (date: string) => void;
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

      // Run one of the completion rules over a day's log, creating the day if
      // this is the first thing recorded on it. A rule that changes nothing
      // returns the same log, and then so does this, so an idempotent settle
      // does not churn the account.
      const writeLog = (
        acc: UserData,
        date: string,
        rule: (log: DailyLog) => DailyLog,
      ): UserData => {
        const existing = acc.dailyLogs[date];
        const next = rule(existing ?? blankLog(date, acc.activeRoutineId));
        if (existing && next === existing) return acc;
        return { ...acc, dailyLogs: { ...acc.dailyLogs, [date]: next } };
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

          const routines = data.routines?.length
            ? data.routines
            : local?.routines ?? defaultUserData.routines;

          const merged: UserData = {
            routines,
            dailyLogs: data.dailyLogs ?? local?.dailyLogs ?? {},
            activeRoutineId:
              data.activeRoutineId ??
              local?.activeRoutineId ??
              defaultUserData.activeRoutineId,
            lastPair: data.lastPair ?? local?.lastPair,
            coachProgress: laterSession(local?.coachProgress, data.coachProgress),
            strumPatterns: data.strumPatterns ?? local?.strumPatterns ?? [],
            songLinks: data.songLinks ?? local?.songLinks ?? {},
            userSongs: data.userSongs ?? local?.userSongs ?? [],
            chordCalibration: data.chordCalibration ?? local?.chordCalibration,
            chordProfiles: data.chordProfiles ?? local?.chordProfiles,
            activeProfileId: data.activeProfileId ?? local?.activeProfileId,
            metronomeBpm: data.metronomeBpm ?? local?.metronomeBpm,
            metronomeAuto: data.metronomeAuto ?? local?.metronomeAuto,
            capoFret: data.capoFret ?? local?.capoFret,
            claimedSkills: data.claimedSkills ?? local?.claimedSkills ?? [],
            leftHanded: data.leftHanded ?? local?.leftHanded,
            currentLesson: data.currentLesson ?? local?.currentLesson,
            reminder: data.reminder ?? local?.reminder,
            // Unioned rather than picked, then topped up from whatever routines
            // won the merge. Each device captures its own aliases, so the cloud
            // copy and the local one can each hold task ids the other has never
            // seen, and dropping either side would orphan the numbers filed
            // under it. Nothing here can overwrite an entry.
            drillKeyAliases: captureDrillKeyAliases(
              routines,
              mergeDrillKeyAliases(local?.drillKeyAliases, data.drillKeyAliases),
            ),
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

        // Put a task back where it was, not on the end. A routine's order is
        // the sequence Coached mode plays, so restoring to the wrong position
        // has quietly rewritten the session rather than undone a delete.
        restoreTask: (routineId, task, index) => set((state) =>
          mutate(state, (a) => ({
            ...a,
            routines: a.routines.map((r) => {
              if (r.id !== routineId) return r;
              if (r.tasks.some((t) => t.id === task.id)) return r;
              const tasks = [...r.tasks];
              tasks.splice(Math.max(0, Math.min(index, tasks.length)), 0, task);
              return { ...r, tasks };
            }),
          })),
        ),

        restoreRoutine: (routine, index) => set((state) =>
          mutate(state, (a) => {
            if (a.routines.some((r) => r.id === routine.id)) return a;
            const routines = [...a.routines];
            routines.splice(Math.max(0, Math.min(index, routines.length)), 0, routine);
            return { ...a, routines };
          }),
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

        // Reorder a task within its routine. Order is meaningful: it's the exact
        // sequence Coached mode plays through, so swapping neighbours lets the
        // user shape the guided session.
        moveTask: (routineId, taskId, direction) => set((state) =>
          mutate(state, (a) => ({
            ...a,
            routines: a.routines.map((r) => {
              if (r.id !== routineId) return r;
              const idx = r.tasks.findIndex((t) => t.id === taskId);
              if (idx < 0) return r;
              const swapWith = direction === 'up' ? idx - 1 : idx + 1;
              if (swapWith < 0 || swapWith >= r.tasks.length) return r;
              const tasks = [...r.tasks];
              [tasks[idx], tasks[swapWith]] = [tasks[swapWith], tasks[idx]];
              return { ...r, tasks };
            }),
          })),
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

        recordMeasurements: (date, taskId, results) =>
          set((state) => mutate(state, (a) => writeLog(a, date, (log) =>
            applyMeasurements(log, taskId, results, now())))),

        recordTime: (date, taskId, outcome) =>
          set((state) => mutate(state, (a) => writeLog(a, date, (log) =>
            applyTime(log, taskId, outcome, now())))),

        settleTask: (date, taskId) =>
          set((state) => mutate(state, (a) => writeLog(a, date, (log) => settle(log, taskId)))),

        markTaskDone: (date, taskId) =>
          set((state) => mutate(state, (a) => writeLog(a, date, (log) =>
            settle(applyStated(log, taskId, now()), taskId)))),

        clearTaskRecord: (date, taskId) =>
          set((state) => mutate(state, (a) => writeLog(a, date, (log) => clearRecord(log, taskId)))),

        setActiveRoutine: (routineId) => set((state) =>
          mutate(state, (a) => ({ ...a, activeRoutineId: routineId })),
        ),

        setLastPair: (from, to) => set((state) =>
          mutate(state, (a) => ({ ...a, lastPair: { from, to } })),
        ),

        saveCoachProgress: (progress) => set((state) =>
          mutate(state, (a) => ({ ...a, coachProgress: progress })),
        ),

        clearCoachProgress: () => set((state) =>
          mutate(state, (a) => ({ ...a, coachProgress: null })),
        ),

        addStrumPattern: (pattern) => set((state) =>
          mutate(state, (a) => ({ ...a, strumPatterns: [...(a.strumPatterns ?? []), pattern] })),
        ),

        removeStrumPattern: (id) => set((state) =>
          mutate(state, (a) => ({ ...a, strumPatterns: (a.strumPatterns ?? []).filter((p) => p.id !== id) })),
        ),

        setSongLink: (songId, url) => set((state) =>
          mutate(state, (a) => ({ ...a, songLinks: { ...(a.songLinks ?? {}), [songId]: url } })),
        ),

        saveUserSong: (song) => set((state) =>
          mutate(state, (a) => {
            const songs = a.userSongs ?? [];
            const at = songs.findIndex((s) => s.id === song.id);
            // Edited in place rather than appended, so a save never reorders
            // the list under someone who is part-way through writing it.
            if (at >= 0) {
              const next = songs.slice();
              next[at] = song;
              return { ...a, userSongs: next };
            }
            return { ...a, userSongs: [...songs, song] };
          }),
        ),

        deleteUserSong: (songId) => set((state) =>
          mutate(state, (a) => ({
            ...a,
            userSongs: (a.userSongs ?? []).filter((s) => s.id !== songId),
            // The link belonged to that chart. Leaving it behind would hand the
            // next song to claim the id someone else's recording.
            songLinks: Object.fromEntries(
              Object.entries(a.songLinks ?? {}).filter(([id]) => id !== songId),
            ),
          })),
        ),

        // Every calibration write goes through here, and every one of them
        // normalises the account onto the profile list first. That is what
        // retires the legacy single-calibration field: it is read on the way in
        // and dropped on the way out, so there is only ever one source of truth
        // for what the detector is listening with.
        setChordCalibration: (chords, label) => set((state) =>
          mutate(state, (a) => {
            const ts = now();
            const profiles = profilesOf(a);
            const active = activeProfileOf(a);
            const next: ChordProfile = active
              ? { ...active, label: label ?? active.label, updatedAt: ts, chords }
              : makeProfile(newProfileId(profiles), label ?? nextProfileLabel(profiles), chords, ts);
            const merged = active
              ? profiles.map((p) => (p.id === active.id ? next : p))
              : [...profiles, next];
            const updated = { ...a, chordProfiles: merged, activeProfileId: next.id };
            delete updated.chordCalibration;
            return updated;
          }),
        ),

        clearChordCalibration: () => set((state) =>
          mutate(state, (a) => {
            const active = activeProfileOf(a);
            if (!active) return a;
            const remaining = profilesOf(a).filter((p) => p.id !== active.id);
            const updated = {
              ...a,
              chordProfiles: remaining,
              activeProfileId: remaining[0]?.id,
            };
            delete updated.chordCalibration;
            return updated;
          }),
        ),

        addChordProfile: (label) => set((state) =>
          mutate(state, (a) => {
            const profiles = profilesOf(a);
            const profile = makeProfile(
              newProfileId(profiles),
              label?.trim() || nextProfileLabel(profiles),
              {},
              now(),
            );
            const updated = {
              ...a,
              chordProfiles: [...profiles, profile],
              activeProfileId: profile.id,
            };
            delete updated.chordCalibration;
            return updated;
          }),
        ),

        setActiveChordProfile: (id) => set((state) =>
          mutate(state, (a) => {
            const profiles = profilesOf(a);
            if (!profiles.some((p) => p.id === id)) return a;
            const updated = { ...a, chordProfiles: profiles, activeProfileId: id };
            delete updated.chordCalibration;
            return updated;
          }),
        ),

        renameChordProfile: (id, label) => set((state) =>
          mutate(state, (a) => {
            const trimmed = label.trim();
            // A nameless guitar in a list of guitars is worse than the default
            // name it replaced, so an empty rename is simply not a rename.
            if (!trimmed) return a;
            const updated = {
              ...a,
              chordProfiles: profilesOf(a).map((p) =>
                p.id === id ? { ...p, label: trimmed, updatedAt: now() } : p,
              ),
            };
            delete updated.chordCalibration;
            return updated;
          }),
        ),

        deleteChordProfile: (id) => set((state) =>
          mutate(state, (a) => {
            const remaining = profilesOf(a).filter((p) => p.id !== id);
            const updated = {
              ...a,
              chordProfiles: remaining,
              activeProfileId:
                a.activeProfileId === id ? remaining[0]?.id : a.activeProfileId,
            };
            delete updated.chordCalibration;
            return updated;
          }),
        ),

        setMetronomeBpm: (bpm) => set((state) =>
          mutate(state, (a) => ({ ...a, metronomeBpm: bpm })),
        ),

        setMetronomeAuto: (auto) => set((state) =>
          mutate(state, (a) => ({ ...a, metronomeAuto: auto })),
        ),

        // Clamped rather than trusted: an out-of-range offset would shift the
        // chroma into nonsense and every drill would stop counting with no
        // visible cause.
        setLeftHanded: (left) => set((state) =>
          mutate(state, (a) => ({ ...a, leftHanded: left })),
        ),

        setSkillClaimed: (skillId, claimed) => set((state) =>
          mutate(state, (a) => {
            const current = a.claimedSkills ?? [];
            if (claimed === current.includes(skillId)) return a;
            return {
              ...a,
              claimedSkills: claimed
                ? [...current, skillId]
                : current.filter((id) => id !== skillId),
            };
          }),
        ),

        setCurrentLesson: (code) => set((state) =>
          mutate(state, (a) => {
            const next = { ...a };
            if (code) next.currentLesson = code;
            else delete next.currentLesson;
            return next;
          }),
        ),

        setReminder: (reminder) => set((state) =>
          mutate(state, (a) => {
            const next = { ...a };
            if (reminder) next.reminder = reminder;
            else delete next.reminder;
            return next;
          }),
        ),

        markNudged: (date) => set((state) =>
          mutate(state, (a) =>
            a.reminder ? { ...a, reminder: { ...a.reminder, lastNudge: date } } : a,
          ),
        ),

        setCapoFret: (fret) => set((state) =>
          mutate(state, (a) => ({ ...a, capoFret: Math.max(0, Math.min(11, Math.round(fret))) })),
        ),
      };
    },
    {
      name: 'daily-fret-storage',
      // Every write runs synchronously inside the click that caused it, so an
      // unguarded one throws out of the handler where nothing catches it. See
      // ./persistence.ts: a refused write becomes state the header can show
      // rather than an exception nobody sees.
      storage: createJSONStorage(() => guardedStorage(() => localStorage)),
      // Snapshot what every task drills the moment the routines come back off
      // disk, before anything the user does can edit that connection away. This
      // is the migration's one write, and it deliberately does not touch
      // `updatedAt`: it is derived knowledge rather than an edit, and stamping
      // it as one would let a device that has just woken up win a
      // last-write-wins merge against another device's newer practice.
      merge: (persisted, current) => {
        const state = { ...current, ...(persisted as Partial<AppState>) };
        const accounts: Record<string, UserData> = {};
        // Storage that has lost its accounts is storage this cannot repair, and
        // throwing here would leave the app on the loader with no way back in.
        for (const [id, acc] of Object.entries(state.accounts ?? current.accounts)) {
          const aliases = captureDrillKeyAliases(acc.routines ?? [], acc.drillKeyAliases);
          accounts[id] = aliases === acc.drillKeyAliases ? acc : { ...acc, drillKeyAliases: aliases };
        }
        return { ...state, accounts };
      },
    },
  ),
);

// Flush the alias capture that `merge` just did in memory.
//
// Zustand only writes the persisted copy when something changes the state, so
// without this the map would sit in memory until the user's next edit and a
// session where nothing else was written would lose it. That is precisely the
// session that matters: the map has to outlive the routines it was read from.
// Each account object keeps its identity, so this writes the file without
// looking like an edit to the cloud sync watching for one.
useStore.setState((state) => ({ accounts: state.accounts }));

// Selector hook for convenience. Subscribes to *only* the current account slice
// (not the whole store) so unrelated state changes don't re-render every
// consumer — and the slice reference is stable until that account mutates.
export const useUserData = () =>
  useStore((s) => s.accounts[s.currentAccountId] ?? defaultUserData);

/**
 * The practice logs with every result under the key it would be written under
 * today.
 *
 * The stored days are untouched; this is a read adapter over them (see
 * src/lib/drillKeys.ts). Every analysis of the history goes through here rather
 * than through `useUserData().dailyLogs`, because a reader that skips it sees
 * the last few months of Chord Perfect and anchor-rotation numbers as belonging
 * to task ids and therefore to nothing.
 */
export const drillLogsOf = (acc: UserData): Record<string, DailyLog> =>
  resolveDrillLogs(acc.dailyLogs, acc.drillKeyAliases);

export const useDrillLogs = (): Record<string, DailyLog> =>
  useStore((s) => drillLogsOf(s.accounts[s.currentAccountId] ?? defaultUserData));

export { getTodayString, defaultUserData };
