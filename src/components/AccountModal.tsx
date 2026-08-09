import { useState } from 'react';
import { Modal } from './Modal';
// Through the facade, so opening this modal is what pulls the Firebase SDK
// down rather than loading the app.
import { useAuthStore, signIn, signUp, signOutUser } from '../lib/auth';
import { useStore } from '../store';
import { ArrowRightIcon, DownloadIcon, PlectrumIcon, SignOutIcon, SpinnerIcon } from './icons';
import { downloadDiagnostics, storedSessionSummaries } from '../audio/diagnostics';
import { MicSetting } from './MicSetting';
import { CalibrationSetting } from './CalibrationSetting';
import { PatternManager } from './PatternManager';
import './AccountModal.css';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AccountModal({ isOpen, onClose }: AccountModalProps) {
  const user = useAuthStore(state => state.user);
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [diagStatus, setDiagStatus] = useState<string | null>(null);

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

  const handleLogout = () => {
    setIsLoading(true);
    onClose();
    setTimeout(async () => {
      await signOutUser();
      setIsLoading(false);
    }, 250); // wait for modal exit animation to prevent login form flash
  };

  const exportData = () => {
    const state = useStore.getState();
    const data = state.accounts[state.currentAccountId];
    if (!data) return;
    
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
    <Modal isOpen={isOpen} onClose={onClose} position="top-right" label="Account and settings">
      <div className="account-modal-content">
        {!user ? (
          <form onSubmit={handleAuth} className="auth-form">
            <h2 className="auth-title">{isLogin ? 'Sign into your account' : 'Create an account'}</h2>
            <p className="auth-subtitle">
              {isLogin ? 'Welcome back to your guitar journey.' : 'Save your progress securely to the cloud.'}
            </p>
            {error && <div className="auth-error">{error}</div>}
            
            <input
              type="email"
              className="auth-input"
              aria-label="Email address"
              autoComplete="email"
              placeholder="Email address" 
              value={email}
              onChange={e => setEmail(e.target.value)}
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
              onChange={e => setPassword(e.target.value)}
              required 
              maxLength={100}
            />
            
            <button type="submit" className="auth-submit" disabled={isLoading}>
              {isLoading ? (
                <SpinnerIcon size={16} className="spinner-icon" />
              ) : (
                <>
                  <span>{isLogin ? 'Sign In' : 'Create Account'}</span>
                  <ArrowRightIcon size={16} />
                </>
              )}
            </button>

            <button type="button" className="auth-switch" onClick={() => setIsLogin(!isLogin)}>
              {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </form>
        ) : (
          <div className="account-settings">
            <h2 className="settings-title">Account Settings</h2>
            <div className="user-email">{user.email}</div>

            <MicSetting />

            <CalibrationSetting />

            <PatternManager />

            <div className="settings-actions">
              <button className="settings-action-btn" onClick={exportData}>
                <DownloadIcon size={18} />
                <span>Export My Data (JSON)</span>
              </button>

              <button className="settings-action-btn" onClick={() => void exportDiagnostics()}>
                <PlectrumIcon size={18} />
                <span>{diagStatus ?? 'Export Detection Diagnostics'}</span>
              </button>

              <button className="settings-action-btn logout" onClick={handleLogout} disabled={isLoading}>
                {isLoading ? <SpinnerIcon size={18} className="spinner-icon" /> : <SignOutIcon size={18} />}
                <span>{isLoading ? 'Logging Out...' : 'Log Out'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
