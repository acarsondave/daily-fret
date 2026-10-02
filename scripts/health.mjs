// One command for a maintenance pass: does it build, do the tests pass, and is
// the live site actually serving a working app.
//
//   npm run health                  build, unit tests, lint, live smoke
//   npm run health -- --live        live smoke only (seconds, no build)
//   npm run health -- --browser     also run every browser suite against a
//                                   local preview, one at a time (slow)
//   HEALTH_URL=https://… npm run health -- --live
//
// The live smoke uses a throwaway browser with nothing signed in, so it reads
// the site and writes nothing anywhere but its own scratch localStorage. It
// runs in Chromium and in WebKit as an iPhone, the Safari check on a host with
// no Mac; WebKit needs `npx playwright install-deps webkit` once per machine.
//
// When CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are set it also says
// which commit production was built from and whether that is origin/main.
//
// Exit code is the number of failed checks (0 is healthy).

import { spawnSync, spawn } from 'node:child_process';
import { setDefaultResultOrder } from 'node:dns';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Cloudflare token is IP-filtered to this host's IPv4 address, and Node
// otherwise prefers whichever family the resolver lists first.
setDefaultResultOrder('ipv4first');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = process.env.HEALTH_URL ?? 'https://routines.minirecc.com/';
const args = new Set(process.argv.slice(2));
const liveOnly = args.has('--live');
const withBrowser = args.has('--browser');

// npm skips devDependencies when NODE_ENV=production, which is set on the VPS
// this usually runs on. Every step here needs them.
const env = { ...process.env, NODE_ENV: 'development' };

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

