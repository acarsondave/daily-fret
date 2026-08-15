/*
THESIS: footage is the visible record of months of practice, not a folder of
files. This screen refuses the media-library grid, where every clip is the same
size and a heavy month looks like a thin one.
OWN-WORLD: daily-fret's own dark ground, hand-drawn 24-grid marks, mono only
where a number is a measurement. One rule runs the length of the screen; months
hang off it, and a month's own bar shows how much of it was filmed.
STORY: the player scans down months, sees where practice thickened and thinned,
recognises a sitting by its still, and opens it to watch. On a technique take
they hold it against the same angle from months back.
FIRST VIEWPORT: one plain sentence of accumulated fact at the top left, the
month rail pinned right, and the newest month already open beneath, its days
carrying real stills.
FORM: vertical timeline (journey spine), pinned by the owner over four
structures offered.
FINISH: unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, and DESIGN.md.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CameraIcon, FramingIcon, KeepIcon } from '../icons';
import { useRecordingStore, forgetRecording } from '../../media/recordingStore';
import { formatMegabytes } from '../../media/quality';
import { buildSpine, formatDuration, sameViewBefore, viewName } from '../../media/library';
import type { LibrarySession, SpineMonth } from '../../media/library';
import { EmptyState } from './EmptyState';
import { PosterTile } from './PosterTile';
import { FootageStage } from './FootageStage';
import './recordingLibrary.css';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthOf(date: string): string {
  return MONTHS_SHORT[Number(date.slice(5, 7)) - 1];
}

/** "14 May" without leaning on locale ordering, which reorders the spine's rhythm. */
function shortDate(date: string): string {
  return `${Number(date.slice(8, 10))} ${monthOf(date)}`;
}

function totalHours(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return `${hours}h ${rest}m`;
}

export function RecordingLibrary() {
  const recordings = useRecordingStore((s) => s.recordings);
  const toggleStar = useRecordingStore((s) => s.toggleStar);
  const spine = useMemo(() => buildSpine(recordings), [recordings]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [activeMonth, setActiveMonth] = useState<string | null>(null);
  const monthRefs = useRef(new Map<string, HTMLElement>());

  const open = useMemo(
    () => (openId ? recordings.find((r) => r.id === openId) ?? null : null),
    [openId, recordings],
  );
  const earlier = useMemo(
    () => (open ? sameViewBefore(recordings, open) : []),
    [open, recordings],
  );

  // Which month the reader is actually in, so the rail says where they are
  // rather than only where they can go.
  useEffect(() => {
    if (spine.months.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveMonth(visible.target.getAttribute('data-month'));
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    for (const node of monthRefs.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, [spine.months]);

  const jump = useCallback((key: string) => {
    monthRefs.current.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const remove = useCallback(async (id: string) => {
    setOpenId(null);
    await forgetRecording(id);
  }, []);

  if (recordings.length === 0) {
    return (
      <EmptyState
        icon={<CameraIcon size={26} />}
        title="Nothing filmed yet"
        body="Once a week, a practice session is filmed and lands here beside the day you played it."
      />
    );
  }

  const renderSession = (session: LibrarySession) => (
    <li key={session.sessionId} className="spine-sitting">
      <ul className="spine-takes">
        {session.clips.map((clip) => (
          <li key={clip.id}>
            <motion.button
              layoutId={`take-${clip.id}`}
              className={clip.id === openId ? 'take is-open' : 'take'}
              onClick={() => setOpenId(clip.id === openId ? null : clip.id)}
              aria-expanded={clip.id === openId}
            >
              <PosterTile
                recording={clip}
                alt={`Still from ${clip.view ? viewName(clip.view) : clip.label}`}
              />
              <span className="take-body">
                <span className="take-name">
                  {clip.view ? viewName(clip.view) : clip.label}
                </span>
                <span className="take-meta">
                  {formatDuration(clip.durationMs)}
                  <span className="take-dot" aria-hidden="true" />
                  {formatMegabytes(clip.bytes)}
                </span>
              </span>
              {clip.starred && <KeepIcon size={13} className="take-kept" />}
            </motion.button>
          </li>
        ))}
      </ul>
    </li>
  );

  const renderMonth = (month: SpineMonth) => (
    <section
      key={month.key}
      className="spine-month"
      data-month={month.key}
      ref={(node) => {
        if (node) monthRefs.current.set(month.key, node);
        else monthRefs.current.delete(month.key);
      }}
    >
      <header className="spine-month-head">
        <h3 className="spine-month-name">
          {month.label}
          <span className="spine-month-year">{month.year}</span>
        </h3>
        {/* Density, not decoration: one mark per day of the month, lit on the
            days with footage. A heavy month and a thin one cannot look alike. */}
        <span
          className="spine-density"
          role="img"
          aria-label={`Filmed on ${month.filmedDays} of ${month.daysInMonth} days`}
        >
          {Array.from({ length: month.daysInMonth }, (_, i) => {
            const day = i + 1;
            const on = month.days.some((d) => d.dayOfMonth === day);
            return <span key={day} className={on ? 'spine-tick is-on' : 'spine-tick'} />;
          })}
        </span>
        <span className="spine-month-sum">{totalHours(month.totalMs)}</span>
      </header>

      <ol className="spine-days">
        {month.days.map((day) => (
          <li key={day.date} className="spine-day">
            <div className="spine-marker" aria-hidden="true">
              {day.hasCheck
                ? <span className="spine-check"><FramingIcon size={12} /></span>
                : <span className="spine-node" />}
            </div>
            <div className="spine-day-body">
              <h4 className="spine-day-title">
                <span className="spine-day-num">{day.dayOfMonth}</span>
                <span className="spine-day-weekday">{day.weekday}</span>
              </h4>
              <ul className="spine-sittings">{day.sessions.map(renderSession)}</ul>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );

  return (
    <div className="spine">
      <header className="spine-head">
        <p className="spine-fact">
          Filmed on <strong>{spine.filmedDays}</strong>{' '}
          {spine.filmedDays === 1 ? 'day' : 'days'}
          {spine.earliest && <> since {shortDate(spine.earliest)}</>}.
        </p>
        <p className="spine-fact is-quiet">
          {totalHours(spine.totalMs)} of playing, {formatMegabytes(spine.totalBytes)} on this machine.
        </p>
      </header>

      <div className="spine-body">
        <nav className="spine-rail" aria-label="Jump to a month">
          {spine.months.map((m) => (
            <button
              key={m.key}
              className={m.key === activeMonth ? 'spine-rail-mark is-here' : 'spine-rail-mark'}
              onClick={() => jump(m.key)}
              aria-current={m.key === activeMonth ? 'true' : undefined}
            >
              <span className="spine-rail-name">{MONTHS_SHORT[Number(m.key.slice(5, 7)) - 1]}</span>
              <span
                className="spine-rail-bar"
                style={{ '--fill': `${Math.round((m.filmedDays / m.daysInMonth) * 100)}%` } as React.CSSProperties}
              />
            </button>
          ))}
        </nav>

        <div className="spine-track">{spine.months.map(renderMonth)}</div>
      </div>

      {open && (
        <FootageStage
            clip={open}
            earlier={earlier}
            onClose={() => setOpenId(null)}
            onStar={toggleStar}
            onDelete={remove}
        />
      )}
    </div>
  );
}
