import { useState } from 'react';
// Through the facade, so opening settings is what pulls the Firebase SDK down
// rather than loading the app.
import { useAuthStore, signIn, signUp, signOutUser } from '../../lib/auth';
import { useStore } from '../../store';
import { ArrowRightIcon, CloudIcon, DeviceIcon, DownloadIcon, PlectrumIcon, SignOutIcon, SpinnerIcon } from '../icons';
import { downloadDiagnostics, storedSessionSummaries } from '../../audio/diagnostics';

interface AccountSectionProps {
  onClose: () => void;
}

/**
 * The account pane: who you are, where your practice lives, and the two ways to
 * take it with you. Signing out sits at the bottom behind a confirmation,
 * because it is the one control here that can make a session's work look lost.
 */
export function AccountSection({ onClose }: AccountSectionProps) {
  const user = useAuthStore((state) => state.user);
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [diagStatus, setDiagStatus] = useState<string | null>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  // Signed-out visitors get the sign-in form folded away behind a prompt. The
  // settings elsewhere in this surface are about the microphone and the guitar,
  // not about an account, and they used to be unreachable without one.
  const [authOpen, setAuthOpen] = useState(false);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      if (isLogin) {
        await signIn(email, password);
      } else {
        await signUp(email, password);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = () => {
    setIsLoading(true);
    onClose();
    setTimeout(async () => {
      await signOutUser();
      setIsLoading(false);
    }, 250); // wait for the exit animation so the sign-in form does not flash
  };

  const exportData = () => {
    const state = useStore.getState();
    const data = state.accounts[state.currentAccountId];
    if (!data) {
      setExportError('Nothing to export yet. Your practice starts saving with your first task.');
      return;
    }
    setExportError(null);

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daily-fret-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Downloads the recorded detection sessions (per-frame gate outcomes) so a
  // bad-detection day can be handed over for analysis instead of described.
  const exportDiagnostics = async () => {
    const count = (await storedSessionSummaries()).length;
    if (!(await downloadDiagnostics())) {
      setDiagStatus('No mic sessions recorded yet');
    } else {
      setDiagStatus(`Exported ${count} session${count === 1 ? '' : 's'}`);
    }
    setTimeout(() => setDiagStatus(null), 2500);
  };

  return (
    <>
      {user ? (
        <div className="setting-block">
          <h3 className="setting-head">
            <CloudIcon size={18} className="setting-head-icon" />
            <span>Signed in</span>
          </h3>
          <p className="account-identity">{user.email}</p>
          <p className="setting-note">
            Your practice syncs to the cloud, so it survives clearing this browser
            and follows you to your phone.
          </p>
        </div>
      ) : (
        <div className="setting-block">
          <h3 className="setting-head">
            <DeviceIcon size={18} className="setting-head-icon" />
            <span>Saved on this device</span>
          </h3>
          {!authOpen ? (
            <>
              <p className="setting-note">
                Everything you have practised is stored in this browser. Sign in to
                keep it if you clear the browser or switch to your phone.
              </p>
              <button
                type="button"
                className="settings-action-btn"
                onClick={() => setAuthOpen(true)}
              >
                <ArrowRightIcon size={18} />
                <span>Sign in or create an account</span>
              </button>
            </>
          ) : (
            <form onSubmit={handleAuth} className="auth-form">
              <p className="setting-note">
                {isLogin
                  ? 'Welcome back. Your practice picks up where it was.'
                  : 'A new account keeps a copy of your practice off this device.'}
              </p>
              {error && (
                <p className="auth-error" role="alert">
                  {error}
                </p>
              )}

              <input
                type="email"
                className="auth-input"
                aria-label="Email address"
                autoComplete="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={100}
              />
              <input
                type="password"
                className="auth-input"
                aria-label="Password"
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                maxLength={100}
              />

              <button type="submit" className="auth-submit" disabled={isLoading}>
                {isLoading ? (
                  <SpinnerIcon size={16} className="spinner-icon" />
                ) : (
                  <>
                    <span>{isLogin ? 'Sign in' : 'Create account'}</span>
                    <ArrowRightIcon size={16} />
                  </>
                )}
              </button>

              <button type="button" className="auth-switch" onClick={() => setIsLogin(!isLogin)}>
                {isLogin ? 'No account yet? Create one' : 'Already have an account? Sign in'}
              </button>
              <button type="button" className="auth-switch" onClick={() => setAuthOpen(false)}>
                Not now
              </button>
            </form>
          )}
        </div>
      )}

      {/* Account-level acts, kept apart from the settings above by a real rule.
          Taking your data out and signing out are not configuration. */}
      <section className="settings-footer-group" aria-labelledby="account-data-heading">
        <h3 className="settings-footer-heading" id="account-data-heading">
          Your data
        </h3>

        <button type="button" className="settings-action-btn" onClick={exportData}>
          <DownloadIcon size={18} />
          <span>Export my practice (JSON)</span>
        </button>
        {exportError && (
          <p className="reminder-error" role="alert">
            {exportError}
          </p>
        )}

        <button
          type="button"
          className="settings-action-btn"
          onClick={() => void exportDiagnostics()}
        >
          <PlectrumIcon size={18} />
          <span>{diagStatus ?? 'Export detection diagnostics'}</span>
        </button>
        <p className="setting-note">
          A recording of what the microphone decided, frame by frame, for a day
          the drills would not count.
        </p>

        {user &&
          (confirmingSignOut ? (
            <div className="settings-confirm" role="group" aria-label="Confirm sign out">
              <p className="settings-confirm-text">
                Sign out? Your practice stays synced, and this browser keeps its own
                copy.
              </p>
              <div className="settings-confirm-actions">
                <button
                  type="button"
                  className="settings-action-btn is-quiet"
                  onClick={() => setConfirmingSignOut(false)}
                >
                  <span>Stay signed in</span>
                </button>
                <button
                  type="button"
                  className="settings-action-btn is-danger"
                  onClick={handleSignOut}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <SpinnerIcon size={18} className="spinner-icon" />
                  ) : (
                    <SignOutIcon size={18} />
                  )}
                  <span>{isLoading ? 'Signing out…' : 'Sign out'}</span>
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="settings-action-btn is-danger"
              onClick={() => setConfirmingSignOut(true)}
            >
              <SignOutIcon size={18} />
              <span>Sign out</span>
            </button>
          ))}
      </section>
    </>
  );
}
