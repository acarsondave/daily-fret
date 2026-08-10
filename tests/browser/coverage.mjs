// What the app says to someone standing where its data runs out.
//
// src/data/skills.ts maps 37 of its 38 skills into Grade 1. Every Grade 1 module
// is covered; fourteen of the remaining fifteen have no skill pointing at them
// at all, and the fifteenth is module 9, "The F Chord Journey", where exactly one
// skill lands and the taxonomy has no F chord in it even though the detector
// hears one. That gap is a decision rather than an oversight: the skills get
// filled in when the course support gets built. Until then every surface has to
// stay correct, honest and standing for a learner the app has no skill data for.
//
// So this suite walks the whole app from thirteen seeded starting points, most
// of them past the end of the mapped data, and asserts three kinds of thing:
//
//   - nothing crashes and nothing logs an error;
//   - no surface renders as nothing, and no number is computed from an empty
//     set ("0 of 0", NaN, Infinity, a full bar over a zero denominator);
//   - no claim is made that is false for that learner.
//
// It is also the regression net for the day the skills data does get filled in:
// every state here should keep passing when module 15 finally has drills.
//
//   node tests/browser/coverage.mjs [outputDir]
//   ONLY=g3-module-15 node tests/browser/coverage.mjs   one state
//   DUMP=1 node tests/browser/coverage.mjs              print every panel's copy
//
// Against the shared dev server by default; set PREVIEW_URL for a build.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? 'tests/browser/.shots/coverage';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5199/';

