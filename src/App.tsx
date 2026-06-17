import { useState, useEffect } from 'react';
import { DailyPath } from './components/DailyPath';
import { Footer } from './components/Footer';
import { AccountModal } from './components/AccountModal';
import { initAuthListener, useAuthStore } from './lib/auth';
import { motion, AnimatePresence } from 'framer-motion';
import { UserCircle } from '@phosphor-icons/react';

function App() {
  const { loading, user } = useAuthStore();
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);

  useEffect(() => {
    initAuthListener();
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
              <div className="header-account">
                {!user ? (
                  <button className="account-btn local-mode" onClick={() => setIsAccountModalOpen(true)}>
                    <UserCircle size={24} weight="light" />
                    <span>Local Mode</span>
                  </button>
                ) : (
                  <button className="account-btn active-mode" onClick={() => setIsAccountModalOpen(true)}>
                    <UserCircle size={24} weight="fill" color="var(--accent-primary)" />
                    <span>{user.email?.split('@')[0]}</span>
                  </button>
                )}
              </div>
            </header>
            
            {/* Minimalist Left Art */}
            <div className="left-art pointer-events-none">
               <svg width="100%" height="100%" viewBox="0 0 100 800" preserveAspectRatio="none">
                 <line x1="20" y1="0" x2="20" y2="800" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                 <line x1="30" y1="0" x2="30" y2="800" stroke="rgba(255,255,255,0.02)" strokeWidth="1" />
                 <line x1="40" y1="0" x2="40" y2="800" stroke="rgba(255,255,255,0.01)" strokeWidth="1" />
                 <circle cx="20" cy="150" r="4" fill="rgba(255,255,255,0.1)" />
                 <circle cx="30" cy="450" r="3" fill="rgba(255,255,255,0.05)" />
                 <circle cx="40" cy="650" r="2" fill="rgba(255,255,255,0.03)" />
               </svg>
            </div>

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
