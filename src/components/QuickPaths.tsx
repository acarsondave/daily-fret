import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Modal } from './Modal';
import { CheckIcon, SessionIcon } from './icons';
import { useStore, useUserData, getTodayString } from '../store';
import { completedSet } from '../lib/taskSplit';
import { taskMinutes } from '../lib/coached';
import type { Routine, Task } from '../types';
import './QuickPaths.css';

// Quick paths: the coached session, over a chosen part of the routine.
//
// For the days a whole routine is not going to happen. The list is the
// routine's own tasks, one exercise per row (lib/taskSplit.ts), so a single set
// of changes can be picked on its own. Starting runs the same coached session
// as the full routine, with the same record, only shorter.

interface Props {
  isOpen: boolean;
  routine: Routine;
  onClose: () => void;
  onStart: (taskIds: string[]) => void;
}

/** Consecutive tasks of one exercise, drawn under the exercise's name. */
interface Section {
  id: string;
  title: string | null;
  tasks: Task[];
}

function sectionsOf(tasks: readonly Task[]): Section[] {
  const out: Section[] = [];
  for (const task of tasks) {
    const last = out[out.length - 1];
    if (task.group && last && last.id === task.group.id) {
      last.tasks.push(task);
      continue;
    }
    out.push({ id: task.group?.id ?? task.id, title: task.group ? task.group.title : null, tasks: [task] });
  }
  // A group that ended up with one part left (the others deleted) is just a task.
  return out.map((s) => (s.title && s.tasks.length === 1 ? { ...s, title: null } : s));
}

/** The row's name inside its section: the pair or block, not the exercise again. */
function rowTitle(task: Task, inSection: boolean): string {
  if (!inSection || !task.group) return task.title;
  const prefix = `${task.group.title} · `;
  return task.title.startsWith(prefix) ? task.title.slice(prefix.length) : task.title;
}

function summarise(tasks: readonly Task[]): string {
  const minutes = tasks.reduce((sum, t) => sum + taskMinutes(t), 0);
  const songs = tasks.filter((t) => t.drill?.kind === 'song').length;
  const count = `${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
  const time = minutes ? ` · ${minutes} min` : '';
  const song = songs ? (minutes ? ' + song' : ' · a song') : '';
  return `${count}${time}${song}`;
}

export function QuickPaths({ isOpen, routine, onClose, onStart }: Props) {
  const account = useUserData();
  const today = getTodayString();
  const remembered = account.quickPaths?.[routine.id];
  const done = useMemo(
    () => completedSet(account.dailyLogs[today], account.taskSplits),
    [account.dailyLogs, account.taskSplits, today],
  );

  // Seeded from the last path each time the sheet opens, and only with ids the
  // routine still has: a task deleted since cannot be run.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const openKey = isOpen ? routine.id : null;
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (openKey) {
      const held = new Set(routine.tasks.map((t) => t.id));
      setPicked(new Set((remembered ?? []).filter((id) => held.has(id))));
    }
  }

  const sections = useMemo(() => sectionsOf(routine.tasks), [routine.tasks]);
  const chosen = routine.tasks.filter((t) => picked.has(t.id));

  const toggle = (ids: string[], on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const start = () => {
    if (!chosen.length) return;
    const ids = chosen.map((t) => t.id);
    useStore.getState().setQuickPath(routine.id, ids);
    onStart(ids);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} position="bottom" label="Quick path">
      <div className="quick-sheet">
        <header className="quick-head">
          <h2 className="quick-title">Quick path</h2>
          <button
            type="button"
            className="quick-clear"
            onClick={() => setPicked(new Set())}
            disabled={!picked.size}
          >
            Clear
          </button>
        </header>

        <div className="quick-list" role="group" aria-label={`Tasks in ${routine.name}`}>
          {sections.map((section) => {
            const ids = section.tasks.map((t) => t.id);
            const all = ids.every((id) => picked.has(id));
            return (
              <div key={section.id} className={clsx('quick-section', section.title && 'is-group')}>
                {section.title && (
                  <div className="quick-section-head">
                    <span className="quick-section-title">{section.title}</span>
                    <button
                      type="button"
                      className="quick-section-all"
                      aria-pressed={all}
                      aria-label={`${all ? 'Clear' : 'Choose'} all of ${section.title}`}
                      onClick={() => toggle(ids, !all)}
                    >
                      {all ? 'Clear' : 'All'}
                    </button>
                  </div>
                )}
                {section.tasks.map((task) => {
                  const on = picked.has(task.id);
                  const minutes = taskMinutes(task);
                  const isDone = done.has(task.id);
                  return (
                    <button
                      key={task.id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      className={clsx('quick-row', on && 'is-on', isDone && 'is-done')}
                      onClick={() => toggle([task.id], !on)}
                    >
                      <span className="quick-mark" aria-hidden="true">
                        {on && <CheckIcon size={14} strokeWidth={2.6} />}
                      </span>
                      <span className="quick-row-text">
                        <span className="quick-row-title">{rowTitle(task, !!section.title)}</span>
                        {isDone && <span className="quick-row-note">Done today</span>}
                      </span>
                      {minutes > 0 && <span className="quick-row-min">{minutes} min</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <footer className="quick-foot">
          <span className="quick-summary" aria-live="polite">
            {chosen.length ? summarise(chosen) : 'Nothing chosen'}
          </span>
          <button type="button" className="quick-start" onClick={start} disabled={!chosen.length}>
            <SessionIcon size={18} />
            Start
          </button>
        </footer>
      </div>
    </Modal>
  );
}
