import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CloseIcon } from './icons';
import { containFocus, pushOverlay } from './overlayStack';
import type { OverlayClaim } from './overlayStack';
import './Modal.css';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  /** Accessible name when the dialog shows no visible title. */
  label?: string;
  /**
   * `full` is a surface rather than a question: it takes the height of the
   * viewport and lets its own content decide what scrolls, for panels that have
   * internal sections instead of one column.
   */
  position?: 'center' | 'bottom' | 'top-right' | 'full';
  /** For panels that are a map rather than a question. */
  wide?: boolean;
  /**
   * The dialog has handed the screen to a layer opened from inside it.
   *
   * It stays mounted, so its tab, its scroll and anything half-typed survive,
   * but it takes no keyboard, no focus and no clicks until that layer closes.
   * Stepping aside is not the same as closing, and the difference is the whole
   * point: closing would destroy what the user was in the middle of.
   */
  suspended?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  children,
  title,
  label,
  position = 'center',
  wide,
  suspended = false,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const overlayRef = useRef<OverlayClaim | null>(null);
  const suspendedRef = useRef(suspended);
  const titleId = useId();

  useEffect(() => {
    suspendedRef.current = suspended;
  }, [suspended]);

  // The place in the overlay stack is claimed once per opening and never
  // reclaimed. Reclaiming would move this dialog back to the top while
  // something opened from inside it is still there, and every parent render was
  // doing exactly that: `onClose` is almost always an inline arrow, so its
  // identity changes on every render of whoever owns the dialog. That is why
  // the claim is kept apart from the key handler, which does need the current
  // `onClose`.
  useEffect(() => {
    if (!isOpen) return;
    const overlay = pushOverlay();
    overlayRef.current = overlay;
    // Written onto the elements rather than routed back through a render. Which
    // layer this dialog paints at is a fact about what was already open when it
    // opened, discovered here and true for as long as it lives; re-rendering
    // the whole dialog to move it in z would be work for nothing.
    if (backdropRef.current) backdropRef.current.style.zIndex = String(overlay.layer);
    if (wrapperRef.current) wrapperRef.current.style.zIndex = String(overlay.layer + 1);

    restoreRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the panel itself rather than its first control, so a screen reader
    // announces the dialog before its contents and nothing is typed into by
    // accident.
    const focusTimer = setTimeout(() => panelRef.current?.focus(), 0);

    return () => {
      overlay.release();
      overlayRef.current = null;
      clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus?.();
    };
  }, [isOpen]);

  // Escape closes and Tab stays inside, both only while this is the dialog on
  // top and not while it has stepped aside for one above it.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (suspendedRef.current) return;
      if (!overlayRef.current?.isTop()) return;
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      containFocus(panel, e);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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
    full: {
      hidden: { opacity: 0, y: 16 },
      visible: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: 16 },
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
            ref={backdropRef}
            className={suspended ? 'modal-backdrop is-suspended' : 'modal-backdrop'}
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <div
            ref={wrapperRef}
            className={`modal-wrapper position-${position}${suspended ? ' is-suspended' : ''}`}
          >
            <motion.div
              ref={panelRef}
              className={wide ? "modal-content glass-panel is-wide" : "modal-content glass-panel"}
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
