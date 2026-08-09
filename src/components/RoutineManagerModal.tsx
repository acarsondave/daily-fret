import { useId, useState } from 'react';
import { Modal } from './Modal';
import { useStore, useUserData } from '../store';
import { ArrowLeftIcon, CheckIcon, CloseIcon, CodeIcon, PlusIcon, SlidersIcon, TrashIcon, UploadIcon } from './icons';
import clsx from 'clsx';
import type { Routine } from '../types';
import { routineChords } from '../lib/pairs';
import './RoutineManagerModal.css';

const VOCAB_CHORDS = ['A', 'C', 'D', 'E', 'G', 'Am', 'Dm', 'Em', 'F'];

interface RoutineManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ViewState = 'list' | 'create' | 'import';

export function RoutineManagerModal({ isOpen, onClose }: RoutineManagerModalProps) {
  const { routines } = useUserData();
  // See TaskCreatorModal: the "Routine Name" label existed but was never bound.
  const fieldId = useId();
  // Per-action selectors return stable refs — avoids subscribing to the whole store.
  const addRoutine = useStore((s) => s.addRoutine);
  const updateRoutine = useStore((s) => s.updateRoutine);
  const deleteRoutine = useStore((s) => s.deleteRoutine);
  
  const [view, setView] = useState<ViewState>('list');
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  
  const [createName, setCreateName] = useState('');
  
  const [deletingId, setDeletingId] = useState<string | null>(null);
  
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState('');

  const handleEdit = (r: Routine) => {
    setEditingId(r.id);
    setEditName(r.name);
  };

  const saveEdit = () => {
    if (editingId && editName.trim()) {
      updateRoutine(editingId, { name: editName.trim() });
    }
    setEditingId(null);
  };

  const toggleVocab = (r: Routine, chord: string) => {
    const current = routineChords(r);
    const next = current.includes(chord)
      ? current.filter((c) => c !== chord)
      : [...current, chord];
    updateRoutine(r.id, { chords: next });
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) return;

    const newRoutine: Routine = {
      id: crypto.randomUUID(),
      name: createName.trim(),
      description: 'A custom routine.',
      isDefault: false,
      tasks: []
    };
    addRoutine(newRoutine);
    setCreateName('');
    setView('list');
  };

  const handleImport = () => {
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed) || !parsed.every(t => t.title && t.duration)) {
        throw new Error('Invalid format. Must be array of tasks: [{ title, description, duration }]');
      }
      
      const newRoutine: Routine = {
        id: crypto.randomUUID(),
        name: 'Imported Routine',
        description: 'Tasks imported from JSON.',
        isDefault: false,
        tasks: parsed.map(t => ({
          id: crypto.randomUUID(),
          title: t.title,
          description: t.description || '',
          duration: t.duration
        }))
      };
      
      addRoutine(newRoutine);
      setJsonText('');
      setJsonError('');
      setView('list');
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const resetAndClose = () => {
    setView('list');
    setEditingId(null);
    setJsonText('');
    setJsonError('');
    setJsonError('');
    setCreateName('');
    setDeletingId(null);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={resetAndClose} position="center" label="Manage routines">
      <div className="routine-manager-content">
        
        {view === 'list' && (
          <>
            <div className="routine-manager-header">
              <div className="header-title-row">
                <SlidersIcon size={24} color="var(--accent-primary)" />
                <h2 className="routine-manager-title">Manage Routines</h2>
              </div>
            </div>

            <div className="routines-list">
              {routines.map(r => (
                <div key={r.id} className="routine-edit-item">
                  {editingId === r.id ? (
                    <div className="routine-edit-input-row">
                      <input
                        type="text"
                        aria-label={`Rename routine ${r.name}`}
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="routine-edit-input"
                        autoFocus
                        onKeyDown={e => e.key === 'Enter' && saveEdit()}
                        onBlur={saveEdit}
                        maxLength={60}
                      />
                      <button className="icon-btn success" onClick={saveEdit}>
                        <CheckIcon size={18} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="routine-edit-display-row">
                        <span className="routine-edit-name" onClick={() => handleEdit(r)}>{r.name}</span>
                        <div className="routine-actions">
                          {deletingId === r.id ? (
                            <>
                              <span className="confirm-text" style={{ fontSize: '0.8rem', color: 'var(--error-color)', marginRight: '8px' }}>Delete?</span>
                              <button className="icon-btn danger" onClick={() => { deleteRoutine(r.id); setDeletingId(null); }}>
                                <CheckIcon size={18} />
                              </button>
                              <button className="icon-btn" onClick={() => setDeletingId(null)}>
                                <CloseIcon size={18} />
                              </button>
                            </>
                          ) : (
                            <button className="icon-btn danger" onClick={() => setDeletingId(r.id)} disabled={routines.length <= 1}>
                              <TrashIcon size={18} />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="routine-vocab">
                        <span className="routine-vocab-label">Chords you've learned</span>
                        <div className="routine-vocab-chips">
                          {VOCAB_CHORDS.map((c) => (
                            <button
                              key={c}
                              type="button"
                              className={clsx('routine-vocab-chip', routineChords(r).includes(c) && 'is-on')}
                              onClick={() => toggleVocab(r, c)}
                            >
                              {c}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="routine-manager-actions">
              <button className="create-routine-btn" onClick={() => setView('create')}>
                <PlusIcon size={16} /> Create New Routine
              </button>
              <button className="import-json-btn" onClick={() => setView('import')}>
                <CodeIcon size={16} /> Import from JSON
              </button>
            </div>
          </>
        )}

        {view === 'create' && (
          <div className="slate-view">
            <div className="slate-header">
              <button className="back-btn" onClick={() => setView('list')}>
                <ArrowLeftIcon size={18} />
              </button>
              <h2 className="slate-title">Create Routine</h2>
            </div>
            <form onSubmit={handleCreateSubmit} className="slate-form">
              <div className="input-group">
                <label htmlFor={`${fieldId}-routine-name`}>Routine Name</label>
                <input
                  id={`${fieldId}-routine-name`}
                  type="text"
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  placeholder="e.g. Weekend Jam"
                  autoFocus
                  required
                  maxLength={60}
                />
              </div>
              <button type="submit" className="slate-submit-btn" disabled={!createName.trim()}>
                Create Routine
              </button>
            </form>
          </div>
        )}

        {view === 'import' && (
          <div className="slate-view">
            <div className="slate-header">
              <button className="back-btn" onClick={() => setView('list')}>
                <ArrowLeftIcon size={18} />
              </button>
              <h2 className="slate-title">Import JSON</h2>
            </div>
            <div className="slate-form">
              <p className="json-hint">Paste an array of tasks: [{`{ "title": "...", "duration": "..." }`}]</p>
              {jsonError && <p className="json-error">{jsonError}</p>}
              <textarea
                className="json-textarea"
                aria-label="Tasks JSON"
                value={jsonText}
                onChange={e => setJsonText(e.target.value)}
                placeholder={`[\n  { "title": "Scale Practice", "duration": "5 mins", "description": "A minor" }\n]`}
                maxLength={50000}
              />
              <button className="slate-submit-btn" onClick={handleImport} disabled={!jsonText.trim()}>
                <UploadIcon size={16} /> Import Tasks
              </button>
            </div>
          </div>
        )}

      </div>
    </Modal>
  );
}
