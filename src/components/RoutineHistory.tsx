import { useEffect, useState } from 'react';
import { useStore, useUserData } from '../store';
import { useAuthStore, listArchivedRoutines, type ArchivedRoutine } from '../lib/auth';
import { ArrowLeftIcon, RetryIcon, SpinnerIcon, TrashIcon, PencilIcon } from './icons';
import type { Routine } from '../types';

/**
 * Every routine edit and delete has been snapshotted to Firestore since the
 * backlog shipped, and nothing has ever read it back. This is the reading half.
 *
 * Undo covers the last few seconds. This covers the other case: the routine you
 * reshaped three weeks ago and now want a piece of, or the one you deleted and
 * only missed later.
 */
export function RoutineHistory({ onBack }: { onBack: () => void }) {
  const user = useAuthStore((s) => s.user);
  const routines = useUserData().routines;
  const addRoutine = useStore((s) => s.addRoutine);
  const setActiveRoutine = useStore((s) => s.setActiveRoutine);

  const [entries, setEntries] = useState<ArchivedRoutine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listArchivedRoutines()
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch(() => {
        if (!cancelled) setError('Could not reach the backlog. Check your connection and try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Restores as a new routine rather than overwriting whatever holds that id
  // now. Bringing back a three-week-old version on top of today's work would be
  // a second destructive act dressed up as a recovery.
  const restore = (entry: ArchivedRoutine) => {
    const taken = new Set(routines.map((r) => r.name));
    let name = `${entry.snapshot.name} (restored)`;
    for (let n = 2; taken.has(name); n++) name = `${entry.snapshot.name} (restored ${n})`;
    const routine: Routine = {
      ...entry.snapshot,
      id: crypto.randomUUID(),
      name,
      isDefault: false,
      tasks: entry.snapshot.tasks.map((t) => ({ ...t, id: crypto.randomUUID() })),
    };
    addRoutine(routine);
    setActiveRoutine(routine.id);
    setRestored(entry.id);
  };

  return (
    <div className="routine-history">
      <div className="routine-manager-header">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back to routines">
          <ArrowLeftIcon size={20} />
        </button>
        <div className="header-title-row">
          <h2 className="routine-manager-title">Earlier versions</h2>
        </div>
      </div>

      {!user ? (
        <p className="routine-history-note">
          Version history is kept with your synced account. Sign in and it starts
          keeping one from your next edit.
        </p>
      ) : error ? (
        <p className="routine-history-note">{error}</p>
      ) : entries === null ? (
        <p className="routine-history-note">
          <SpinnerIcon size={16} className="spinner-icon" /> Looking through the backlog…
        </p>
      ) : entries.length === 0 ? (
        <p className="routine-history-note">
          Nothing here yet. A version is kept each time you change or delete a
          routine, so this fills up as you work.
        </p>
      ) : (
        <ul className="routine-history-list">
          {entries.map((entry) => (
            <li key={entry.id} className="routine-history-item">
              <span className="routine-history-icon" aria-hidden="true">
                {entry.reason === 'deleted' ? <TrashIcon size={16} /> : <PencilIcon size={16} />}
              </span>
              <div className="routine-history-body">
                <span className="routine-history-name">{entry.snapshot.name}</span>
                <span className="routine-history-meta">
                  {entry.reason === 'deleted' ? 'Before it was deleted' : 'Before an edit'}
                  {' · '}
                  {describeWhen(entry.archivedAt)}
                  {' · '}
                  {entry.snapshot.tasks.length} task{entry.snapshot.tasks.length === 1 ? '' : 's'}
                </span>
              </div>
              <button
                type="button"
                className="routine-history-restore"
                onClick={() => restore(entry)}
                disabled={restored === entry.id}
              >
                <RetryIcon size={15} />
                <span>{restored === entry.id ? 'Restored' : 'Restore'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {restored && (
        <p className="routine-history-note" role="status">
          Brought back as a separate routine, so nothing you have now was
          overwritten. It is the active one.
        </p>
      )}
    </div>
  );
}

function describeWhen(at: number): string {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}