function run(name, cmd, cmdArgs) {
  const started = Date.now();
  process.stdout.write(`\n▸ ${name}\n`);
  const res = spawnSync(cmd, cmdArgs, { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  if (res.status !== 0) {
    console.log(out.split('\n').filter((l) => /FAIL|error|Error/.test(l)).slice(0, 20).join('\n'));
  }
  record(name, res.status === 0, `${secs}s`);
  return out;
}

// --- local ------------------------------------------------------------------
if (!liveOnly) {
  const build = run('build (tsc + vite)', 'npm', ['run', 'build']);
  const entry = build.match(/assets\/index-[\w-]+\.js\s+([\d.]+) kB │ gzip:\s+([\d.]+) kB/);
  if (entry) console.log(`        entry chunk ${entry[1]} kB (${entry[2]} kB gzip)`);
  run('unit tests', 'npm', ['test']);
  run('lint', 'npm', ['run', 'lint']);
  const audit = spawnSync('npm', ['audit', '--omit=dev', '--json'], { cwd: ROOT, env, encoding: 'utf8' });
  try {
    const v = JSON.parse(audit.stdout).metadata.vulnerabilities;
    const serious = (v.high ?? 0) + (v.critical ?? 0);
    record('npm audit (runtime deps)', serious === 0, `${v.critical} critical, ${v.high} high, ${v.moderate} moderate`);
  } catch {
    record('npm audit (runtime deps)', false, 'could not read npm audit output');
  }
}

if (withBrowser && !liveOnly) {
  // One at a time: these drive real audio through a real browser and share
  // the machine with everything else on it.
  const port = 4199;
  const preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { cwd: ROOT, env, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 3000));
  const suites = readdirSync(join(ROOT, 'tests/browser'))
    .filter((f) => f.endsWith('.mjs') && !['tone.mjs', 'fakeGuitar.mjs'].includes(f))
    .sort();
  // Suites that take BROWSER (tests/browser/engine.mjs) run a second time in
  // WebKit as an iPhone: that is the Safari check on a host with no Mac.
  const runs = suites.flatMap((suite) => {
    const takesEngine = readFileSync(join(ROOT, 'tests/browser', suite), 'utf8').includes('./engine.mjs');
    return takesEngine ? [[suite, 'chromium'], [suite, 'webkit']] : [[suite, null]];
  });
  for (const [suite, engine] of runs) {
    const res = spawnSync('node', [join('tests/browser', suite), '/tmp/daily-fret-health-shots'], {
      cwd: ROOT,
      env: { ...env, PREVIEW_URL: `http://localhost:${port}/`, ...(engine ? { BROWSER: engine } : {}) },
      encoding: 'utf8',
      timeout: 600_000,
    });
    const fails = `${res.stdout ?? ''}`.split('\n').filter((l) => /^\s*FAIL/.test(l));
    record(`browser: ${suite}${engine ? ` (${engine})` : ''}`, res.status === 0, fails.slice(0, 2).join(' / ').trim());
  }
  preview.kill();
}

// --- live -------------------------------------------------------------------
console.log(`\n▸ live site ${LIVE}`);
const get = async (path) => {
  const url = new URL(path, LIVE);
  const res = await fetch(url, { redirect: 'follow' });
  return { url: url.href, status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text() };
};

try {
  const home = await get('/');
  record('home page answers', home.status === 200 && home.type.includes('html'), `${home.status}`);
  const entry = home.body.match(/src="(\/assets\/index-[\w-]+\.js)"/)?.[1];
  record('home page names its entry script', !!entry, entry ?? 'none found');
  if (entry) {
    const js = await get(entry);
    record('entry script is served as JavaScript', js.status === 200 && /javascript/.test(js.type), `${js.status} ${js.type}`);
    // The config is inlined into the sync chunk, which the entry names. Web API
    // keys for Firebase all start AIza.
    const syncChunk = js.body.match(/firebaseSync-[\w-]+\.js/)?.[0];
    const sync = syncChunk ? await get(`/assets/${syncChunk}`) : null;
    record('the build carries a Firebase project', !!sync && /AIza[\w-]{20,}/.test(sync.body),
      sync ? 'cloud sync needs the VITE_FIREBASE_* build variables' : 'no sync chunk named by the entry');
  }
  for (const path of ['/sw.js', '/manifest.webmanifest', '/coach/manifest.json']) {
    const r = await get(path);
    record(`${path} is served`, r.status === 200, `${r.status}`);
  }
  // Pages answers unknown paths with the app shell, so a deep link survives a reload.
  const deep = await get('/some/deep/link');
  record('a deep link falls back to the app', deep.status === 200 && deep.body.includes('id="root"'), `${deep.status}`);
} catch (err) {
  record('live site reachable', false, String(err?.message ?? err));
}

// A real load in a real browser: seed a routine the way an old install saved it
// (one combined task), and check the app splits it and offers a Quick path.
// Run in Chromium and again in WebKit as an iPhone, which is how Safari is
// checked without a Mac or a phone (tests/browser/engine.mjs). WebKit needs
// its system libraries (`npx playwright install-deps webkit`); a host without
// them reports the Safari check as not run instead of passing it.
const { chromium, webkit, devices } = await import('playwright');
for (const [label, launcher, context] of [
  ['', chromium, { viewport: { width: 390, height: 844 } }],
  [' (Safari/WebKit, iPhone)', webkit, { ...devices['iPhone 15'], viewport: { width: 390, height: 844 } }],
]) {
try {
  const browser = await launcher.launch();
  const page = await (await browser.newContext(context)).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.addInitScript(() => {
    if (localStorage.getItem('daily-fret-storage')) return;
    const routine = {
      id: 'health', name: 'Health check', description: '', chords: ['A', 'D', 'E'],
      tasks: [
        { id: 'h1', title: 'Spider walk', duration: '1' },
        { id: 'h2', title: 'Changes', drill: { kind: 'one-minute-changes', durationSec: 60, chords: ['A', 'D', 'E'] } },
      ],
    };
    const account = { activeRoutineId: 'health', routines: [routine], dailyLogs: {}, strumPatterns: [], songLinks: {}, updatedAt: 1 };
    localStorage.setItem('daily-fret-storage', JSON.stringify({ state: { currentAccountId: 'anonymous', accounts: { anonymous: account } }, version: 0 }));
  });
  await page.goto(LIVE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.task-container', { timeout: 30000 });
  const rows = await page.locator('.task-row').count();
  record(`the app renders a routine${label}`, rows > 0, `${rows} rows`);
  record(`a combined task is split into its pairs${label}`, rows === 4, `${rows} rows (want 4)`);
  const quick = page.getByRole('button', { name: /^quick$/i });
  record(`Quick paths is offered${label}`, (await quick.count()) === 1);
  if (await quick.count()) {
    await quick.click();
    await page.waitForSelector('.quick-sheet', { timeout: 10000 });
    record(`the Quick path sheet opens${label}`, (await page.getByRole('checkbox').count()) === 4);
  }
  record(`no uncaught errors on the page${label}`, errors.length === 0, errors.join(' / '));
  await browser.close();
} catch (err) {
  record(`live browser smoke${label}`, false, String(err?.message ?? err).split('\n')[0]);
}
}

// --- deploy -----------------------------------------------------------------
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
if (token && account) {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/daily-fret/deployments?env=production&per_page=1`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const latest = (await res.json()).result?.[0];
    const commit = latest?.deployment_trigger?.metadata?.commit_hash ?? '';
    spawnSync('git', ['fetch', '-q', 'origin', 'main'], { cwd: ROOT });
    const main = spawnSync('git', ['rev-parse', 'origin/main'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
    record('latest production deploy succeeded', latest?.latest_stage?.status === 'success',
      `${latest?.latest_stage?.name} ${latest?.latest_stage?.status}, ${latest?.created_on?.slice(0, 16)}`);
    record('production is origin/main', !!commit && commit === main, `${commit.slice(0, 7)} vs ${main.slice(0, 7)}`);
  } catch (err) {
    record('Cloudflare deploy lookup', false, String(err?.message ?? err));
  }
} else {
  console.log('        (set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID to check which commit is live)');
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n✗ ${failed.length} of ${results.length} checks failed\n` : `\n✓ all ${results.length} checks passed\n`);
process.exit(failed.length);
