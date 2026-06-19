import { useState } from 'react';
import { Modal } from './Modal';
import { useStore } from '../store';
import { Plus } from '@phosphor-icons/react';
import './TaskCreatorModal.css';

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    addTask(routineId, {
      id: crypto.randomUUID(),
      title: title.trim(),
      description: description.trim(),
      duration: duration.trim() || '5 mins'
    });

    setTitle('');
    setDescription('');
    setDuration('');
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
          
          <button type="submit" className="task-submit-btn" disabled={!title.trim()}>
            <Plus size={16} />
            <span>Add Task</span>
          </button>
        </form>
      </div>
    </Modal>
  );
}
