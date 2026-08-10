import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CapoIcon, PlectrumIcon } from '../icons';
import { useUserData } from '../../store';
import { profilesOf } from '../../lib/chordProfiles';
import { CapoSetting } from './CapoSetting';
import { MicSetting } from './MicSetting';
import { GuitarPicker } from './GuitarPicker';
import './settings.css';
import './QuickSetup.css';

interface QuickSetupProps {
  onOpenSettings: () => void;
}

/**
 * The three facts that decide whether a drill can hear you, one tap from the
 * practice screen: where the capo is, which microphone is open, and which guitar
 * the detector is matching against.
 *
 * They are here rather than only in settings because they are the settings that
 * change between sessions. Everything else in there (handedness, the reminder
 * schedule, strum patterns, the account) is set once and left. Putting the
 * volatile three behind three taps and a scroll is how a capo gets left on and
 * a whole practice quietly counts nothing.
 *
 * The label carries the capo state, because the app should say out loud what it
 * is assuming about the instrument in the room.
 */
export function QuickSetup({ onOpenSettings }: QuickSetupProps) {
  const account = useUserData();
  const capo = account.capoFret ?? 0;
  const [open, setOpen] = useState(false);
  // Measured from the trigger rather than anchored to it in CSS. The button is
  // not the rightmost thing in the header, so a right-aligned panel wide enough
  // to hold the capo row hung off the left edge of a phone.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Only worth asking about when there is more than one answer. A single
  // calibrated guitar is not a choice, and the settings surface still carries
  // the full list.
  const multipleGuitars = useMemo(() => profilesOf(account).length > 1, [account]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      setAnchor({ top: rect.bottom + 8, right: Math.max(0, window.innerWidth - rect.right) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // pointerdown, not mousedown: it fires for touch and pen too, so the panel
    // closes on a tap outside on a phone.
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // This panel is not on the overlay stack, so it must claim the key or a
      // dialog underneath would close at the same time.
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="quick-setup" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={capo > 0 ? 'quick-setup-btn has-capo' : 'quick-setup-btn'}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          capo > 0
            ? `Setup. Capo on fret ${capo}.`
            : 'Setup. No capo. Microphone and guitar.'
        }
        onClick={() => setOpen((v) => !v)}
      >
        <CapoIcon size={16} />
        <span className="quick-setup-label">{capo > 0 ? `Capo ${capo}` : 'Setup'}</span>
      </button>

      <AnimatePresence>
        {open && anchor && (
          <motion.div
            className="quick-setup-panel glass-panel"
            role="dialog"
            aria-label="Quick setup"
            style={{
              top: anchor.top,
              right: anchor.right,
              // Keeps the left edge inside the viewport whatever the trigger's
              // distance from the right edge turns out to be.
              maxWidth: `calc(100vw - ${anchor.right}px - var(--space-3))`,
            }}
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="quick-setup-body">
              <CapoSetting />
              <MicSetting />
              {multipleGuitars && (
                <div className="setting-block">
                  <h3 className="setting-head">
                    <PlectrumIcon size={18} className="setting-head-icon" />
                    <span>Guitar in use</span>
                  </h3>
                  <GuitarPicker />
                </div>
              )}
            </div>

            <button
              type="button"
              className="quick-setup-more"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              All settings
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
