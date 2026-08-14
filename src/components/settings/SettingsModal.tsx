import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Modal } from '../Modal';
import { CalibrationFlow } from '../practice/CalibrationFlow';
import { CapoIcon, HourglassIcon, SlidersIcon } from '../icons';
import { MicSetting } from './MicSetting';
import { CalibrationSetting } from './CalibrationSetting';
import { CapoSetting } from './CapoSetting';
import { HandednessSetting } from './HandednessSetting';
import { RecordingSetting } from './RecordingSetting';
import { ReminderSetting } from './ReminderSetting';
import { PatternManager } from './PatternManager';
import { AccountSection } from './AccountSection';
import type { IconProps } from '../icons';
import './settings.css';
import './SettingsModal.css';

/**
 * Settings as a place rather than a drawer.
 *
 * It used to be one scroll inside a 320px panel hanging off the account button:
 * a microphone, a capo, two guitars, seven day toggles, a strum pattern editor
 * and a sign-out, in that order, with nothing telling you which of those you
 * were about to reach. It is now a full-height surface with three named groups
 * and one group on screen at a time.
 *
 * Deliberately still an overlay and not a route. This app has no page
 * navigation on purpose: a coached session, a half-typed task and a running
 * drill all live in component state, and sending settings through a router would
 * throw that away to answer a question about the microphone.
 */

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type GroupId = 'setup' | 'practice' | 'account';

const GROUPS: ReadonlyArray<{
  id: GroupId;
  label: string;
  blurb: string;
  Icon: (props: IconProps) => React.ReactElement;
}> = [
  {
    id: 'setup',
    label: 'Your setup',
    blurb: 'What the app listens to',
    Icon: CapoIcon,
  },
  {
    id: 'practice',
    label: 'Practice',
    blurb: 'Reminders and patterns',
    Icon: HourglassIcon,
  },
  {
    id: 'account',
    label: 'Account',
    blurb: 'Sign in, and your data',
    Icon: SlidersIcon,
  },
];

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  // Opens on the setup group every time. Remembering the last group would mean
  // the panel opens on whatever you were doing a week ago, and the setup group
  // is the one with a reason to be checked before playing.
  const [group, setGroup] = useState<GroupId>('setup');
  const paneRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  // Calibration is owned here rather than by the row that offers it.
  //
  // It is a full-attention task: the microphone is live and the player is asked
  // to hold eight chords in turn with both hands on the guitar. Rendered from
  // inside the setup pane it was at the mercy of this surface — switching group
  // unmounted it mid-capture, and the settings close button tore it down along
  // with the dialog, which is what the close button was for. So settings steps
  // aside for it instead of stacking underneath it: one screen, one close
  // button, one Escape. Two full-height surfaces with two close buttons a few
  // pixels apart is the confusion, not the fix.
  const [calibrating, setCalibrating] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const openCalibration = useCallback(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setCalibrating(true);
  }, []);

  const closeCalibration = useCallback(() => setCalibrating(false), []);

  // Back exactly where they were: same group, same scroll, keyboard on the
  // button that opened it. In an effect rather than in the handler because the
  // settings surface is still hidden until that commit paints, and focus given
  // to a hidden element is focus dropped on the floor.
  useEffect(() => {
    if (calibrating) return;
    const previous = returnFocusRef.current;
    returnFocusRef.current = null;
    if (previous?.isConnected) previous.focus();
  }, [calibrating]);

  const tabId = (id: GroupId) => `${baseId}-tab-${id}`;
  const paneId = (id: GroupId) => `${baseId}-pane-${id}`;

  // A new group starts at its own top. Carrying the previous scroll offset over
  // opens the next group halfway down itself.
  useEffect(() => {
    paneRef.current?.scrollTo({ top: 0 });
  }, [group]);

  const onRailKeyDown = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const index = GROUPS.findIndex((g) => g.id === group);
    const next = GROUPS[(index + step + GROUPS.length) % GROUPS.length];
    setGroup(next.id);
    railRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(next.id))}`)?.focus();
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        position="full"
        title="Settings"
        suspended={calibrating}
      >
        <div className="settings-surface">
          <div
            className="settings-rail"
            role="tablist"
            aria-label="Settings groups"
            ref={railRef}
            onKeyDown={onRailKeyDown}
          >
            {GROUPS.map(({ id, label, blurb, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={tabId(id)}
                aria-selected={group === id}
                aria-controls={paneId(id)}
                className={group === id ? 'settings-rail-btn is-on' : 'settings-rail-btn'}
                onClick={() => setGroup(id)}
              >
                <Icon size={18} className="settings-rail-icon" />
                <span className="settings-rail-text">
                  <span className="settings-rail-label">{label}</span>
                  <span className="settings-rail-blurb">{blurb}</span>
                </span>
              </button>
            ))}
          </div>

          <div
            className="settings-pane"
            role="tabpanel"
            id={paneId(group)}
            aria-labelledby={tabId(group)}
            tabIndex={-1}
            ref={paneRef}
          >
            {group === 'setup' && (
              <>
                {/* Capo first: it is the only one of these that changes from one
                    session to the next, and getting it wrong stops every drill
                    counting with nothing on screen to say why. */}
                <CapoSetting />
                <MicSetting />
                <CalibrationSetting onCalibrate={openCalibration} />
                <HandednessSetting />
                {/* Last in the group, and deliberately below everything the app
                    listens with. This is the only setting here that points a
                    camera at the room, and putting it above the microphone
                    would have it read as part of the standard setup rather
                    than as the deliberate opt-in it is. */}
                <RecordingSetting />
              </>
            )}

            {group === 'practice' && (
              <>
                <ReminderSetting />
                <PatternManager />
              </>
            )}

            {group === 'account' && <AccountSection onClose={onClose} />}
          </div>
        </div>
      </Modal>

      {isOpen && calibrating && <CalibrationFlow onClose={closeCalibration} />}
    </>
  );
}
