// Strum timing: when a strum landed, and when the click did, read off the same
// microphone so the two are on one clock.
//
// The hard problem this file exists to solve is that the metronome plays out of
// the speakers the microphone is listening to, so an onset detector sees every
// click as a strum. Blanking a window around each click is not available: a
// strum landing exactly on the beat is the thing being measured and it lives
// inside that window.
//
// The way out is that a click and a strum do not occupy the same frequencies. A
// strummed guitar puts nearly all of its energy in fundamentals and low
// harmonics, under about 800 Hz. The app's own click (src/audio/metronome.ts)
// is deliberately centred between 2 and 5 kHz, where the ear is most sensitive
// and the instrument is least dense. That was a choice made for audibility, and
// it turns out to be exactly what makes the two separable. So the signal is split into
// two disjoint bands by steep filters and each band gets its own attack
// detector. Neither can see the other's events. The click still leaks a little
// into the guitar's band, because any fast attack is broadband by definition;
// a one millisecond fade-in on the click (see ATTACK_S in metronome.ts) takes
// that leak down by more than ten times, and the level floors below cover what
// is left. Measured: the loudest click voice puts 0.0066 into the guitar band
// against a detection bar of 0.027, and the quietest 0.0005.
//
// Reading the click out of the microphone rather than off the AudioContext clock
// is not a workaround, it is the correct reference. What a player is trying to
// do is strum with the click they can hear, and the click they can hear has
// already been through the output buffer, the speaker, the air and the input
// buffer. Measuring against the scheduled time would charge the player for every
// millisecond of that path and would need a latency figure from a browser that
// may not have an honest one. Measuring against the click as it arrives charges
// them for nothing but their own hands.
//
// The price is that the click has to reach the microphone, so this drill cannot
// be practised on headphones. The surface says so plainly rather than quietly
// reporting a number it cannot stand behind.
//
// Detection works on the band's amplitude envelope rather than on spectral flux.
// Flux was tried first and is the wrong tool here: a ringing open chord holds
// dozens of partials inside every analysis bin, they beat against each other,
// and the resulting frame-to-frame magnitude churn is the same size as a real
// attack. An envelope asks the question that actually separates them, which is
// whether the level in this band jumped, and that is the same principle the
// chord detector's attack-rise arming already rests on. Filtering rather than
// transforming also removes the analysis window from the timing path, and the
// window was the largest single source of error: a 512-point window smears an
// attack across twelve milliseconds no matter how finely it is hopped.

/** Input frame size, matching the worklet's fixed block (src/audio/capture.ts). */
export const TIMING_FRAME_SIZE = 1024;

// The two bands, in Hz. 800 is comfortably above the fundamental of every note a
// beginner plays (the top open E is 330 Hz) and takes almost none of a strum's
// energy with it: measured on synthesised chords, moving the edge from 1200 down
// to 800 changes the strum's band level by under half a per cent, because a
// strummed guitar's energy is overwhelmingly in its fundamentals and second
// harmonics. What it does buy is another eight decibels against the downbeat
// bell's 1570 Hz partial, which is the one part of the click that is a sustained
// tone rather than a transient and therefore the hardest to keep out.
//
// The gap up to 2100 is deliberate: six poles is a steep skirt but not a wall,
// and neither band should have to reason about the other's leakage.
const PLAY_HI_HZ = 800;
const PLAY_LO_HZ = 60;
const CLICK_LO_HZ = 2100;
const CLICK_HI_HZ = 7000;

/**
 * Envelope smoothing, as a one-pole time constant.
 *
 * This is the single most consequential number in the file and it was chosen by
 * measurement. Short smoothing (2 to 3 ms) leaves the half-wave ripple of a low
 * string in the envelope, and that ripple is the same size as the level jump a
 * re-strummed ringing chord actually makes, so no threshold separates them: at
 * 120 BPM with the chord still sounding, one strum in thirty was found. Long
 * smoothing (20 ms and up) flattens the attack until the crossing point wanders.
 * Fourteen milliseconds detected every strum in every synthesised take with no
 * false ones, which nothing else did.
 *
 * It costs nothing in accuracy. A one-pole smoother reaches a third of a step
 * inside a tenth of its time constant, and it is applied identically to both
 * bands, so what little lag it adds is common to the strum and the click and
 * cancels in the difference. Measured on a chord whose six strings are struck at
 * exactly the same instant, the reported time is 0.4 ms late with a spread of
 * 0.2 ms.
 */
