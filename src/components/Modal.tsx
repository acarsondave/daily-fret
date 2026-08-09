import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CloseIcon } from './icons';
import './Modal.css';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  /** Accessible name when the dialog shows no visible title. */
  label?: string;
  position?: 'center' | 'bottom' | 'top-right';
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  isOpen,
  onClose,
  children,
  title,
  label,
  position = 'center',
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Escape closes, Tab stays inside, and the page behind stops scrolling. A
  // dialog that leaks focus to the page underneath is a dialog in appearance
  // only: a keyboard lands on controls it cannot see.
  useEffect(() => {
    if (!isOpen) return;

    restoreRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the panel itself rather than its first control, so a screen reader
    // announces the dialog before its contents and nothing is typed into by
    // accident.
    const focusTimer = setTimeout(() => panelRef.current?.focus(), 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus?.();
    };
  }, [isOpen, onClose]);

  const variants = {
    center: {
      hidden: { opacity: 0, scale: 0.95, y: 10 },
      visible: { opacity: 1, scale: 1, y: 0 },
      exit: { opacity: 0, scale: 0.95, y: 10 },
    },
    bottom: {
      hidden: { opacity: 0, y: '100%' },
      visible: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: '100%' },
    },
    'top-right': {
      hidden: { opacity: 0, scale: 0.95, x: 20, y: -20 },
      visible: { opacity: 1, scale: 1, x: 0, y: 0 },
      exit: { opacity: 0, scale: 0.95, x: 20, y: -20 },
    },
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* A click-to-dismiss scrim. Deliberately not focusable: Escape and
              the close button are the keyboard paths, and putting the backdrop
              in the tab order would add a control that announces nothing. */}
          <motion.div
            className="modal-backdrop"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <div className={`modal-wrapper position-${position}`}>
            <motion.div
              ref={panelRef}
              className="modal-content glass-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby={title ? titleId : undefined}
              aria-label={title ? undefined : label}
              tabIndex={-1}
              variants={variants[position]}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="modal-close" onClick={onClose} aria-label="Close">
                <CloseIcon size={20} />
              </button>
              {title && (
                <div className="modal-header">
                  <h2 id={titleId} className="modal-title">
                    {title}
                  </h2>
                </div>
              )}
              <div className="modal-body">{children}</div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
