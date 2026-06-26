// Single source of truth for turning a drill title into a clip-safe slug.
// MUST stay byte-for-byte identical to slugify() in src/audio/coachVoice.ts so a
// title generated here matches the clip the player looks up at runtime.
export function slugify(s) {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
