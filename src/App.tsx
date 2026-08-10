import { useState, useEffect, lazy, Suspense } from 'react';
import { DailyPath } from './components/DailyPath';
import { Footer } from './components/Footer';
// Settings, sign-in, the pattern manager and a chord diagram all hang off this
// surface, and none of it is needed to paint today's practice. It opens on a
// tap, which is exactly when it can be fetched.
const SettingsModal = lazy(() =>
  import('./components/settings/SettingsModal').then((m) => ({ default: m.SettingsModal })),
);
// Not lazy: the capo state is painted in the header on first render, so the
// chunk would be requested immediately anyway.
import { QuickSetup } from './components/settings/QuickSetup';
import { StreakGraph } from './components/StreakGraph';
import { initAuthListener, useAuthStore } from './lib/auth';
import { armOutputAudioUnlock } from './audio/outputContext';
import { CloudIcon, DeviceIcon } from './components/icons';
import { motion, AnimatePresence } from 'framer-motion';
import './App.css';

function App() {
  const { loading, user } = useAuthStore();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Read once per mount rather than on every render: the heading is a fixed
  // fact about this session, not something that should re-derive on each paint.
  // Two lengths of the same date. A phone header has to hold the date, the
  // streak and the storage state at once, and the long form was crowding the
  // other two off the row until both lost their labels. CSS picks one.
  const [displayDate] = useState(() => ({
    long: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    short: new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
  }));

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

  return (
    <>
      {/* The room the app sits in. Two slow radial fields and a faint horizon,
          painted as gradients rather than blurred elements so the drift stays
          on the compositor. */}
      <div className="app-ambient" aria-hidden="true">
        <span className="app-ambient-field is-sky" />
        <span className="app-ambient-field is-moss" />
        <span className="app-ambient-horizon" />
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
            <header className="app-header">
              <h1 className="header-date">
                <span className="header-date-long">{displayDate.long}</span>
                <span className="header-date-short">{displayDate.short}</span>
              </h1>
              <div className="header-actions">
                <StreakGraph />
                <QuickSetup onOpenSettings={() => setIsSettingsOpen(true)} />
                <button
                  className={user ? 'account-btn is-synced' : 'account-btn'}
                  onClick={() => setIsSettingsOpen(true)}
                  aria-label={
                    user
                      ? 'Settings. Your practice is synced to the cloud.'
                      : 'Settings. Your practice is saved on this device only.'
                  }
                >
                  {user ? <CloudIcon size={16} /> : <DeviceIcon size={16} />}
                  {/* Says where the data actually lives. "Local Mode" named a
                      mode; this names the consequence. */}
                  <span>{user ? 'Synced' : 'This device'}</span>
                </button>
              </div>
            </header>

            <div className="center-content">
              <DailyPath />
            </div>

            <Footer />

            <Suspense fallback={null}>
              {isSettingsOpen && (
                <SettingsModal
                  isOpen={isSettingsOpen}
                  onClose={() => setIsSettingsOpen(false)}
                />
              )}
            </Suspense>
          </motion.main>
        )}
      </AnimatePresence>
    </>
  );
}

export default App;
