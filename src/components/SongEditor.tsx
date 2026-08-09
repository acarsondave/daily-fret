// Write a chord chart.
//
// The interaction is built around what people actually have when they sit down
// to add a song: a chord sheet, somewhere, as text. So the primary input is a
// line you type or paste — "A D E D" — and everything else is refinement. There
// is deliberately no 25-chord palette: a grid of every chord in existence is
// slower than typing four letters, and it would sit there being ignored. What
// replaces it is a row of the chords this song already uses, which after the
// first line is exactly the set the rest of the song needs.
//
// A bar is selected by tapping it, and edits happen in an inspector that opens
// directly under that bar's own section rather than in place, so the grid stays
// readable as a chart instead of turning into a wall of input boxes.
//
// The dialog belongs to this component rather than to the caller, because the
// close policy is the editor's business: a half-written chart must survive
// Escape and a stray click on the backdrop.

import { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Modal } from './Modal';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CloseIcon,
  CycleIcon,
  MusicNoteIcon,
  PlusIcon,
  TrashIcon,
} from './icons';
import type { SongSection, SongStepDef } from '../data/songs';
import {
  chordsUsed,
  chordsWithoutDiagram,
  draftProblems,
  normaliseStrum,
  parseChordLine,
  type SongDraft,
} from '../lib/songCatalog';
import './SongEditor.css';

// Offered only while the chart is empty and there is nothing better to suggest.
// Every one of these is a chord the beginner course teaches in its first weeks.
const STARTER_CHORDS = ['A', 'D', 'E', 'Am', 'Em', 'G', 'C', 'Dm'];

interface Props {
  draft: SongDraft;
  /** True when this id is already in the library, which changes the verb only. */
  existing: boolean;
  onSave: (draft: SongDraft) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

interface Selection {
  section: number;
  step: number;
}

export function SongEditor({ draft: initial, existing, onSave, onCancel, onDelete }: Props) {
  const [draft, setDraft] = useState<SongDraft>(initial);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [lines, setLines] = useState<Record<number, string>>({});
  const [showProblems, setShowProblems] = useState(false);
  const [confirm, setConfirm] = useState<'close' | 'delete' | null>(null);
  const gridRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // The editor owns its own dialog, and therefore its own close policy. When it
  // was mounted inside a Modal owned by the caller, Escape and a brush against
  // the backdrop both went straight to onCancel, and a chart someone had spent
  // ten minutes typing vanished with no warning and no undo.
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(initial),
    [draft, initial],
  );
  const requestClose = () => (dirty ? setConfirm('close') : onCancel());

  const problems = useMemo(() => draftProblems(draft), [draft]);
  const used = useMemo(() => chordsUsed(draft.sections), [draft.sections]);
  const undrawable = useMemo(() => chordsWithoutDiagram(draft.sections), [draft.sections]);
  const totalBars = draft.sections.reduce((n, s) => n + s.steps.length, 0);

  const patch = (updates: Partial<SongDraft>) => setDraft((d) => ({ ...d, ...updates }));

  const patchSections = (fn: (sections: SongSection[]) => SongSection[]) =>
    setDraft((d) => ({ ...d, sections: fn(d.sections) }));

  const patchSteps = (sectionIndex: number, fn: (steps: SongStepDef[]) => SongStepDef[]) =>
    patchSections((sections) =>
      sections.map((s, i) => (i === sectionIndex ? { ...s, steps: fn(s.steps) } : s)),
    );

  // --- bars ---------------------------------------------------------------

  const appendBars = (sectionIndex: number, steps: SongStepDef[]) => {
    if (!steps.length || !draft.sections[sectionIndex]) return;
    patchSteps(sectionIndex, (current) => [...current, ...steps]);
    // Land on the last bar added. Adding then immediately wanting to attach a
    // lyric to what you just added is the common next move.
    const at = draft.sections[sectionIndex].steps.length + steps.length - 1;
    setSelected({ section: sectionIndex, step: at });
    // The grid scrolls sideways; a bar appended off the right edge is a bar the
    // user has no evidence arrived.
    requestAnimationFrame(() => {
      const grid = gridRefs.current[sectionIndex];
      if (grid) grid.scrollLeft = grid.scrollWidth;
    });
  };

