import { useMemo, useState, type CSSProperties } from 'react';
import clsx from 'clsx';
import { CaretDownIcon, CheckIcon, HourglassIcon, MicIcon, PlayIcon, TargetIcon } from '../icons';
import { useStore, useUserData } from '../../store';
import { useProgression } from '../../hooks/useProgression';
import { nextUp, provenChords, type SkillStanding } from '../../lib/progression';
import { getLessonByCode, getTrack, lessonUrl } from '../../data/curriculum';
import { useSongs } from '../../hooks/useSongs';
import {
  BEGINNER_PATH,
  BEGINNER_TOTALS,
  gradeOf,
  moduleContent,
  moduleOfLesson,
  positionOf,
  type JourneyGrade,
  type JourneyModule,
  type ModuleContent,
} from './journeyCourse';
import {
  countLine,
  evidenceLine,
  kindNote,
  outsideNote,
  paidGap,
  plural,
  shapeOf,
  stateLabel,
} from './journeyCopy';
import './journey.css';

/**
 * Where you are in a course that takes years, and what the part you are standing
 * in actually asks of you.
 *
 * Numbers live in Progress. This answers the question underneath them, and it
 * has one job the flat list it replaced could not do: a module is a mix of
 * things you drill for weeks and things you watch once, and the two are not the
 * same commitment. Showing "Holding The Guitar" in the same row shape as a chord
 * change turned a course map into a to-do list nobody would work through. See
 * journeyCourse.ts for where that split is decided.
 */
