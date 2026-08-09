import { useEffect, useState } from 'react';
import { CloseIcon, MicIcon } from '../icons';
import './micHint.css';

const DISMISS_KEY = 'daily-fret-mic-hint-dismissed';

type MicState = 'granted' | 'denied' | 'prompt' | 'unknown';

// Best-effort microphone permission state. The Permissions API supports the
// 'microphone' name in Chromium/Firefox; Safari throws or omits it, so we report
// 'unknown' there and still show a gentle, dismissible tip.
function useMicPermission(): MicState {
  const [state, setState] = useState<MicState>('unknown');

  useEffect(() => {
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const onChange = () => {
      if (status && !cancelled) setState(status.state as MicState);
    };
    (async () => {
      try {
        if (!navigator.permissions?.query) return;
        status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        if (cancelled) return;
        setState(status.state as MicState);
        status.addEventListener('change', onChange);
      } catch {
        /* unsupported (e.g. Safari) — leave as 'unknown' */
      }
    })();
    return () => {
      cancelled = true;
      status?.removeEventListener('change', onChange);
    };
  }, []);

  return state;
}

// Shown only when mic access isn't already granted. Tells the user how to flip
// on "always allow" so the coach can hear chords without re-prompting. Hidden
// once granted, or once the user dismisses it (remembered).
export function MicPermissionHint() {
  const permission = useMicPermission();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  if (dismissed || permission === 'granted') return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mic-hint" role="note">
      <MicIcon size={18} className="mic-hint-icon" />
      <div className="mic-hint-text">
        {/* This sits under a running countdown, on the one screen where both
            hands are on the guitar. It used to recite Safari's and Chrome's
            permission menus in prose, six lines of it, which is more reading
            than anyone does mid-session. The instruction people actually need
            is the one word to pick when the browser asks. */}
        <strong>Let the coach hear you.</strong> Allow the microphone when your
        browser asks. Choose <em>Always allow</em> so it stops asking every time.
      </div>
      <button className="mic-hint-close" onClick={dismiss} title="Dismiss" aria-label="Dismiss tip">
        <CloseIcon size={14} />
      </button>
    </div>
  );
}
