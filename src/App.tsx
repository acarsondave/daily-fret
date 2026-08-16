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
import { readDurability, requestDurableStorage } from './lib/durability';
import { SurfaceBoundary } from './components/SurfaceBoundary';
import { CloudIcon, DeviceIcon } from './components/icons';
import { motion } from 'framer-motion';
import './App.css';

function App() {
  const user = useAuthStore((s) => s.user);
  const syncing = useAuthStore((s) => s.syncing);
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

  const accountLabel = syncing
    ? 'Settings. Your practice is on this device and the cloud copy is still loading.'
    : user
      ? 'Settings. Your practice is synced to the cloud.'
      : 'Settings. Your practice is saved on this device only.';

  useEffect(() => {
    initAuthListener();
    // Practice audio (the coach's click, the cues) starts on a timer, not on a
    // tap, and browsers only free audio inside a gesture. Claim the first tap of
    // the visit so the click is already warm by the time a drill needs it.
    armOutputAudioUnlock();

    // Ask the browser to keep the practice history and the footage.
    //
    // Reading is safe anywhere; asking is not, because Firefox prompts, so the
    // request rides the first real interaction of the visit. Without it every
    // byte this app has written is best-effort, which in WebKit means it is
    // deleted outright after seven days of browser use with no visit here. A
    // fortnight away from the guitar is an ordinary thing and a terrible reason
    // to lose months of history.
    void readDurability();
    const ask = () => {
      void requestDurableStorage();
    };
    const events = ['pointerdown', 'keydown'] as const;
    events.forEach((e) => document.addEventListener(e, ask, { once: true, passive: true }));
    return () => events.forEach((e) => document.removeEventListener(e, ask));
  }, []);

  // The splash is dismissed by the first commit, not by a network result. It
  // exists to cover the gap between the HTML arriving and React mounting; once
  // the routine is on screen there is nothing left for it to cover.
  useEffect(() => {
    const loader = document.getElementById('initial-loader');
    if (!loader) return;
    loader.style.opacity = '0';
    loader.style.visibility = 'hidden';
    const remove = setTimeout(() => loader.remove(), 300);
    return () => clearTimeout(remove);
  }, []);

  return (
    <>
      {/* The room the app sits in: one warm lamp past the lower-right corner,
          the room's cold air past the upper-left, and six strings raked across
          the lower half in low-E-to-high-E order. Both light centres are off
          canvas, so only their falloff is ever on screen. Nothing here moves.
          Geometry and the reasoning behind it are in App.css. */}
      <div className="app-ambient" aria-hidden="true">
        <span className="app-ambient-light" />
        <span className="app-ambient-rake">
          <span className="app-ambient-string is-e6" />
          <span className="app-ambient-string is-a5" />
          <span className="app-ambient-string is-d4" />
          <span className="app-ambient-string is-g3" />
          <span className="app-ambient-string is-b2" />
          <span className="app-ambient-string is-e1" />
        </span>
        <span className="app-ambient-grain" />
      </div>

      {/* Opacity only, and short. The old entrance animated `filter: blur(10px)`
          across the whole viewport for 600ms, which on a mid-range phone is an
          offscreen render pass per frame and, more to the point, 600ms during
          which the practice list is there but cannot be read. */}
      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
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
              aria-label={accountLabel}
            >
              {user || syncing ? <CloudIcon size={16} /> : <DeviceIcon size={16} />}
              {/* Says where the data actually lives. "Local Mode" named a mode;
                  this names the consequence. While the cloud copy is still
                  coming this says so, because the screen was painted from the
                  local copy and might yet be corrected. */}
              <span>{syncing ? 'Syncing' : user ? 'Synced' : 'This device'}</span>
            </button>
          </div>
        </header>

        <div className="center-content">
          <DailyPath />
        </div>

        <Footer />

        {/* The boundary is mounted with the surface and not around it, so closing
            settings unmounts the boundary and clears its failed state. A
            boundary that outlives the thing it guards latches on the first
            failure and shows the panel over a screen nobody opened. */}
        {isSettingsOpen && (
          <SurfaceBoundary name="Settings" overlay onDismiss={() => setIsSettingsOpen(false)}>
            <Suspense fallback={null}>
              <SettingsModal isOpen onClose={() => setIsSettingsOpen(false)} />
            </Suspense>
          </SurfaceBoundary>
        )}
      </motion.main>
    </>
  );
}

export default App;
