// Timing a chart to a recording, in one pass through the song.
//
// This tool is used by one person, and it is still the most important screen in
// the feature, because the timing data is the feature. A chart that scrolls with
// the record cannot exist until someone has told the app where each section
// starts, and if that costs twenty minutes a song then no song will ever have it.
// The target is two minutes: press play, tap the space bar on each section's
// first downbeat, done.
//
// Three decisions make that possible.
//
// One: capture is a single key, in one pass, at full speed. No scrubbing, no
// typing timecodes, no per-bar work. Anchors are per section precisely because
// nine taps is a thing a person will do and four hundred is not.
//
// Two: a tap is assumed to be a little late and is corrected by a fixed amount.
// Reacting to a beat you can hear lands consistently behind it; a constant is
// the honest model of a constant bias, and anything it does not cover is what
// the nudge is for.
//
// Three: nothing is destructive and everything is checkable. Any anchor can be
// nudged by a frame or replayed in place without disturbing the ones around it,
// so a song can be corrected in the spot that is wrong instead of retaken.

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, CloseIcon, MinusIcon, PlayIcon, PlusIcon, RetryIcon } from './icons';
import { YouTubePlayer } from './practice/YouTubePlayer';
import { currentTimeOf, seekPlayerTo, type YTPlayer } from '../lib/youtube';
import { buildTimeline, formatVideoTime, TAP_LATENCY_SECONDS } from '../lib/songTiming';
import { draftToSong, youtubeIdFrom, type SongDraft } from '../lib/songCatalog';
import './SongTimingEditor.css';

/** One nudge. A frame and a half at 30fps: small enough to be worth pressing twice. */
const NUDGE_SECONDS = 0.05;

/** Where "play this section" starts, so you hear the run-up and not just the hit. */
const REPLAY_LEAD_SECONDS = 2;

const BEATS_CHOICES = ['3', '4', '6'];

interface Props {
  draft: SongDraft;
  onPatch: (updates: Partial<SongDraft>) => void;
  onClose: () => void;
}

interface Slot {
  label: string;
  /** True for the trailing slot, which is the end of the chart, not a section. */
  isEnd: boolean;
  at: number | null;
}

