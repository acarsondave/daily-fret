import { motion } from 'framer-motion';
import clsx from 'clsx';
import { ArrowRightIcon, HourglassIcon, PlectrumIcon, TallyIcon } from '../icons';
import { ChordDiagram } from '../practice/ChordDiagram';
import type { FirstRunPlan, PlanSong, PlanTask } from './plan';
import './ready.css';

/**
 * Three. The session.
 *
 * This screen used to describe the session instead of being it: a sentence about
 * minutes, a sentence about what the routine was built from, then a list of rows
 * each carrying a title, a pill reading "counted", and a sentence of
 * instructions. It was the most text-dense screen in a flow whose first two
 * screens are the app doing the thing rather than saying it, and it arrived at
 * the exact moment the whole flow was supposed to land.
 *
 * So the minutes are drawn. One stroke per minute, in the same pen the first
 * screen leaves its tally marks with, grouped by block: the shape of the strip
 * is the shape of the session, and the number beside it is the number of
 * strokes, which is why lib/routineBuilder.ts rounds per task rather than at the
 * end. Accent strokes are minutes the microphone counts and grey ones are
 * minutes a clock runs, so the product's central distinction is in the drawing
 * rather than in a pill repeating the word.
 *
 * And the session ends with a chart, named, with its shapes drawn at a size you
 * can read them at. Underneath, when there is one, the shape standing between
 * the player and the next chart. Neither of those is copy. They are the two
 * facts the app has been holding since the chord grid and never once shown.
 */

interface Props {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  plan: FirstRunPlan;
  micLive: boolean;
  onStart: () => void;
}

/** Diagrams shrink on a phone through CSS; this is the laptop size. */
const SHAPE_SIZE = 52;

export function ReadyScreen({ headingRef, plan, micLive, onStart }: Props) {
  const { routine, minutes, measured, tasks, horizon } = plan;
  const song = tasks.find((t) => t.song !== null)?.song ?? null;
  // Strokes carry the two states the old lead sentence carried in words: filled
  // where the microphone is listening, hollow where it is not and the counting
  // is waiting on it. Hollow rather than faded, because nothing is in them yet.
  const countedState = micLive ? 'is-counted' : 'is-waiting';

  return (
    <>
      <h1 className="onboarding-title" ref={headingRef} tabIndex={-1}>
        Your first session.
      </h1>

      <div className="onboarding-shape">
        {/* Every stroke the same width, which is what makes the strip readable
            as a quantity. Blocks are separated by a wider gap rather than by
            being their own boxes: boxes sized to their minutes left ragged
            space inside each one and the proportions stopped reading. */}
        <div className="onboarding-comb" aria-hidden="true">
          {strokes(tasks).map((stroke, i) => (
            <span
              key={stroke.key}
              className={clsx(
                'onboarding-comb-stroke',
                stroke.open ? 'is-open' : stroke.counted ? countedState : 'is-timed',
                stroke.opensBlock && 'is-block',
              )}
              style={{
                animationDelay: `${i * 22}ms`,
                ...(stroke.open ? { height: `${58 - stroke.index * 24}%` } : null),
              }}
            />
          ))}
        </div>
        <p className="onboarding-total" aria-hidden="true">
          {minutes}
          <span>min</span>
        </p>
        {/* Everything the strip draws, in words, and the same scruple: what is
            counted and what is only waiting to be are different claims. */}
        <p className="sr-only">
          About {minutes} minutes{song ? ', and a song for as long as it runs' : ''}.{' '}
          {measured > 0
            ? micLive
              ? `${measured} of these ${tasks.length} blocks are counted through the microphone.`
              : `${measured} of these ${tasks.length} blocks would be counted, once the microphone is on.`
            : 'Nothing here is counted yet.'}
        </p>
      </div>

      {/* The routine says what it was built from, in its own words. For most of
          Grade 2 and all of Grade 3 the app has no drills mapped to the module,
          and pretending otherwise is the discrepancy this whole flow exists to
          stop repeating. */}
      <p className="onboarding-basis">{routine.description}</p>

      <ol className="onboarding-preview">
        {tasks.map((task, i) => (
          <motion.li
            key={task.id}
            className={clsx('onboarding-preview-item', task.song && 'is-song')}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.04, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <span
              className={clsx('onboarding-preview-mark', task.counted && countedState)}
              aria-hidden="true"
            >
              {task.song ? (
                <PlectrumIcon size={18} />
              ) : task.counted ? (
                <TallyIcon size={18} />
              ) : (
                <HourglassIcon size={18} />
              )}
            </span>
            <span className="onboarding-preview-text">
              <span className="onboarding-preview-name">{task.title}</span>
              {task.song ? (
                <span className="onboarding-preview-by">{task.song.artist}</span>
              ) : (
                task.chords.length > 0 && (
                  <span className="onboarding-preview-chords">
                    {task.chords.map((chord) => (
                      <span key={chord}>{chord}</span>
                    ))}
                  </span>
                )
              )}
            </span>
            <span className="sr-only">{spoken(task, micLive)}</span>
            {task.song && <Shapes chords={task.song.chords} />}
          </motion.li>
        ))}
      </ol>

      {/* One shape short. Drawn in the state it is in: nothing filled, because
          nothing has been played. It is not part of today and does not pretend
          to be, which is why it sits below the session rather than in it. */}
      {horizon && (
        <motion.p
          className="onboarding-horizon"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 + tasks.length * 0.04, duration: 0.4 }}
        >
          <Shapes chords={[horizon.missing]} muted />
          <span className="onboarding-horizon-text">opens {horizon.song.title}</span>
        </motion.p>
      )}

      <div className="onboarding-actions is-end">
        <button type="button" className="onboarding-next is-primary" onClick={onStart} autoFocus>
          Start the session <ArrowRightIcon size={16} />
        </button>
      </div>
    </>
  );
}