const ENVELOPE_TAU_MS = 14;
// The envelope is only sampled this often for onset picking. 0.73 ms at 44.1 kHz
// is an order of magnitude finer than the tolerance this drill reports in, and
// it keeps the picker's ring buffers small.
const ENVELOPE_STEP = 32;

/**
 * How far back an attack is measured against, and how far the level has to have
 * climbed over that span to count as one.
 *
 * The two bands get different values because they are looking at different
 * physical events, and that difference is itself a discriminator. A click is an
 * impulse: it is at full level within a millisecond, so it is looked for over a
 * short span and has to be a large jump. A strum is six strings struck in
 * succession over tens of milliseconds, so it is looked for over a longer span
 * and allowed a much gentler climb. A pick attack bright enough to leak into the
 * click band still climbs like a strum, and so fails the click test on shape
 * rather than on level alone.
 *
 * A third of a rise sounds slight, and it is: it has to be. The hardest case in
 * this drill is a chord strummed again while the last one is still ringing
 * undamped, which is exactly what strumming practice is. Measured on synthesised
 * takes, that adds only about forty per cent to the band's level. Anything
 * stricter starts losing real strums at the top of the tempo range, and a missed
 * strum is reported to the player as a beat they failed to play, which is a
 * worse lie than an extra.
 */
const PLAY_RISE_SPAN_MS = 30;
const PLAY_RISE_RATIO = 1.35;
const CLICK_RISE_SPAN_MS = 12;
const CLICK_RISE_RATIO = 2.6;

/**
 * How long the click detector keeps looking after its first candidate, and takes
 * the biggest jump it saw rather than the first.
 *
 * This is what stops a strum stealing a beat. A steel-string pick attack does
 * put some energy above 2 kHz, and a player who lands twenty milliseconds early
 * would otherwise fire the click detector with their own strum, have the real
 * click swallowed by the refractory, and be measured against a beat that had
 * moved to meet them. That is the one failure mode in this whole file that
 * flatters the player, which makes it the one least likely to be noticed and the
 * most important to remove. Measured on synthesised takes, a click is four times
 * the level of the loudest strum leaking into its band, so taking the largest
 * jump in the window resolves it every time.
 *
 * The window has to be wider than the largest offset the drill means to measure,
 * and this is what sets its size. A player who is consistently 70 ms early was
 * having every one of their own strums promoted to a click, because the strum
 * opened the window, the window closed before the real click arrived, and the
 * refractory then swallowed it: the beat grid ended up fitted to the guitar and
 * the run came back looking flawless. The drill's own inhuman-precision guard
 * caught it, which is what that guard is for, but a heavy rusher is exactly the
 * player this drill exists for and refusing to measure them is not a fix. 130 ms
 * is two and a half times the in-time window and covers any lean worth naming.
 *
 * Zero for the play band, which wants the first crossing: nothing can leak into
 * it loudly enough to compete, and a strum's own attack keeps climbing for tens
 * of milliseconds, so "biggest" there would mean "latest".
 */
const CLICK_HOLD_MS = 130;

/**
 * Where on the attack the onset is timed, as a fraction of the climb that
 * qualified it.
 *
 * Not the peak: a downstroke reaches its loudest well after the pick met the
 * first string, and how long that takes depends on how hard it was played. Not
 * the very foot of the climb either, which is buried in whatever was still
 * ringing. Three tenths of the way up is early enough to track the attack and
 * late enough to be clear of the previous chord's tail.
 */
const CROSS_FRACTION = 0.3;

