import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore, drillLogsOf } from '../store';
import { MODULE_6, moduleUpdateDue, planModuleUpdate, updateTarget, type ModulePlan } from '../lib/moduleRoutine';
import type { Task } from '../types';
import './ModuleUpdate.css';

/** The update on offer. One at a time; the next module is a new entry. */
const PLANS: ModulePlan[] = [MODULE_6];
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * A module's routine update, offered once, previewed whole, applied in one tap.
 *
 * Collapsed it is one line and two buttons: the player is here to practise, not
 * to read. Open, it is three short lists, grouped by where each change came
 * from, so the player can see that the course asked for these, his own numbers
 * asked for those, and the rest is what he already had. Nothing in it is a
 * sentence about the change: the task names are the change.
 *
 * After accepting, the card stays for the rest of the day as a single Undo, the
 * one escape hatch for something that rewrote the list he practises from.
 */
export function ModuleUpdate() {
  const acc = useStore((s) => s.accounts[s.currentAccountId]);
  const accept = useStore((s) => s.acceptModuleUpdate);
  const snooze = useStore((s) => s.snoozeModuleUpdate);
  const undo = useStore((s) => s.undoModuleUpdate);
  const [open, setOpen] = useState(false);
  const [justAccepted, setJustAccepted] = useState<ModulePlan | null>(null);
  // Read once per mount: a snooze that runs out mid-visit can wait for the next.
  const [now] = useState(() => Date.now());

  const plan = acc ? PLANS.find((p) => moduleUpdateDue(acc, p, now)) : undefined;
  const preview = useMemo(() => {
    if (!acc || !plan) return null;
    const target = updateTarget(acc);
    return target ? planModuleUpdate(target, plan, drillLogsOf(acc)) : null;
  }, [acc, plan]);

  if (justAccepted) {
    return (
      <motion.div className="mu mu-done" role="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <span className="mu-mark" aria-hidden="true">{justAccepted.module}</span>
        <p className="mu-title">{justAccepted.name}</p>
        <button
          type="button"
          className="mu-quiet"
          onClick={() => {
            undo(justAccepted);
            setJustAccepted(null);
          }}
        >
          Undo
        </button>
      </motion.div>
    );
  }
  if (!plan || !preview) return null;
  const { changes } = preview;
  const fromCourse = changes.added.filter((a) => a.source === 'module').map((a) => a.task);
  const fromYou = changes.added.filter((a) => a.source === 'carry').map((a) => a.task);
  const kept = [...changes.edited.map((e) => e.task), ...changes.kept];

  return (
    <motion.section
      className="mu"
      aria-label={`Module ${plan.module} routine`}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="mu-head">
        <span className="mu-mark" aria-hidden="true">{plan.module}</span>
        <button type="button" className="mu-title mu-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Module {plan.module} routine
          <span className="mu-counts">
            +{changes.added.length} <span className="mu-minus">&minus;{changes.removed.length}</span>
          </span>
        </button>
        <div className="mu-actions">
          <button type="button" className="mu-quiet" onClick={() => snooze(plan, Date.now() + SNOOZE_MS)}>
            Later
          </button>
          <button
            type="button"
            className="mu-go"
            onClick={() => {
              accept(plan);
              setJustAccepted(plan);
            }}
          >
            Update
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="mu-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <Group label={`Module ${plan.module}`} tasks={fromCourse} tone="add" />
            <Group label="From your numbers" tasks={fromYou} tone="add" />
            <Group label="Kept" tasks={kept} tone="keep" />
            <Group label="Out" tasks={changes.removed.map((r) => r.task)} tone="out" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function Group({ label, tasks, tone }: { label: string; tasks: Task[]; tone: 'add' | 'keep' | 'out' }) {
  if (!tasks.length) return null;
  return (
    <div className={`mu-group is-${tone}`}>
      <h3 className="mu-label">{label}</h3>
      <ul className="mu-list">
        {tasks.map((t) => (
          <li key={t.id}>{t.title}</li>
        ))}
      </ul>
    </div>
  );
}