export function SongTimingEditor({ draft, onPatch, onClose }: Props) {
  const videoId = youtubeIdFrom(draft.youtubeLink);
  const playerRef = useRef<YTPlayer | null>(null);
  const clockRef = useRef<HTMLSpanElement>(null);

  const charted = useMemo(() => draft.sections.filter((s) => s.steps.length > 0), [draft.sections]);

  const slots = useMemo<Slot[]>(
    () => [
      ...charted.map((s) => ({
        label: s.label.trim() || 'Section',
        isEnd: false,
        at: typeof s.atSeconds === 'number' ? s.atSeconds : null,
      })),
      { label: 'End of the last bar', isEnd: true, at: draft.endSeconds },
    ],
    [charted, draft.endSeconds],
  );

  const [cursor, setCursor] = useState(() => {
    const firstEmpty = slots.findIndex((s) => s.at === null);
    return firstEmpty === -1 ? slots.length : firstEmpty;
  });

  const captured = slots.filter((s) => s.at !== null).length;
  const status = useMemo(() => buildTimeline(draftToSong(draft)), [draft]);

  // The video's clock, written straight into the DOM. It moves ten times a
  // second and nothing else on this panel depends on it, so re-rendering the
  // whole list to advance one number would be work for nothing.
  useEffect(() => {
    const id = window.setInterval(() => {
      const node = clockRef.current;
      const player = playerRef.current;
      if (!node || !player) return;
      const now = currentTimeOf(player);
      node.textContent = now === null ? '--' : formatVideoTime(now);
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  const writeSlot = (index: number, seconds: number | null) => {
    const slot = slots[index];
    if (!slot) return;
    if (slot.isEnd) {
      onPatch({ endSeconds: seconds });
      return;
    }
    const target = charted[index];
    onPatch({
      sections: draft.sections.map((section) =>
        section === target
          ? seconds === null
            ? stripAnchor(section)
            : { ...section, atSeconds: seconds }
          : section,
      ),
    });
  };

  const capture = () => {
    const player = playerRef.current;
    if (!player || cursor >= slots.length) return;
    const now = currentTimeOf(player);
    if (now === null) return;
    writeSlot(cursor, Math.max(0, now - TAP_LATENCY_SECONDS));
    setCursor((c) => c + 1);
  };

  const nudge = (index: number, direction: -1 | 1) => {
    const at = slots[index]?.at;
    if (at === null || at === undefined) return;
    writeSlot(index, Math.max(0, at + direction * NUDGE_SECONDS));
  };

  const replay = (index: number) => {
    const at = slots[index]?.at;
    const player = playerRef.current;
    if (at === null || at === undefined || !player) return;
    seekPlayerTo(player, Math.max(0, at - REPLAY_LEAD_SECONDS));
  };

  const clearAll = () => {
    onPatch({
      sections: draft.sections.map(stripAnchor),
      endSeconds: null,
    });
    setCursor(0);
  };

  // Space is the tap. It is bound to the window rather than to the button so
  // the author can watch the video rather than a control, which is the whole
  // point of a one-key capture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.key !== 'Spacebar') return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      capture();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pending = cursor < slots.length ? slots[cursor] : null;

  return (
    <div className="st">
      <header className="st-head">
        <div>
          <h3 className="st-title">Time this chart to the recording</h3>
          <p className="st-sub">
            Play the video and tap on the first beat of each section, in order. Space works too.
          </p>
        </div>
        <button className="se-tool" onClick={onClose} aria-label="Close timing">
          <CloseIcon size={15} />
        </button>
      </header>

      {!videoId ? (
        <p className="st-empty">
          Add a YouTube link above first. A chart is timed against one recording, so there has to
          be one to time it against.
        </p>
      ) : (
        <>
          <YouTubePlayer
            videoId={videoId}
            onEnded={() => undefined}
            onPlayer={(player) => {
              playerRef.current = player;
            }}
          />

          <div className="st-capture">
            <button
              className="st-tap"
              onClick={capture}
              disabled={!pending}
              aria-label={pending ? `Capture the downbeat of ${pending.label}` : 'Every section is timed'}
            >
              <span className="st-tap-key">space</span>
              <span className="st-tap-target">
                {pending ? pending.label : 'All timed'}
              </span>
            </button>
            <div className="st-meter">
              <span className="st-clock" ref={clockRef}>
                --
              </span>
              <span className="st-progress">
                {captured} of {slots.length} timed
              </span>
              <div className="st-bar" aria-hidden="true">
                <span style={{ transform: `scaleX(${captured / slots.length})` }} />
              </div>
            </div>
          </div>

          <ol className="st-list">
            {slots.map((slot, index) => (
              <li
                key={`${slot.label}-${index}`}
                className={`st-slot${index === cursor ? ' is-pending' : ''}${
                  slot.at === null ? '' : ' is-set'
                }${slot.isEnd ? ' is-end' : ''}`}
              >
                <span className="st-slot-label">{slot.label}</span>
                <span className="st-slot-time">{slot.at === null ? '--' : formatVideoTime(slot.at)}</span>
                <div className="st-slot-tools">
                  <button
                    className="se-tool"
                    onClick={() => nudge(index, -1)}
                    disabled={slot.at === null}
                    aria-label={`${slot.label} slightly earlier`}
                    title="Earlier"
                  >
                    <MinusIcon size={14} />
                  </button>
                  <button
                    className="se-tool"
                    onClick={() => nudge(index, 1)}
                    disabled={slot.at === null}
                    aria-label={`${slot.label} slightly later`}
                    title="Later"
                  >
                    <PlusIcon size={14} />
                  </button>
                  <button
                    className="se-tool"
                    onClick={() => replay(index)}
                    disabled={slot.at === null}
                    aria-label={`Play ${slot.label} to check it`}
                    title="Play from here"
                  >
                    <PlayIcon size={14} />
                  </button>
                  <button
                    className="se-tool"
                    onClick={() => {
                      writeSlot(index, null);
                      setCursor(index);
                    }}
                    aria-label={`Retake ${slot.label}`}
                    title="Retake"
                  >
                    <RetryIcon size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ol>

          <div className="st-foot">
            <label className="st-beats">
              <span className="se-field-label">Beats in a bar</span>
              <div className="st-beats-row">
                {BEATS_CHOICES.map((choice) => (
                  <button
                    key={choice}
                    className={`st-beats-chip${
                      (draft.beatsPerBar || '4') === choice ? ' is-on' : ''
                    }`}
                    onClick={() => onPatch({ beatsPerBar: choice === '4' ? '' : choice })}
                    aria-pressed={(draft.beatsPerBar || '4') === choice}
                  >
                    {choice}
                  </button>
                ))}
              </div>
            </label>
            <button className="st-clear" onClick={clearAll} disabled={captured === 0}>
              Start over
            </button>
          </div>

          <p className={status.ok ? 'st-status is-ok' : 'st-status'}>
            {status.ok ? (
              <>
                <CheckIcon size={15} /> Timed. The chart will move with this recording.
              </>
            ) : (
              status.gap.message
            )}
          </p>
        </>
      )}
    </div>
  );
}

// Written as a delete rather than as `atSeconds: undefined`, so a cleared chart
// saves with no key at all and reads back identically to one never timed.
function stripAnchor<T extends { atSeconds?: number }>(section: T): T {
  if (section.atSeconds === undefined) return section;
  const next = { ...section };
  delete next.atSeconds;
  return next;
}