/**
 * Absolute envelope floors, as amplitude. Below these the band is not carrying a
 * signal at all and a relative rise means nothing: doubling silence is silence.
 *
 * They also carry the last of the rejection in each direction, which is why
 * they are not merely nominal. With a one millisecond attack ramp on the click
 * and the band closing at 800 Hz, the loudest click voice puts 0.0066 into the
 * guitar's band, against a bar of 0.02 x 1.35: four times clear. In the other
 * direction the loudest strum puts 0.030 into the click band, against a bar of
 * 0.012 x 2.6: again clear. That second margin is what makes the drill able to
 * say "I cannot hear the click" rather than quietly measuring the guitar against
 * itself and reporting perfect time.
 */
const PLAY_LEVEL_FLOOR = 0.02;
const CLICK_LEVEL_FLOOR = 0.012;

/**
 * A detector goes quiet for this long after firing, and then must also see the
 * rise fall back before it will fire again.
 *
 * The two bands need different amounts of it. A strum rings, and its ring-out
 * ripple is what 200 ms is sized against: it is a quarter of a beat at the
 * drill's slowest tempo and not quite half of one at its fastest, so it can
 * never swallow a beat. It does mean this analyser cannot see two strums closer
 * together than a fifth of a second, which is deliberate: the drill measures one
 * down strum per beat, and reading up strums needs their direction as well as
 * their time, neither of which is available here.
 *
 * The click has no ring to suppress, and its refractory has to be short because
 * it is spent on top of the hold window above: the two together are how long the
 * detector is blind after a candidate opens, and that total has to stay under a
 * beat at the fastest tempo the metronome allows.
 *
 * The re-arm is the part that matters for a strum: an attack that keeps climbing
 * for tens of milliseconds would otherwise fire again the moment the refractory
 * expired.
 */
const PLAY_REFRACTORY_MS = 200;
const CLICK_REFRACTORY_MS = 100;
const RE_ARM_RATIO = 1.12;

/**
 * The closest two strums can be and still both be reported, in milliseconds.
 *
 * The refractory above says this in the negative and nothing outside this file
 * could read it, which is how a sixteenth-note drill came to be built on top of
 * a detector that cannot resolve sixteenth notes. It is stated here as a
 * positive number so anything asking a player for two strokes can check first
 * whether the answer it gets back could mean anything.
 *
 * Measured, not derived: eight identical strums at a fixed spacing through the
 * real analyser are all eight reported at 210 ms apart, and at 200 ms three of
 * them go missing. That is PLAY_REFRACTORY_MS plus what the re-arm costs, and
 * the ten milliseconds between them is why this is not simply the refractory.
 * tests/strumPattern.test.mjs holds both halves of that measurement, so this
 * number cannot drift away from the detector it describes.
 *
 * What it does NOT include is the player. Two strokes written a fifth of a
 * second apart arrive closer than that whenever the second one is early, so a
 * caller deciding whether a pattern can be graded has to leave room for that on
 * top; see MIN_GRADED_STROKE_GAP_MS in src/lib/strumPattern.ts.
 */
export const MIN_STRUM_GAP_MS = 210;

// Noise floor tracking for the signal meter, mirroring the chord detector's.
const SILENCE_RMS = 0.005;
const NOISE_FLOOR_MAX = 0.03;

/**
 * Snapshot of every tuning constant, embedded in a diagnostic session so an
 * export stays interpretable after these change. Mirrors DETECTOR_CONSTANTS.
 */
export const TIMING_CONSTANTS: Record<string, number> = {
  PLAY_LO_HZ,
  PLAY_HI_HZ,
  CLICK_LO_HZ,
  CLICK_HI_HZ,
  ENVELOPE_TAU_MS,
  ENVELOPE_STEP,
  PLAY_RISE_SPAN_MS,
  PLAY_RISE_RATIO,
  CLICK_RISE_SPAN_MS,
  CLICK_RISE_RATIO,
  CLICK_HOLD_MS,
  CROSS_FRACTION,
  PLAY_LEVEL_FLOOR,
  CLICK_LEVEL_FLOOR,
  PLAY_REFRACTORY_MS,
  CLICK_REFRACTORY_MS,
  RE_ARM_RATIO,
};

