import { useState } from 'react';
import { Modal } from './Modal';
import { auth } from '../lib/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { useAuthStore } from '../lib/auth';
import { useStore } from '../store';
import { SignOut, ArrowRight, Guitar } from '@phosphor-icons/react';
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

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      onClose();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    onClose();
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

  return (
    <Modal isOpen={isOpen} onClose={onClose} position="top-right">
      <div className="account-modal-content">
        {!user ? (
          <form onSubmit={handleAuth} className="auth-form">
            <h3 className="auth-title">{isLogin ? 'Welcome Back' : 'Start Journey'}</h3>
            {error && <div className="auth-error">{error}</div>}
            
            <input 
              type="email" 
              className="auth-input" 
              placeholder="Email" 
              value={email}
              onChange={e => setEmail(e.target.value)}
              required 
            />
            <input 
              type="password" 
              className="auth-input" 
              placeholder="Password" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              required 
            />
            
            <button type="submit" className="auth-submit">
              <span>{isLogin ? 'Log In' : 'Sign Up'}</span>
              <ArrowRight size={16} />
            </button>

            <button type="button" className="auth-switch" onClick={() => setIsLogin(!isLogin)}>
              {isLogin ? "Need an account? Sign up" : "Already have an account? Log in"}
            </button>
          </form>
        ) : (
          <div className="account-settings">
            <h3 className="settings-title">Account Settings</h3>
            <div className="user-email">{user.email}</div>
            
            <div className="settings-actions">
              <button className="settings-action-btn" onClick={restoreDefaults}>
                <Guitar size={18} />
                <span>Restore Starter Routines</span>
              </button>
              
              <button className="settings-action-btn logout" onClick={handleLogout}>
                <SignOut size={18} />
                <span>Log Out</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
