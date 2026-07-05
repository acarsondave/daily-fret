import { useRef } from 'react';
import { useStore } from '../store';
import { diag } from '../audio/diagnostics';
import { CalibrationCollector, mergeCalibration } from '../audio/calibration';
import type { LevelEvent } from '../audio/detector';

// Only reinforce frames the detector already got right, at high confidence. This
// keeps passive learning from ever teaching the model a wrong shape: it sharpens
// correct detections, it does not rescue stuck ones (guided calibration does).
const PASSIVE_MARGIN_MIN = 0.25;
const STRUM_RMS_RATIO = 3;
const MIN_STRUM_RMS = 0.02;

// Guarded passive calibration. During a drill where the expected chord is known,
// feed each level event with the expected chord; frames the detector matched to
// that same chord with a clear margin and a real strum are collected. Call
// commit() at the end of the drill to sample-weighted-merge them into the stored
// calibration. observe/commit are stable (ref-backed) so they are safe to call
// from a frozen audio-thread handler.
export function usePassiveRefine() {
  const collectorRef = useRef(new CalibrationCollector());
  const ingestedRef = useRef(0);

  const observe = (expected: string, ev: LevelEvent): void => {
    if (!ev.chroma || ev.chord !== expected) return;
    if (ev.margin < PASSIVE_MARGIN_MIN) return;
    const armed = ev.rms > Math.max(ev.noiseFloor * STRUM_RMS_RATIO, MIN_STRUM_RMS);
    if (!armed) return;
    collectorRef.current.add(expected, ev.chroma);
    ingestedRef.current += 1;
  };

  const commit = (): void => {
    const collected = collectorRef.current.toData();
    collectorRef.current.reset();
    const ingested = ingestedRef.current;
    ingestedRef.current = 0;

    const state = useStore.getState();
    const base = state.accounts[state.currentAccountId]?.chordCalibration?.chords;
    // Passive refinement only SHARPENS chords the guided flow already established.
    // It never introduces a new chord on its own: a discriminative template is only
    // safe when its confusable partners were learned alongside it (so their shared
    // notes cancel in the fit). A partial passive-built set could otherwise sharpen
    // one side of a confusable pair and make the lock worse. No baseline => no-op.
    if (!base) return;
    const extra = Object.fromEntries(
      Object.entries(collected).filter(([chord]) => base[chord]),
    );
    if (!Object.keys(extra).length) return;

    const merged = mergeCalibration(base, extra);
    state.setChordCalibration(merged);
    diag.mark(`passive refine: +${ingested} frames across ${Object.keys(extra).length} chords`);
  };

  return { observe, commit };
}
