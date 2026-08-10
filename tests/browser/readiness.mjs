// The held mark, on a real render, in every state it has.
//
// The unit suite proves the rule. This proves the panel says it: that a held
// pair is legible while scanning twenty rows, that a part-built streak stays
// out of that list and speaks in the focus section instead, that the mark never
// dresses itself up as the personal best sitting two lines below it, and that
// none of it pushes the row sideways on a phone.
//
//   PREVIEW_URL=http://localhost:5199/ node tests/browser/readiness.mjs [outDir]

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? 'tests/browser/.shots';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.PREVIEW_URL ?? 'http://localhost:4173/';

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const pair = (a, b) => `pair:${[a, b].sort().join('|')}`;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

// One pair per state the rule can be in, so a single screen carries all of
// them and they can be compared against each other rather than one at a time.
// Values are the owner's own order of magnitude; the bar is 30.
const PLAN = [
  // held, and a long enough history for the chart to have a shape
  ['A', 'D', [38, 41, 36, 44, 40, 43, 41, 46]],
  // held on exactly three, after a spell below the bar
  ['D', 'E', [21, 24, 27, 33, 31, 35]],
  // two of three: the dip two runs back is what keeps this out of held
  ['D', 'Em', [35, 24, 33, 35]],
  // one of three
  ['Am', 'E', [22, 20, 25, 38]],
  // under the bar and climbing
  ['Dm', 'Am', [14, 19, 22, 26]],
  // a single run, which is not a trend and not a streak
  ['C', 'G', [33]],
];
// Held, then left alone past the staleness window.
const LAPSED = ['Am', 'Em', [34, 31, 36]];
const LAPSED_IDLE = 31;

function logs() {
  const byDate = {};
  const put = (date, key, value) => {
    byDate[date] ??= { date, routineId: 'r1', completedTaskIds: ['t1'], drillResults: {} };
    byDate[date].drillResults[key] = value;
  };
  for (const [a, b, values] of PLAN) {
    values.forEach((value, i) => put(daysAgo(values.length - i), pair(a, b), value));
  }
  const [la, lb, lvalues] = LAPSED;
  lvalues.forEach((value, i) => put(daysAgo(LAPSED_IDLE + (lvalues.length - i)), pair(la, lb), value));
  return byDate;
}

const account = () => ({
  activeRoutineId: 'r1',
  currentLesson: 'b1-403',
  routines: [{
    id: 'r1', name: 'Module 4 Daily', description: '', isDefault: true,
    tasks: [
      { id: 't1', title: 'Module 4 Changes', drill: { kind: 'one-minute-changes', durationSec: 60, pairs: [{ from: 'Dm', to: 'Am' }] } },
      { id: 't2', title: 'Spider walk', duration: '5 mins' },
    ],
  }],
  dailyLogs: logs(),
  strumPatterns: [], songLinks: [], updatedAt: 1,
});

const browser = await chromium.launch();

async function openNumbers(viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(
    (s) => localStorage.setItem('daily-fret-storage', JSON.stringify({ state: s, version: 0 })),
    { currentAccountId: 'anonymous', accounts: { anonymous: account() } },
  );
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.task-container');
  await page.getByRole('button', { name: 'Progress' }).click();
  await page.waitForSelector('.progress-tabs');
  await page.locator('.progress-tab', { hasText: /^Numbers$/ }).click();
  await page.waitForSelector('.progress-pair-row');
  await page.waitForTimeout(500);
  return { ctx, page, errors };
}

// Pair keys are order-independent and stored sorted, so the label the panel
// draws is always the alphabetical one. Mirroring `pairKey` here rather than
// spelling the order out at each call site is what stops a test looking for a
// row that renders under the other name.
const rowFor = (page, a, b) => {
  const [from, to] = [a, b].sort();
  return page.locator('.progress-pair-row').filter({ hasText: `${from} ↔ ${to}` }).first();
};

