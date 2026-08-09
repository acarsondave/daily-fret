import { useMemo, useState } from 'react';
import { DownloadIcon, HourglassIcon } from './icons';
import { useStore, useUserData } from '../store';
import { buildIcs } from '../lib/calendarFile';
import {
  DAY_NAMES,
  DEFAULT_REMINDER,
  describeDays,
  formatTime,
  parseTime,
  WEEK_ORDER,
  type ReminderSettings,
} from '../lib/reminders';

// Practice reminders, and an honest account of what each one can do.
//
// The ordering on screen is the ordering by reliability, not by novelty. The
// calendar file goes first because it is the only one that fires on a phone in
// a pocket; the notification is second and says out loud that it needs the tab
// open. Selling the weaker mechanism as "reminders" would mean someone relies
// on it, misses a week, and stops believing anything else the app tells them.

/** Rough length of the active routine, so the calendar block is not a guess. */
function routineMinutes(durations: readonly (string | undefined)[]): number {
  const total = durations.reduce((sum, d) => {
    const n = d ? Number.parseInt(d, 10) : NaN;
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
  return total > 0 ? total : 20;
}

export function ReminderSetting() {
  const account = useUserData();
  const setReminder = useStore((s) => s.setReminder);
  const [notifyError, setNotifyError] = useState<string | null>(null);

  const reminder = account.reminder;
  const on = !!reminder;
  const settings: ReminderSettings = reminder ?? DEFAULT_REMINDER;

  const minutes = useMemo(() => {
    const active = account.routines.find((r) => r.id === account.activeRoutineId);
    return routineMinutes((active?.tasks ?? []).map((t) => t.duration));
  }, [account.routines, account.activeRoutineId]);

  const patch = (updates: Partial<ReminderSettings>) => setReminder({ ...settings, ...updates });

  const toggleDay = (day: number) => {
    const set = new Set(settings.days);
    if (set.has(day)) set.delete(day);
    else set.add(day);
    patch({ days: [...set].sort((a, b) => a - b) });
  };

  const askToNotify = async () => {
    setNotifyError(null);
    if (typeof Notification === 'undefined') {
      setNotifyError('This browser has no notifications.');
      return;
    }
    if (Notification.permission === 'denied') {
      // The browser will not ask twice. Saying so beats a button that looks
      // broken every time it is pressed.
      setNotifyError('Notifications are blocked for this site in your browser settings.');
      return;
    }
    const result =
      Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (result !== 'granted') {
      setNotifyError('Not allowed, so this one stays off.');
      return;
    }
    patch({ notify: true });
  };

  const download = () => {
    const ics = buildIcs({
      settings,
      minutes,
      from: new Date(),
      uid: `daily-fret-practice-${Date.now().toString(36)}@daily-fret`,
    });
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'guitar-practice.ics';
    link.click();
    URL.revokeObjectURL(url);
  };

  const timeValid = parseTime(settings.time) !== null;
  const canSchedule = timeValid && settings.days.length > 0;

  return (
    <div className="mic-setting">
      <div className="mic-setting-head">
        <HourglassIcon size={18} />
        <span>Practice reminder</span>
      </div>

      {!on ? (
        <>
          <p className="setting-note">
            Pick a time and the app will notice when a day slips, and hand you a
            calendar entry that fires whether or not this is open.
          </p>
          <button
            type="button"
            className="settings-action-btn"
            onClick={() => setReminder(DEFAULT_REMINDER)}
          >
            <HourglassIcon size={18} />
            <span>Set a practice time</span>
          </button>
        </>
      ) : (
        <>
          <div className="reminder-when">
            <label className="reminder-time">
              <span className="reminder-label">At</span>
              <input
                type="time"
                className="reminder-input"
                aria-label="Practice time"
                value={settings.time}
                onChange={(e) => patch({ time: e.target.value })}
              />
            </label>
            <p className="reminder-summary">
              {canSchedule
                ? `${describeDays(settings.days)}, ${formatTime(settings.time)}`
                : 'Choose at least one day.'}
            </p>
          </div>

          <div className="reminder-days" role="group" aria-label="Practice days">
            {WEEK_ORDER.map((day) => {
              const active = settings.days.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  className={`reminder-day${active ? ' is-on' : ''}`}
                  aria-pressed={active}
                  aria-label={DAY_NAMES[day]}
                  onClick={() => toggleDay(day)}
                >
                  {DAY_NAMES[day].slice(0, 1)}
                </button>
              );
            })}
          </div>

          {/* First, because it is the only one that works with the app closed. */}
          <button
            type="button"
            className="settings-action-btn"
            onClick={download}
            disabled={!canSchedule}
          >
            <DownloadIcon size={18} />
            <span>Add to my calendar</span>
          </button>
          <p className="setting-note">
            A repeating {minutes}-minute entry your phone or computer will remind
            you about on its own. This is the reliable one.
          </p>

          {!settings.notify ? (
            <>
              <button type="button" className="settings-action-btn" onClick={() => void askToNotify()}>
                <HourglassIcon size={18} />
                <span>Also notify me in the browser</span>
              </button>
              <p className="setting-note">
                Only arrives while Daily Fret is open in a tab. A web page cannot
                wake a sleeping phone, so treat this as a bonus on a desktop.
              </p>
            </>
          ) : (
            <>
              <button
                type="button"
                className="settings-action-btn"
                onClick={() => patch({ notify: false })}
              >
                <HourglassIcon size={18} />
                <span>Turn browser notifications off</span>
              </button>
              <p className="setting-note">
                On, and only while this is open in a tab.
              </p>
            </>
          )}

          {notifyError && <p className="reminder-error">{notifyError}</p>}

          <button
            type="button"
            className="settings-action-btn is-quiet"
            onClick={() => setReminder(null)}
          >
            <span>Turn the reminder off</span>
          </button>
        </>
      )}
    </div>
  );
}
