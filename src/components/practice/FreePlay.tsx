import { useEffect, useRef, useState } from 'react';
import { Microphone, ArrowClockwise } from '@phosphor-icons/react';
import { useChordDetector } from '../../hooks/useChordDetector';
import { NO_CHORD } from '../../audio/detector';
import { SignalMeter } from './SignalMeter';
import { classifyLevel, type SignalQuality } from './signalQuality';

const NOTE_LABELS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function FreePlay() {
  const { status, error, start, stop } = useChordDetector();
  const [chord, setChord] = useState('--');
  const [signal, setSignal] = useState<SignalQuality>('silent');

  const heroRef = useRef<HTMLDivElement>(null);
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);
  const popTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lowLevelFrames = useRef(0);
  const signalRef = useRef<SignalQuality>('silent');

  const pop = () => {
    const hero = heroRef.current;
    if (!hero) return;
    hero.classList.remove('is-idle');
    hero.classList.add('is-active');
    if (popTimer.current) clearTimeout(popTimer.current);
    popTimer.current = setTimeout(() => hero.classList.remove('is-active'), 280);
  };

  const resetIdle = () => {
    setChord('--');
    heroRef.current?.classList.add('is-idle');
    heroRef.current?.classList.remove('is-active');
  };

  const setBars = (chroma: Float32Array | null) => {
    const bars = barRefs.current;
    for (let i = 0; i < bars.length; i++) {
      const el = bars[i];
      if (!el) continue;
      const h = chroma ? Math.min(100, chroma[i] * 100) : 0;
      el.style.height = `${h}%`;
    }
  };

  const launch = () => {
    void start({
      onChord: (ev) => {
        lowLevelFrames.current = 0;
        if (ev.chord === NO_CHORD) {
          resetIdle();
          return;
        }
        setChord(ev.chord);
        pop();
      },
      onLevel: (ev) => {
        const quality = classifyLevel(ev);
        if (quality !== signalRef.current) {
          signalRef.current = quality;
          setSignal(quality);
        }
        if (ev.chroma === null) {
          lowLevelFrames.current += 1;
          if (lowLevelFrames.current > 12) resetIdle();
          setBars(null);
          return;
        }
        lowLevelFrames.current = 0;
        setBars(ev.chroma);
      },
    });
  };

  useEffect(() => {
    launch();
    return () => {
      if (popTimer.current) clearTimeout(popTimer.current);
      void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === 'error') {
    return (
      <div className="mic-gate">
        <Microphone size={40} weight="duotone" color="var(--text-secondary)" />
        <p>{error ?? 'Microphone unavailable.'}</p>
        <button className="practice-btn primary" onClick={launch}>
          <ArrowClockwise size={18} weight="bold" /> Try again
        </button>
      </div>
    );
  }

  if (status !== 'running') {
    return (
      <div className="mic-gate">
        <Microphone size={40} weight="duotone" color="var(--accent-primary)" />
        <p>Allow microphone access, then strum.</p>
      </div>
    );
  }

  return (
    <>
      <div className="practice-mode is-chord">free play</div>
      <div ref={heroRef} className="practice-hero is-idle">
        {chord}
      </div>
      <div className="chroma-viz">
        {NOTE_LABELS.map((note, i) => (
          <div key={note} className="chroma-bar-wrap">
            <div className="chroma-bar-track">
              <div
                ref={(el) => {
                  barRefs.current[i] = el;
                }}
                className="chroma-bar-fill"
              />
            </div>
            <span className="chroma-bar-label">{note}</span>
          </div>
        ))}
      </div>
      <SignalMeter quality={signal} />
    </>
  );
}
