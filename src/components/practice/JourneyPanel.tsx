import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { CheckIcon, CaretDownIcon, TargetIcon, HourglassIcon, MicIcon, PlayIcon } from '../icons';
import { useStore, useUserData } from '../../store';
import { useProgression } from '../../hooks/useProgression';
import { nextUp, provenChords, byModule, type SkillStanding } from '../../lib/progression';
import { CURRICULUM, getLessonByCode, lessonUrl, trackModules, trackOfLesson } from '../../data/curriculum';
import { useSongs } from '../../hooks/useSongs';
import './journey.css';

/**
 * Where you are, rather than what your numbers are.
 *
 * Progress already answers "how fast am I changing A to D". This answers the
 * question underneath it: which of the things this course teaches are actually
 * under my hands, what is next, and what does the app honestly not know.
 */
export function JourneyPanel() {
  const standings = useProgression();
  const currentLesson = useUserData().currentLesson;
  const setSkillClaimed = useStore((s) => s.setSkillClaimed);
  const [openModule, setOpenModule] = useState<number | null>(null);

  // Ask the lesson which course it belongs to. Splitting the code on its first
  // dash worked only for Grade 1: Grade 2 and 3 lessons are coded BG-1501, so
  // the split returned 'bg' and the Journey fell back to showing Grade 1.
  const track = (currentLesson && trackOfLesson(currentLesson)) ?? 'bg1';
  const modules = useMemo(() => trackModules(track), [track]);
  const lessonCodes = useMemo(
    () => modules.flatMap((m) => m.lessons.map((l) => l.code)),
    [modules],
  );
  const grouped = useMemo(() => byModule(standings, lessonCodes), [standings, lessonCodes]);
  // "Closest to done" has to actually be that. Mixing skills already under way
  // with ones never attempted put "0 / 20" under a heading promising the
  // opposite, so the two cases are separated and the heading follows the list.
  const next = useMemo(() => {
    const all = nextUp(standings, 12);
    const working = all.filter((s) => s.state === 'working');
    return working.length
      ? { title: 'Closest to done', items: working.slice(0, 3) }
      : { title: 'Where to start', items: all.slice(0, 3) };
  }, [standings]);
  const proven = useMemo(() => provenChords(standings), [standings]);

  const songs = useSongs();
  const playable = useMemo(
    () => songs.filter((song) => song.chords?.length && song.chords.every((c) => proven.includes(c))),
    [songs, proven],
  );

  const trackTitle = CURRICULUM.tracks.find((t) => t.code === track)?.title ?? 'Your course';
  const here = currentLesson ? getLessonByCode(currentLesson) : null;

  return (
    <div className="journey">
      <header className="journey-head">
        <span className="journey-eyebrow">{trackTitle}</span>
        {here && (
          <p className="journey-here">
            You said you are on <strong>{here.title}</strong>, module {here.module}.
          </p>
        )}
        {/* Until now the Journey could name the lesson and not much else. The
            video sitemap has always carried the id of the video that teaches
            each one; the first build of this dataset simply dropped it.

            The link goes to the lesson on Justin's own site rather than
            straight to YouTube: that is where the lesson actually lives, with
            its prose and its tab, and this app is a practice layer on top of
            that course, not a replacement for it. */}
        {here && (
          <a
            className="journey-lesson-link"
            href={lessonUrl(here)}
            target="_blank"
            rel="noreferrer noopener"
          >
            <PlayIcon size={15} />
            {here.videoId ? 'Watch this lesson' : 'Open this lesson'}
            <span className="journey-lesson-host">justinguitar.com</span>
          </a>
        )}
      </header>

      {next.items.length > 0 && (
        <section className="journey-section">
          <h3 className="journey-title">
            <TargetIcon size={16} /> {next.title}
          </h3>
          <ul className="journey-next">
            {next.items.map((standing) => (
              <li key={standing.skill.id} className="journey-next-item">
                <div className="journey-next-body">
                  <span className="journey-next-name">{standing.skill.title}</span>
                  <span className="journey-next-evidence">{standing.evidence}</span>
                </div>
                {standing.bar !== null && (
                  <span className="journey-next-bar" aria-hidden="true">
                    <span
                      className="journey-next-fill"
                      style={{ width: `${Math.round(standing.progress * 100)}%` }}
                    />
                  </span>
                )}
                <span className="journey-next-figure">
                  {standing.best ?? 0}
                  <span className="journey-next-of">/{standing.bar}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {playable.length > 0 && (
        <section className="journey-section">
          <h3 className="journey-title">
            <CheckIcon size={16} /> Songs you can play right now
          </h3>
          {/* Gated on chords the learner has actually proven, not on chords a
              routine happens to mention. Getting this wrong in the encouraging
              direction is the version that hurts: being handed a song you cannot
              play is worse than not being offered one. */}
          <ul className="journey-songs">
            {playable.map((song) => (
              <li key={song.id} className="journey-song">
                <span className="journey-song-name">{song.title}</span>
                <span className="journey-song-chords">{song.chords?.join(' · ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="journey-section">
        <h3 className="journey-title">The course, and where you are in it</h3>
        <ul className="journey-modules">
          {grouped.map(({ module, skills, solid, total }) => {
            const open = openModule === module;
            const source = modules.find((m) => m.number === module);
            const moduleLessons = source?.lessons ?? [];
            return (
              <li key={module} className={clsx('journey-module', open && 'is-open')}>
                <button
                  type="button"
                  className="journey-module-head"
                  onClick={() => setOpenModule(open ? null : module)}
                  aria-expanded={open}
                >
                  <span className="journey-module-number">{module}</span>
                  <span className="journey-module-name">
                    {source?.title ?? `Module ${module}`}
                    <span className="journey-module-count">
                      {solid} of {total} solid
                    </span>
                  </span>
                  <span className="journey-module-bar" aria-hidden="true">
                    <span
                      className="journey-module-fill"
                      style={{ width: `${total ? Math.round((solid / total) * 100) : 0}%` }}
                    />
                  </span>
                  <CaretDownIcon size={16} className={clsx('journey-caret', open && 'is-open')} />
                </button>

                {open && (
                  <ul className="journey-skills">
                    {skills.map((standing) => (
                      <SkillRow
                        key={standing.skill.id}
                        standing={standing}
                        onClaim={(claimed) => setSkillClaimed(standing.skill.id, claimed)}
                      />
                    ))}
                    {moduleLessons.length > 0 && (
                      <li className="journey-lessons">
                        <span className="journey-lessons-label">Lessons in this module</span>
                        <span className="journey-lessons-list">
                          {moduleLessons.map((lesson) => (
                            <a
                              key={lesson.code}
                              href={lessonUrl(lesson)}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="journey-lesson"
                            >
                              {lesson.title}
                            </a>
                          ))}
                        </span>
                      </li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

const STATE_LABEL: Record<SkillStanding['state'], string> = {
  solid: 'Solid',
  working: 'Under way',
  ready: 'Ready',
  locked: 'Later',
};

function SkillRow({
  standing,
  onClaim,
}: {
  standing: SkillStanding;
  onClaim: (claimed: boolean) => void;
}) {
  const { skill, state, source, evidence, blockedBy } = standing;
  // Only skills the app will never be able to hear offer a self-report. A
  // measured skill has a drill; asking someone to tick it off would be inviting
  // them to skip the practice and mark it done.
  const selfReportable = skill.measure.kind === 'known' || skill.measure.kind === 'timed';

  return (
    <li className={clsx('journey-skill', `is-${state}`)}>
      <span className="journey-skill-mark" aria-hidden="true">
        {state === 'solid' ? (
          <CheckIcon size={13} />
        ) : skill.measure.kind === 'timed' ? (
          <HourglassIcon size={13} />
        ) : skill.measure.kind === 'measurable' ? (
          <MicIcon size={13} />
        ) : null}
      </span>

      <span className="journey-skill-body">
        <span className="journey-skill-name">
          {skill.title}
          <span className="journey-skill-state">{STATE_LABEL[state]}</span>
          {source === 'claimed' && <span className="journey-skill-state is-claimed">your word</span>}
        </span>
        <span className="journey-skill-evidence">
          {state === 'locked' && blockedBy.length
            ? `After ${blockedBy.map((s) => s.title).join(' and ')}.`
            : evidence}
        </span>
      </span>

      {selfReportable && (
        <button
          type="button"
          className={clsx('journey-skill-claim', source === 'claimed' && 'is-on')}
          aria-pressed={source === 'claimed'}
          onClick={() => onClaim(source !== 'claimed')}
        >
          {source === 'claimed' ? 'Got it' : 'Mark done'}
        </button>
      )}
    </li>
  );
}