const sideways = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/**
 * Real contrast, which means compositing the translucent surfaces first.
 *
 * A first version took the nearest ancestor with a background and read its
 * colour straight, so every row painted `rgba(255,255,255,0.03)` measured as if
 * it were white and reported 1.92:1 for text that is actually near 10:1. The
 * alpha has to be composited down the stack to an opaque base or the number is
 * worse than no number.
 */
const contrast = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const parse = (c) => {
      const n = (c.match(/[\d.]+/g) ?? []).map(Number);
      return { r: n[0] ?? 0, g: n[1] ?? 0, b: n[2] ?? 0, a: n.length > 3 ? n[3] : 1 };
    };
    const over = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    });
    const lum = ({ r, g, b }) => {
      const [lr, lg, lb] = [r, g, b].map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    };

    // Every painted layer between the text and the first opaque ground.
    const layers = [];
    for (let node = el.parentElement; node; node = node.parentElement) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c.a === 0) continue;
      layers.push(c);
      if (c.a === 1) break;
    }
    let ground = layers.pop() ?? { r: 15, g: 15, b: 17, a: 1 };
    while (layers.length) ground = over(layers.pop(), ground);

    const fg = over(parse(getComputedStyle(el).color), ground);
    const a = lum(fg);
    const b = lum(ground);
    return Number(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2));
  }, selector);

// --- the list, on a laptop --------------------------------------------------
{
  console.log('\nThe list of drills, every state at once\n');
  const { ctx, page, errors } = await openNumbers({ width: 1280, height: 1000 });

  const held = rowFor(page, 'A', 'D');
  check('a pair past the bar three runs running is marked held',
    (await held.locator('.progress-standing.is-held').count()) === 1);
  check('and says the word, not only a tick',
    /held/i.test(await held.locator('.progress-standing').innerText()));
  // Same trap as the focus line: the gap between the name and the mark is a
  // flex gap, which the accessibility tree cannot see. The row is a button, so
  // its accessible name is what a screen-reader user hears for the whole thing.
  check('the row announces the mark as a separate word from the pair',
    /A ↔ D\s+held/i.test((await held.getAttribute('aria-label')) ?? await held.innerText()),
    JSON.stringify(await held.innerText()));

  check('three runs after a dip is also held',
    (await rowFor(page, 'D', 'E').locator('.progress-standing.is-held').count()) === 1);

  // The reversal made visible: two of the last three cleared and the row must
  // stay silent, because "held" would be a claim the player has not earned.
  for (const [a, b, why] of [
    ['D', 'Em', 'a dip two runs back'],
    ['Am', 'E', 'one clearing run'],
    ['Dm', 'Am', 'nothing over the bar'],
    ['C', 'G', 'a single run'],
  ]) {
    check(`${why} earns no mark in the list`,
      (await rowFor(page, a, b).locator('.progress-standing').count()) === 0);
  }

  const lapsed = rowFor(page, 'Am', 'Em');
  check('a held pair left alone past the window reads as lapsed',
    (await lapsed.locator('.progress-standing.is-lapsed').count()) === 1);
  check('and drops the tick, because nothing is currently true',
    (await lapsed.locator('.progress-standing svg').count()) === 0);

  // Held is a floor and the personal best is a peak. If they share a colour the
  // panel is saying the same thing twice in two different registers.
  const heldColour = await page.locator('.progress-standing.is-held').first()
    .evaluate((el) => getComputedStyle(el).color);
  const bestColour = await page.locator('.progress-focus-best').first()
    .evaluate((el) => getComputedStyle(el).color);
  check('held and the personal best are not the same colour', heldColour !== bestColour,
    `${heldColour} vs ${bestColour}`);

  // No pill. A filled chip here would read as a second trend chip.
  const heldBg = await page.locator('.progress-standing.is-held').first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  check('the mark carries no fill of its own', /rgba\(0, 0, 0, 0\)|transparent/.test(heldBg), heldBg);

  check('held text clears 4.5:1', (await contrast(page, '.progress-standing.is-held')) >= 4.5,
    String(await contrast(page, '.progress-standing.is-held')));
  check('lapsed text clears 4.5:1', (await contrast(page, '.progress-standing.is-lapsed')) >= 4.5,
    String(await contrast(page, '.progress-standing.is-lapsed')));

  check('no sideways scroll', (await sideways(page)) <= 0);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${OUT}/readiness-list-1280.png`, fullPage: true });
  await ctx.close();
}

// --- the sentence, per state ------------------------------------------------
{
  console.log('\nThe focus line, which is where a part-built streak speaks\n');
  const { ctx, page, errors } = await openNumbers({ width: 1280, height: 1000 });

  const line = page.locator('.progress-standing-line');
  const say = async (a, b) => {
    await rowFor(page, a, b).click();
    await page.waitForTimeout(250);
    return (await line.innerText()).replace(/\s+/g, ' ').trim();
  };

  const heldText = await say('A', 'D');
  check('held states its window and its bar',
    /held/i.test(heldText) && /at 30 or better/.test(heldText), heldText);

  const twoText = await say('D', 'Em');
  check('two of three is counted out loud', /2 of 3/i.test(twoText), twoText);
  // The label's gap is drawn by a margin, which the accessibility tree cannot
  // see. Without a real space in the markup this reads as "2 of 333 and 35".
  check('and the label is separated from its sentence by an actual space',
    /2 of 3\s+33 and 35/i.test(twoText), twoText);
  check('and says exactly what is left', /one more at 30 or better makes it held/i.test(twoText), twoText);

  const oneText = await say('Am', 'E');
  check('one of three too', /1 of 3/i.test(oneText) && /two more/i.test(oneText), oneText);

  const workingText = await say('Dm', 'Am');
  check('under the bar states the rule rather than scolding',
    /held is three runs running at 30 or better/i.test(workingText), workingText);
  check('and carries no label of its own',
    (await line.locator('.progress-standing-label').count()) === 0, workingText);

  const lapsedText = await say('Am', 'Em');
  check('lapsed says how long and how to undo it',
    /not run for \d+ days/.test(lapsedText) && /brings it back/.test(lapsedText), lapsedText);

  // Two readings of one drill, and they must not collapse into one voice.
  await rowFor(page, 'A', 'D').click();
  await page.waitForTimeout(250);
  check('the trend line and the standing line are both present and distinct',
    (await page.locator('.progress-focus-trend').count()) === 1
    && (await page.locator('.progress-standing-line').count()) === 1);

  check('no console errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${OUT}/readiness-focus-1280.png`, fullPage: true });
  await ctx.close();
}

