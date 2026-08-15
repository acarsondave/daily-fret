// Getting the speakers back after something takes them away.
//
// One AudioContext carries the metronome, the coach and the cues, so whatever
// silences it silences all three at once. Opening a microphone does exactly
// that, and the app now films practice sessions, so this stopped being a rare
// interruption and became a thing that happens on purpose in the middle of a
// drill.
//
// The bug this pins down was reported from a real session: the click went quiet
// while filming and never came back. The asking gave up after twenty seconds
// while the camera held the route for the whole eight-minute drill.

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l}${!ok && d ? ' · ' + d : ''}`); };

// --- a controllable world ----------------------------------------------------

let now = 0;
let timers = [];
let resumeCalls = 0;

class FakeAudioContext {
  constructor() {
    this.state = 'suspended';
    this.grantOnNextResume = false;
    this.listeners = [];
    this.sampleRate = 48000;
  }
  addEventListener(kind, fn) { if (kind === 'statechange') this.listeners.push(fn); }
  resume() {
    resumeCalls += 1;
    // A suspended context only ever returns because a resume() succeeded.
    if (this.grantOnNextResume) {
      this.grantOnNextResume = false;
      this.set('running');
    }
    return Promise.resolve();
  }
  createBufferSource() { return { buffer: null, connect() {}, start() {} }; }
  createBuffer() { return {}; }
  /** What the browser does to us, not what we do to it. */
  set(state) {
    this.state = state;
    for (const fn of this.listeners) fn();
  }
}

globalThis.window = globalThis;
globalThis.document = { addEventListener() {}, removeEventListener() {} };
globalThis.AudioContext = FakeAudioContext;
globalThis.performance = { now: () => now };
globalThis.setInterval = (fn, ms) => {
  const t = { fn, ms, next: now + ms, id: timers.length + 1 };
  timers.push(t);
  return t.id;
};
globalThis.clearInterval = (id) => { timers = timers.filter((t) => t.id !== id); };

/** Advance the clock, firing any interval that comes due. */
function tick(ms) {
  const until = now + ms;
  let guard = 0;
  while (guard++ < 10000) {
    const due = timers.filter((t) => t.next <= until).sort((a, b) => a.next - b.next)[0];
    if (!due) break;
    now = due.next;
    due.next = now + due.ms;
    due.fn();
  }
  now = until;
}

const {
  getOutputContext, isOutputAudioReady, requestOutputAudio,
  releaseOutputAudio, nudgeOutputAudio, onOutputAudioChange,
} = await import('../src/audio/outputContext.ts');

const ctx = getOutputContext();

console.log('\nThe route is taken away mid-drill\n');
{
  ctx.set('running');
  check('starts audible', isOutputAudioReady() === true);

  // The metronome starts while audio is already fine. Before the fix this
  // returned early and recorded no intent at all, which is what left nothing
  // asking later.
  requestOutputAudio();

  // Filming opens a microphone; the browser hands the output route away.
  ctx.set('suspended');
  check('goes quiet when the route is taken', isOutputAudioReady() === false);

  resumeCalls = 0;
  tick(5000);
  check('and something is asking for it back', resumeCalls > 0, `${resumeCalls} resume calls`);
}

console.log('\nA camera holds it for the whole drill\n');
{
  resumeCalls = 0;
  const minutes = 8;
  tick(minutes * 60 * 1000);

  // The heart of the reported bug. This used to stop after twenty tries, and a
  // suspended context never resumes itself, so the click was gone for the rest
  // of the session however long the camera held the route.
  check('it is still asking eight minutes in', resumeCalls > 60,
    `${resumeCalls} resume calls over ${minutes} minutes`);
  check('and asking gently, about once a second', resumeCalls <= minutes * 60 + 5,
    `${resumeCalls} calls in ${minutes * 60}s`);

  let heard = null;
  const off = onOutputAudioChange((ready) => { heard = ready; });

  // A real suspended context comes back only because a resume() finally lands,
  // so this is modelled as the next ask succeeding rather than as the browser
  // handing it over unprompted.
  ctx.grantOnNextResume = true;
  tick(2000);

  check('it is picked up the moment the camera lets go', isOutputAudioReady() === true);
  check('and everything listening is told', heard === true, String(heard));
  check('then it stops asking', timers.length === 0, `${timers.length} timers`);
  off();
}

console.log('\nA second interruption is handled like the first\n');
{
  ctx.set('suspended');
  resumeCalls = 0;
  tick(5000);
  check('asking starts again', resumeCalls > 0, `${resumeCalls} resume calls`);
  ctx.grantOnNextResume = true;
  tick(2000);
  check('and recovers again', isOutputAudioReady() === true);
}

console.log('\nWhen nothing wants to be heard\n');
{
  releaseOutputAudio();
  ctx.set('suspended');
  resumeCalls = 0;
  tick(10_000);
  check('a stopped metronome does not keep the media stack busy', resumeCalls === 0,
    `${resumeCalls} resume calls`);
  check('and no timer is left running', timers.length === 0, `${timers.length} timers`);

  nudgeOutputAudio();
  tick(3000);
  check('a camera opening claims nothing on its own', resumeCalls === 0,
    `${resumeCalls} resume calls`);
}

console.log('\nThe nudge, for browsers that suspend without saying so\n');
{
  ctx.state = 'running';
  requestOutputAudio();
  // Suspended with no statechange at all, which WebKit does.
  ctx.state = 'suspended';
  resumeCalls = 0;
  nudgeOutputAudio();
  check('the nudge asks immediately', resumeCalls > 0, `${resumeCalls} resume calls`);
  tick(3000);
  check('and leaves it asking', resumeCalls > 1, `${resumeCalls} resume calls`);
  releaseOutputAudio();
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
