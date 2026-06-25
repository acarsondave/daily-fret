import { useState } from 'react';
import { Modal } from './Modal';
import { auth } from '../lib/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { useAuthStore } from '../lib/auth';
import { useStore } from '../store';
import { SignOut, ArrowRight, Guitar, Spinner, DownloadSimple } from '@phosphor-icons/react';
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

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
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
      await signOut(auth);
      setIsLoading(false);
    }, 250); // wait for modal exit animation to prevent login form flash
  };

  const restoreDefaults = () => {
    useStore.setState(state => {
      const uid = state.currentAccountId;
      const acc = state.accounts[uid];
      const seededRoutines = [
        {
          id: 'r_10min',
          name: '10-Min Muscle Memory',
          description: 'Low energy day. 100% focused on physical mechanics.',
          isDefault: true,
          tasks: [
            { id: 't1', title: 'Spider Exercises', description: '1st fret start. Low E to high E.', duration: '5 mins' },
            { id: 't2', title: 'Lauren Bateman Pushups', description: '20 reps per finger on the G string.', duration: '2-3 mins' },
            { id: 't3', title: 'Chord Speed Training', description: 'A, D, E transitions. Goal: 65+ cpm.', duration: '3 mins' }
          ]
        },
        {
          id: 'r_30min',
          name: '30-Min Concept Mastery',
          description: 'High energy day. Focus on JustinGuitar module concepts.',
          isDefault: true,
          tasks: [
            { id: 'c1', title: 'Spider Exercises', description: '1st fret start. Low E to high E.', duration: '5 mins' },
            { id: 'c2', title: 'Lauren Bateman Pushups', description: '20 reps per finger on the G string.', duration: '2-3 mins' },
            { id: 'c3', title: 'Chord Speed Training', description: 'A, D, E transitions. Goal: 65+ cpm.', duration: '3 mins' },
            { id: 'c4', title: 'JustinGuitar Lesson', description: 'Watch and grasp new concepts from Module 2.', duration: '10 mins' },
            { id: 'c5', title: 'Song Integration', description: '"Wild Thing" by The Troggs practice.', duration: '10 mins' }
          ]
        }
      ];
      return { 
        accounts: { 
          ...state.accounts, 
          [uid]: { ...acc, routines: seededRoutines, activeRoutineId: 'r_10min' } 
        } 
      };
    });
    onClose();
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

  return (
    <Modal isOpen={isOpen} onClose={onClose} position="top-right">
      <div className="account-modal-content">
        {!user ? (
          <form onSubmit={handleAuth} className="auth-form">
            <h3 className="auth-title">{isLogin ? 'Sign into your account' : 'Create an account'}</h3>
            <p className="auth-subtitle">
              {isLogin ? 'Welcome back to your guitar journey.' : 'Save your progress securely to the cloud.'}
            </p>
            {error && <div className="auth-error">{error}</div>}
            
            <input 
              type="email" 
              className="auth-input" 
              placeholder="Email address" 
              value={email}
              onChange={e => setEmail(e.target.value)}
              required 
              maxLength={100}
            />
            <input 
              type="password" 
              className="auth-input" 
              placeholder="Password" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              required 
              maxLength={100}
            />
            
            <button type="submit" className="auth-submit" disabled={isLoading}>
              {isLoading ? (
                <Spinner size={16} className="spinner-icon" weight="bold" />
              ) : (
                <>
                  <span>{isLogin ? 'Sign In' : 'Create Account'}</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>

            <button type="button" className="auth-switch" onClick={() => setIsLogin(!isLogin)}>
              {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </form>
        ) : (
          <div className="account-settings">
            <h3 className="settings-title">Account Settings</h3>
            <div className="user-email">{user.email}</div>
            
            <div className="settings-actions">
              <button className="settings-action-btn" onClick={exportData}>
                <DownloadSimple size={18} />
                <span>Export My Data (JSON)</span>
              </button>

              <button className="settings-action-btn" onClick={restoreDefaults}>
                <Guitar size={18} />
                <span>Restore Starter Routines</span>
              </button>
              
              <button className="settings-action-btn logout" onClick={handleLogout} disabled={isLoading}>
                {isLoading ? <Spinner size={18} className="spinner-icon" /> : <SignOut size={18} />}
                <span>{isLoading ? 'Logging Out...' : 'Log Out'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