  const commitLine = (sectionIndex: number) => {
    const steps = parseChordLine(lines[sectionIndex] ?? '');
    if (!steps.length) return;
    appendBars(sectionIndex, steps);
    setLines((l) => ({ ...l, [sectionIndex]: '' }));
  };

  const updateStep = (sel: Selection, updates: Partial<SongStepDef>) =>
    patchSteps(sel.section, (steps) =>
      steps.map((step, i) => {
        if (i !== sel.step) return step;
        const next = { ...step, ...updates };
        // Blank optional fields are removed rather than stored as '', so a saved
        // chart carries no empty lyric lines and the grid can test for presence.
        for (const key of ['lyric', 'strum', 'tag'] as const) {
          if (!next[key]) delete next[key];
        }
        return next;
      }),
    );

  const removeStep = (sel: Selection) => {
    patchSteps(sel.section, (steps) => steps.filter((_, i) => i !== sel.step));
    const remaining = draft.sections[sel.section].steps.length - 1;
    setSelected(remaining > 0 ? { section: sel.section, step: Math.max(0, sel.step - 1) } : null);
  };

  const moveStep = (sel: Selection, delta: -1 | 1) => {
    const steps = draft.sections[sel.section].steps;
    const to = sel.step + delta;
    if (to < 0 || to >= steps.length) return;
    patchSteps(sel.section, (current) => {
      const next = current.slice();
      [next[sel.step], next[to]] = [next[to], next[sel.step]];
      return next;
    });
    setSelected({ section: sel.section, step: to });
  };

  // --- sections -----------------------------------------------------------

  const addSection = () => {
    patchSections((sections) => [...sections, { label: `Section ${sections.length + 1}`, steps: [] }]);
    setSelected(null);
  };

  // Choruses repeat. Retyping one is the single most tedious thing about writing
  // a chart out by hand, and the one thing a computer should obviously absorb.
  const duplicateSection = (index: number) =>
    patchSections((sections) => {
      const copy: SongSection = {
        label: sections[index].label,
        steps: sections[index].steps.map((s) => ({ ...s })),
      };
      const next = sections.slice();
      next.splice(index + 1, 0, copy);
      return next;
    });