/** One thing the analyser heard, timed in seconds since the analyser started. */
export interface TimingOnset {
  at: number;
  /** How far the level jumped, as a multiple of the bar it had to clear. */
  strength: number;
}

export interface TimingLevel {
  rms: number;
  noiseFloor: number;
}

export interface TimingHandlers {
  /** A strum, heard in the low band. */
  onStrum?: (onset: TimingOnset) => void;
  /** A metronome click, heard in the high band. */
  onClick?: (onset: TimingOnset) => void;
  /** Per input frame, for the signal meter. */
  onLevel?: (level: TimingLevel) => void;
}

export interface TimingOptions extends TimingHandlers {
  sampleRate: number;
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/** One direct-form-II transposed biquad section. */
class Biquad {
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;
  private z1 = 0;
  private z2 = 0;

  private constructor(b0: number, b1: number, b2: number, a1: number, a2: number) {
    this.b0 = b0;
    this.b1 = b1;
    this.b2 = b2;
    this.a1 = a1;
    this.a2 = a2;
  }

  // Audio EQ cookbook forms. Written out rather than pulled in, because two
  // shapes at three Q values is less code than a dependency and the whole
  // filter has to be readable next to the band edges it enforces.
  static lowpass(frequency: number, sampleRate: number, q: number): Biquad {
    const w = (2 * Math.PI * frequency) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    return new Biquad(
      ((1 - cos) / 2) / a0,
      (1 - cos) / a0,
      ((1 - cos) / 2) / a0,
      (-2 * cos) / a0,
      (1 - alpha) / a0,
    );
  }

  static highpass(frequency: number, sampleRate: number, q: number): Biquad {
    const w = (2 * Math.PI * frequency) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    return new Biquad(
      ((1 + cos) / 2) / a0,
      (-(1 + cos)) / a0,
      ((1 + cos) / 2) / a0,
      (-2 * cos) / a0,
      (1 - alpha) / a0,
    );
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}

/** Section Q values for a sixth-order Butterworth response, in cascade. */
const BUTTERWORTH_6 = [0.51764, 0.70711, 1.93185];

/**
 * A band, followed by its amplitude envelope.
 *
 * The envelope is a one-pole smoother over the squared signal, square-rooted, so
 * it reads as an amplitude and a rise ratio means what it looks like it means.
 */
class BandEnvelope {
  private readonly sections: Biquad[];
  private readonly smoothing: number;
  private power = 0;

  constructor(sections: Biquad[], sampleRate: number) {
    this.sections = sections;
    this.smoothing = Math.exp(-1 / ((ENVELOPE_TAU_MS / 1000) * sampleRate));
  }

  process(sample: number): number {
    let x = sample;
    for (const section of this.sections) x = section.process(x);
    this.power = this.power * this.smoothing + x * x * (1 - this.smoothing);
    return Math.sqrt(this.power);
  }

  reset(): void {
    for (const section of this.sections) section.reset();
    this.power = 0;
  }
}

// ---------------------------------------------------------------------------
// Onset picking
// ---------------------------------------------------------------------------

interface AttackShape {
  spanMs: number;
  ratio: number;
  floor: number;
  /** How long to keep looking for a bigger jump before reporting. 0 fires at once. */
  holdMs: number;
  refractoryMs: number;
}

interface Attack {
  /** Fractional step index of the crossing. */
  at: number;
  /** How far above its bar the level went, as a multiple. */
  strength: number;
  /** The climb over the rise span, which is what a hold compares candidates on. */
  rise: number;
}

/**
 * Finds the moment a band's level jumped, and says when it crossed rather than
 * when it peaked.
 *
 * The crossing is the right instant because it tracks the arrival of the sound
 * rather than its peak, and it does so identically on both bands. Measured
 * against synthesised takes with known answers: a click is reported 0.3 ms late
 * with a spread of 0.1 ms, and a chord whose strings are all struck at the same
 * instant 0.4 ms late.
 *
 * A real strum reads later than the moment the pick met the first string, by
 * roughly nine milliseconds for a brisk downstroke and eighteen for an ordinary
 * one. That is not an error and it is deliberately not corrected. A strum is not
 * an event, it is six strings sounding in succession, and the moment its sound
 * arrives is both what this measures and what a listener hears. Subtracting a
 * constant to make the number agree with the pick instead of the ear would be
 * inventing precision the signal does not contain.
 */
class AttackPicker {
  /** The last `span` + 1 envelope samples, oldest at `head`. */
  private readonly ring: Float32Array;
  private readonly span: number;
  private readonly ratio: number;
  private readonly floor: number;
  private readonly holdSteps: number;
  private readonly minSteps: number;
  private head = 0;
  private filled = 0;
  private step = 0;
  private candidate: Attack | null = null;
  private holdLeft = 0;
  private refractoryLeft = 0;
  private armed = true;