let failures = 0;
// Detail explains a failure. Printed on a pass it reads as a complaint, and at
// nine hundred checks it buries the four lines anybody needs.
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail ? `: ${detail}` : ''}`);
};

const pair = (a, b) => `pair:${[a, b].sort().join('|')}`;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

const TASKS = [
  { id: 't1', title: 'Chord Perfect', duration: '10 mins', drill: { kind: 'chord-trainer', durationSec: 90, chords: ['Am', 'Em'] } },
  { id: 't2', title: 'Spider walk', duration: '5 mins' },
  { id: 't3', title: 'One-minute changes', duration: '5 mins', drill: { kind: 'one-minute-changes', durationSec: 60, chords: ['A', 'D'] } },
];

const routine = (name, tasks) => ({ id: 'r1', name, description: '', isDefault: true, tasks });

// Yesterday backwards, so nothing here completes today's routine and pops the
// reflection sheet over every assertion below.
//
// Three key shapes on every day, because a stored result is only readable if the
// panel knows what it was a result of (src/lib/drillKeys.ts):
//
//   pair:A|D     a chord change, keyed this way since before the others existed
//   pool:Am|Em   a Chord Perfect block, and the key `t1` below aliases to
//   ring:A>D>E   one turn of an anchor rotation
//
// `t1` is kept alongside them on purpose. It is a result written under a task id
// before keys named what was played, and it is the case the alias map exists for.
const history = (days) =>
  Object.fromEntries(
    Array.from({ length: days }, (_, i) => {
      const date = daysAgo(i + 1);
      return [date, {
        date, routineId: 'r1', completedTaskIds: ['t1'],
        drillResults: {
          [pair('A', 'D')]: 30 + i,
          'pool:Am|Em': 12 + i,
          'ring:A>D>E': 20 + i,
          t1: 11 + i,
        },
      }];
    }),
  );

const account = (extra) => ({
  activeRoutineId: 'r1',
  routines: [routine('Module 4 Daily', TASKS)],
  dailyLogs: history(12),
  strumPatterns: [], songLinks: [], userSongs: [], updatedAt: 1,
  ...extra,
});

const seed = (extra) => ({ currentAccountId: 'anonymous', accounts: { anonymous: account(extra) } });

/**
 * The starting points.
 *
 * `expect` is what the Journey must actually say for this learner. Every entry
 * is a claim the panel would otherwise be free to get wrong: the grade it names,
 * the module it names, and whether it admits it has no drills here.
 */
const STATES = [
  {
    name: 'g1-mapped',
    what: 'Grade 1 module 4, seven skills mapped. The control.',
    state: seed({ currentLesson: 'b1-403' }),
    journey: { has: [/Module 4/, /Grade 1/], hasNot: [/no drills mapped/] },
  },
  {
    name: 'g2-module-9',
    what: 'Grade 2 module 9, "The F Chord Journey", exactly one skill mapped and it is unmeasurable.',
    state: seed({ currentLesson: 'b2-901' }),
    journey: { has: [/Module 9/, /Grade 2/], hasNot: [] },
  },
  {
    name: 'g2-module-8',
    what: 'Grade 2 module 8, the first module past the mapped data. No skills at all.',
    state: seed({ currentLesson: 'b2-801' }),
    journey: { has: [/Module 8/, /Grade 2/, /no drills mapped/i], hasNot: [] },
  },
  {
    name: 'g2-module-10',
    what: 'Grade 2 module 10, no skills, and no practice history either.',
    state: seed({ currentLesson: 'bg-1001', dailyLogs: {} }),
    journey: { has: [/Module 10/, /Grade 2/, /no drills mapped/i], hasNot: [] },
  },
  {
    name: 'g3-module-15',
    what: 'Grade 3 module 15. No skills anywhere in Grade 3.',
    state: seed({ currentLesson: 'bg-1501' }),
    journey: { has: [/Module 15/, /Grade 3/, /no drills mapped/i], hasNot: [] },
  },
  {
    name: 'g3-module-22',
    what: 'The last module of the beginner course, no skills, no history.',
    state: seed({ currentLesson: 'bg-2201', dailyLogs: {} }),
    journey: { has: [/Module 22/, /Grade 3/, /no drills mapped/i], hasNot: [] },
  },
  {
    name: 'companion',
    what: 'A companion series lesson: Nitsuj Grade 1 Practice, whose module has no number.',
    state: seed({ currentLesson: 'nj-101' }),
    // A companion series is inside the course and outside its numbered path.
    // Saying it "sits outside the beginner course" under a heading naming that
    // course was the panel contradicting itself.
    journey: {
      has: [/companion series alongside the course/],
      hasNot: [/^Module /m, /outside the beginner course/],
    },
  },
  {
    name: 'unknown-lesson',
    what: 'A lesson code the curriculum has never heard of.',
    state: seed({ currentLesson: 'zz-999' }),
    journey: { has: [/Beginner Guitar Course/, /does not hold that lesson/], hasNot: [/^Module /m] },
  },
  {
    name: 'no-lesson',
    what: 'Never said where they are.',
    state: seed({}),
    journey: { has: [/have not said where you are/i], hasNot: [/^Module /m] },
  },
  {
    name: 'no-course',
    what: 'The onboarding "something else" path: a routine, no course, no lesson.',
    state: seed({ routines: [routine('My practice', TASKS)], dailyLogs: {} }),
    journey: { has: [/have not said where you are/i], hasNot: [] },
  },
  {
    name: 'empty-routine',
    what: 'A routine with no tasks at all, and a day logged against it.',
    state: seed({
      currentLesson: 'bg-1501',
      routines: [routine('Module 15 Daily', [])],
      dailyLogs: { [daysAgo(1)]: { date: daysAgo(1), routineId: 'r1', completedTaskIds: [], feedback: 'Just noodled.' } },
    }),
    journey: { has: [/Module 15/], hasNot: [] },
  },
  {
    name: 'no-drills',
    what: 'Tasks, but nothing ever measured.',
    state: seed({ currentLesson: 'bg-1101', dailyLogs: {} }),
    journey: { has: [/Module 11/, /Grade 2/, /no drills mapped/i], hasNot: [] },
  },
  {
    name: 'claims-f',
    what: 'Onboarding wrote chord.F, a skill the taxonomy does not have.',
    // No expectation about F itself: the taxonomy having no F skill is the
    // deferred decision, not the defect. What must hold is that a claim pointing
    // at nothing cannot break a panel or earn a standing, and both are covered by
    // the checks every state runs.
    state: seed({ currentLesson: 'b2-901', dailyLogs: {}, claimedSkills: ['chord.F', 'chord.A', 'chord.D'] }),
    journey: { has: [/Module 9/, /Grade 2/], hasNot: [] },
  },
];

/** One state, by name, when a single seeded case is what is being worked on. */
const ONLY = process.env.ONLY;

const VIEWPORTS = [
  ['390', { width: 390, height: 844 }],
  ['1280', { width: 1280, height: 1000 }],
];

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

async function open(state, viewport) {
  const ctx = await browser.newContext({ viewport, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${String(e).slice(0, 200)}`));
  await page.addInitScript(
    (s) => localStorage.setItem('daily-fret-storage', JSON.stringify({ state: s, version: 0 })),
    state,
  );
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
  } catch {
    await page.waitForTimeout(2500);
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
  }
  await page.waitForSelector('.task-container', { timeout: 25000 });
  return { ctx, page, errors };
}

