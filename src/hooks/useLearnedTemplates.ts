import { useMemo } from 'react';
import { useUserData } from '../store';
import { templatesFor } from '../audio/calibration';
import type { LearnedTemplates } from '../audio/chords';

// The current account's fitted chord templates, or undefined when uncalibrated.
// Pass straight into a drill's start() options so the detector matches against
// this guitar's learned fingerprints. Memoised on the stored calibration, which
// only changes reference when the user recalibrates.
export function useLearnedTemplates(): LearnedTemplates | undefined {
  const calibration = useUserData().chordCalibration;
  return useMemo(() => templatesFor(calibration), [calibration]);
}
