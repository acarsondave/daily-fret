import { useEffect, useMemo, useState } from 'react';
import { getTodayString, useStore, useUserData } from '../store';
import { msUntilNext, nudgeDecision, practisedOn, type NudgeDecision } from '../lib/reminders';

// Re-checked on a slow tick rather than a timer set to the exact minute: a
// laptop that was asleep at the reminder time wakes with a wildly overdue
// timeout, and a tab left open overnight has to notice the date rolled over.
// Thirty seconds is far below anything a person would notice and costs nothing.
const TICK_MS = 30_000;

/**
 * Whether to say something about practice on this visit, and the browser
 * notification while the tab is open.
 *
 * The nudge is the part that actually works on a phone, so it needs no
 * permission and no setup beyond a time. The notification is a bonus for a
 * desktop left open, and never asked for silently — see ReminderSetting.
 */
export function usePracticeReminder(): NudgeDecision & { dismiss: () => void } {
  const account = useUserData();
  const markNudged = useStore((s) => s.markNudged);
  const reminder = account.reminder;
  const logs = account.dailyLogs;

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!reminder) return;
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, [reminder]);

  const decision = useMemo<NudgeDecision>(() => {
    if (!reminder) return { show: false, missed: 0 };
    const today = getTodayString();
    return nudgeDecision(logs, reminder, today, now.getHours() * 60 + now.getMinutes());
  }, [reminder, logs, now]);

  // The in-tab notification. Deliberately does not fire when practice is
  // already done for the day: a reminder for something you have finished is
  // noise, and noise is how a reminder gets turned off.
  useEffect(() => {
    if (!reminder?.notify) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    let timer: number | undefined;
    const schedule = () => {
      const delay = msUntilNext(reminder, new Date());
      if (delay === null) return;
      timer = window.setTimeout(() => {
        const today = getTodayString();
        if (!practisedOn(useStore.getState().accounts[useStore.getState().currentAccountId]?.dailyLogs ?? {}, today)) {
          try {
            new Notification('Guitar practice', {
              body: 'Your routine is waiting.',
              tag: 'daily-fret-practice',
            });
          } catch {
            // Some browsers only allow notifications through a service worker
            // registration. Nothing to recover here: the nudge still catches it
            // on the next visit, which is the mechanism that was always going
            // to do the real work.
          }
        }
        schedule();
      }, delay);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [reminder]);

  return {
    ...decision,
    dismiss: () => markNudged(getTodayString()),
  };
}
