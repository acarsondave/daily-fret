// The scheduler that sounds a song.
//
// Nothing here asserts that the scheduler was called. Every check is against
// the times sources were actually started at, compared to times computed by
// hand from the chart, because "the code ran" and "the chord landed on the
// beat" are exactly the two things this project has confused before.
//
// The fake context models the part of a real one that bites: a source that has
// been handed to the audio thread is gone unless it is explicitly stopped, and a
// context that is not running accepts nothing at all.

import {
  SongBacking,
  buildBackingPlan,
  barStrokes,
  cursorAt,
} from '../src/audio/songBacking.ts';
import { SongClock } from '../src/lib/songClock.ts';
import { buildTempoTimeline } from '../src/lib/songTempo.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${d ? ' — ' + d : ''}`); };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const times = (nodes) => nodes.map((n) => Number(n.startedAt.toFixed(6)));

function fakeContext(sampleRate = 48000) {
  const nodes = [];
  const ctx = {
    currentTime: 0,
    sampleRate,
    state: 'running',
    destination: {},
    createBuffer: (channels, length, rate) => ({
      duration: length / rate,
      copyToChannel() {},
    }),
    createBufferSource: () => {
      const node = {
        buffer: null,
        startedAt: null,
        stoppedAt: false,
        connect() {},
        start(when) { node.startedAt = when; },
        stop() { node.stoppedAt = true; },
      };
      nodes.push(node);
      return node;
    },
  };
  // What is currently handed to the audio thread and has not sounded yet. A
  // source whose start time has already passed has played; it is not something
  // a rebase could take back, and counting it as one would make every one of
  // these checks pass for the wrong reason.
  const pending = () => nodes.filter((n) => n.startedAt !== null && !n.stoppedAt && n.startedAt >= ctx.currentTime);
  return { ctx, nodes, pending };
}

const song = (strum, bars = 2) => ({
  id: 't', title: 'T', artist: 'A', strum, chords: ['A'],
  sections: [{ label: 'Verse', steps: Array.from({ length: bars }, (_, i) => ({ chord: i % 2 ? 'D' : 'A' })) }],
});

// 120 bpm, four to a bar: a bar is two seconds and a beat is half of one.
const timelineOf = (strum, bars = 2) => buildTempoTimeline(song(strum, bars), 120).timeline;

console.log('\nWhere a bar sounds its strokes\n');
{
  const twoDowns = barStrokes(timelineOf('DD').bars[0]);
  check('two downs across a bar are a second apart', twoDowns.length === 2);
  check('the first is on the downbeat', near(twoDowns[0].at, 0));
  check('the second is halfway through', near(twoDowns[1].at, 1));
  check('and both are down strokes', twoDowns.every((s) => s.dir === 'D'));

  const eighths = barStrokes(timelineOf('D--UX--U').bars[0]);
  check('an eighth-note bar sounds only its four marked slots', eighths.length === 4, String(eighths.length));
  check('and each one where its arrow is drawn',
    eighths.map((s) => Number(s.at.toFixed(3))).join() === '0,0.75,1,1.75',
    eighths.map((s) => s.at).join());
  check('a dead stroke is a stroke', eighths[2].dir === 'X');
  check('and an up stroke is an up stroke', eighths[1].dir === 'U');

  // Six arrows in a bar of four is not a grid. Sounding them evenly would be a
  // sextuplet, which is not how any of these songs go.
  const sixArrows = barStrokes(timelineOf('DDUUDU').bars[0]);
  check('six arrows in a bar of four sound once, on the downbeat', sixArrows.length === 1, String(sixArrows.length));
  check('and that stroke is where the first arrow is drawn', near(sixArrows[0].at, 0));
  check('nothing is ever sounded between the arrows',
    barStrokes(timelineOf('DDDDDD').bars[0]).length === 1);

  const rests = barStrokes({ ...timelineOf('DD').bars[0], strum: '----' });
  check('a bar of rests sounds nothing', rests.length === 0);
  const second = barStrokes(timelineOf('DD').bars[1]);
  check('the second bar sounds in the second bar', near(second[0].at, 2) && near(second[1].at, 3));
}