export function JourneyPanel() {
  const standings = useProgression();
  const currentLesson = useUserData().currentLesson;
  const setCurrentLesson = useStore((s) => s.setCurrentLesson);

  // Ask the lesson which course it belongs to. Splitting the code on its first
  // dash worked only for Grade 1: Grade 2 and 3 lessons are coded BG-1501, so
  // the split returned 'bg' and the Journey fell back to showing Grade 1.
  const here = currentLesson ? getLessonByCode(currentLesson) : null;
  const hereModule = here ? moduleOfLesson(here.code) : null;
  const hereGrade = hereModule ? gradeOf(hereModule) : null;

  const [openGrade, setOpenGrade] = useState<string | null>(
    hereGrade?.track ?? BEGINNER_PATH[0]?.track ?? null,
  );
  const [openModule, setOpenModule] = useState<number | null>(hereModule?.number ?? null);

  // Left to the compiler rather than hand-memoised: the fold is a scan of 38
  // skills against one module's lesson codes, and a manual useMemo here is the
  // one thing that made React Compiler give up on the whole component.
  const hereContent = hereModule ? moduleContent(hereModule, standings) : null;

  // "Closest to done" has to actually be that. Mixing skills already under way
  // with ones never attempted put "0 / 20" under a heading promising the
  // opposite, so the two cases are separated and the heading follows the list.
  const next = useMemo(() => {
    const all = nextUp(standings, 12);
    // Lapsed counts as under way: one run brings it back, so it is the closest
    // thing on the list to done, not a fresh start.
    const working = all.filter((s) => s.state === 'working' || s.state === 'lapsed');
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

  const standHere = (module: JourneyModule) => {
    const first = module.lessons[0];
    // Every beginner module names at least one lesson, so this cannot silently
    // do nothing in practice; it refuses rather than guessing a code if it ever can.
    if (!first) return;
    setCurrentLesson(first.code);
    setOpenGrade(module.track);
    setOpenModule(module.number);
  };

  return (
    <div className="journey">
      <header className="journey-head">
        <h3 className="journey-heading">
          {hereModule ? `Module ${hereModule.number}: ${hereModule.title}` : headingWithout(here)}
        </h3>

        <p className="journey-standing">
          {here ? (
            <>
              You said you are on <strong>{here.title}</strong>.
              {!hereModule && ` ${outsideNote(
                BEGINNER_PATH.some((g) => g.track === here.track) ? 'companion' : 'other-course',
              )}`}
            </>
          ) : currentLesson ? (
            <>
              You said you are on <strong>{currentLesson}</strong>. {outsideNote('unknown')}
            </>
          ) : (
            'You have not said where you are, so nothing below is marked as behind you. Open a module and say you are on it.'
          )}
        </p>

        {/* The link goes to the lesson on Justin's own site rather than straight
            to YouTube: that is where the lesson actually lives, with its prose
            and its tab, and this app is a practice layer on top of that course,
            not a replacement for it. */}
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

        <Spine hereModule={hereModule} />

        {hereModule && hereContent && (
          <p className="journey-now">{shapeOf(hereModule, hereContent)}</p>
        )}
      </header>

      {next.items.length > 0 && (
        <section className="journey-section">
          <h4 className="journey-title">
            <TargetIcon size={16} /> {next.title}
          </h4>
          {/* This list is the whole taxonomy, closest first, and it always was.
              Standing in a module the app has mapped, that reads as "next for
              you" and is near enough true. Standing in module 22 it read as the
              app telling someone on the last beginner module to start with the D
              chord, without saying that it had nothing from where they actually
              are. The list is unchanged; what it is drawn from is now stated. */}
          {hereModule && hereContent && !hereContent.mapped && (
            <p className="journey-note">
              Nothing in module {hereModule.number} is mapped to a drill yet, so this is everything
              Daily Fret can measure anywhere in the course, closest first.
            </p>
          )}
          <ul className="journey-next">
            {next.items.map((standing) => (
              <li key={standing.skill.id} className="journey-next-item">
                <div className="journey-next-body">
                  <span className="journey-next-name">{standing.skill.title}</span>
                  <span className="journey-next-evidence">{standing.evidence}</span>
                </div>
                {standing.bar !== null && (
                  <>
                    {/* Same rule the module rows follow: a track drawn at zero
                        reads as no progress, and nothing measured is not no
                        progress. The figure carries the target instead. */}
                    {standing.best !== null && (
                      <span className="journey-next-bar" aria-hidden="true">
                        <span className="journey-next-fill" style={fillStyle(standing.progress)} />
                      </span>
                    )}
                    <span className="journey-next-figure">
                      <Figure best={standing.best} bar={standing.bar} />
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {playable.length > 0 && (
        <section className="journey-section">
          <h4 className="journey-title">
            <CheckIcon size={16} /> Songs you can play right now
          </h4>
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
        <h4 className="journey-title">The whole course</h4>
        <p className="journey-note">
          {BEGINNER_TOTALS.modules} modules, {BEGINNER_TOTALS.lessons} lessons.
          {BEGINNER_TOTALS.paidNotListed > 0 &&
            ` ${BEGINNER_TOTALS.paidNotListed} of them are paid lessons the course counts but does not name, so they are in the totals and not in the lists.`}
        </p>

        {BEGINNER_PATH.map((grade) => (
          <GradeBlock
            key={grade.track}
            grade={grade}
            standings={standings}
            hereModule={hereModule}
            open={openGrade === grade.track}
            onToggle={() => setOpenGrade(openGrade === grade.track ? null : grade.track)}
            openModule={openModule}
            onToggleModule={(number) => setOpenModule(openModule === number ? null : number)}
            onStandHere={standHere}
          />
        ))}
      </section>
    </div>
  );
}

/** What to call the course when the learner's lesson is not in the taught path. */
function headingWithout(here: { track: string } | null): string {
  if (!here) return 'The Beginner Guitar Course';
  return getTrack(here.track)?.title ?? 'The Beginner Guitar Course';
}

/**
 * The course as a profile rather than a bar.
 *
 * Twenty-three modules, each drawn at its own size, so the shape of what is
 * ahead is visible at a glance and the marker has somewhere to sit. Height is
 * the module's true lesson count, which is a fact the data holds for every
 * module including the ones no skill maps to.
 */
function Spine({ hereModule }: { hereModule: JourneyModule | null }) {
  const position = hereModule ? positionOf(hereModule) : null;

  return (
    <figure className="journey-spine">
      <div className="journey-spine-track" aria-hidden="true">
        {BEGINNER_PATH.map((grade) => (
          <div
            className="journey-spine-grade"
            key={grade.track}
            style={{ flexGrow: grade.modules.length }}
          >
            <div className="journey-spine-ticks">
              {grade.modules.map((module) => (
                <span
                  key={module.number}
                  className={clsx('journey-spine-tick', hereModule && tickState(module, hereModule))}
                  style={{
                    height: `${Math.round((module.lessonCount / BEGINNER_TOTALS.largestModule) * 100)}%`,
                  }}
                />
              ))}
            </div>
            <span className="journey-spine-grade-name">{grade.title}</span>
          </div>
        ))}
      </div>
      <figcaption className="journey-spine-caption">
        {position
          ? `Each bar is a module, drawn at its lesson count. ${position.behind} behind you, ${position.ahead} ahead.`
          : `Each bar is a module, drawn at its lesson count, across ${BEGINNER_PATH.length} grades.`}
      </figcaption>
    </figure>
  );
}

// Module numbers run continuously across the three beginner grades, 0 to 22, so
// they compare directly and no grade lookup is needed to say what is behind.
const tickState = (module: JourneyModule, here: JourneyModule): string =>
  module.number < here.number ? 'is-behind' : module.number === here.number ? 'is-here' : 'is-ahead';

interface GradeProps {
  grade: JourneyGrade;
  standings: readonly SkillStanding[];
  hereModule: JourneyModule | null;
  open: boolean;
  onToggle: () => void;
  openModule: number | null;
  onToggleModule: (number: number) => void;
  onStandHere: (module: JourneyModule) => void;
}

function GradeBlock({
  grade,
  standings,
  hereModule,
  open,
  onToggle,
  openModule,
  onToggleModule,
  onStandHere,
}: GradeProps) {
  const first = grade.modules[0].number;
  const last = grade.modules[grade.modules.length - 1].number;
  const isHere = hereModule !== null && grade.modules.includes(hereModule);

  return (
    <div className={clsx('journey-grade', open && 'is-open')}>
      <h5 className="journey-grade-heading">
        <button type="button" className="journey-grade-head" aria-expanded={open} onClick={onToggle}>
          <span className="journey-grade-name">
            {grade.title}
            {isHere && <span className="journey-grade-mark">you are here</span>}
          </span>
          <span className="journey-grade-meta">
            Modules {first} to {last} · {plural(grade.lessonCount, 'lesson')}
          </span>
          <CaretDownIcon size={16} className={clsx('journey-caret', open && 'is-open')} />
        </button>
      </h5>

      {open && (
        <ul className="journey-modules">
          {grade.modules.map((module) => (
            <ModuleRow
              key={module.number}
              module={module}
              content={moduleContent(module, standings)}
              isHere={module === hereModule}
              open={openModule === module.number}
              onToggle={() => onToggleModule(module.number)}
              onStandHere={() => onStandHere(module)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface ModuleProps {
  module: JourneyModule;
  content: ModuleContent;
  isHere: boolean;
  open: boolean;
  onToggle: () => void;
  onStandHere: () => void;
}

function ModuleRow({ module, content, isHere, open, onToggle, onStandHere }: ModuleProps) {
  return (
    <li className={clsx('journey-module', open && 'is-open', isHere && 'is-here')}>
      <h6 className="journey-module-heading">
        <button
          type="button"
          className="journey-module-head"
          onClick={onToggle}
          aria-expanded={open}
        >
          <span className="journey-module-number">{module.number}</span>
          <span className="journey-module-name">
            {module.title}
            <span className="journey-module-count">{countLine(module, content)}</span>
          </span>
          {/* Only a module the app can actually score gets a bar. An empty track
              under a module it has never mapped would read as no progress rather
              than as no measurement. */}
          {content.measured > 0 && (
            <span className="journey-module-bar" aria-hidden="true">
              <span
                className="journey-module-fill"
                style={fillStyle(content.atBar / content.measured)}
              />
            </span>
          )}
          <CaretDownIcon size={16} className={clsx('journey-caret', open && 'is-open')} />
        </button>
      </h6>

      {open && (
        <div className="journey-module-body">
          {content.practice.length > 0 && (
            <>
              <p className="journey-kind">To practise</p>
              <ul className="journey-practice">
                {content.practice.map((standing) => (
                  <PracticeRow key={standing.skill.id} standing={standing} />
                ))}
              </ul>
              {kindNote(content) && <p className="journey-note">{kindNote(content)}</p>}
            </>
          )}

          {/* The reason this panel was rebuilt. A grip, a posture and a way of
              reading a chord box are real parts of the course and they are not
              practice, so they are named once, quietly, and never given a row
              that looks like something you owe the app. The label states the
              app's own limit rather than a claim about the course: some of these
              are motor skills, and none of them is anything this app can drill. */}
          {content.taughtOnce.length > 0 && (
            <>
              <p className="journey-kind">Taught here, not drilled</p>
              <ul className="journey-once">
                {content.taughtOnce.map((standing) => (
                  <li key={standing.skill.id} className="journey-once-item">
                    {standing.skill.title}
                  </li>
                ))}
              </ul>
            </>
          )}

          {!content.mapped && (
            <p className="journey-note">
              Daily Fret has no drills mapped to this module yet. The lessons are below.
            </p>
          )}

          <p className="journey-kind">{plural(module.lessons.length, 'lesson')} in this module</p>
          <div className="journey-lessons-list">
            {module.lessons.map((lesson) => (
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
          </div>
          {/* A gap that is stated is data. A gap quietly closed up is a lie about
              the course, so the count says the module is bigger than the list. */}
          {paidGap(module) && <p className="journey-note">{paidGap(module)}</p>}

          {!isHere && module.lessons.length > 0 && (
            <button type="button" className="journey-stand" onClick={onStandHere}>
              Say you are on module {module.number}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function PracticeRow({ standing }: { standing: SkillStanding }) {
  const { skill, state, source, bar, best, progress } = standing;
  const line = evidenceLine(standing);

  return (
    <li className={clsx('journey-skill', `is-${state}`)}>
      <span className="journey-skill-mark" aria-hidden="true">
        {/* Lapsed keeps the tick, drawn hollow by the stylesheet. It was earned
            and the app is not pretending otherwise; what it has lost is being
            current, and that is what the hollow says. */}
        {state === 'solid' || state === 'lapsed' ? (
          <CheckIcon size={13} />
        ) : skill.measure.kind === 'timed' ? (
          <HourglassIcon size={13} />
        ) : skill.measure.kind === 'measured' ? (
          <MicIcon size={13} />
        ) : null}
      </span>

      <span className="journey-skill-body">
        <span className="journey-skill-name">
          {skill.title}
          <span className="journey-skill-state">{stateLabel(standing)}</span>
          {source === 'claimed' && <span className="journey-skill-state is-claimed">your word</span>}
        </span>
        {line && <span className="journey-skill-evidence">{line}</span>}
        {bar !== null && best !== null && (
          <span className="journey-skill-bar" aria-hidden="true">
            <span className="journey-skill-fill" style={fillStyle(progress)} />
          </span>
        )}
      </span>

      {bar !== null && (
        <span className="journey-skill-figure">
          <Figure best={best} bar={bar} />
        </span>
      )}
    </li>
  );
}

/**
 * A result against its bar, or the bar on its own.
 *
 * `best ?? 0` used to print a confident zero beside a sentence saying no drill
 * had ever used this chord, which is the app scoring practice that never
 * happened. Nothing measured is not a score of nothing, so the row states what
 * it would take to clear and leaves the number to the first real run.
 */
function Figure({ best, bar }: { best: number | null; bar: number }) {
  if (best === null) return <span className="journey-figure-target">{bar} to clear</span>;
  return (
    <>
      {best}
      <span className="journey-figure-of">/{bar}</span>
    </>
  );
}

/** The bar's fill, as a scale factor the stylesheet reads. */
const fillStyle = (ratio: number): CSSProperties =>
  ({ '--fill': Math.max(0, Math.min(1, ratio)) }) as CSSProperties;