  constructor(shape: AttackShape, stepSeconds: number) {
    this.span = Math.max(1, Math.round(shape.spanMs / 1000 / stepSeconds));
    this.ratio = shape.ratio;
    this.floor = shape.floor;
    this.holdSteps = Math.round(shape.holdMs / 1000 / stepSeconds);
    this.ring = new Float32Array(this.span + 1);
    this.minSteps = Math.max(1, Math.round(shape.refractoryMs / 1000 / stepSeconds));
  }

  /** Feed one envelope sample. Returns a confirmed attack, or null. */
  push(level: number): Attack | null {
    const size = this.ring.length;
    this.ring[this.head] = level;
    const before = this.ring[(this.head + 1) % size];
    this.head = (this.head + 1) % size;
    this.filled += 1;
    const step = this.step;
    this.step += 1;

    if (this.filled <= this.span) return null;

    if (this.refractoryLeft > 0) {
      this.refractoryLeft -= 1;
      return null;
    }
    const reference = Math.max(before, this.floor);
    if (!this.armed) {
      // A single attack climbs for tens of milliseconds. Re-arming only once the
      // level has fallen back toward what it rose from is what stops the tail of
      // one strum being read as the head of another.
      if (level < reference * RE_ARM_RATIO) this.armed = true;
      return null;
    }

    const bar = reference * this.ratio;
    if (level > bar) {
      const rise = level - before;
      if (this.candidate === null) {
        this.candidate = { at: this.crossingAt(before, level, step), strength: level / bar, rise };
        this.holdLeft = this.holdSteps;
      } else if (rise > this.candidate.rise) {
        this.candidate = { at: this.crossingAt(before, level, step), strength: level / bar, rise };
      }
    }
    if (this.candidate === null) return null;
    if (this.holdLeft > 0) {
      this.holdLeft -= 1;
      return null;
    }

    const attack = this.candidate;
    this.candidate = null;
    this.armed = false;
    this.refractoryLeft = this.minSteps;
    return attack;
  }

  /**
   * Where in the last `span` steps the level passed CROSS_FRACTION of the climb
   * that has just qualified. Linear interpolation between two 0.73 ms steps is
   * as exact as this needs to be.
   */
  private crossingAt(before: number, level: number, step: number): number {
    const threshold = before + CROSS_FRACTION * (level - before);
    const size = this.ring.length;
    // The ring now ends at `step`; walk it forward in time from step - span.
    const oldest = this.head;
    let previous = this.ring[oldest];
    for (let i = 1; i < size; i++) {
      const value = this.ring[(oldest + i) % size];
      if (value >= threshold) {
        const climb = value - previous;
        const fraction = climb > 0 ? Math.min(1, Math.max(0, (threshold - previous) / climb)) : 0;
        return step - this.span + i - 1 + fraction;
      }
      previous = value;
    }
    return step;
  }

  reset(): void {
    this.ring.fill(0);
    this.head = 0;
    this.filled = 0;
    this.step = 0;
    this.candidate = null;
    this.holdLeft = 0;
    this.refractoryLeft = 0;
    this.armed = true;
  }
}

// ---------------------------------------------------------------------------

export class TimingAnalyser {
  private readonly play: BandEnvelope;
  private readonly click: BandEnvelope;
  private readonly playPicker: AttackPicker;
  private readonly clickPicker: AttackPicker;
  private readonly handlers: TimingHandlers;
  private readonly stepSeconds: number;
  private readonly sampleRate: number;
  private sampleInStep = 0;
  private steps = 0;
  private noiseFloor = SILENCE_RMS;

