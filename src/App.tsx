import { useEffect } from 'react';
import { DailyPath } from './components/DailyPath';
import { initAuthListener, useAuthStore } from './lib/auth';
import { motion, AnimatePresence } from 'framer-motion';

function App() {
  const { loading, user } = useAuthStore();

  useEffect(() => {
    initAuthListener();
  }, []);

  return (
    <>
      {/* Background ambient glow */}
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: -1 }}>
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-sky-500/10 blur-[100px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-emerald-500/10 blur-[100px]" />
      </div>

      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div 
            key="loader"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center justify-center min-h-screen"
          >
            <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
          </motion.div>
        ) : (
          <motion.main 
            key="app"
            initial={{ opacity: 0, filter: 'blur(10px)' }}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Minimal Auth Indicator */}
            {!user && (
              <div style={{ position: 'absolute', top: '16px', right: '16px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Local Mode
              </div>
            )}
            
            <DailyPath />
          </motion.main>
        )}
      </AnimatePresence>
    </>
  );
}

export default App;
