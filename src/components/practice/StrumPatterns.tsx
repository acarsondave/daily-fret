import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRightIcon, HourglassIcon, MicIcon, PlayIcon, RetryIcon } from '../icons';
import { useStrumTiming } from '../../hooks/useStrumTiming';
import { metronome } from '../../audio/metronome';
import { diag, DIAG_CODE } from '../../audio/diagnostics';
import { sfx } from '../../audio/sfx';
import { fitBeatGrid, type BeatGrid } from '../../lib/strumTiming';
import {
  MIN_PATTERN_BARS,
  SLOTS_PER_BAR,
  dealNext,
  matchPattern,
  parsePattern,
  patternStanding,
  summarisePattern,
  type Pattern,
  type PatternRunRecord,
  type PatternStanding,
  type PatternSummary,
  type SlotOutcome,
} from '../../lib/strumPattern';
import { barsPerDeal, describePattern, upStrumsUnheard } from '../../lib/patternDeck';
import { patternName } from '../../data/strumPatterns';
import { useStore } from '../../store';
import { PatternBar, type SlotView } from './PatternBar';
import { ClickPath } from './ClickPath';
import { SignalMeter } from './SignalMeter';
import { useTimingSignalMeter } from './signalQuality';
import type { DrillConfig } from '../../types';
import './strumPattern.css';

const AUTO_ADVANCE_SECONDS = 5;
/** Beats in the bar a pattern is. Eight eighth-note slots is four of them. */
const BEATS_PER_BAR = 4;
/**
 * How long the drill listens for the click before it says it cannot hear one.
 *
 * The same seven seconds strum timing allows, and for the same reasons: the
 * metronome's own start offset, a browser taking its time to free the audio
 * route, and a player who has not started yet.
 */
const CLICK_GRACE_SECONDS = 7;
/** How often the run checks where it is in the bar. Slot changes drive the drawing. */
const TICK_MS = 40;

type View = 'deck' | 'playing' | 'results';

/** One pattern, dealt and played for its bars. */
export interface PatternDeal {
  pattern: string;
  score: number;
  settledBar: number | null;
  /** Every up strum in this deal went missing together. Nothing is scored. */
  upsUnheard: boolean;
}

export interface StrumPatternResult {
  bpm: number;
  deals: PatternDeal[];
}

interface Props {
  config?: DrillConfig;
  /** The tempo the drill runs at, from the shared prescription. */
  bpm: number;
  /** The deck, in the order it should be shown. */
  deck: string[];
  /** Every recorded run of each pattern in the deck, at this tempo, oldest first. */
  history: Record<string, PatternRunRecord[]>;
  onResult?: (result: StrumPatternResult) => void;
  onClose?: () => void;
  autoStart?: boolean;
  onNext?: () => void;
  autoAdvance?: boolean;
  nextLabel?: string;
  onSessionStart?: () => void;
}

/** What one deal accumulated while it was on screen. */
interface LiveDeal {
  pattern: Pattern;
  source: string;
  /** Bar of the metronome's own count this deal started on. */
  startBar: number;
  /** The grid beat this deal's bar zero sits on, or null while nothing is heard. */
  originBeat: number | null;
  onsets: number[];
}

/** A pattern's whole showing across the run, for the results card. */
interface PatternReport {
  source: string;
  pattern: Pattern;
  summary: PatternSummary;
  upsUnheard: boolean;
  standing: PatternStanding;
}

/**
 * Strumming patterns, dealt from a deck against a click that never stops.
 *
 * Module 5 teaches one mechanic and it is not a rhythm: the arm is a continuous
 * eighth-note pendulum from the elbow, and the pattern is only which of the
 * eight slots you let the pick touch the strings on. Everything on this surface
 * follows from that. The click runs through the whole drill, a pattern is dealt
 * for four bars, the next one appears a bar before the last one ends so the arm
 * never has to stop to read anything, and the marker crossing the strings keeps
 * going whether or not the slot it is crossing sounds.
 *
 * Nothing here reports a percentage as the result. A single number cannot say
 * the thing the drill is for, which is which slot the arm is dropping and which
 * way the hand leans; the eight slots can, and do.
 */
