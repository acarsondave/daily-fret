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
//   ELEVEN_VOICE_ID     (optional) premade/cloned voice id; default is a warm male voice
//   ELEVEN_MODEL_ID     (optional) default eleven_multilingual_v2

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTIONS } from './coach-phrases.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../public/coach');

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVEN_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'; // "Adam" — stable premade voice
const MODEL_ID = process.env.ELEVEN_MODEL_ID || 'eleven_multilingual_v2';
const OUTPUT_FORMAT = 'mp3_44100_128';
const FORCE = process.argv.includes('--force');

if (!API_KEY) {
  console.error('✗ Missing ELEVENLABS_API_KEY. Run: ELEVENLABS_API_KEY=sk_xxx node scripts/gen-coach-voice.mjs');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const pad = (n) => String(n).padStart(2, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function synth(text, destPath) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=${OUTPUT_FORMAT}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        // A calm, encouraging coach: stable but with a touch of warmth.
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
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
  console.log(`Voice: ${VOICE_ID}  ·  Model: ${MODEL_ID}  ·  Out: ${OUT_DIR}\n`);
  const manifest = {};
  let made = 0;
  let skipped = 0;

  for (const section of SECTIONS) {
    manifest[section.file] = section.lines.length;
    for (let i = 0; i < section.lines.length; i++) {
      const name = `${section.file}-${pad(i + 1)}.mp3`;
      const dest = path.join(OUT_DIR, name);
      if (!FORCE && fs.existsSync(dest)) {
        skipped++;
        continue;
      }
      process.stdout.write(`→ ${name}  `);
      try {
        await synth(section.lines[i], dest);
        made++;
        console.log('ok');
      } catch (err) {
        console.log('FAILED');
        console.error(`\n✗ ${err.message}\n`);
        // Still write the manifest for whatever succeeded so partial runs are usable.
        fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
        process.exit(1);
      }
      await sleep(350); // gentle pacing for free-tier rate limits
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n✓ Done. ${made} generated, ${skipped} skipped. Wrote manifest.json`);
  console.log('Commit public/coach/ so Cloudflare serves the clips.');
}

main();
