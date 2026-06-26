// One-time coach-voice generator. Run locally with your ElevenLabs API key —
// it writes static MP3s to public/coach/, so the deployed app ships plain audio
// files with NO key and NO runtime cost.
//
// Usage:
//   ELEVENLABS_API_KEY=sk_xxx node scripts/gen-coach-voice.mjs
//   ELEVENLABS_API_KEY=sk_xxx ELEVEN_VOICE_ID=<id> node scripts/gen-coach-voice.mjs --force
//
// Flags:
//   --force   regenerate clips that already exist (otherwise existing ones are skipped)
//
// Env:
//   ELEVENLABS_API_KEY  (required) your key — never commit it
//   ELEVEN_VOICE_ID     (optional) premade/cloned voice id; default below
//   ELEVEN_MODEL_ID     (optional) default eleven_flash_v2_5 (0.5 credit/char)
//
// Spoken drill names: if scripts/drill-names.json exists (run `npm run names`
// first), one `name-<slug>.mp3` is generated per distinct title. The player
// matches a drill to its clip by the same slug; titles without a clip fall back
// to a generic "up next" line in the same voice.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTIONS } from './coach-phrases.mjs';
import { slugify } from './slugify.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../public/coach');
const NAMES_FILE = path.resolve(__dirname, 'drill-names.json');

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVEN_VOICE_ID || 'XrExE9yKIg1WjnnlVkGX';
const MODEL_ID = process.env.ELEVEN_MODEL_ID || 'eleven_flash_v2_5';
const OUTPUT_FORMAT = 'mp3_44100_128';
const FORCE = process.argv.includes('--force');

if (!API_KEY) {
  console.error('✗ Missing ELEVENLABS_API_KEY. Run: ELEVENLABS_API_KEY=sk_xxx node scripts/gen-coach-voice.mjs');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const pad = (n) => String(n).padStart(2, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Load the confirmed drill names (optional). De-dupe by slug defensively.
function loadNames() {
  if (!fs.existsSync(NAMES_FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(NAMES_FILE, 'utf8'));
    const bySlug = new Map();
    for (const entry of raw) {
      const title = (entry?.title ?? '').trim();
      const slug = entry?.slug || slugify(title);
      if (title && slug && !bySlug.has(slug)) bySlug.set(slug, title);
    }
    return [...bySlug.entries()].map(([slug, title]) => ({ slug, title }));
  } catch (err) {
    console.error(`✗ Could not read ${path.basename(NAMES_FILE)}: ${err.message}`);
    process.exit(1);
  }
}

async function synth(text, destPath) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=${OUTPUT_FORMAT}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        // A calm, encouraging coach: stable, a touch of warmth, and slightly
        // slower than default so lines breathe and don't feel rushed.
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed: 0.92 },
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
}

async function main() {
  const names = loadNames();
  console.log(`Voice: ${VOICE_ID}  ·  Model: ${MODEL_ID}  ·  Out: ${OUT_DIR}`);
  console.log(`Sections: ${SECTIONS.length}  ·  Drill names: ${names.length}\n`);

  const counts = {};
  let made = 0;
  let skipped = 0;

  const writeManifest = () =>
    fs.writeFileSync(
      path.join(OUT_DIR, 'manifest.json'),
      JSON.stringify({ counts, names: names.map((n) => n.slug) }, null, 2),
    );

  const render = async (text, name) => {
    const dest = path.join(OUT_DIR, name);
    if (!FORCE && fs.existsSync(dest)) {
      skipped++;
      return;
    }
    process.stdout.write(`→ ${name}  `);
    try {
      await synth(text, dest);
      made++;
      console.log('ok');
    } catch (err) {
      console.log('FAILED');
      console.error(`\n✗ ${err.message}\n`);
      writeManifest(); // keep whatever succeeded usable
      process.exit(1);
    }
    await sleep(350); // gentle pacing for free-tier rate limits
  };

  for (const section of SECTIONS) {
    counts[section.file] = section.lines.length;
    for (let i = 0; i < section.lines.length; i++) {
      await render(section.lines[i], `${section.file}-${pad(i + 1)}.mp3`);
    }
  }

  for (const { slug, title } of names) {
    await render(title, `name-${slug}.mp3`);
  }

  writeManifest();
  console.log(`\n✓ Done. ${made} generated, ${skipped} skipped. Wrote manifest.json`);
  console.log('Commit public/coach/ so Cloudflare serves the clips.');
}

main();
