import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

// Detection diagnostics used to live in localStorage and grew to several
// megabytes, close to Safari's ~5MB origin cap. That starved the app's own
// persisted state and stalled every tab on the origin, since localStorage is
// synchronous and shared. They live in IndexedDB now (src/audio/diagnostics.ts);
// this reclaims the old key on the next load rather than waiting for the audio
// chunk to be imported. Inlined so startup does not pull in that chunk.
try {
  localStorage.removeItem('df-diag-v1')
} catch {
  // Storage disabled (private mode); nothing to reclaim.
}

// CSS can only reach CSS. Framer drives the overlays, the task list and the
// metronome pendulum from JS, so the OS setting has to be handed to it here.
// `reducedMotion="user"` drops transform and layout animation while keeping
// opacity, which is the distinction that matters: a screen still has to be seen
// to change, it just must not fly across the viewport to say so.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </MotionConfig>
  </StrictMode>,
)
