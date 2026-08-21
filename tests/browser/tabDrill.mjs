// The riff block, driven in a real browser.
//
// The old renderer put a monospace staff in the slot a description would
// otherwise take, beside a countdown ring, and left it there. Three of its
// faults could only ever be seen in a running page and none of them by a unit
// test: whether the riff actually fits the screen it is read on, whether the
// structure in it is drawn as structure, and whether anything moves.
//
// So every check below is about the rendered page. Nothing here asserts that a
// component mounted: this project has already shipped a feature whose tests all
// passed while the feature did not work, because they confirmed the code ran
// rather than that the thing happened.
//
//   npm run build && npx vite preview --port 5413 --strictPort
//   PREVIEW_URL=http://localhost:5413/ node tests/browser/tabDrill.mjs

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5413/';
const SHOT = (process.argv[2] ?? 'tests/browser/.shots') + '/tab-';
mkdirSync(SHOT.slice(0, SHOT.lastIndexOf('/')), { recursive: true });

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail !== undefined ? `: ${detail}` : ''}`);
};

// --- The riffs ---------------------------------------------------------------
//
// Authored here because a riff's tab lives in the owner's own practice notes,
// not in this repository. Each one is a case the renderer has actually had to
// answer for.

const FIGURE = '0--0--2--2--0--0--2--2';
// Repeat marks at both ends, a count row sitting over its own frets, two bars.
const COUNTED = [
  'Main riff',
  '    1  +  2  +  3  +  4  +',
  `D|:-${FIGURE}-|-${FIGURE}-:|`,
  `A|:-${'-'.repeat(FIGURE.length)}-|-${'-'.repeat(FIGURE.length)}-:|`,
].join('\n');

// A note left ringing, which is the thing the owner had to ask about out loud.
const TIED = [
  'Let it ring',
  '   1  +  2  +  3  +  4  +',
  'e|--0--0--(0)--3--0--0--3-|',
  'B|------------------------|',
].join('\n');

// Three bars over six strings, far wider than a phone.
const WIDE = [
  'Run it up',
  'e|---------------|---------------|---------------|',
  'B|---------------|---------------|---------------|',
  'G|--0--2--4--5---|--5--4--2--0---|--0--2--4--5---|',
  'D|---------------|---------------|---------------|',
  'A|---------------|---------------|---------------|',
  'E|---------------|---------------|---------------|',
].join('\n');

// Two strings, one bar, and no count anywhere in it.
const UNCOUNTED = ['A|:--0--1--2--2--1--0--:|', `E|:${'-'.repeat(20)}:|`].join('\n');

// One riff typed over two staves, each counted over its own frets.
const MULTI = [
  'Verse',
  '    1  +  2  +',
  'e|--0--2--3--0--|',
  'B|--------------|',
  '',
  '    1  +  2  +',
  'e|--3--2--0--2--|',
  'B|--------------|',
].join('\n');

const block = (id, label, note) => ({ id, label, durationSec: 900, note, bpm: 80 });

const account = () => ({
  activeRoutineId: 'r1',
  currentLesson: 'b1-403',
  routines: [
    {
      id: 'r1',
      name: 'Riffs',
      description: '',
      isDefault: true,
      tasks: [
        { id: 't1', title: 'Counted riff', blocks: [block('b1', 'Counted riff', COUNTED)] },
        { id: 't2', title: 'Ringing riff', blocks: [block('b2', 'Ringing riff', TIED)] },
        { id: 't3', title: 'Wide riff', blocks: [block('b3', 'Wide riff', WIDE)] },
        { id: 't4', title: 'Uncounted riff', blocks: [block('b4', 'Uncounted riff', UNCOUNTED)] },
        { id: 't5', title: 'Two staves', blocks: [block('b5', 'Two staves', MULTI)] },
        { id: 't6', title: 'Prose block', blocks: [block('b6', 'Prose block', 'Slowly | then faster.')] },
      ],
    },
  ],
  dailyLogs: {},
  strumPatterns: [],
  songLinks: [],
  updatedAt: 1,
});

const seed = { currentAccountId: 'anonymous', accounts: { anonymous: account() } };

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

async function open(viewport, options = {}) {
  const ctx = await browser.newContext({ viewport, ...options });
  const page = await ctx.newPage();
  const errors = [];
  // The preview build carries no Firebase key, so the app's own "cloud sync
  // unavailable" path fires on every load. That is the environment, not the
  // page, and the app is designed to run signed out.
  const environmental = (text) => /Firebase|Cloud sync unavailable/.test(text);
  const record = (text) => {
    if (!environmental(text)) errors.push(text);
  };
  page.on('console', (m) => m.type() === 'error' && record(m.text()));
  page.on('pageerror', (e) => record(String(e)));
  await page.addInitScript(
    (s) => localStorage.setItem('daily-fret-storage', JSON.stringify({ state: s, version: 0 })),
    seed,
  );
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.task-container');
  return { ctx, page, errors };
}

async function enter(page, title) {
  await page.getByRole('button', { name: `Start ${title}`, exact: true }).click();
  await page.waitForSelector('.practice-overlay');
  await page.waitForSelector('.tab-frame, .timed-desc');
  await page.waitForTimeout(700);
}

async function leave(page) {
  await page.keyboard.press('Escape');
  await page.waitForSelector('.practice-overlay', { state: 'detached' });
}

const sideways = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// --- It fits, at every width it is read at ----------------------------------
{
  console.log('\nThe riff fits the screen it is read on\n');

  for (const vp of [
    { width: 360, height: 740 },
    { width: 390, height: 844 },
    { width: 1366, height: 768 },
  ]) {
    const { ctx, page, errors } = await open(vp);
    console.log(`\n  === ${vp.width}x${vp.height} ===`);

    await enter(page, 'Wide riff');
    check(`${vp.width}: the page does not scroll sideways`, (await sideways(page)) <= 0, await sideways(page));

    const fit = await page.evaluate(() => {
      const frame = document.querySelector('.tab-frame');
      const sheet = document.querySelector('.tab-sheet');
      const systems = [...document.querySelectorAll('.tab-system')];
      const f = frame.getBoundingClientRect();
      const sh = sheet.getBoundingClientRect();
      return {
        overflow: Math.max(sheet.scrollWidth - sheet.clientWidth, frame.scrollWidth - frame.clientWidth),
        systems: systems.length,
        widest: Math.max(...systems.map((s) => s.getBoundingClientRect().width)),
        inner: f.width,
        sheet: sh.width,
        right: Math.max(...systems.map((s) => s.getBoundingClientRect().right)),
        frameRight: sh.right,
        names: systems.map((s) => [...s.querySelectorAll('.tab-name')].length),
      };
    });
    check(`${vp.width}: the staff never scrolls`, fit.overflow <= 1, `${fit.overflow}px`);
    check(`${vp.width}: nothing spills out of the sheet`, fit.right <= fit.frameRight + 1,
      `${fit.right.toFixed(1)} vs ${fit.frameRight.toFixed(1)}`);
    check(`${vp.width}: every system reprints all six string names`,
      fit.names.every((n) => n === 6), fit.names.join(','));
    console.log(`        ${fit.systems} system(s), widest ${fit.widest.toFixed(0)}px, sheet ${fit.sheet.toFixed(0)}px in ${fit.inner.toFixed(0)}px`);
    check(`${vp.width}: the sheet is no wider than the music on it`,
      fit.sheet <= fit.widest + 30, `${fit.sheet.toFixed(0)} vs ${fit.widest.toFixed(0)}`);

    if (vp.width <= 390) {
      check(`${vp.width}: a wide riff wraps rather than scrolling`, fit.systems >= 2, fit.systems);
    } else {
      check('1366: the same riff needs fewer lines', fit.systems <= 2, fit.systems);
    }

    await page.screenshot({ path: `${SHOT}wide-${vp.width}.png`, fullPage: false });
    await leave(page);

    await enter(page, 'Counted riff');
    check(`${vp.width}: still no sideways scroll on the counted riff`, (await sideways(page)) <= 0);
    await page.screenshot({ path: `${SHOT}counted-${vp.width}.png`, fullPage: false });
    await leave(page);

    check(`${vp.width}: no console errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
}

