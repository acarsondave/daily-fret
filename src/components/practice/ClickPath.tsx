import clsx from 'clsx';
import { ICON_STROKE } from '../icons/Icon';
import './clickPath.css';

/**
 * Why this drill needs the click in the room, drawn once instead of said four
 * times.
 *
 * Strum timing reads the beat from the click as the microphone hears it, which
 * makes one arrangement of the room a hard requirement: the speaker has to
 * reach the microphone, and headphones cannot. That was explained in prose on
 * the setup screen, again when the click could not be found, and twice more on
 * a results card that had nothing to show. It is one picture: a speaker, the
 * guitar, a microphone, and the two paths into it.
 *
 * The states are the three things that actually happen. Both paths arriving is
 * the drill working. A dashed path that stops short is the click playing into
 * headphones, or into a room the microphone cannot hear. No path at all is the
 * click not playing, and the speaker carries the app's own muted mark so the
 * two failures cannot be mistaken for each other.
 */

type ClickPathState = 'reaching' | 'broken' | 'silent';

interface Props {
  state: ClickPathState;
  className?: string;
}

/** Everything is drawn with the icon set's pen, so a scaled mark keeps its weight. */
const pen = (scale: number) => ICON_STROKE / scale;

const SPEAKER_SCALE = 1.7;
const GUITAR_SCALE = 2.2;
const MIC_SCALE = 1.7;

/** The click, arriving. */
const CLICK_ARC = 'M64 48 C108 10, 198 10, 240 48';
/** The click, stopping in the air well short of the microphone. */
const CLICK_BROKEN = 'M64 48 C96 18, 138 6, 172 8';
/** The guitar, which the microphone always hears. */
const GUITAR_ARC = 'M166 78 C196 88, 224 82, 241 70';

export function ClickPath({ state, className }: Props) {
  const silent = state === 'silent';
  return (
    <svg
      viewBox="0 0 300 120"
      className={clsx('click-path', `is-${state}`, className)}
      role="img"
      aria-label={
        silent
          ? 'A speaker with no sound leaving it, a guitar, and a microphone.'
          : state === 'broken'
            ? 'A speaker whose sound stops before it reaches the microphone, and a guitar the microphone still hears.'
            : 'A speaker and a guitar, both reaching the microphone.'
      }
    >
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        {/* Speaker */}
        <g
          className="click-path-speaker"
          transform={`translate(38 60) scale(${SPEAKER_SCALE}) translate(-12 -12)`}
          strokeWidth={pen(SPEAKER_SCALE)}
        >
          <path d="M4 10.2v3.6a1.4 1.4 0 0 0 1.4 1.4h2.2l4.8 3.6V5.2L7.6 8.8H5.4A1.4 1.4 0 0 0 4 10.2Z" />
          {silent ? (
            <path d="M16 10 20 14M20 10l-4 4" />
          ) : (
            <>
              <path d="M15.8 9.4a3.8 3.8 0 0 1 0 5.2" />
              <path d="M18.4 7a7.2 7.2 0 0 1 0 10" />
            </>
          )}
        </g>

        {/* The guitar in the room. Waisted body, soundhole, neck: the shape of
            the thing being measured, in the same pen as everything else. */}
        <g
          className="click-path-guitar"
          transform={`translate(150 64) scale(${GUITAR_SCALE}) translate(-12 -12)`}
          strokeWidth={pen(GUITAR_SCALE)}
        >
          <path d="M12 8.4c3.6 0 5.2 2.2 4.4 4.2-.6 1.4-.6 2.2.2 3.4 1.2 1.8-.2 4.4-4.6 4.4s-5.8-2.6-4.6-4.4c.8-1.2.8-2 .2-3.4-.8-2 .8-4.2 4.4-4.2Z" />
          <circle cx="12" cy="15.2" r="1.5" />
          <path d="M12 8.4V3.2" />
          <path d="M10.3 3.2h3.4" />
        </g>

        {/* Microphone */}
        <g
          className="click-path-mic"
          transform={`translate(262 60) scale(${MIC_SCALE}) translate(-12 -12)`}
          strokeWidth={pen(MIC_SCALE)}
        >
          <path d="M12 4.2a2.7 2.7 0 0 1 2.7 2.7v4.6a2.7 2.7 0 0 1-5.4 0V6.9A2.7 2.7 0 0 1 12 4.2Z" />
          <path d="M6.4 11a5.6 5.6 0 0 0 11.2 0" />
          <path d="M12 16.6v3.2M9.2 19.8h5.6" />
        </g>

        {/* The two signals. The guitar always arrives; the click is the one in
            question, so it is the one that changes. */}
        <path className="click-path-line is-guitar" d={GUITAR_ARC} strokeWidth="2" />
        {!silent && (
          <path
            className={clsx('click-path-line is-click', state === 'broken' && 'is-cut')}
            d={state === 'broken' ? CLICK_BROKEN : CLICK_ARC}
            strokeWidth="2"
          />
        )}

        {/* A pulse travelling in, so a working path reads as sound moving rather
            than as two lines that happen to touch. */}
        {state === 'reaching' && (
          <>
            <path className="click-path-pulse" d={CLICK_ARC} strokeWidth="2.4" />
            <path className="click-path-pulse is-late" d={GUITAR_ARC} strokeWidth="2.4" />
          </>
        )}
      </g>
    </svg>
  );
}