/** Shapes at a size they can be read at, named, as the chord grid drew them. */
function Shapes({ chords, muted }: { chords: readonly string[]; muted?: boolean }) {
  return (
    <span className={clsx('onboarding-shapes', muted && 'is-muted')}>
      {chords.map((chord) => (
        <span key={chord} className="onboarding-shape-card">
          <ChordDiagram chord={chord} size={SHAPE_SIZE} showFingers={false} />
          <span className="onboarding-shape-name">{chord}</span>
        </span>
      ))}
    </span>
  );
}

interface Stroke {
  key: string;
  /** Position inside its own block, so the open tail can fall away. */
  index: number;
  counted: boolean;
  /** A block with no length: the play-along. */
  open: boolean;
  /** First stroke of a block, and not the first of the strip. */
  opensBlock: boolean;
}

/** One stroke per minute, and a short tail for the block that has no length. */
function strokes(tasks: readonly PlanTask[]): Stroke[] {
  const out: Stroke[] = [];
  for (const task of tasks) {
    const count = task.minutes === 0 ? 2 : task.minutes;
    for (let index = 0; index < count; index++) {
      out.push({
        key: `${task.id}-${index}`,
        index,
        counted: task.counted,
        open: task.minutes === 0,
        opensBlock: index === 0 && out.length > 0,
      });
    }
  }
  return out;
}

/**
 * A row's own facts for anything that cannot see it.
 *
 * The mark, the chips and the strip are all drawn, so this is the only place the
 * distinction between a counted block and a timed one exists in words, and it
 * has to keep the same care the visible screen does: a microphone that is off
 * counts nothing, however the row is drawn.
 */
function spoken(task: PlanTask, micLive: boolean): string {
  if (task.song) return `${songLine(task.song)} Play-along, not counted.`;
  const long = `${task.minutes} minute${task.minutes === 1 ? '' : 's'}`;
  const shapes = task.chords.length ? ` On ${task.chords.join(', ')}.` : '';
  if (!task.counted) return `${long} on a timer.${shapes}`;
  return micLive
    ? `${long}, counted through the microphone.${shapes}`
    : `${long}, counted once the microphone is on.${shapes}`;
}

const songLine = (song: PlanSong): string =>
  `${song.title} by ${song.artist}, on ${song.chords.join(', ')}.`;
