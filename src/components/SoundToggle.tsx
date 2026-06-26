import { useState } from 'react';
import { SpeakerHigh, SpeakerSlash } from '@phosphor-icons/react';
import { isSoundEnabled, setSoundEnabled, sfx } from '../audio/sfx';
import './SoundToggle.css';

export function SoundToggle() {
  const [on, setOn] = useState(isSoundEnabled());

  const toggle = () => {
    const next = !on;
    setSoundEnabled(next);
    setOn(next);
    if (next) sfx.go(); // a tiny confirmation chirp when turning sound on
  };

  return (
    <button
      className="sound-toggle"
      onClick={toggle}
      title={on ? 'Sound on' : 'Sound off'}
      aria-label={on ? 'Mute sound effects' : 'Unmute sound effects'}
      aria-pressed={on}
    >
      {on ? <SpeakerHigh size={18} weight="duotone" /> : <SpeakerSlash size={18} weight="duotone" />}
    </button>
  );
}