export function StrumPatterns({
  config,
  bpm,
  deck,
  history,
  onResult,
  onClose,
  autoStart = false,
  onNext,
  autoAdvance = false,
  nextLabel = 'Up next',
  onSessionStart,
}: Props) {
  const { status, route, error, start, stop } = useStrumTiming();
  const duration = config?.durationSec ?? 60;
  const bars = barsPerDeal(config?.bars);
  const custom = useStore((s) => s.accounts[s.currentAccountId]?.strumPatterns ?? []);

  const [view, setView] = useState<View>(autoStart ? 'playing' : 'deck');
  // Whatever the click is actually set to, which is not always the prescription:
  // the player can move it from the metronome panel at any time. Held in state
  // rather than read from the click during render, because it decides the key
  // every result is filed under and a key must not change under a run.
  const [tempo, setTempo] = useState(bpm);
  const [timeLeft, setTimeLeft] = useState(duration);
  const [current, setCurrent] = useState<Pattern | null>(null);
  const [next, setNext] = useState<Pattern | null>(null);
  const [dealId, setDealId] = useState(0);
  const [bar, setBar] = useState(0);
  const [outcomes, setOutcomes] = useState<SlotOutcome[]>([]);
  const [passedSlot, setPassedSlot] = useState(-1);
  const [deaf, setDeaf] = useState(false);
  const [reports, setReports] = useState<PatternReport[]>([]);
  const [advanceLeft, setAdvanceLeft] = useState(AUTO_ADVANCE_SECONDS);
  const { quality: signal, push: pushSignal, reset: resetSignal } = useTimingSignalMeter(route);

  // Everything the analyser reports lands in refs. Strums and clicks arrive
  // several times a second and the grid is refitted on each one; keeping the raw
  // lists out of React state is what stops a re-render per event while the
  // filters are running on the same thread.
  const clicksRef = useRef<number[]>([]);
  const gridRef = useRef<BeatGrid | null>(null);
  const periodRef = useRef(60 / bpm);
  /**
   * The analyser's clock against the browser's, taken from the last click.
   *
   * The analyser counts seconds from its own first frame and the metronome
   * counts beats on the audio clock, and the drill has to put a bar line found
   * on one into the other. A click is the one event both clocks see, so it is
   * where they are tied together.
   */
  const clockRef = useRef<{ analyser: number; wall: number } | null>(null);
  const dealRef = useRef<LiveDeal | null>(null);
  const collectedRef = useRef<Map<string, SlotOutcome[]>>(new Map());
  const dealsRef = useRef<PatternDeal[]>([]);
  const recordsRef = useRef<Record<string, PatternRunRecord[]>>({});
  // The card queued up beside the one being played, read from inside the run
  // loop where the rendered state is a closure from whenever it last ran.
  const nextRef = useRef<Pattern | null>(null);
  const startedAtRef = useRef(0);
  // The same tempo the state carries, for the run loop and for `finish`, which
  // both read it outside a render and would otherwise close over a stale one.
  const tempoRef = useRef(bpm);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishedRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  /** How wide one eighth-note slot is, in milliseconds, at the tempo being held. */
  const slotMs = ((60 / tempo) * 1000 * BEATS_PER_BAR) / SLOTS_PER_BAR;

  /**
   * Where the arm is, in slots, read on every frame by the bar itself.
   *
   * Off the metronome rather than off the microphone. The arm is what the click
   * is asking for, so it belongs to the click's own clock, and reading it there
   * costs no capture latency at all. What the microphone heard is a separate
   * question and is drawn separately.
   */
  const sweepAt = useCallback((): number | null => {
    const phase = metronome.phase();
    if (!phase) return null;
    const beat = ((phase.position % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
    return (beat + phase.sinceSeconds / phase.secondsPerBeat) * (SLOTS_PER_BAR / BEATS_PER_BAR);
  }, []);

  const standingOf = useCallback(
    (source: string): PatternStanding => patternStanding(recordsRef.current[source] ?? []),
    [],
  );

  /** The card to deal next, weighted towards whatever is least established. */
  const drawCard = useCallback(
    (previous: string | null): Pattern | null => {
      const cards = deck.map((pattern) => ({ pattern, standing: standingOf(pattern) }));
      const chosen = dealNext(cards, previous, Math.random());
      return chosen ? parsePattern(chosen) : null;
    },
    [deck, standingOf],
  );

  const handleClick = (at: number) => {
    clicksRef.current.push(at);
    clockRef.current = { analyser: at, wall: performance.now() };
    diag.timing(DIAG_CODE.CLICK_HEARD, 0);
    const grid = fitBeatGrid(clicksRef.current, periodRef.current);
    if (grid) {
      gridRef.current = grid;
      setDeaf(false);
      return;
    }
    if (gridRef.current) {
      // The clicks stopped describing this tempo. The old grid is no longer a
      // claim that can be made about what is being played now.
      gridRef.current = null;
      diag.timing(DIAG_CODE.GRID_LOST, 0);
    }
  };

  const handleStrum = (at: number) => {
    const deal = dealRef.current;
    const grid = gridRef.current;
    if (!deal || !grid || deal.originBeat === null) {
      diag.timing(DIAG_CODE.STRUM_NO_GRID, 0);
      return;
    }
    deal.onsets.push(at);
    const found = matchPattern({
      onsets: deal.onsets,
      grid,
      pattern: deal.pattern,
      originBeat: deal.originBeat,
      bars,
    });
    diag.timing(DIAG_CODE.STRUM_TIMED, 0);
    setOutcomes(found);
  };

  /** Close the deal on screen, score it, and keep what it said. */
  const closeDeal = (deal: LiveDeal) => {
    const grid = gridRef.current;
    if (deal.originBeat === null || !grid) return;
    const found = matchPattern({
      onsets: deal.onsets,
      grid,
      pattern: deal.pattern,
      originBeat: deal.originBeat,
      bars,
    });
    const summary = summarisePattern(found, deal.pattern);
    const unheard = upStrumsUnheard(summary);
    // A deal whose up strums all went missing is not scored. The downs were
    // fine, so a score built from them would be a real number about half a
    // pattern, presented as a number about the pattern.
    const score = summary.enough && !unheard ? summary.score : 0;
    dealsRef.current.push({
      pattern: deal.source,
      score,
      settledBar: unheard ? null : summary.settledBar,
      upsUnheard: unheard,
    });
    if (score > 0) {
      const held = recordsRef.current[deal.source] ?? [];
      recordsRef.current = {
        ...recordsRef.current,
        [deal.source]: [...held, { date: '', score, settledBar: summary.settledBar }],
      };
    }
    // Bars are renumbered as they accumulate so a pattern dealt twice reads as
    // one longer showing of it rather than as two runs written over each other.
    const kept = collectedRef.current.get(deal.source) ?? [];
    const offset = kept.length ? Math.max(...kept.map((o) => o.bar)) + 1 : 0;
    collectedRef.current.set(deal.source, [
      ...kept,
      ...found.map((o) => ({ ...o, bar: o.bar + offset })),
    ]);
  };

  /** Deal a card, aligned to the bar of the click the player is hearing. */
  const openDeal = (startBar: number, pattern: Pattern) => {
    dealRef.current = {
      pattern,
      source: pattern.source,
      startBar,
      originBeat: originBeatFor(startBar),
      onsets: [],
    };
    nextRef.current = null;
    setCurrent(pattern);
    setNext(null);
    setOutcomes([]);
    setPassedSlot(-1);
    setBar(0);
    setDealId((n) => n + 1);
  };

  /**
   * Which beat of the fitted grid a bar of the click starts on.
   *
   * The metronome knows where beat one is and the microphone does not: the
   * analyser hears clicks, not accents. So the bar line is taken from the click
   * the player is listening to and carried across to the grid through the last
   * click both clocks saw. Getting this wrong rotates the pattern and scores a
   * good take as a total miss, which is exactly the failure a player would
   * otherwise be blamed for.
   */
  function originBeatFor(startBar: number): number | null {
    const grid = gridRef.current;
    const clock = clockRef.current;
    const phase = metronome.phase();
    if (!grid || !clock || !phase) return null;
    const agoSeconds =
      (phase.position - startBar * BEATS_PER_BAR) * phase.secondsPerBeat + phase.sinceSeconds;
    const wallAtBarLine = performance.now() - agoSeconds * 1000;
    const analyserAtBarLine = clock.analyser + (wallAtBarLine - clock.wall) / 1000;
    return Math.round((analyserAtBarLine - grid.origin) / grid.period);
  }

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    clearTimer();
    const open = dealRef.current;
    dealRef.current = null;
    if (open) closeDeal(open);
    void stop();

    const built: PatternReport[] = [];
    for (const [source, found] of collectedRef.current) {
      const pattern = parsePattern(source);
      if (!pattern) continue;
      const summary = summarisePattern(found, pattern);
      built.push({
        source,
        pattern,
        summary,
        upsUnheard: upStrumsUnheard(summary),
        standing: standingOf(source),
      });
    }
    diag.mark(
      `strum patterns finish at ${bpm} BPM: ${dealsRef.current
        .map((d) => `${d.pattern} ${d.upsUnheard ? 'ups unheard' : `${d.score}%`}`)
        .join(', ')}`,
    );
    if (dealsRef.current.some((d) => d.score > 0)) sfx.complete();
    setReports(built);
    setView('results');
    onResult?.({ bpm: tempoRef.current, deals: dealsRef.current });
  };

  const startSession = async () => {
    sfx.go();
    const opening = metronome.getBpm();
    clicksRef.current = [];
    gridRef.current = null;
    clockRef.current = null;
    dealRef.current = null;
    collectedRef.current = new Map();
    dealsRef.current = [];
    recordsRef.current = { ...history };
    finishedRef.current = false;
    periodRef.current = 60 / opening;
    tempoRef.current = opening;
    setTempo(opening);
    nextRef.current = null;
    setCurrent(null);
    setNext(null);
    setOutcomes([]);
    setPassedSlot(-1);
    setDeaf(false);
    setTimeLeft(duration);
    resetSignal();
    onSessionStart?.();
    setView('playing');

    const running = await start(
      {
        onStrum: (onset) => handleStrum(onset.at),
        onClick: (onset) => handleClick(onset.at),
        onLevel: (level) => pushSignal(level),
      },
      'strum patterns',
    );
    if (!running) return; // denied or failed; the mic gate view takes over
    diag.mark(`strum patterns start at ${opening} BPM (${duration}s, ${bars} bars a deal)`);

    clearTimer();
    startedAtRef.current = Date.now();
    const deadline = startedAtRef.current + duration * 1000;
    const hardStopMs = (bars * BEATS_PER_BAR * 60 * 1000) / opening + 3000;
    timerRef.current = setInterval(() => {
      const now = Date.now();
      setTimeLeft(Math.max(0, Math.ceil((deadline - now) / 1000)));

      // A deal can only be scored whole, so the clock runs out at a bar line
      // rather than mid-pattern. This is the backstop for the run whose click
      // went away and whose bar line will therefore never arrive.
      if (now >= deadline + hardStopMs) {
        finish();
        return;
      }

      // Moving the click makes every offset collected so far a statement about
      // a different exercise, and a different key. The run starts collecting
      // again rather than blending two tempos into one series.
      const live = metronome.getBpm();
      if (live !== tempoRef.current) {
        const open = dealRef.current;
        dealRef.current = null;
        if (open) closeDeal(open);
        tempoRef.current = live;
        periodRef.current = 60 / live;
        clicksRef.current = [];
        gridRef.current = null;
        clockRef.current = null;
        nextRef.current = null;
        startedAtRef.current = now;
        setTempo(live);
        setCurrent(null);
        setNext(null);
        setOutcomes([]);
        diag.mark(`strum patterns tempo changed to ${live} BPM; dealing again`);
        return;
      }

      const phase = metronome.phase();
      if (!phase) return;
      const heard = gridRef.current !== null && clockRef.current !== null;
      if (!heard) {
        if (now - startedAtRef.current > CLICK_GRACE_SECONDS * 1000) setDeaf(true);
        return;
      }

      const atBar = Math.floor(phase.position / BEATS_PER_BAR);
      const beatInBar = phase.position - atBar * BEATS_PER_BAR;
      const slot =
        Math.floor((beatInBar + phase.sinceSeconds / phase.secondsPerBeat) * (SLOTS_PER_BAR / BEATS_PER_BAR));

      const deal = dealRef.current;
      if (!deal) {
        // The first card waits for the next bar line, so the pattern and the
        // count start together rather than half a bar apart.
        if (beatInBar === 0) {
          const card = drawCard(null);
          if (card) openDeal(atBar, card);
        }
        return;
      }

      const into = atBar - deal.startBar;
      if (into >= bars) {
        closeDeal(deal);
        if (now >= deadline) {
          finish();
          return;
        }
        const card = nextRef.current ?? drawCard(deal.source);
        if (card) openDeal(atBar, card);
        return;
      }

      setBar(into);
      setPassedSlot(slot);
      // One bar out, the next card comes up beside this one, so the player sees
      // it coming and the arm never breaks between them.
      if (into === bars - 1 && !nextRef.current) {
        const card = drawCard(deal.source);
        if (card) {
          nextRef.current = card;
          setNext(card);
        }
      }
    }, TICK_MS);
  };

  useEffect(() => {
    const t = autoStart ? setTimeout(() => startSession(), 0) : null;
    return () => {
      if (t) clearTimeout(t);
      clearTimer();
      void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (view !== 'results' || !autoAdvance || !onNext) return;
    const deadline = Date.now() + AUTO_ADVANCE_SECONDS * 1000;
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setAdvanceLeft(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        onNext();
      }
    }, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, autoAdvance]);

  const nameOf = useCallback(
    (source: string) => patternName(source, custom) ?? source,
    [custom],
  );

  // --- The deck ------------------------------------------------------------

  if (view === 'deck') {
    return (
      <div className="om-setup sp-setup">
        <div className="sp-deck">
          {deck.map((source) => {
            const pattern = parsePattern(source);
            if (!pattern) return null;
            const standing = patternStanding(history[source] ?? []);
            return (
              <div key={source} className={`sp-card is-${standing}`}>
                <PatternBar
                  pattern={pattern}
                  size="deck"
                  standing={standing}
                  label={`${nameOf(source)}. ${describePattern(pattern)}`}
                />
                <span className="sp-card-name">{nameOf(source)}</span>
              </div>
            );
          })}
        </div>
        <button className="practice-btn primary" onClick={startSession}>
          <PlayIcon size={20} /> Start {duration}s
        </button>
      </div>
    );
  }

  // --- Playing -------------------------------------------------------------

  if (view === 'playing') {
    if (status === 'error') {
      return (
        <div className="mic-gate">
          <MicIcon size={40} color="var(--text-secondary)" />
          <p>{error ?? 'Microphone unavailable.'}</p>
          <button className="practice-btn primary" onClick={startSession}>
            <RetryIcon size={18} /> Try again
          </button>
        </div>
      );
    }
    if (status !== 'running') {
      return (
        <div className="mic-gate">
          <MicIcon size={40} color="var(--accent-primary)" />
          <p>Allow microphone access to begin…</p>
        </div>
      );
    }
    if (deaf) {
      const silent = !metronome.isAudible;
      return (
        <div className="mic-gate sp-deaf">
          {/* The same picture strum timing uses, failing the same way. The
              speaker carries the app's own muted mark when the click is not
              playing at all, so the two causes are different pictures rather
              than two paragraphs. */}
          <ClickPath state={silent ? 'silent' : 'broken'} className="sp-diagram" />
          <p className="sp-deaf-title">
            {silent ? 'The click is not playing' : 'I cannot hear the click'}
          </p>
          <button
            className="practice-btn primary"
            onClick={() => {
              if (silent) metronome.unlockAndStart(bpm);
              startedAtRef.current = Date.now();
              setDeaf(false);
            }}
          >
            <RetryIcon size={18} /> {silent ? 'Turn the click on' : 'Try again'}
          </button>
        </div>
      );
    }

    return (
      <div className="sp-stage drill-stage">
        <div className="drill-cue sp-bars">
          {current && (
            <PatternBar
              key={`deal-${dealId}`}
              className="sp-current"
              pattern={current}
              sweepAt={sweepAt}
              slots={liveSlots(current, outcomes, bar, passedSlot, slotMs)}
              label={describePattern(current)}
            />
          )}
          {next && (
            <motion.div
              className="sp-next"
              initial={{ opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            >
              <PatternBar pattern={next} size="card" label={`Next. ${describePattern(next)}`} />
            </motion.div>
          )}
        </div>

        <div className="drill-read sp-under">
          {/* Which bar of the deal is under way, drawn as the bars themselves.
              A number would be one more thing to read while both hands are on
              the guitar. */}
          <span className="sp-bars-left" role="img" aria-label={`Bar ${bar + 1} of ${bars}`}>
            {Array.from({ length: bars }, (_, i) => (
              <span key={i} className={i <= bar ? 'sp-tick is-done' : 'sp-tick'} />
            ))}
          </span>
          <span className="om-timer">
            <HourglassIcon size={22} /> {timeLeft}
          </span>
          <SignalMeter quality={signal} />
        </div>
      </div>
    );
  }

  // --- Results -------------------------------------------------------------

  const measured = reports.filter((r) => r.summary.enough);
  const heardNothing = measured.length === 0;

  return (
    <motion.div
      className="om-results sp-results"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {heardNothing ? (
        <>
          <ClickPath state="broken" className="sp-diagram" />
          <p className="sp-call">
            Nothing was measured. A pattern needs {MIN_PATTERN_BARS} bars the microphone can hear.
          </p>
        </>
      ) : (
        <div className="sp-report">
          {measured.map((report) => (
            <div key={report.source} className={`sp-row is-${report.standing}`}>
              <div className="sp-row-head">
                <span className="sp-row-name">{nameOf(report.source)}</span>
                <StandingMark standing={report.standing} />
              </div>
              <PatternBar
                pattern={report.pattern}
                size="card"
                slots={reportSlots(report, slotMs)}
                label={`${nameOf(report.source)}. ${describePattern(report.pattern)}`}
              />
              {report.upsUnheard && (
                <p className="sp-note">The up strums were too quiet to hear.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {autoAdvance ? (
        <div className="coach-advance">
          <span className="coach-advance-label">{nextLabel} in</span>
          <span className="coach-advance-count">{advanceLeft}</span>
        </div>
      ) : (
        <div className="om-actions">
          <button className="practice-btn ghost" onClick={() => onClose?.()}>
            {onNext ? 'End session' : 'Done'}
          </button>
          <button className="practice-btn primary" onClick={onNext ?? (() => setView('deck'))}>
            {onNext ? 'Next drill' : 'Again'} <ArrowRightIcon size={18} />
          </button>
        </div>
      )}
    </motion.div>
  );
}

/**
 * How established a pattern is, as three strokes filling in.
 *
 * A word would say it once and then sit there for the rest of the session. The
 * mark says the same thing at a glance and says it in the same language as the
 * row it sits over: three clean runs is what makes a pattern automatic, so the
 * mark is three strokes.
 */
function StandingMark({ standing }: { standing: PatternStanding }) {
  const filled = standing === 'automatic' ? 3 : standing === 'learning' ? 1 : 0;
  return (
    <span
      className="sp-standing"
      role="img"
      aria-label={
        standing === 'automatic'
          ? 'Automatic: three clean runs, each arriving on the first bar.'
          : standing === 'learning'
            ? 'Being learned.'
            : 'New.'
      }
    >
      {[0, 1, 2].map((i) => (
        <span key={i} className={i < filled ? 'sp-standing-tick is-on' : 'sp-standing-tick'} />
      ))}
    </span>
  );
}

/**
 * The bar on screen, right now.
 *
 * Only slots the arm has already crossed can be called missed. Judging a slot
 * the pendulum has not reached yet would dim the whole bar the moment it
 * started, which is the drill telling the player they have failed at something
 * they have not been asked to do yet. Half a slot of grace past the crossing,
 * because a strum is timed when its sound arrives and that is a little after the
 * pick moved.
 */
function liveSlots(
  pattern: Pattern,
  outcomes: readonly SlotOutcome[],
  bar: number,
  passedSlot: number,
  slotMs: number,
): SlotView[] {
  return pattern.slots.map((expected, slot) => {
    const outcome = outcomes.find((o) => o.bar === bar && o.slot === slot);
    if (outcome && (outcome.kind === 'hit' || outcome.kind === 'added')) {
      return {
        state: outcome.kind === 'added' ? 'added' : 'struck',
        at: (outcome.offsetMs ?? 0) / slotMs,
      };
    }
    if (expected && slot < passedSlot) return { state: 'missed' };
    return { state: 'idle' };
  });
}

/** A pattern's whole showing: how reliably each slot came out, and which way it leans. */
function reportSlots(report: PatternReport, slotMs: number): SlotView[] {
  return report.summary.slots.map((slot) => {
    const share = slot.bars ? slot.struck / slot.bars : 0;
    const at = slot.medianMs / slotMs;
    if (!slot.expected) {
      return share > 0 ? { state: 'added', at, share } : { state: 'idle' };
    }
    if (report.upsUnheard && slot.expected === 'U') return { state: 'unheard' };
    if (slot.struck === 0) return { state: 'missed' };
    return { state: 'struck', at, share };
  });
}