// --- Structure is drawn as structure ----------------------------------------
{
  console.log('\nWhat the drawing says without words\n');
  const { ctx, page, errors } = await open({ width: 1280, height: 900 });

  await enter(page, 'Counted riff');
  const drawn = await page.evaluate(() => ({
    characters: (document.querySelector('.tab-frame').textContent ?? '').replace(/\s/g, ''),
    rules: document.querySelectorAll('.tab-rule').length,
    heavy: document.querySelectorAll('.tab-rule.is-heavy').length,
    repeatDots: document.querySelectorAll('.tab-dot').length,
    returns: document.querySelectorAll('.tab-return path').length,
    arrow: document.querySelectorAll('.tab-return-head').length,
    frets: [...document.querySelectorAll('.tab-fret')].map((t) => t.textContent),
    counts: [...document.querySelectorAll('.tab-count')].map((t) => t.textContent),
    offbeats: document.querySelectorAll('.tab-off').length,
    gaps: [...document.querySelectorAll('.tab-string')].map((g) => g.querySelectorAll('line').length),
    gauges: [...document.querySelectorAll('.tab-string')].map((g) => g.style.strokeWidth),
  }));

  check('there is not a dash or a pipe left in it',
    !/[-|:]/.test(drawn.characters), drawn.characters.slice(0, 60));
  check('bar divisions are drawn as rules', drawn.rules >= 3, drawn.rules);
  check('a repeat is drawn as a heavy rule with two dots',
    drawn.heavy >= 2 && drawn.repeatDots === 4, `${drawn.heavy} heavy, ${drawn.repeatDots} dots`);
  check('and the return is drawn as a return, with a head on it',
    drawn.returns >= 1 && drawn.arrow >= 1, `${drawn.returns} arcs, ${drawn.arrow} heads`);
  check('the frets are all there', drawn.frets.join('') === '0022002200220022', drawn.frets.join(''));
  // Two bars, and the fixture counts only the first. The count is a ruler over
  // equal-width bars, so it is carried across the second rather than stopping at
  // the barline. Sunshine Of Your Love was authored exactly that way and drew a
  // ruler over its opening with nothing over the rest of itself, which is what
  // the owner saw and reported as an unfinished tab.
  check('the count is numbers on the beats', drawn.counts.join('') === '12341234', drawn.counts.join(''));
  check('and dots on the offbeats', drawn.offbeats === 8, drawn.offbeats);
  // The assertion that matters, and the one that was missing: the ruler reaches
  // the end of the music rather than stopping where the author stopped typing.
  const reach = await page.evaluate(() => {
    const counts = [...document.querySelectorAll('.tab-count')];
    const frets = [...document.querySelectorAll('.tab-fret')];
    if (!counts.length || !frets.length) return null;
    const right = (els) => Math.max(...els.map((e) => e.getBoundingClientRect().right));
    return { count: right(counts), fret: right(frets) };
  });
  check('and the count reaches the last note rather than the first barline',
    reach !== null && reach.count >= reach.fret - 40,
    reach && `count ends ${Math.round(reach.count)}, last fret ends ${Math.round(reach.fret)}`);
  check('the string carrying the notes is cut behind every one of them',
    drawn.gaps[0] > 3, drawn.gaps.join(','));
  check('and the empty string beside it runs unbroken',
    drawn.gaps[1] === 1, drawn.gaps.join(','));
  check('and the two strings are drawn at different gauges',
    drawn.gauges[0] !== drawn.gauges[1], drawn.gauges.join(' / '));

  const spoken = await page.evaluate(() =>
    [...document.querySelectorAll('.tab-spoken li')].map((li) => li.textContent));
  check('a screen reader gets the riff as a sequence, not a picture', spoken.length > 4, spoken.length);
  check('it names bars', spoken.some((l) => /^Bar 1$/.test(l)) && spoken.some((l) => /^Bar 2$/.test(l)));
  check('it names the string and the fret', spoken.some((l) => /fret 0/.test(l) && /D/.test(l)),
    spoken.slice(0, 4).join(' | '));
  check('and it says where the repeat goes', spoken.some((l) => /[Rr]epeat/.test(l)),
    spoken[spoken.length - 1]);
  await leave(page);

  await enter(page, 'Ringing riff');
  const ring = await page.evaluate(() => ({
    ties: document.querySelectorAll('.tab-tied path').length,
    tiedFrets: [...document.querySelectorAll('.tab-tied text')].map((t) => t.textContent),
    brackets: (document.querySelector('.tab-frame').textContent ?? '').includes('('),
    spoken: [...document.querySelectorAll('.tab-spoken li')].map((li) => li.textContent),
  }));
  check('a bracketed fret is drawn as a tie', ring.ties === 1 && ring.tiedFrets.join('') === '0',
    `${ring.ties} ties, "${ring.tiedFrets.join('')}"`);
  check('and the brackets themselves are gone', !ring.brackets);
  check('a screen reader is told it is still ringing',
    ring.spoken.some((l) => /still ringing/.test(l)), ring.spoken.join(' | '));
  await leave(page);

  await enter(page, 'Two staves');
  const staves = await page.evaluate(() => ({
    riffs: document.querySelectorAll('.tab-riff').length,
    caption: document.querySelector('.tab-caption')?.textContent,
  }));
  check('two staves are drawn as two staves', staves.riffs === 2, staves.riffs);
  check('and the caption stays on the one it introduced', staves.caption === 'Verse', staves.caption);
  await leave(page);

  await enter(page, 'Prose block');
  const prose = await page.evaluate(() => ({
    staff: document.querySelectorAll('.tab-frame').length,
    text: document.querySelector('.timed-desc')?.textContent,
  }));
  check('a sentence with a pipe in it is still a sentence', prose.staff === 0 && prose.text?.includes('Slowly'),
    `${prose.staff} staves, "${prose.text}"`);
  await leave(page);

  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- Nothing on the sheet moves ---------------------------------------------
//
// The riff carried a playhead for a day: a marker walking the staff at the
// click's tempo behind four count-in pips. It was removed for two reasons, and
// the weaker one was that it was broken. The stronger one is that a marker
// inviting the player to match it, at a tempo taken from the block's BPM rather
// than from the record, asks for sync on a surface that hears nothing. This
// asserts the sheet is still, so it cannot come back by accident.
{
  console.log('\nThe sheet is read, not followed\n');
  const { ctx, page, errors } = await open({ width: 1280, height: 900 });

  await enter(page, 'Counted riff');
  await page.waitForSelector('.tab-system');
  const gone = await page.evaluate(() => ({
    head: document.querySelectorAll('.tab-head').length,
    lit: document.querySelectorAll('.tab-lit').length,
    pip: document.querySelectorAll('.tab-pip').length,
    honesty: document.querySelectorAll('.tab-honesty').length,
  }));
  check('no playhead is drawn', gone.head === 0, gone.head);
  check('no bar marker either', gone.lit === 0, gone.lit);
  check('and no count-in pips', gone.pip === 0, gone.pip);
  // The disclaimer went with the thing it disclaimed. Nothing left on the
  // surface makes a claim about listening, so nothing has to deny one.
  check('nothing left to disclaim', gone.honesty === 0, gone.honesty);

  // The real assertion: the drawing is identical several seconds apart, while
  // the block's clock is running. Entrance animations settle first.
  await page.waitForTimeout(1500);
  const shot = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.tab-system')]
        .map((svg) => {
          const r = svg.getBoundingClientRect();
          return `${r.x.toFixed(1)},${r.y.toFixed(1)},${r.width.toFixed(1)}`;
        })
        .join('|'),
    );
  const before = await shot();
  await page.waitForTimeout(5000);
  check('the staff has not moved five seconds later', (await shot()) === before, before);
  await page.screenshot({ path: `${SHOT}still.png` });
  await leave(page);

  check('no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// --- Reduced motion ----------------------------------------------------------
{
  console.log('\nWith motion turned off\n');
  const { ctx, page } = await open({ width: 1280, height: 900 }, { reducedMotion: 'reduce' });
  // Read immediately. The failure this guards against is not a staff that never
  // appears; it is a staff stranded at the first frame of its own entrance,
  // which a check run a second later would never see.
  await page.getByRole('button', { name: 'Start Counted riff', exact: true }).click();
  await page.waitForSelector('.tab-frame');
  await page.waitForTimeout(50);
  const drawn = await page.evaluate(() =>
    [...document.querySelectorAll('.tab-system')].map((s) => ({
      clip: getComputedStyle(s).clipPath,
      width: s.getBoundingClientRect().width,
    })));
  check('the staff is drawn from the first frame', drawn.length > 0 && drawn.every((s) => s.width > 100),
    JSON.stringify(drawn));
  check('and nothing is left clipped away', drawn.every((s) => s.clip === 'none'),
    drawn.map((s) => s.clip).join(' | '));
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} failed\n` : '\nall good\n');
process.exit(failures ? 1 : 0);
