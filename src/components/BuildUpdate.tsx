import { useRegisterSW } from 'virtual:pwa-register/react';
import { RetryIcon } from './icons';

// The app is cached so it opens with no connection, which means a build can go
// on running long after a newer one has been deployed. Two things follow, and
// both are about not lying to the player.
//
// It never swaps underneath a session. A service worker that takes over on the
// next navigation would reload the page mid-drill and lose the run.
//
// And it never stays quiet about being old. The waiting build is announced by
// one control that does the one thing there is to do about it, next to the pill
// that already says where today's results went. Tapping it is the only way a
// new build ever takes over.
export function BuildUpdate() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <button className="build-update" onClick={() => void updateServiceWorker(true)}>
      <RetryIcon size={16} />
      <span>Update</span>
    </button>
  );
}