// --- a propped phone --------------------------------------------------------
{
  console.log('\nA phone at arm\'s length\n');
  const { ctx, page, errors } = await openNumbers({ width: 390, height: 844 });
  check('the mark survives the narrow row',
    (await rowFor(page, 'A', 'D').locator('.progress-standing.is-held').count()) === 1);
  check('the pair name is not truncated to make room for it',
    !(await rowFor(page, 'A', 'D').locator('.progress-pair-name').evaluate(
      (el) => el.scrollWidth > el.clientWidth + 1)));
  check('no sideways scroll', (await sideways(page)) <= 0);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${OUT}/readiness-list-390.png`, fullPage: true });
  await ctx.close();
}

// --- the narrowest phone the app targets ------------------------------------
{
  console.log('\n360px, where the row wraps\n');
  const { ctx, page, errors } = await openNumbers({ width: 360, height: 780 });
  const row = rowFor(page, 'A', 'D');
  check('the mark still reads', (await row.locator('.progress-standing.is-held').count()) === 1);
  check('and stays on the same line as the name it belongs to',
    await row.evaluate((el) => {
      const name = el.querySelector('.progress-pair-name');
      const mark = el.querySelector('.progress-standing');
      if (!name || !mark) return false;
      const a = name.getBoundingClientRect();
      const b = mark.getBoundingClientRect();
      return Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) < 8;
    }));
  check('no sideways scroll', (await sideways(page)) <= 0);
  check('no console errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${OUT}/readiness-list-360.png`, fullPage: true });
  await ctx.close();
}

await browser.close();
console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures ? 1 : 0);