const sideways = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/**
 * A number computed from an empty set, in the text a person actually reads.
 *
 * "0 of 0" is on this list because it is the shape the app takes when a
 * denominator was empty and nobody noticed: a count of nothing, presented as a
 * measurement of something.
 */
const NONSENSE = /\bNaN\b|\bInfinity\b|\bundefined\b|\[object |\bnull\b|\b0 of 0\b|\bNaN%|\b-0\b/;

/** The offending fragment with enough around it to place, or nothing. */
const nonsenseIn = (text) => {
  const hit = (text ?? '').match(NONSENSE);
  if (!hit) return null;
  const at = Math.max(0, hit.index - 60);
  return `"${hit[0]}" in: ...${(text ?? '').slice(at, at + 160)}...`;
};

const readable = async (page, selector) => {
  const el = page.locator(selector).first();
  if (!(await el.count())) return null;
  return (await el.innerText()).replace(/\s+/g, ' ').trim();
};

/** Every bar in a surface, as its fill fraction, so a full bar over nothing shows. */
const fills = (page, selector) =>
  page.$$eval(selector, (nodes) =>
    nodes.map((n) => {
      const style = getComputedStyle(n);
      const width = style.width;
      const scale = n.style.getPropertyValue('--fill');
      return { width, scale, parent: n.parentElement?.getBoundingClientRect().width ?? 0 };
    }),
  );

/** Controls a finger has to hit. Inline text links are text, and are excluded. */
const smallControls = (page, root) =>
  page.$$eval(`${root} button`, (nodes) =>
    nodes
      .filter((n) => n.offsetParent !== null)
      .map((n) => ({ label: (n.innerText || n.ariaLabel || '').replace(/\s+/g, ' ').trim().slice(0, 40), h: Math.round(n.getBoundingClientRect().height) }))
      .filter((n) => n.h > 0 && n.h < 36),
  );

const TABS = ['Journey', 'Numbers', 'Awards', 'History'];

/**
 * Every panel's text, kept so `DUMP=1` can print the whole set at the end.
 *
 * The assertions catch a number computed from nothing. They cannot catch a
 * sentence that is merely wrong, and most of what this suite is guarding is
 * sentences, so the copy has to be readable as a whole by a person.
 */
const shots = {};

for (const spec of STATES) {
  if (ONLY && spec.name !== ONLY) continue;
  console.log(`\n${spec.name}: ${spec.what}\n`);
  for (const [tag, viewport] of VIEWPORTS) {
    const at = `${spec.name} @${tag}`;
    const { ctx, page, errors } = await open(spec.state, viewport);
    await page.waitForTimeout(500);

    // --- the day's list ----------------------------------------------------
    const listText = await readable(page, '.task-container');
    check(`${at}: the day's list says something`, Boolean(listText) && listText.length > 10, listText);
    check(`${at}: the list holds no empty-set arithmetic`, !NONSENSE.test(listText ?? ''), nonsenseIn(listText));

    // An action that cannot work must not be offered. With no task there is
    // nothing for a coached run to coach.
    const hasTasks = (await page.locator('.task-row').count()) > 0;
    const coached = await page.locator('.progress-launch', { hasText: /^Coached$/ }).count();
    check(`${at}: coached is offered only when there is something to run`, hasTasks === (coached > 0),
      `tasks=${hasTasks} coached=${coached}`);

    // --- the four Progress tabs -------------------------------------------
    await page.locator('.progress-launch', { hasText: /^Progress$/ }).click();
    await page.waitForSelector('.progress-tabs', { timeout: 15000 });

    const offscreen = await page.$$eval('.progress-tab', (nodes) =>
      nodes.filter((n) => { const r = n.getBoundingClientRect(); return r.left < 0 || r.right > window.innerWidth; })
        .map((n) => n.textContent.trim()));
    check(`${at}: every tab is on screen`, offscreen.length === 0, offscreen.join(' '));

    for (const tab of TABS) {
      await page.locator('.progress-tab', { hasText: new RegExp(`^${tab}$`) }).click();
      await page.waitForTimeout(tab === 'Journey' ? 900 : 500);
      const panel = await readable(page, '#progress-panel');
      check(`${at}: ${tab} says something`, Boolean(panel) && panel.length > 40, (panel ?? '').slice(0, 90));
      shots[`${spec.name}-${tag}-${tab}`] = panel;
      check(`${at}: ${tab} holds no empty-set arithmetic`, !NONSENSE.test(panel ?? ''), nonsenseIn(panel));

      if (tab === 'Journey') {
        for (const rx of spec.journey.has) {
          check(`${at}: Journey states ${rx}`, rx.test(panel ?? ''), (panel ?? '').slice(0, 140));
        }
        for (const rx of spec.journey.hasNot) {
          check(`${at}: Journey never claims ${rx}`, !rx.test(panel ?? ''), (panel ?? '').slice(0, 140));
        }
        // A bar drawn full because its denominator was zero is the exact defect
        // an unmapped module invites.
        const bars = await fills(page, '.journey-module-fill, .journey-skill-fill, .journey-next-fill');
        const bogus = bars.filter((b) => b.scale === '' || !Number.isFinite(Number(b.scale)));
        check(`${at}: every Journey bar has a real fraction behind it`, bogus.length === 0,
          JSON.stringify(bogus.slice(0, 3)));
      }

      // A drill whose key the app cannot place is labelled "a drill since
      // removed", which is the honest thing to say about a genuinely lost
      // number and a lie about every result these states seed. It appeared on
      // the day the keys changed, and only a rendered panel could show it.
      if (tab === 'History' || tab === 'Numbers') {
        check(`${at}: ${tab} never calls a live drill a removed one`,
          !/drill since removed/i.test(panel ?? ''), (panel ?? '').slice(0, 160));
      }

      const small = await smallControls(page, '#progress-panel');
      check(`${at}: ${tab} controls are hittable`, small.length === 0, JSON.stringify(small.slice(0, 4)));
      check(`${at}: ${tab} does not scroll sideways`, (await sideways(page)) <= 0);
      await page.screenshot({ path: `${OUT}/${spec.name}-${tag}-${tab.toLowerCase()}.png`, fullPage: tag === '1280' });
    }

    // Opening an unmapped module by hand, which is the one path that reaches a
    // module with no skills without moving the learner there.
    await page.locator('.progress-tab', { hasText: /^Journey$/ }).click();
    await page.waitForTimeout(500);
    const grade3 = page.locator('.journey-grade-head', { hasText: /Grade 3/ }).first();
    if (await grade3.count()) {
      if ((await grade3.getAttribute('aria-expanded')) !== 'true') {
        await grade3.click();
        await page.waitForTimeout(300);
      }
      // The row states the gap in its own count line, so it is also how the row
      // is found. Already open when the learner is standing in it.
      const module = page.locator('.journey-module-head', { hasText: /no drills mapped yet/ }).last();
      if ((await module.getAttribute('aria-expanded')) !== 'true') {
        await module.click();
        await page.waitForTimeout(300);
      }
      const body = await readable(page, '.journey-module.is-open .journey-module-body');
      check(`${at}: an unmapped module states its gap`, /no drills mapped/i.test(body ?? ''), (body ?? '').slice(0, 120));
      check(`${at}: and lists its lessons anyway`,
        (await page.locator('.journey-module.is-open .journey-lesson').count()) > 0);
      await page.screenshot({ path: `${OUT}/${spec.name}-${tag}-unmapped-module.png`, fullPage: tag === '1280' });
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // --- settings ----------------------------------------------------------
    await page.locator('.account-btn').click();
    await page.waitForSelector('.settings-surface', { timeout: 15000 });
    await page.waitForTimeout(400);
    const settings = await readable(page, '.settings-surface');
    check(`${at}: settings say something`, Boolean(settings) && settings.length > 40);
    check(`${at}: settings hold no empty-set arithmetic`, !NONSENSE.test(settings ?? ''), nonsenseIn(settings));
    check(`${at}: settings do not scroll sideways`, (await sideways(page)) <= 0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // --- the tuner ---------------------------------------------------------
    await page.locator('.progress-launch', { hasText: /^Tune$/ }).click();
    await page.waitForSelector('.tuner-overlay, .tuner-blocked', { timeout: 20000 });
    await page.waitForTimeout(900);
    const tuner = await readable(page, '.tuner-overlay, .tuner-blocked');
    check(`${at}: the tuner opens and says something`, Boolean(tuner) && tuner.length > 10);
    check(`${at}: the tuner holds no empty-set arithmetic`, !NONSENSE.test(tuner ?? ''), nonsenseIn(tuner));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // --- a drill, and the coached run --------------------------------------
    if (hasTasks) {
      await page.locator('.task-row').first().click();
      await page.waitForSelector('.practice-overlay', { timeout: 20000 });
      await page.waitForTimeout(1200);
      const drill = await readable(page, '.practice-overlay');
      check(`${at}: the drill opens and says something`, Boolean(drill) && drill.length > 10);
      check(`${at}: the drill holds no empty-set arithmetic`, !NONSENSE.test(drill ?? ''), nonsenseIn(drill));
      await page.screenshot({ path: `${OUT}/${spec.name}-${tag}-drill.png` });
      await page.keyboard.press('Escape');
      // Waited out rather than slept through: the overlay animates away, and a
      // click landing on it mid-exit is a flake rather than a finding.
      await page.waitForSelector('.practice-overlay', { state: 'detached', timeout: 10000 });
      await page.waitForTimeout(300);

      await page.locator('.progress-launch', { hasText: /^Coached$/ }).click();
      await page.waitForSelector('.practice-overlay', { timeout: 20000 });
      await page.waitForTimeout(1200);
      const coachedText = await readable(page, '.practice-overlay');
      check(`${at}: the coached session opens and says something`,
        Boolean(coachedText) && coachedText.length > 10);
      check(`${at}: the coached session holds no empty-set arithmetic`, !NONSENSE.test(coachedText ?? ''),
        nonsenseIn(coachedText));
      check(`${at}: the coached session does not scroll sideways`, (await sideways(page)) <= 0);
      await page.screenshot({ path: `${OUT}/${spec.name}-${tag}-coached.png` });
      await page.keyboard.press('Escape');
      await page.waitForSelector('.practice-overlay', { state: 'detached', timeout: 10000 });
      await page.waitForTimeout(300);
    }

    await page.screenshot({ path: `${OUT}/${spec.name}-${tag}-day.png` });
    check(`${at}: no sideways scroll`, (await sideways(page)) <= 0);
    check(`${at}: no console errors`, errors.length === 0, errors.join(' | ').slice(0, 300));
    await ctx.close();
  }
}

await browser.close();
if (process.env.DUMP) console.log(JSON.stringify(shots, null, 1));
console.log(failures ?  `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
