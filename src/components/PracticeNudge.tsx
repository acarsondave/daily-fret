import { motion } from 'framer-motion';
import { HourglassIcon, PlayIcon } from './icons';
import { usePracticeReminder } from '../hooks/usePracticeReminder';
import { nudgeMessage } from '../lib/reminders';
import './PracticeNudge.css';

interface Props {
  onStart: () => void;
}

/**
 * The reminder that actually reaches a phone.
 *
 * A web page cannot wake a sleeping device, so the notification is only ever a
 * bonus. This is not a notification: it is what the app says when you open it
 * and the day has already slipped, which is the moment a reminder can still do
 * something useful.
 *
 * The tone matters more than the mechanism. A missed day is the point at which
 * people quit, and a counter shouting about a broken streak is what pushes them
 * over. So it names the gap plainly, offers the smallest possible way back in,
 * and can be dismissed for the day in one tap.
 */
export function PracticeNudge({ onStart }: Props) {
  const { show, missed, dismiss } = usePracticeReminder();
  if (!show) return null;

  return (
    <motion.div
      className="nudge"
      role="status"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      <HourglassIcon size={18} className="nudge-icon" />
      <p className="nudge-text">{nudgeMessage(missed)}</p>
      <div className="nudge-actions">
        <button type="button" className="nudge-dismiss" onClick={dismiss}>
          Not today
        </button>
        <button
          type="button"
          className="nudge-start"
          onClick={() => {
            dismiss();
            onStart();
          }}
        >
          <PlayIcon size={15} /> Start
        </button>
      </div>
    </motion.div>
  );
}
