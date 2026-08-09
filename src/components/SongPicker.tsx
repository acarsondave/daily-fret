// Choose a song for a Song task, and write one when the list does not have it.
//
// The editor lives here rather than behind a settings screen because this is the
// exact moment someone discovers they need it: they went to add the song they
// are learning and it was not in the list. Sending them somewhere else to write
// it, then back here to pick it, is where that intention gets lost.
//
// It doubles as the library. Editing and deleting a chart are reachable from
// the row that names it, which means there is no second screen listing the same
// songs again and no way for the two to disagree.

import { lazy, Suspense, useState } from 'react';
import { PencilIcon, PlusIcon } from './icons';
import { useSongs } from '../hooks/useSongs';
import { useStore } from '../store';
import { Loader } from './Loader';
import {
  draftToSong,
  duplicateAsDraft,
  emptyDraft,
  findSong,
  isUserSong,
  newSongId,
  songToDraft,
  type SongDraft,
} from '../lib/songCatalog';
import './SongPicker.css';

// The picker ships with every task row; the editor is opened by a minority of
// sessions and carries its own stylesheet, so it stays out of the first paint.
const SongEditor = lazy(() => import('./SongEditor').then((m) => ({ default: m.SongEditor })));

interface Props {
  value: string;
  onChange: (songId: string) => void;
}

export function SongPicker({ value, onChange }: Props) {
  const songs = useSongs();
  const saveUserSong = useStore((s) => s.saveUserSong);
  const deleteUserSong = useStore((s) => s.deleteUserSong);
  const [draft, setDraft] = useState<SongDraft | null>(null);

  const selected = findSong(songs, value);
  const mine = songs.filter(isUserSong);
  const builtIn = songs.filter((s) => !isUserSong(s));
  const editingExisting = draft ? songs.some((s) => s.id === draft.id) : false;

  const save = (next: SongDraft) => {
    const song = draftToSong(next);
    saveUserSong(song);
    onChange(song.id);
    setDraft(null);
  };

  const remove = () => {
    if (!draft) return;
    deleteUserSong(draft.id);
    // Never leave the task pointing at a chart that no longer exists. The first
    // song in the list is always something real.
    if (value === draft.id) onChange(songs.find((s) => s.id !== draft.id)?.id ?? '');
    setDraft(null);
  };

  return (
    <div className="song-picker">
      <select
        className="task-input drill-song-select"
        aria-label="Song"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {mine.length > 0 && (
          <optgroup label="My charts">
            {mine.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} · {s.artist} ({s.chords.join(' ')})
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label={mine.length ? 'Built in' : 'Songs'}>
          {builtIn.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title} · {s.artist} ({s.chords.join(' ')})
            </option>
          ))}
        </optgroup>
      </select>

      <div className="song-picker-tools">
        <button
          type="button"
          className="song-picker-btn"
          onClick={() => setDraft(emptyDraft(newSongId(songs)))}
        >
          <PlusIcon size={15} /> Write a chart
        </button>

        {selected && isUserSong(selected) && (
          <button
            type="button"
            className="song-picker-btn"
            onClick={() => setDraft(songToDraft(selected))}
          >
            <PencilIcon size={15} /> Edit {selected.title}
          </button>
        )}

        {/* A built-in is read-only, but "that song the way my teacher plays it"
            is the most common chart anyone writes. Copying beats retyping. */}
        {selected && !isUserSong(selected) && (
          <button
            type="button"
            className="song-picker-btn"
            onClick={() => setDraft(duplicateAsDraft(selected, newSongId(songs)))}
          >
            <PencilIcon size={15} /> Make my own version
          </button>
        )}
      </div>

      <Suspense fallback={draft ? <Loader overlay label="Opening the chart…" /> : null}>
        {draft && (
          <SongEditor
            draft={draft}
            existing={editingExisting}
            onSave={save}
            onCancel={() => setDraft(null)}
            onDelete={editingExisting ? remove : undefined}
          />
        )}
      </Suspense>
    </div>
  );
}
