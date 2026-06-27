import { useState } from 'react';
import { Modal } from './Modal';
import { useStore } from '../store';
import { Plus, Trash } from '@phosphor-icons/react';
import clsx from 'clsx';
import { sanitizeMinutes } from '../lib/coached';
import { SONGS } from '../data/songs';
import type { DrillConfig, DrillKind, TimedBlock } from '../types';
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
  const [changesChords, setChangesChords] = useState<string[]>(['A', 'D', 'E']);
  const [trainerChords, setTrainerChords] = useState<string[]>(['A', 'D', 'E', 'G', 'C']);
  const [songId, setSongId] = useState<string>(SONGS[0].id);
  const [blocks, setBlocks] = useState<TimedBlock[]>([]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setDuration('');
    setDrillKind('none');
    setChangesChords(['A', 'D', 'E']);
    setTrainerChords(['A', 'D', 'E', 'G', 'C']);
    setSongId(SONGS[0].id);
    setBlocks([]);
  };

  const addBlock = () =>
    setBlocks((prev) => [...prev, { id: crypto.randomUUID(), label: '', durationSec: 60 }]);
  const updateBlock = (id: string, patch: Partial<TimedBlock>) =>
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const removeBlock = (id: string) => setBlocks((prev) => prev.filter((b) => b.id !== id));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    let drill: DrillConfig | undefined;
    if (drillKind === 'one-minute-changes') {
      drill = {
        kind: 'one-minute-changes',
        chords: changesChords.length >= 2 ? changesChords : ['A', 'D'],
        durationSec: 60,
      };
    } else if (drillKind === 'chord-trainer') {
      drill = {
        kind: 'chord-trainer',
        chords: trainerChords.length >= 2 ? trainerChords : ['A', 'D', 'E', 'G', 'C'],
        durationSec: 60,
      };
    } else if (drillKind === 'song') {
      drill = { kind: 'song', songId };
    }

    // A "None" task can carry several named timed blocks (e.g. strumming
    // patterns). Drop blank rows and only keep blocks when no live drill is set.
    const cleanBlocks =
      drillKind === 'none'
        ? blocks
            .map((b) => ({ ...b, label: b.label.trim() }))
            .filter((b) => b.label && b.durationSec > 0)
        : [];

    addTask(routineId, {
      id: crypto.randomUUID(),
      title: title.trim(),
      description: description.trim(),
      duration: duration.trim() || '5',
      drill,
      blocks: cleanBlocks.length ? cleanBlocks : undefined,
    });

    resetForm();
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
            <div className="task-duration-field">
              <input
                type="text"
                className="task-input"
                placeholder="Minutes"
                value={duration}
                onChange={e => setDuration(sanitizeMinutes(e.target.value))}
                inputMode="numeric"
                pattern="[0-9]*"
              />
              <span className="task-duration-suffix">mins</span>
            </div>
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
                ['one-minute-changes', 'Changes'],
                ['chord-trainer', 'Trainer'],
                ['song', 'Song'],
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
              <>
                <span className="drill-hint">Chords to switch between (pairs are auto-made)</span>
                <div className="drill-chip-grid">
                  {DRILL_CHORDS.map(c => (
                    <button
                      key={c}
                      type="button"
                      className={clsx('drill-chip', changesChords.includes(c) && 'active')}
                      onClick={() => setChangesChords(prev =>
                        prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c],
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </>
            )}
            {drillKind === 'chord-trainer' && (
              <>
                <span className="drill-hint">Chords to reinforce (all you've learned)</span>
                <div className="drill-chip-grid">
                  {DRILL_CHORDS.map(c => (
                    <button
                      key={c}
                      type="button"
                      className={clsx('drill-chip', trainerChords.includes(c) && 'active')}
                      onClick={() => setTrainerChords(prev =>
                        prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c],
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </>
            )}
            {drillKind === 'song' && (
              <>
                <span className="drill-hint">Play along to the chords at your own pace</span>
                <select
                  className="task-input drill-song-select"
                  value={songId}
                  onChange={e => setSongId(e.target.value)}
                >
                  {SONGS.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.title} · {s.artist} ({s.chords.join(' ')})
                    </option>
                  ))}
                </select>
              </>
            )}
            {drillKind === 'none' && (
              <>
                <span className="drill-hint">
                  Timed blocks (optional) — one per pattern, each with its own minutes
                </span>
                <div className="drill-blocks">
                  {blocks.map(block => (
                    <div key={block.id} className="drill-block-row">
                      <input
                        type="text"
                        className="task-input"
                        placeholder="e.g. Pattern 1"
                        value={block.label}
                        onChange={e => updateBlock(block.id, { label: e.target.value })}
                        maxLength={40}
                      />
                      <div className="drill-block-mins">
                        <input
                          type="text"
                          className="task-input"
                          placeholder="Min"
                          value={String(Math.round(block.durationSec / 60))}
                          onChange={e => {
                            const m = parseInt(sanitizeMinutes(e.target.value) || '0', 10);
                            updateBlock(block.id, { durationSec: Math.max(1, m) * 60 });
                          }}
                          inputMode="numeric"
                        />
                        <span className="task-duration-suffix">min</span>
                      </div>
                      <button
                        type="button"
                        className="drill-block-remove"
                        onClick={() => removeBlock(block.id)}
                        title="Remove block"
                      >
                        <Trash size={16} />
                      </button>
                    </div>
                  ))}
                  <button type="button" className="drill-block-add" onClick={addBlock}>
                    <Plus size={14} weight="bold" /> Add block
                  </button>
                </div>
              </>
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