  const moveSection = (index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= draft.sections.length) return;
    patchSections((sections) => {
      const next = sections.slice();
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
    setSelected(null);
  };

  const removeSection = (index: number) => {
    patchSections((sections) => sections.filter((_, i) => i !== index));
    setSelected(null);
  };

  const attemptSave = () => {
    if (problems.length) {
      setShowProblems(true);
      return;
    }
    onSave(draft);
  };

  const selectedStep =
    selected != null ? draft.sections[selected.section]?.steps[selected.step] : undefined;

  const quickChords = used.length ? used : STARTER_CHORDS;
  const quickTarget = selected?.section ?? draft.sections.length - 1;

  // Rendered inside the section that owns the selected bar rather than at the
  // bottom of the dialog. An inspector sitting three controls away from the
  // thing it edits makes you check twice that you are editing what you think.
  const inspector = (sel: Selection, step: SongStepDef) => (
    <motion.div
      className="se-inspector"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="se-inspector-inner">
        <div className="se-inspector-head">
          <span className="se-inspector-title">Bar {sel.step + 1}</span>
          <button className="se-tool" onClick={() => setSelected(null)} aria-label="Close bar editor">
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="se-inspector-row">
          <label className="se-field">
            <span className="se-field-label">Chord</span>
            <input
              className="se-input is-chord"
              value={step.chord}
              onChange={(e) => updateStep(sel, { chord: e.target.value.trim() })}
            />
          </label>
          <label className="se-field is-wide">
            <span className="se-field-label">Lyric</span>
            <input
              className="se-input"
              placeholder="words sung on this chord"
              value={step.lyric ?? ''}
              onChange={(e) => updateStep(sel, { lyric: e.target.value })}
            />
          </label>
        </div>
        <div className="se-inspector-row">
          <label className="se-field">
            <span className="se-field-label">Strum here</span>
            <input
              className="se-input is-mono"
              placeholder={draft.strum || 'DD'}
              value={step.strum ?? ''}
              onChange={(e) => updateStep(sel, { strum: normaliseStrum(e.target.value) })}
            />
          </label>
          <label className="se-field">
            <span className="se-field-label">Label</span>
            <input
              className="se-input"
              placeholder="riff"
              value={step.tag ?? ''}
              onChange={(e) => updateStep(sel, { tag: e.target.value })}
            />
          </label>
          <div className="se-inspector-actions">
            <button
              className="se-tool"
              onClick={() => moveStep(sel, -1)}
              disabled={sel.step === 0}
              aria-label="Move bar earlier"
            >
              <ArrowLeftIcon size={15} />
            </button>
            <button
              className="se-tool"
              onClick={() => moveStep(sel, 1)}
              disabled={sel.step === draft.sections[sel.section].steps.length - 1}
              aria-label="Move bar later"
            >
              <ArrowRightIcon size={15} />
            </button>
            <button className="se-tool is-danger" onClick={() => removeStep(sel)} aria-label="Delete bar">
              <TrashIcon size={15} />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );

  return (
    <Modal isOpen onClose={requestClose} label="Song chart editor" wide>
        <div className="song-editor">
        <div className="se-head">
          <input
            className="se-title-input"
            aria-label="Song title"
            placeholder="Song title"
            value={draft.title}
            onChange={(e) => patch({ title: e.target.value })}
            autoFocus
          />
          <input
            className="se-artist-input"
            aria-label="Artist"
            placeholder="Artist"
            value={draft.artist}
            onChange={(e) => patch({ artist: e.target.value })}
          />
        </div>

        <div className="se-meta">
          <label className="se-field">
            <span className="se-field-label">Strum</span>
            <input
              className="se-input is-mono"
              value={draft.strum}
              placeholder="DD"
              onChange={(e) => patch({ strum: normaliseStrum(e.target.value) })}
            />
          </label>
          <label className="se-field">
            <span className="se-field-label">Tempo</span>
            <input
              className="se-input is-mono"
              inputMode="numeric"
              value={draft.bpm}
              placeholder="—"
              onChange={(e) => patch({ bpm: e.target.value.replace(/\D/g, '').slice(0, 3) })}
            />
          </label>
          <label className="se-field is-wide">
            <span className="se-field-label">Recording</span>
            <input
              className="se-input"
              placeholder="YouTube link (optional)"
              value={draft.youtubeLink}
              onChange={(e) => patch({ youtubeLink: e.target.value })}
            />
          </label>
        </div>

        <div className="se-sections">
          {draft.sections.map((section, si) => (
            <section className="se-section" key={si}>
              <header className="se-section-head">
                <input
                  className="se-section-label"
                  aria-label={`Section ${si + 1} name`}
                  value={section.label}
                  placeholder="Verse"
                  onChange={(e) =>
                    patchSections((sections) =>
                      sections.map((s, i) => (i === si ? { ...s, label: e.target.value } : s)),
                    )
                  }
                />
                <span className="se-section-count">
                  {section.steps.length} {section.steps.length === 1 ? 'bar' : 'bars'}
                </span>
                <div className="se-section-tools">
                  <button
                    className="se-tool"
                    onClick={() => duplicateSection(si)}
                    aria-label={`Duplicate ${section.label}`}
                    title="Duplicate"
                  >
                    <CycleIcon size={15} />
                  </button>
                  <button
                    className="se-tool"
                    onClick={() => moveSection(si, -1)}
                    disabled={si === 0}
                    aria-label={`Move ${section.label} earlier`}
                    title="Move up"
                  >
                    <ArrowUpIcon size={15} />
                  </button>
                  <button
                    className="se-tool"
                    onClick={() => moveSection(si, 1)}
                    disabled={si === draft.sections.length - 1}
                    aria-label={`Move ${section.label} later`}
                    title="Move down"
                  >
                    <ArrowDownIcon size={15} />
                  </button>
                  <button
                    className="se-tool is-danger"
                    onClick={() => removeSection(si)}
                    disabled={draft.sections.length === 1}
                    aria-label={`Delete ${section.label}`}
                    title="Delete section"
                  >
                    <TrashIcon size={15} />
                  </button>
                </div>
              </header>

              <div
                className="se-grid"
                ref={(el) => {
                  gridRefs.current[si] = el;
                }}
              >
                {section.steps.map((step, bi) => {
                  const isSelected = selected?.section === si && selected.step === bi;
                  return (
                    <button
                      key={bi}
                      className={`se-bar${isSelected ? ' is-selected' : ''}`}
                      onClick={() => setSelected(isSelected ? null : { section: si, step: bi })}
                      aria-pressed={isSelected}
                      aria-label={`Bar ${bi + 1}, ${step.chord}${step.lyric ? `, ${step.lyric}` : ''}`}
                    >
                      {step.tag && <span className="se-bar-tag">{step.tag}</span>}
                      <span className="se-bar-chord">{step.chord}</span>
                      {step.lyric && <span className="se-bar-lyric">{step.lyric}</span>}
                      {step.strum && <span className="se-bar-strum">{step.strum}</span>}
                    </button>
                  );
                })}
                {section.steps.length === 0 && (
                  <p className="se-grid-empty">
                    Type the chords below, in order, one line at a time.
                  </p>
                )}
              </div>

              <AnimatePresence initial={false}>
                {selected?.section === si && selectedStep && inspector(selected, selectedStep)}
              </AnimatePresence>

              <div className="se-line">
                <input
                  className="se-line-input"
                  aria-label={`Add chords to ${section.label}`}
                  placeholder="A D E D"
                  value={lines[si] ?? ''}
                  onChange={(e) => setLines((l) => ({ ...l, [si]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    commitLine(si);
                  }}
                />
                <button
                  className="se-line-add"
                  onClick={() => commitLine(si)}
                  disabled={!parseChordLine(lines[si] ?? '').length}
                >
                  <PlusIcon size={16} /> Add
                </button>
              </div>
            </section>
          ))}
        </div>

        <button className="se-add-section" onClick={addSection}>
          <PlusIcon size={16} /> Add a section
        </button>

        {/* The chords this song already uses. Contextual rather than exhaustive:
            after the first line it is precisely the set the rest of the song needs,
            and a chord you have not used yet is a keystroke away in the line above. */}
        <div className="se-quick">
          <span className="se-quick-label">{used.length ? 'In this song' : 'Common starters'}</span>
          <div className="se-quick-row">
            {quickChords.map((chord) => (
              <button
                key={chord}
                className="se-quick-chip"
                onClick={() => appendBars(quickTarget, [{ chord }])}
                aria-label={`Add a ${chord} bar to ${draft.sections[quickTarget]?.label ?? 'the section'}`}
              >
                {chord}
              </button>
            ))}
          </div>
        </div>

        <div className="se-summary">
          <MusicNoteIcon size={16} />
          <span>
            {totalBars} {totalBars === 1 ? 'bar' : 'bars'}
            {used.length ? ` · ${used.join(' · ')}` : ''}
          </span>
        </div>

        {/* Said rather than blocked. A chart is still perfectly playable when the
            app has no picture of one of its shapes; the only thing lost is the
            diagram, so this is information, not an error. */}
        {undrawable.length > 0 && (
          <p className="se-note">
            No chord diagram for {undrawable.join(', ')}. The chart still plays.
          </p>
        )}

        {showProblems && problems.length > 0 && (
          <ul className="se-problems">
            {problems.map((p) => (
              <li key={p.field}>{p.message}</li>
            ))}
          </ul>
        )}

        {/* Both confirmations are inline. A second dialog on top of this one
            would trap focus inside a trap, and the answer is one tap either way. */}
        {confirm === 'close' && (
          <div className="se-confirm">
            <p className="se-confirm-text">Close without saving? The chart goes with it.</p>
            <div className="se-confirm-actions">
              <button className="se-btn" onClick={() => setConfirm(null)} autoFocus>
                Keep editing
              </button>
              <button className="se-btn is-danger" onClick={onCancel}>
                Discard
              </button>
            </div>
          </div>
        )}

        {confirm === 'delete' && (
          <div className="se-confirm">
            <p className="se-confirm-text">Delete {draft.title.trim() || 'this chart'} for good?</p>
            <div className="se-confirm-actions">
              <button className="se-btn" onClick={() => setConfirm(null)} autoFocus>
                Keep it
              </button>
              <button className="se-btn is-danger" onClick={onDelete}>
                Delete
              </button>
            </div>
          </div>
        )}

        <div className="se-actions">
          {onDelete && (
            <button className="se-delete" onClick={() => setConfirm('delete')}>
              <TrashIcon size={16} /> Delete song
            </button>
          )}
          <div className="se-actions-right">
            <button className="se-btn" onClick={requestClose}>
              Cancel
            </button>
            <button className="se-btn is-primary" onClick={attemptSave}>
              {existing ? 'Save changes' : 'Add to my songs'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
