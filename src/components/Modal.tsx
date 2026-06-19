import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from '@phosphor-icons/react';
import './Modal.css';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  position?: 'center' | 'bottom' | 'top-right';
}

export function Modal({ isOpen, onClose, children, title, position = 'center' }: ModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const variants = {
    center: {
      hidden: { opacity: 0, scale: 0.95, y: 10 },
      visible: { opacity: 1, scale: 1, y: 0 },
      exit: { opacity: 0, scale: 0.95, y: 10 }
    },
    bottom: {
      hidden: { opacity: 0, y: '100%' },
      visible: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: '100%' }
    },
    'top-right': {
      hidden: { opacity: 0, scale: 0.95, x: 20, y: -20 },
      visible: { opacity: 1, scale: 1, x: 0, y: 0 },
      exit: { opacity: 0, scale: 0.95, x: 20, y: -20 }
    }
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            className="modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <div className={`modal-wrapper position-${position}`}>
            <motion.div 
              className="modal-content glass-panel"
              variants={variants[position]}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="modal-close" onClick={onClose}>
                <X size={20} />
              </button>
              {title && (
                <div className="modal-header">
                  <h3 className="modal-title">{title}</h3>
                </div>
              )}
              <div className="modal-body">
                {children}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