console.log('\nThe plan\n');
{
  const line = timelineOf('DD');
  const plan = buildBackingPlan(line, 4);
  const at = (kind) => plan.filter((e) => e.kind === kind).map((e) => Number(e.at.toFixed(3)));
  check('the count-in is four beats before the first downbeat',
    at('click').slice(0, 4).join() === '-2,-1.5,-1,-0.5', at('click').slice(0, 4).join());
  check('and they are counted in, not played in',
    plan.slice(0, 4).every((e) => e.accent === 'countin'));
  check('every beat of the song gets a click', at('click').length === 4 + 8, String(at('click').length));
  check('beat one of a bar is the downbeat',
    plan.find((e) => e.kind === 'click' && near(e.at, 2)).accent === 'downbeat');
  check('and the others are not',
    plan.find((e) => e.kind === 'click' && near(e.at, 2.5)).accent === 'beat');
  check('each bar sounds its own chord',
    plan.filter((e) => e.kind === 'chord').map((e) => e.chord).join() === 'A,A,D,D');
  check('the plan is in time order', plan.every((e, i) => i === 0 || e.at >= plan[i - 1].at));

  check('the cursor finds the first event at or after a moment', cursorAt(plan, 0) === 4);
  check('and nothing before it', cursorAt(plan, -99) === 0);
  check('and everything before the end', cursorAt(plan, 99) === plan.length);
  check('a chart with no bars has no plan', buildBackingPlan({ bars: [], sections: [] }, 4).length === 0);
}

console.log('\nEvery sounded thing gets exactly one source, at the right moment\n');
{
  const line = timelineOf('D--UX--U');
  const plan = buildBackingPlan(line, 4);
  const { ctx, nodes } = fakeContext();
  const clock = new SongClock({ now: () => ctx.currentTime, running: () => ctx.state === 'running' });
  const backing = new SongBacking(clock, { capo: 0, click: true, contextOf: () => ctx });
  backing.setPlan(plan);

  // The clock is started two seconds before the first downbeat, at context time
  // zero, so a chart moment lands on the context two seconds later.
  clock.start(-2);
  backing.start();
  for (let t = 0; t <= 7; t += 0.05) {
    ctx.currentTime = Number(t.toFixed(3));
    backing.pump();
  }
  backing.stop();

  const expected = plan.map((e) => Number((e.at + 2).toFixed(6))).sort((a, b) => a - b);
  const actual = times(nodes).sort((a, b) => a - b);
  check('one source per event, and no more', nodes.length === plan.length, `${nodes.length} for ${plan.length}`);
  check('every one of them starts where the chart says',
    actual.length === expected.length && actual.every((v, i) => near(v, expected[i], 1e-6)),
    `${actual.slice(0, 6).join()} vs ${expected.slice(0, 6).join()}`);
  check('nothing was queued in the past', nodes.every((n) => n.startedAt >= 0));
}

console.log('\nThe click is a toggle, but the count-in is not\n');
{
  const plan = buildBackingPlan(timelineOf('DD'), 4);
  const { ctx, nodes } = fakeContext();
  const clock = new SongClock({ now: () => ctx.currentTime, running: () => ctx.state === 'running' });
  const backing = new SongBacking(clock, { click: false, contextOf: () => ctx });
  backing.setPlan(plan);
  clock.start(-2);
  backing.start();
  for (let t = 0; t <= 7; t += 0.05) {
    ctx.currentTime = Number(t.toFixed(3));
    backing.pump();
  }
  backing.stop();

  const chords = plan.filter((e) => e.kind === 'chord').length;
  check('with the click off, the count-in still counts you in and the chords still play',
    nodes.length === chords + 4, `${nodes.length} for ${chords} chords plus four`);
  const started = times(nodes).sort((a, b) => a - b);
  check('the four before the downbeat are the count-in',
    started.slice(0, 4).join() === '0,0.5,1,1.5', started.slice(0, 4).join());
  check('and nothing sounds on beats two, three or four of a bar',
    !started.some((t) => near(t, 2.5) || near(t, 3.5)), started.join());
}

