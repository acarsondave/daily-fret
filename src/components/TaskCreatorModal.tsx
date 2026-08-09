import { useId, useState } from 'react';
import { Modal } from './Modal';
import { useStore } from '../store';
import { PlusIcon, TrashIcon } from './icons';
import clsx from 'clsx';
import { sanitizeMinutes } from '../lib/coached';
import { SongPicker } from './SongPicker';
import { useSongs } from '../hooks/useSongs';
import { StrumPatternSelect } from './StrumPatternSelect';
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
  // Stable per-instance ids so the visible labels above these fields are
  // actually bound to them. They were plain <label> elements with nothing to
  // point at, which is a label a screen reader never reads.
  const fieldId = useId();
  const songs = useSongs();
  const firstSongId = songs[0]?.id ?? '';
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState('');
  const [drillKind, setDrillKind] = useState<DrillKind | 'none'>('none');
  const [changesChords, setChangesChords] = useState<string[]>(['A', 'D', 'E']);
  const [trainerChords, setTrainerChords] = useState<string[]>(['A', 'D', 'E', 'G', 'C']);
  const [songId, setSongId] = useState<string>(firstSongId);
  const [blocks, setBlocks] = useState<TimedBlock[]>([]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setDuration('');
    setDrillKind('none');
    setChangesChords(['A', 'D', 'E']);
    setTrainerChords(['A', 'D', 'E', 'G', 'C']);
    setSongId(firstSongId);
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
    } else if (drillKind === 'chord-rotation') {
      drill = {
        kind: 'chord-rotation',
        chords: changesChords.length >= 2 ? changesChords : ['D', 'A', 'E'],
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
    <Modal isOpen={isOpen} onClose={onClose} position="center" label="Add a task">
      <div className="task-creator-content">
        <div className="task-creator-header">
          <h2 className="task-creator-title">Add New Task</h2>
        </div>

        <form onSubmit={handleSubmit} className="task-creator-form">
          <div className="form-group">
            <label htmlFor={`${fieldId}-title`}>Task Title</label>
            <input
              id={`${fieldId}-title`}
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
            <label htmlFor={`${fieldId}-duration`}>Duration</label>
            <div className="task-duration-field">
              <input
                id={`${fieldId}-duration`}
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
            <label htmlFor={`${fieldId}-desc`}>Description (Optional)</label>
            <textarea
              id={`${fieldId}-desc`}
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
                ['chord-rotation', 'Anchor'],
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
            {drillKind === 'chord-rotation' && (
              <>
                <span className="drill-hint">Chords to rotate through, in the order you tap them</span>
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
                <SongPicker value={songId} onChange={setSongId} />
              </>
            )}
            {drillKind === 'none' && (
              <>
                <span className="drill-hint">
                  Timed blocks (optional). One per pattern, each with its own minutes.
                </span>
                <div className="drill-blocks">
                  {blocks.map(block => (
                    <div key={block.id} className="drill-block">
                      <div className="drill-block-row">
                        <input
                          type="text"
                          className="task-input"
                          aria-label="Block name"
                          placeholder="e.g. Pattern 1"
                          value={block.label}
                          onChange={e => updateBlock(block.id, { label: e.target.value })}
                          maxLength={40}
                        />
                        <div className="drill-block-mins">
                          <input
                            type="text"
                            className="task-input"
                            aria-label="Block minutes"
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
                          <TrashIcon size={16} />
                        </button>
                      </div>
                      <StrumPatternSelect
                        value={block.pattern ?? ''}
                        onChange={p => updateBlock(block.id, { pattern: p || undefined })}
                      />
                      {/* A timed block has no measurable change rate to derive a
                          tempo from, so a riff or pattern with a real tempo says
                          it here. Blank leaves the standard practice click. */}
                      <div className="drill-block-bpm">
                        <input
                          type="text"
                          className="task-input"
                          placeholder="Tempo"
                          value={block.bpm ? String(block.bpm) : ''}
                          onChange={e => {
                            const raw = e.target.value.replace(/\D/g, '').slice(0, 3);
                            updateBlock(block.id, { bpm: raw ? parseInt(raw, 10) : undefined });
                          }}
                          inputMode="numeric"
                          aria-label="Block tempo in BPM"
                        />
                        <span className="task-duration-suffix">BPM</span>
                      </div>
                    </div>
                  ))}
                  <button type="button" className="drill-block-add" onClick={addBlock}>
                    <PlusIcon size={14} /> Add block
                  </button>
                </div>
              </>
            )}
          </div>

          <button type="submit" className="task-submit-btn" disabled={!title.trim()}>
            <PlusIcon size={16} />
            <span>Add Task</span>
          </button>
        </form>
      </div>
    </Modal>
  );
}
