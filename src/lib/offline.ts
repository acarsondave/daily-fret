import { useSyncExternalStore } from 'react';

// Whether there is a connection, as far as the browser will say.
//
// One job, and a deliberately narrow one. `navigator.onLine` is honest about
// having no network interface and optimistic about everything else: a captive
// portal, a dead router and a phone with one bar all report true. So this
// decides what a surface may *offer* and never what it silently *does*. The
// record stage still fails the way it always failed when a connection turns out
// to be a lie, and nothing anywhere switches modes on its own.

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
};

// A browser that does not implement it is not a browser that is offline.
const read = (): boolean => (typeof navigator.onLine === 'boolean' ? navigator.onLine : true);

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}