console.log('\nA pace change takes back what was queued at the old pace\n');
{
  const plan = buildBackingPlan(timelineOf('DD', 4), 4);
  const { ctx, pending } = fakeContext();
  const clock = new SongClock({ now: () => ctx.currentTime, running: () => ctx.state === 'running' });
  const backing = new SongBacking(clock, { click: true, contextOf: () => ctx });
  backing.setPlan(plan);
  clock.start(0);
  backing.start();
  // The scheduler only queues as far ahead as it expects to sleep, so it takes
  // a few wakes to have anything ahead of the clock at all.
  for (let t = 0; t <= 0.4; t += 0.05) {
    ctx.currentTime = Number(t.toFixed(3));
    backing.pump();
  }
  const beforeChange = pending().slice();
  check('something was queued at the old pace', beforeChange.length > 0, String(beforeChange.length));

  clock.setRate(0.5);
  backing.pump();
  check('every source queued against the old mapping was taken back',
    beforeChange.every((n) => n.stoppedAt === true),
    `${beforeChange.filter((n) => !n.stoppedAt).length} left running`);

  // Wake it until it has queued something ahead of the clock again, so what is
  // compared below is a live queue rather than an empty one.
  for (let t = 0.45; t <= 2 && pending().length === 0; t += 0.05) {
    ctx.currentTime = Number(t.toFixed(3));
    backing.pump();
  }

  // What is live now must be exactly the events from here on, at the new
  // mapping. Anything else is a double-queue: the same bar sounding twice, once
  // at each tempo.
  const position = clock.peek();
  const remaining = plan.filter((e) => e.at >= position);
  const stillLive = pending();
  const mapped = stillLive.map((n) => Number(n.startedAt.toFixed(6))).sort((a, b) => a - b);
  const expected = remaining
    .slice(0, stillLive.length)
    .map((e) => Number(clock.sourceTimeAt(e.at).toFixed(6)))
    .sort((a, b) => a - b);
  check('and what is queued now is the song from here on, at the new pace',
    mapped.length > 0 && mapped.every((v, i) => near(v, expected[i], 1e-6)),
    `${mapped.slice(0, 4).join()} vs ${expected.slice(0, 4).join()}`);
  check('half pace means a bar takes twice as long',
    near(clock.sourceTimeAt(plan.find((e) => e.at >= 2).at) - ctx.currentTime,
      (2 - position) * 2, 1e-6));

  // And no chart moment is represented twice among the sources still to sound.
  const duplicates = mapped.filter((v, i) => i > 0 && v === mapped[i - 1]).length;
  const simultaneous = remaining.slice(0, stillLive.length)
    .map((e) => Number(clock.sourceTimeAt(e.at).toFixed(6)));
  const legitimate = simultaneous.filter((v, i) => simultaneous.indexOf(v) !== i).length;
  check('nothing is queued twice', duplicates === legitimate, `${duplicates} against ${legitimate} genuine ties`);
  backing.stop();
}

console.log('\nSeeking, pausing, and a context that has gone quiet\n');
{
  const plan = buildBackingPlan(timelineOf('DD', 6), 4);
  const { ctx, pending } = fakeContext();
  const clock = new SongClock({ now: () => ctx.currentTime, running: () => ctx.state === 'running' });
  const backing = new SongBacking(clock, { click: true, contextOf: () => ctx });
  backing.setPlan(plan);
  clock.start(0);
  backing.start();
  for (let t = 0; t <= 0.4; t += 0.05) {
    ctx.currentTime = Number(t.toFixed(3));
    backing.pump();
  }
  const queuedBefore = pending().slice();

  clock.seek(8);
  backing.pump();
  check('a seek takes back everything the old position had queued',
    queuedBefore.every((n) => n.stoppedAt === true));
  check('and queues the place it was sent to',
    pending().every((n) => n.startedAt >= ctx.currentTime));
  check('which is where the song is now',
    pending().length > 0 && near(Math.min(...pending().map((n) => n.startedAt)), clock.sourceTimeAt(8), 1e-6),
    String(Math.min(...pending().map((n) => n.startedAt))));

  const afterSeek = pending().slice();
  clock.pause();
  backing.pump();
  check('pausing takes back the queue too', afterSeek.every((n) => n.stoppedAt === true));
  check('and queues nothing while paused', pending().length === 0);

  // The camera takes the output route. A suspended context is handed nothing,
  // and its clock stops: `currentTime` deliberately does not move here, because
  // on a real one it does not either, which is the whole reason the chart holds
  // where it was instead of lurching when the sound comes back.
  clock.resume();
  ctx.state = 'suspended';
  backing.pump();
  check('a suspended context is handed nothing', pending().length === 0);
  ctx.state = 'running';
  backing.pump();
  check('and when it comes back the song is queued again', pending().length > 0);
  check('from where it held, not from where the wall clock got to',
    Math.min(...pending().map((n) => n.startedAt)) >= ctx.currentTime,
    String(Math.min(...pending().map((n) => n.startedAt))));

  const alive = pending().slice();
  backing.stop();
  check('stopping cancels everything still queued',
    alive.length > 0 && alive.every((n) => n.stoppedAt === true), `${alive.length} were queued`);
  check('and the scheduler says it has stopped', backing.isRunning === false);
}

console.log('\nA chord with no shape is silent rather than wrong\n');
{
  const bogus = {
    id: 't', title: 'T', artist: 'A', strum: 'DD', chords: [],
    sections: [{ label: 'V', steps: [{ chord: 'Gbm11' }] }],
  };
  const plan = buildBackingPlan(buildTempoTimeline(bogus, 120).timeline, 0);
  const { ctx, nodes } = fakeContext();
  const clock = new SongClock({ now: () => ctx.currentTime, running: () => ctx.state === 'running' });
  const backing = new SongBacking(clock, { click: false, contextOf: () => ctx });
  backing.setPlan(plan);
  clock.start(0);
  backing.start();
  for (let t = 0; t <= 3; t += 0.05) { ctx.currentTime = Number(t.toFixed(3)); backing.pump(); }
  backing.stop();
  check('the chord the app cannot shape is not played as something else', nodes.length === 0);
}

console.log(failures ? `\n${failures} failed\n` : '\nall good\n');
process.exit(failures ? 1 : 0);
