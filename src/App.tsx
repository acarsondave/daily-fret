import { useState, useEffect } from 'react';
import { DailyPath } from './components/DailyPath';
import { Footer } from './components/Footer';
import { AccountModal } from './components/AccountModal';
import { StreakGraph } from './components/StreakGraph';
import { initAuthListener, useAuthStore } from './lib/auth';
import { armOutputAudioUnlock } from './audio/outputContext';
import { motion, AnimatePresence } from 'framer-motion';
import './App.css';

function App() {
  const { loading, user } = useAuthStore();
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);

  useEffect(() => {
    initAuthListener();
    // Practice audio (the coach's click, the cues) starts on a timer, not on a
    // tap, and browsers only free audio inside a gesture. Claim the first tap of
    // the visit so the click is already warm by the time a drill needs it.
    armOutputAudioUnlock();
  }, []);

  useEffect(() => {
    if (!loading) {
      const loader = document.getElementById('initial-loader');
      if (loader) {
        loader.style.opacity = '0';
        loader.style.visibility = 'hidden';
        setTimeout(() => loader.remove(), 600);
      }
    }
  }, [loading]);

  const displayDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });

  return (
    <>
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: -1 }}>
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-sky-500/10 blur-[100px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-emerald-500/10 blur-[100px]" />
      </div>

      <AnimatePresence mode="wait">
        {loading ? null : (
          <motion.main 
            key="app"
            initial={{ opacity: 0, filter: 'blur(10px)' }}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="app-layout"
          >
            {/* Top Navigation */}
            <header className="app-header">
              <div className="header-date">{displayDate}</div>
              <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                <StreakGraph />
                <div className="header-account">
                  {!user ? (
                    <button className="account-btn local-mode" onClick={() => setIsAccountModalOpen(true)}>
                      <span>Local Mode</span>
                    </button>
                  ) : (
                    <button className="account-btn active-mode" onClick={() => setIsAccountModalOpen(true)}>
                      <span>Cloud Mode</span>
                    </button>
                  )}
                </div>
              </div>
            </header>

            <div className="center-content">
              <DailyPath />
            </div>

            <Footer />

            <AccountModal 
              isOpen={isAccountModalOpen} 
              onClose={() => setIsAccountModalOpen(false)} 
            />
          </motion.main>
        )}
      </AnimatePresence>
    </>
  );
}

export default App;
