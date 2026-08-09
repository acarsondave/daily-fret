import { useMemo } from 'react';
import { useUserData } from '../store';
import { templatesFor } from '../audio/calibration';
import { activeProfileOf } from '../lib/chordProfiles';
import type { LearnedTemplates } from '../audio/chords';

// Fitted chord templates for the guitar currently selected, or undefined when
// that guitar is uncalibrated. Pass straight into a drill's start() options so
// the detector matches against this instrument's learned fingerprints.
// Memoised on the stored profile, which only changes reference when the user
// recalibrates or picks up a different guitar.
export function useLearnedTemplates(): LearnedTemplates | undefined {
  const account = useUserData();
  const profile = useMemo(() => activeProfileOf(account), [account]);
  return useMemo(() => templatesFor(profile), [profile]);
}
