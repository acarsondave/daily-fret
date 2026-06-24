import { useState } from 'react';
import { Modal } from './Modal';
import { useStore } from '../store';
import { Plus, ArrowsLeftRight } from '@phosphor-icons/react';
import clsx from 'clsx';
import type { DrillConfig, DrillKind } from '../types';
import './TaskCreatorModal.css';
import './drill-fields.css';

const DRILL_CHORDS = ['A', 'C', 'D', 'E', 'G', 'Am', 'Dm', 'Em', 'F'];

interface TaskCreatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  routineId: string;
}

export function TaskCreatorModal({ isOpen, onClose, routineId }: TaskCreatorModalProps) {
  const addTask = useStore(state => state.addTask);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState('');
  const [drillKind, setDrillKind] = useState<DrillKind | 'none'>('none');
  const [chords, setChords] = useState({ from: 'A', to: 'D' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    let drill: DrillConfig | undefined;
    if (drillKind === 'one-minute-changes') {
      drill = { kind: 'one-minute-changes', chordFrom: chords.from, chordTo: chords.to, durationSec: 60 };
    } else if (drillKind === 'free-play') {
      drill = { kind: 'free-play' };
    }

    addTask(routineId, {
      id: crypto.randomUUID(),
      title: title.trim(),
      description: description.trim(),
      duration: duration.trim() || '5 mins',
      drill,
    });

    setTitle('');
    setDescription('');
    setDuration('');
    setDrillKind('none');
    setChords({ from: 'A', to: 'D' });
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} position="center">
      <div className="task-creator-content">
        <div className="task-creator-header">
          <h3 className="task-creator-title">Add New Task</h3>
        </div>

        <form onSubmit={handleSubmit} className="task-creator-form">
          <div className="form-group">
            <label>Task Title</label>
            <input 
              type="text" 
              className="task-input" 
              placeholder="e.g. Spider Exercises" 
              value={title}
              onChange={e => setTitle(e.target.value)}
              autoFocus
              required 
              maxLength={60}
            />
          </div>

          <div className="form-group">
            <label>Duration</label>
            <input 
              type="text" 
              className="task-input" 
              placeholder="e.g. 5 mins" 
              value={duration}
              onChange={e => setDuration(e.target.value)}
              maxLength={30}
            />
          </div>

          <div className="form-group">
            <label>Description (Optional)</label>
            <textarea 
              className="task-input task-textarea" 
              placeholder="e.g. Start at 1st fret, alternate picking." 
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={300}
            />
          </div>
          
          <div className="drill-edit">
            <span className="drill-edit-label">Live drill</span>
            <div className="drill-segment">
              {([
                ['none', 'None'],
                ['free-play', 'Free Play'],
                ['one-minute-changes', '1-Min Changes'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={clsx('drill-segment-btn', drillKind === value && 'active')}
                  onClick={() => setDrillKind(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {drillKind === 'one-minute-changes' && (
              <div className="drill-chords">
                <select className="drill-select" value={chords.from} onChange={e => setChords(c => ({ ...c, from: e.target.value }))}>
                  {DRILL_CHORDS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <ArrowsLeftRight size={16} color="var(--text-secondary)" />
                <select className="drill-select" value={chords.to} onChange={e => setChords(c => ({ ...c, to: e.target.value }))}>
                  {DRILL_CHORDS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
          </div>

          <button type="submit" className="task-submit-btn" disabled={!title.trim()}>
            <Plus size={16} />
            <span>Add Task</span>
          </button>
        </form>
      </div>
    </Modal>
  );
}