  constructor(options: TimingOptions) {
    const { sampleRate } = options;
    this.handlers = options;
    this.sampleRate = sampleRate;
    this.stepSeconds = ENVELOPE_STEP / sampleRate;

    this.play = new BandEnvelope(
      [
        Biquad.highpass(PLAY_LO_HZ, sampleRate, Math.SQRT1_2),
        ...BUTTERWORTH_6.map((q) => Biquad.lowpass(PLAY_HI_HZ, sampleRate, q)),
      ],
      sampleRate,
    );
    this.click = new BandEnvelope(
      [
        ...BUTTERWORTH_6.map((q) => Biquad.highpass(CLICK_LO_HZ, sampleRate, q)),
        Biquad.lowpass(CLICK_HI_HZ, sampleRate, Math.SQRT1_2),
      ],
      sampleRate,
    );

    this.playPicker = new AttackPicker(
      {
        spanMs: PLAY_RISE_SPAN_MS,
        ratio: PLAY_RISE_RATIO,
        floor: PLAY_LEVEL_FLOOR,
        holdMs: 0,
        refractoryMs: PLAY_REFRACTORY_MS,
      },
      this.stepSeconds,
    );
    this.clickPicker = new AttackPicker(
      {
        spanMs: CLICK_RISE_SPAN_MS,
        ratio: CLICK_RISE_RATIO,
        floor: CLICK_LEVEL_FLOOR,
        holdMs: CLICK_HOLD_MS,
        refractoryMs: CLICK_REFRACTORY_MS,
      },
      this.stepSeconds,
    );
  }

  /** Seconds of audio the analyser has consumed. The drill's clock. */
  get elapsed(): number {
    return this.steps * this.stepSeconds;
  }

  /** Feed exactly one TIMING_FRAME_SIZE block of mono samples. */
  processFrame(frame: Float32Array): void {
    if (frame.length !== TIMING_FRAME_SIZE) return;

    let sumSquares = 0;
    for (let i = 0; i < frame.length; i++) {
      const sample = frame[i];
      sumSquares += sample * sample;
      const playLevel = this.play.process(sample);
      const clickLevel = this.click.process(sample);
      this.sampleInStep += 1;
      if (this.sampleInStep < ENVELOPE_STEP) continue;
      this.sampleInStep = 0;
      this.steps += 1;

      const strum = this.playPicker.push(playLevel);
      if (strum) this.handlers.onStrum?.({ at: this.stepTime(strum.at), strength: strum.strength });
      const click = this.clickPicker.push(clickLevel);
      if (click) this.handlers.onClick?.({ at: this.stepTime(click.at), strength: click.strength });
    }

    const rms = Math.sqrt(sumSquares / frame.length);
    if (rms < Math.max(this.noiseFloor * 2, SILENCE_RMS)) {
      this.noiseFloor = Math.min(this.noiseFloor * 0.98 + rms * 0.02, NOISE_FLOOR_MAX);
    }
    this.handlers.onLevel?.({ rms, noiseFloor: this.noiseFloor });
  }

  reset(): void {
    this.play.reset();
    this.click.reset();
    this.playPicker.reset();
    this.clickPicker.reset();
    this.sampleInStep = 0;
    this.steps = 0;
    this.noiseFloor = SILENCE_RMS;
  }

  /**
   * A step index as a time. The envelope is one-pole smoothed, so the level it
   * reports at a given sample is a weighted average of the recent past and every
   * reading lags the signal by about the smoother's own time constant. That lag
   * is a property of the filter, identical on both bands, and it therefore
   * cancels where it matters. It is deliberately not subtracted here: a constant
   * removed from both sides of a subtraction is a fudge factor with nothing to
   * do, and hiding it would only make the two numbers harder to reconcile with a
   * diagnostics export.
   */
  private stepTime(fractionalStep: number): number {
    return (fractionalStep * ENVELOPE_STEP) / this.sampleRate;
  }
}
